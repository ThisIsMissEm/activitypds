import { type IncomingMessage } from "node:http";
import { stdSerializers } from "pino";
import { pinoHttp } from "pino-http";

import { obfuscateHeaders, subsystemLogger } from "@atproto/common";

export const httpLogger = subsystemLogger("pds");
export const dbLogger = subsystemLogger("pds:db");
export const fetchLogger = subsystemLogger("pds:fetch");
export const oauthLogger = subsystemLogger("pds:oauth");

export const loggerMiddleware = pinoHttp({
  logger: httpLogger,
  autoLogging: {
    ignore(req: IncomingMessage): boolean {
      if (
        (req.url && req.url.startsWith("/@atproto/oauth-provider/~assets/")) ||
        req.url === "/favicon.ico"
      ) {
        return true;
      }
      return false;
    },
  },
  serializers: {
    req: reqSerializer,
    err: (err: unknown) => ({
      code: err?.["code"],
      message: err?.["message"],
    }),
  },
});

export function reqSerializer(req: IncomingMessage) {
  const serialized = stdSerializers.req(req);
  const headers = obfuscateHeaders(serialized.headers);
  return { ...serialized, headers };
}
