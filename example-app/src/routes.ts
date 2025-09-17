import assert from "node:assert";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  OAuthCallbackError,
  OAuthResolverError,
  OAuthResponseError,
} from "@atproto/oauth-client-node";
import { isValidHandle } from "@atproto/syntax";
import express from "express";
import { getIronSession } from "iron-session";
import type { AppContext } from "#/index";
import { login } from "#/pages/login";
import { env } from "#/lib/env";
import { page } from "#/lib/view";
import pinoHttp from "pino-http";
import { debug } from "./pages/debug";

type Session = { did: string };

// Helper function for defining routes
const handler =
  (fn: express.Handler) =>
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };

// Helper function to get the Atproto Agent for the active session
async function getSessionAgent(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  ctx: AppContext
) {
  const session = await getIronSession<Session>(req, res, {
    cookieName: "sid",
    password: env.COOKIE_SECRET,
  });
  if (!session.did) return null;
  try {
    const oauthSession = await ctx.oauthClient.restore(session.did);
    // Here we'd have an ApAgent(oauthSession) which would give a fluent activitypub API:
    return oauthSession ? oauthSession : null;
  } catch (err) {
    ctx.logger.warn({ err }, "oauth restore failed");
    await session.destroy();
    return null;
  }
}

async function getSession(req: express.Request, res: express.Response) {
  return getIronSession<Session>(req, res, {
    cookieName: "sid",
    password: env.COOKIE_SECRET,
  });
}

export const createRouter = (ctx: AppContext) => {
  const router = express.Router();

  // Static assets
  router.use(
    "/public",
    express.static(path.join(__dirname, "pages", "public"))
  );

  const loggerMiddleware = pinoHttp({ logger: ctx.logger });
  router.use(loggerMiddleware);

  // OAuth metadata
  router.get(
    "/client-metadata.json",
    handler((_req, res) => {
      return res.json(ctx.oauthClient.clientMetadata);
    })
  );

  // OAuth callback to complete session creation
  router.get(
    "/oauth/callback",
    handler(async (req, res) => {
      // return res.json({ params: req.query });

      const params = new URLSearchParams(req.originalUrl.split("?")[1]);
      try {
        const { session } = await ctx.oauthClient.callback(params);
        const clientSession = await getSession(req, res);
        assert(!clientSession.did, "session already exists");
        clientSession.did = session.did;
        await clientSession.save();
      } catch (err) {
        ctx.logger.error({ err }, "oauth callback failed");

        if (err instanceof OAuthCallbackError) {
          if (err.cause && err.cause instanceof OAuthResponseError) {
            return res.redirect(`/login?error=${err.cause.error ?? "unknown"}`);
          }
          return res.redirect(`/login?error=${err.params.get("error")}`);
        } else {
          return res.redirect(`/login?error=unknown`);
        }
      }
      return res.redirect("/");
    })
  );

  function errorCodeToMessage(errorCode: string): string | undefined {
    switch (errorCode) {
      case "access_denied":
        return "You rejected the authorization attempt";
      case "server_error":
        return "Server error when completing authorization";
      case "unknown":
        return "An unknown error occurred";
      default:
        return undefined;
    }
  }

  // Login page
  router.get(
    "/login",
    handler(async (req, res) => {
      const error =
        typeof req.query.error === "string"
          ? errorCodeToMessage(req.query.error)
          : undefined;

      return res
        .type("html")
        .send(page(login({ pds_url: ctx.pds.url, error })));
    })
  );

  router.get("/signup", (req, res) => res.redirect("/login"));

  // Login handler
  router.post(
    "/login",
    handler(async (req, res) => {
      // Validate
      const handle = req.body?.handle;
      if (
        typeof handle !== "string" ||
        !(isValidHandle(handle) || URL.canParse(handle))
      ) {
        return res
          .type("html")
          .send(page(login({ pds_url: ctx.pds.url, error: "invalid handle" })));
      }

      // Initiate the OAuth flow
      try {
        const session = await getSession(req, res);
        session.destroy();

        const url = await ctx.oauthClient.authorize(handle, {
          scope: "atproto transition:generic",
          prompt: "select_account",
        });
        return res.redirect(url.toString());
      } catch (err) {
        ctx.logger.error({ err }, "oauth authorize failed");
        return res.type("html").send(
          page(
            login({
              pds_url: ctx.pds.url,
              error:
                err instanceof OAuthResolverError
                  ? err.message
                  : "couldn't initiate login",
            })
          )
        );
      }
    })
  );

  router.post(
    "/signup",
    handler(async (req, res) => {
      const pds = req.body?.pds;
      if (typeof pds !== "string" || !URL.canParse(pds)) {
        return res.type("html").send(
          page(
            login({
              pds_url: ctx.pds.url,
              error: `invalid PDS: ${pds}`,
            })
          )
        );
      }

      try {
        const session = await getSession(req, res);
        session.destroy();

        const url = await ctx.oauthClient.authorize(pds, {
          scope: "atproto transition:generic",
        });
        return res.redirect(url.toString());
      } catch (err) {
        ctx.logger.error({ err }, "oauth authorize failed");
        return res.type("html").send(
          page(
            login({
              pds_url: pds,
              error:
                err instanceof OAuthResolverError
                  ? err.message
                  : "couldn't initiate login",
            })
          )
        );
      }
    })
  );

  // Logout handler
  router.post(
    "/logout",
    handler(async (req, res) => {
      const session = await getSession(req, res);
      const agent = await getSessionAgent(req, res, ctx);
      if (agent) {
        await agent.signOut();
      }

      await session.destroy();
      return res.redirect("/");
    })
  );

  // Homepage
  router.get(
    "/",
    handler(async (req, res) => {
      // If the user is signed in, get an agent which communicates with their server
      const agent = await getSessionAgent(req, res, ctx);

      if (!agent) {
        return res.redirect("/login");
      }

      try {
        const timeout = AbortSignal.timeout(100);
        const response = await agent.fetchHandler("/userinfo", {
          signal: timeout,
        });
        const json = await response.json();

        return res.type("html").send(
          page(
            debug({
              result: {
                credentials: json.credentials,
                account: json.account,
              },
              url: response.url,
            })
          )
        );
      } catch (err) {
        ctx.logger.error(err);
        res.json({ err });
      }
    })
  );

  return router;
};
