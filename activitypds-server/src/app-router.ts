import AppContext from "./context";
import { Router } from "express";
import { excludeErrorResult } from "./errors";
import { Account } from "./db/schema";
import * as error from "./error-handler";
import { oauthLogger } from "./logger";

export const createRouter = (ctx: AppContext): Router => {
  const router = Router();

  router.get("/userinfo", async (req, res, next) => {
    try {
      const result = await ctx.authVerifier.oauth({
        async authorize(permissions, ctx) {
          // throw here if not authorized
        },
      })({ req, res, params: {} });

      excludeErrorResult(result);

      let account: Omit<Account, "passwordScrypt"> | null = null;
      if (result.credentials) {
        const accountRecord = await ctx.accountManager.getAccount(
          result.credentials.did.slice()
        );
        if (accountRecord) {
          const { passwordScrypt, ...tmp } = accountRecord;
          account = tmp;
        }
      }

      oauthLogger.info({ ...result, account }, "UserInfo Response");
      res.json({ ...result, account });
    } catch (err) {
      error.handler(err, req, res, next);
    }
  });

  return router;
};
