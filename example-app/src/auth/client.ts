import { type ResolveIdentityOptions } from "@atproto-labs/identity-resolver";
import { AtprotoDid, NodeOAuthClient } from "@atproto/oauth-client-node";
import { SessionStore, StateStore } from "./storage";
import { AppContext } from "..";

export const createClient = async (ctx: Omit<AppContext, "oauthClient">) => {
  const url = ctx.service.url;

  return new NodeOAuthClient({
    identityResolver: {
      async resolve(identifier: string, options: ResolveIdentityOptions) {
        const did = `did:web:${identifier}`;
        return {
          handle: identifier,
          did: did as AtprotoDid,
          didDoc: {
            "@context": [
              "https://www.w3.org/ns/did/v1",
              "https://w3id.org/security/multikey/v1",
              "https://w3id.org/security/suites/secp256k1-2019/v1",
            ],
            id: `did:web:${identifier}` as AtprotoDid,
            alsoKnownAs: [`at://${identifier}`],
            verificationMethod: [],
            service: [
              {
                id: "#atproto_pds",
                type: "AtprotoPersonalDataServer",
                serviceEndpoint: ctx.pds.url,
              },
            ],
          },
        };
      },
    },
    clientMetadata: {
      client_name: "AT Protocol Express App",
      client_id: `${url}/client-metadata.json`,
      client_uri: url,
      redirect_uris: [`${url}/oauth/callback`],
      scope: "atproto transition:generic",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "web",
      token_endpoint_auth_method: "none",
      dpop_bound_access_tokens: true,
    },
    stateStore: new StateStore(ctx.db),
    sessionStore: new SessionStore(ctx.db),
  });
};
