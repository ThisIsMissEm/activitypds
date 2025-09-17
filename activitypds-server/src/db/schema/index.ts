import * as simpleKV from "./simple-kv-store";
import * as accounts from "./account";

export type DatabaseSchema = simpleKV.PartialDB & accounts.PartialDB;

export type { SimpleKVRowEntry, SimpleKVRow } from "./simple-kv-store";
export type { Account, AccountEntry } from "./account";
