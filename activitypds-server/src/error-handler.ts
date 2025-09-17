import { ErrorRequestHandler } from "express";
import { OAuthError, WWWAuthenticateError } from "@atproto/oauth-provider";
import { httpLogger } from "./logger";

export const handler: ErrorRequestHandler = (err, _req, res, next) => {
  httpLogger.error({ err }, "unexpected internal server error");

  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof WWWAuthenticateError) {
    res.setHeader("WWW-Authenticate", err.wwwAuthenticateHeader);
  }

  if (err instanceof OAuthError) {
    res.status(err.status).json(err.toJSON());
    return;
  }

  res.status(500).json({ error: "Something went wrong :(" });
};
