import {
  DidWebMethod,
  isResolvedHandle,
  NodeOAuthClient,
  ResolvedHandle,
  ResolveHandleOptions,
} from "@atproto/oauth-client-node";
import { SessionStore, StateStore } from "./storage";
import { AppContext } from "..";

export const createClient = async (ctx: Omit<AppContext, "oauthClient">) => {
  const url = ctx.service.url;
  const didWebResolver = new DidWebMethod({ fetch });

  return new NodeOAuthClient({
    // Custom resolver to work around safeFetch issues in WellKnownHandleResolver,
    // This does mean we don't do DNS TXT record lookups:
    // See: https://github.com/bluesky-social/atproto/issues/4215
    handleResolver: {
      async resolve(
        handle: string,
        options?: ResolveHandleOptions
      ): Promise<ResolvedHandle> {
        const did = await didWebResolver.resolve(`did:web:${handle}`, options);

        if (isResolvedHandle(did.id)) {
          return did.id;
        }

        return null;
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
