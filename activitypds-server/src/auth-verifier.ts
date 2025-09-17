import { KeyObject } from "node:crypto";
import { ServerResponse } from "node:http";
import {
  AuthorizedOptions,
  MethodAuthContext,
  MethodAuthVerifier,
  Params,
} from "./types";
import { AuthRequiredError, InvalidRequestError } from "./errors";
import {
  Account,
  OAuthVerifier,
  VerifyTokenPayloadOptions,
  WWWAuthenticateError,
} from "@atproto/oauth-provider";
import { AccountManager } from "./account-manager";
import { oauthLogger } from "./logger";

export type AuthVerifierOpts = {
  publicUrl: string;
  jwtKey: KeyObject;
};

export type VerifyScopes = {
  scopes: string[];
};

export type VerifiedOptions = {
  checkDeactivated?: boolean;
  checkTakedown?: boolean;
};

export type UnauthenticatedOutput = {
  credentials: null;
};

export type OAuthOutput = {
  credentials: {
    type: "oauth";
    did: string;
    permissions: string[];
  };
};

export type VerifyBearerJwtResult = {
  sub: string;
  aud: string;
  jti: string | undefined;
  scope: string;
};

export class AuthVerifier {
  private publicUrl: string;

  constructor(
    public accountManager: AccountManager,
    public oauthVerifier: OAuthVerifier,
    opts: AuthVerifierOpts
  ) {
    this.publicUrl = opts.publicUrl;
  }

  // verifiers (arrow fns to preserve scope)

  public unauthenticated: MethodAuthVerifier<UnauthenticatedOutput> = (ctx) => {
    setAuthHeaders(ctx.res);

    // @NOTE this auth method is typically used as fallback when no other auth
    // method is applicable. This means that the presence of an "authorization"
    // header means that that header is invalid (as it did not match any of the
    // other auth methods).
    if (ctx.req.headers["authorization"]) {
      throw new AuthRequiredError("Invalid authorization header");
    }

    return {
      credentials: null,
    };
  };

  public oauth({
    authorize,
    ...verifyStatusOptions
  }: VerifiedOptions & AuthorizedOptions): MethodAuthVerifier<OAuthOutput> {
    const verifyTokenOptions: VerifyTokenPayloadOptions = {
      audience: [this.publicUrl],
      scope: ["atproto"],
    };

    return async (ctx) => {
      setAuthHeaders(ctx.res);

      const { req, res } = ctx;

      // https://datatracker.ietf.org/doc/html/rfc9449#section-8.2
      const dpopNonce = this.oauthVerifier.nextDpopNonce();
      if (dpopNonce) {
        res.setHeader("DPoP-Nonce", dpopNonce);
        res.appendHeader("Access-Control-Expose-Headers", "DPoP-Nonce");
      }

      const originalUrl = req.originalUrl || req.url || "/";
      const url = new URL(originalUrl, this.publicUrl);

      oauthLogger.info(
        { url, method: req.method, verifyTokenOptions },
        "auth-verifier:oauth"
      );
      const { scope, sub: did } = await this.oauthVerifier
        .authenticateRequest(
          req.method || "GET",
          url,
          req.headers,
          verifyTokenOptions
        )
        .catch((err) => {
          // Make sure to include any WWW-Authenticate header in the response
          // (particularly useful for DPoP's "use_dpop_nonce" error)
          if (err instanceof WWWAuthenticateError) {
            res.setHeader("WWW-Authenticate", err.wwwAuthenticateHeader);
            res.appendHeader(
              "Access-Control-Expose-Headers",
              "WWW-Authenticate"
            );
          }

          // if (err instanceof OAuthError) {
          //   throw new XRPCError(err.status, err.error_description, err.error);
          // }

          throw err;
        });

      if (typeof did !== "string" || !did.startsWith("did:")) {
        throw new InvalidRequestError("InvalidToken: Malformed token");
      }

      await this.verifyStatus(did, verifyStatusOptions as VerifiedOptions);

      const permissions = scope?.split(" ") ?? [];

      // Should never happen
      // if (!permissions.scopes.has("atproto")) {
      //   throw new InvalidRequestError(
      //     'OAuth token does not have "atproto" scope',
      //     "InvalidToken"
      //   );
      // }

      await authorize(permissions, ctx);

      return {
        credentials: {
          type: "oauth",
          did,
          permissions: permissions,
        },
      };
    };
  }

  protected async verifyStatus(
    did: string,
    options: VerifiedOptions
  ): Promise<void> {
    if (options.checkDeactivated || options.checkTakedown) {
      await this.findAccount(did, options);
    }
  }

  /**
   * Finds an account by its handle or DID, returning possibly deactivated or
   * taken down accounts (unless `options.checkDeactivated` or
   * `options.checkTakedown` are set to true, respectively).
   */
  public async findAccount(
    handleOrDid: string,
    options: VerifiedOptions
  ): Promise<Account> {
    oauthLogger.info({ handleOrDid }, "findAccount");
    const account = await this.accountManager.getAccount(handleOrDid);
    if (!account) {
      // will be turned into ExpiredToken for the client if proxied by entryway
      // throw new ForbiddenError("Account not found", "AccountNotFound");
      throw new AuthRequiredError("Account not found");
    }
    // if (options.checkTakedown && account.deleted) {
    //   throw new AuthRequiredError(
    //     "Account has been taken down",
    //     "AccountTakedown"
    //   );
    // }
    // if (options.checkDeactivated && account.deactivatedAt) {
    //   throw new AuthRequiredError(
    //     "Account is deactivated",
    //     "AccountDeactivated"
    //   );
    // }

    return {
      sub: `did:web:${account.handle}`,
      aud: this.publicUrl,
      email: account.email || undefined,
      email_verified: account.email
        ? account.emailConfirmedAt != null
        : undefined,
      preferred_username: account.handle,
    };
  }
}

// HELPERS
// ---------
function setAuthHeaders(res: ServerResponse) {
  res.setHeader("Cache-Control", "private");
  res.appendHeader("Vary", "Authorization");
}
