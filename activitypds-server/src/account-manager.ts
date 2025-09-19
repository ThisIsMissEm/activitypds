import {
  AuthenticateAccountData,
  CreateAccountData,
  InvalidRequestError,
  SecondAuthenticationFactorRequiredError,
} from "@atproto/oauth-provider";
import { Database, Account } from "./db";
import * as scrypt from "./utils/scrypt";
import { AuthRequiredError } from "./errors";
import { wait } from "@atproto/common";
import { DID_WEB_PREFIX } from "./constants";

export class UserAlreadyExistsError extends Error {}

export class AccountManager {
  constructor(protected db: Database, protected requireSecondFactor: boolean) {}

  async createAccount({
    password,
    handle,
    email,
  }: Pick<
    CreateAccountData,
    "email" | "handle" | "password"
  >): Promise<Account> {
    if (password && password.length > scrypt.NEW_PASSWORD_MAX_LENGTH) {
      throw new InvalidRequestError("Password too long");
    }

    const passwordScrypt = await scrypt.genSaltAndHash(password);

    const [registered] = await this.db
      .insertInto("account")
      .values({
        handle: handle.toLowerCase(),
        email: email.toLowerCase(),
        passwordScrypt,
      })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .execute();

    if (!registered) {
      throw new UserAlreadyExistsError();
    }

    return registered;
  }

  async login({ username, password, emailOtp }: AuthenticateAccountData) {
    const identifier = username.toLowerCase();

    const start = Date.now();
    try {
      const account = identifier.includes("@")
        ? await this.getAccountByEmail(identifier)
        : await this.getAccount(identifier);

      if (!account) {
        throw new AuthRequiredError("Invalid identifier or password");
      }

      const validAccountPass = await scrypt.verify(
        password,
        account.passwordScrypt
      );

      if (!validAccountPass) {
        throw new AuthRequiredError("Invalid identifier or password");
      }

      if (this.requireSecondFactor && !emailOtp) {
        // generate 2fa token
        throw new SecondAuthenticationFactorRequiredError(
          "emailOtp",
          account.email
        );
      }

      if (emailOtp !== "22222-22222") {
        throw new AuthRequiredError("Invalid identifier or password");
      }

      return account;
    } finally {
      // Mitigate timing attacks
      await wait(350 - (Date.now() - start));
    }
  }

  async exists({ email, handle }: { email?: string; handle?: string }) {
    if (email) {
      const account = await this.db
        .selectFrom("account")
        .where("email", "=", email.toLowerCase())
        .select("email")
        .executeTakeFirst();
      return !!account;
    } else if (handle) {
      const account = await this.db
        .selectFrom("account")
        .where("handle", "=", handle.toLowerCase())
        .select("handle")
        .executeTakeFirst();
      return !!account;
    }
  }

  async getAccount(handleOrDid): Promise<Account | null> {
    const handle = handleOrDid.startsWith(DID_WEB_PREFIX)
      ? handleOrDid.slice(DID_WEB_PREFIX.length)
      : handleOrDid;

    const account = await this.db
      .selectFrom("account")
      .where("handle", "=", handle.toLowerCase())
      .selectAll()
      .executeTakeFirst();

    if (account) return account;
    return null;
  }

  async getAccountByEmail(email): Promise<Account | null> {
    const account = await this.db
      .selectFrom("account")
      .where("email", "=", email.toLowerCase())
      .selectAll()
      .executeTakeFirst();

    if (account) return account;
    return null;
  }
}
