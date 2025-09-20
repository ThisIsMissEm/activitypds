import events from "node:events";
import http from "node:http";
import cors from "cors";
import express from "express";
import { HttpTerminator, createHttpTerminator } from "http-terminator";
import { DAY, SECOND } from "@atproto/common";

import * as authRoutes from "./auth-router";
import * as appRoutes from "./app-router";
// import * as basicRoutes from "./basic-routes";
import { ServerConfig, ServerSecrets } from "./config";
import { AppContext, AppContextOptions } from "./context";
import * as error from "./error-handler";
import { httpLogger, loggerMiddleware } from "./logger";
import compression from "./utils/compression";

// import * as wellKnown from "./well-known";

export class ActivityPDS {
  public ctx: AppContext;
  public app: express.Application;
  public server?: http.Server;
  private terminator?: HttpTerminator;

  constructor(opts: { ctx: AppContext; app: express.Application }) {
    this.ctx = opts.ctx;
    this.app = opts.app;
  }

  static async create(
    cfg: ServerConfig,
    secrets: ServerSecrets,
    overrides?: Partial<AppContextOptions>
  ): Promise<ActivityPDS> {
    const ctx = await AppContext.fromConfig(cfg, secrets, overrides);

    const app = express();
    app.set("trust proxy", [
      "127.0.0.1",
      // e.g. load balancer
      "loopback",
      "linklocal",
      "uniquelocal",
    ]);

    app.get("/favicon.ico", (req, res) => {
      res.send(Buffer.from(""));
    });

    app.use(loggerMiddleware);
    app.use(compression());

    app.use(authRoutes.createRouter(ctx)); // Before CORS

    app.use(cors({ maxAge: DAY / SECOND }));

    app.get("/.well-known/atproto-did", async (req, res) => {
      console.log(req.hostname, cfg.service.hostname);
      if (req.hostname === cfg.service.hostname) {
        return `did:web:${cfg.service.hostname}`;
      }

      const handleDomain = cfg.service.handleDomains.find((handleDomain) => {
        return req.hostname.endsWith(handleDomain);
      });
      console.log({ handleDomain });
      if (!handleDomain) {
        return res.status(404).send("");
      }

      const account = await ctx.accountManager.getAccount(req.hostname);
      if (!account) {
        return res.status(404).send("");
      }

      res.send(`did:web:${account.handle}`);
    });

    app.get("/.well-known/did.json", async (req, res) => {
      if (req.hostname === cfg.service.hostname) {
        return res.json({
          "@context": [
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/multikey/v1",
          ],
          id: `did:web:${cfg.service.hostname}`,
          verificationMethod: [],
          service: [],
        });
      }

      const handleDomain = cfg.service.handleDomains.find((handleDomain) => {
        return req.hostname.endsWith(handleDomain);
      });

      if (!handleDomain) {
        return res.status(404).json({ error: "not_found" });
      }

      const username = req.hostname.slice(
        0,
        req.hostname.indexOf(handleDomain)
      );

      const account = await ctx.accountManager.getAccount(req.hostname);

      if (!account) {
        return res.status(404).json({ error: "not_found" });
      }

      httpLogger.info({
        hostname: req.hostname,
        handleDomain,
        username,
        account,
      });

      res.json({
        "@context": [
          "https://www.w3.org/ns/did/v1",
          "https://w3id.org/security/multikey/v1",
        ],
        id: `did:web:${account.handle}`,
        alsoKnownAs: [`at://${account.handle}`],
        verificationMethod: [],
        service: [
          {
            id: "#atproto_pds",
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: cfg.service.publicUrl,
          },
        ],
      });
    });

    app.get("/", (req, res) => {
      res.send("Hello ActivityPDS!");
    });

    app.use(appRoutes.createRouter(ctx));

    // app.use(basicRoutes.createRouter(ctx));
    // app.use(wellKnown.createRouter(ctx));

    // app.use fedify

    app.use(error.handler);

    return new ActivityPDS({
      ctx,
      app,
    });
  }

  async start(): Promise<http.Server> {
    const server = this.app.listen(this.ctx.cfg.service.port);
    this.server = server;
    this.server.keepAliveTimeout = 90000;
    this.terminator = createHttpTerminator({ server });
    await events.once(server, "listening");
    return server;
  }

  async destroy(): Promise<void> {
    await this.terminator?.terminate();
    await this.ctx.closeDb();
  }
}

export default ActivityPDS;
