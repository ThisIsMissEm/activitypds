import { Selectable } from "kysely";
import { DateISO } from "../cast";

export interface SimpleKVRow {
  key: string;
  value: string;
  type: string;
  expiresAt: DateISO | null;
}

export type SimpleKVRowEntry = Selectable<SimpleKVRow>;

export const tableName = "simple_kv_store";

export type PartialDB = { [tableName]: SimpleKVRowEntry };
