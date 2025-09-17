import {
  AccessTokenMode,
  InvalidTokenError,
  JoseKey,
  LexiconResolver,
  OAuthProvider,
  OAuthVerifier,
} from "@atproto/oauth-provider";
import { Fetch, safeFetchWrap } from "@atproto-labs/fetch-node";
// import { AccountManager } from './account-manager/account-manager'
// import { OAuthStore } from './account-manager/oauth-store'
// import { ActorStore } from './actor-store/actor-store'
// import {
//   AuthVerifier,
//   createPublicKeyObject,
//   createSecretKeyObject,
// } from './auth-verifier'
// import { ServerConfig, ServerSecrets } from "./config";
import { dbLogger, fetchLogger, oauthLogger } from "./logger";
import { createSecretKeyObject } from "./secret-key";
import { OAuthStore } from "./stores/oauth";
import { ServerConfig, ServerSecrets } from "./config";
import { AuthVerifier } from "./auth-verifier";
import { AccountManager } from "./account-manager";
import { createDb, Database, migrateToLatest } from "./db";

export type AppContextOptions = {
  // actorStore: ActorStore;
  accountManager: AccountManager;
  safeFetch: Fetch;
  oauthProvider: OAuthProvider;
  authVerifier: AuthVerifier;
  cfg: ServerConfig;
  db: Database;
};

export class AppContext {
  // public actorStore: ActorStore;
  public accountManager: AccountManager;
  public safeFetch: Fetch;
  public authVerifier: AuthVerifier;
  public oauthProvider?: OAuthProvider;
  public cfg: ServerConfig;
  public db: Database;

  private dbDestroyed = false;

  constructor(opts: AppContextOptions) {
    this.db = opts.db;
    // this.actorStore = opts.actorStore;
    this.accountManager = opts.accountManager;
    this.safeFetch = opts.safeFetch;
    this.authVerifier = opts.authVerifier;
    this.oauthProvider = opts.oauthProvider;
    this.cfg = opts.cfg;
  }

  static async fromConfig(
    cfg: ServerConfig,
    secrets: ServerSecrets,
    overrides?: Partial<AppContextOptions>
  ): Promise<AppContext> {
    const jwtSecretKey = createSecretKeyObject(secrets.jwtSecret);
    const jwtPublicKey = null;

    const db = createDb(cfg.db.location);
    await migrateToLatest(db);

    // const actorStore = new ActorStore(db);
    const accountManager = new AccountManager(jwtSecretKey, db);

    /**
     * A fetch() function that protects against SSRF attacks, large responses &
     * known bad domains. This function can safely be used to fetch user
     * provided URLs (unless "disableSsrfProtection" is true, of course).
     *
     * @note **DO NOT** wrap `safeFetch` with any logging or other transforms as
     * this might prevent the use of explicit `redirect: "follow"` init from
     * working. See {@link safeFetchWrap}.
     */
    const safeFetch = safeFetchWrap({
      allowIpHost: false,
      allowPrivateIps: true,
      allowImplicitRedirect: false,
      responseMaxSize: cfg.fetch.maxResponseSize,
      ssrfProtection: !cfg.fetch.disableSsrfProtection,

      // @NOTE Since we are using NodeJS <= 20, unicastFetchWrap would normally
      // *not* be using a keep-alive agent if it we are providing a fetch
      // function that is different from `globalThis.fetch`. However, since the
      // fetch function below is indeed calling `globalThis.fetch` without
      // altering any argument, we can safely force the use of the keep-alive
      // agent. This would not be the case if we used "loggedFetch" as that
      // function does wrap the input & init arguments into a Request object,
      // which, on NodeJS<=20, results in init.dispatcher *not* being used.
      dangerouslyForceKeepAliveAgent: true,
      fetch: function (input, init) {
        const method =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        const uri = input instanceof Request ? input.url : String(input);

        fetchLogger.info({ method, uri }, "fetch");

        return globalThis.fetch.call(this, input, init);
      },
    });

    const oauthStore = new OAuthStore(
      accountManager,
      db,
      cfg.service.publicUrl
    );

    const oauthProvider = new OAuthProvider({
      issuer: cfg.oauth.issuer,
      keyset: [await JoseKey.fromKeyLike(jwtSecretKey, undefined, "HS256")],
      store: oauthStore,
      // redis: redisScratch,
      dpopSecret: secrets.dpopSecret,
      inviteCodeRequired: cfg.invites.required,
      availableUserDomains: cfg.service.handleDomains,
      // hcaptcha: cfg.oauth.provider.hcaptcha,
      // branding: cfg.oauth.provider.branding,
      safeFetch,
      // lexiconResolver,
      metadata: {
        protected_resources: [new URL(cfg.oauth.issuer).origin],
      },

      accessTokenMode: AccessTokenMode.stateful,
      // accessTokenMode: AccessTokenMode.stateless,

      getClientInfo(clientId) {
        return {
          isTrusted: cfg.oauth.provider?.trustedClients?.includes(clientId),
        };
      },
    });

    // The following is only necessary if using an entryway:
    // const oauthVerifier =
    //   oauthProvider ??
    //   new OAuthVerifier({
    //     issuer: cfg.oauth.issuer,
    //     // This is how @atproto/pds does it, but I can't make it work:
    //     keyset: [await JoseKey.fromKeyLike(jwtPublicKey!, undefined, "ES256K")],
    //     // keyset: [await JoseKey.fromKeyLike(jwtSecretKey, undefined, "HS256")],
    //     dpopSecret: secrets.dpopSecret,
    //     // redis: redisScratch,
    //     onDecodeToken: async ({ payload, dpopProof }) => {
    //       oauthLogger.info({ payload }, "onDecodeToken");

    //       const token = await oauthStore.readToken(payload.jti);
    //       if (!token) throw InvalidTokenError.from(null, "DPoP");

    //       payload.scope = token.data.scope ?? "";

    //       return payload;
    //     },
    //   });

    const authVerifier = new AuthVerifier(accountManager, oauthProvider, {
      publicUrl: cfg.service.publicUrl,
      jwtKey: jwtPublicKey ?? jwtSecretKey,
    });

    return new AppContext({
      db,
      // actorStore,
      accountManager,
      safeFetch,
      authVerifier,
      oauthProvider,
      cfg,
      ...(overrides ?? {}),
    });
  }

  async closeDb(): Promise<void> {
    if (this.dbDestroyed) return;
    await this.db
      .destroy()
      .then(() => (this.dbDestroyed = true))
      .catch((err) => dbLogger.error({ err }, "error closing db"));
  }
}

export default AppContext;
