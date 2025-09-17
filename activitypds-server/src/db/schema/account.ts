import { Selectable } from "kysely";

export interface Account {
  handle: string;
  email: string;
  emailConfirmedAt: string | null;
  passwordScrypt: string;
}

export type AccountEntry = Selectable<Account>;

export const tableName = "account";

export type PartialDB = { [tableName]: Account };
