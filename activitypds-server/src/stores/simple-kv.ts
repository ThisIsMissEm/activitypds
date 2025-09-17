import { Transaction } from "kysely";
import { Database, DatabaseSchema, SimpleKVRow, SimpleKVRowEntry } from "../db";
import { Encodable, fromDateISO, toDateISO, toJson } from "../db/cast";

export type SimpleKVRecord =
  | {
      key: string;
      type: string;
      value: string;
    }
  | {
      key: string;
      type: string;
      value: string;
      expiresAt: Date | null;
    };

export type Methods = {
  get(key: string): Promise<SimpleKVRecord | null>;
  put(key: string, value: Encodable, expiresAt?: Date | null): Promise<void>;
  putMapping(type: string, key: string, targetId: string): Promise<void>;
  remove(key: string, addPrefix?: boolean): Promise<SimpleKVRecord | null>;
  removeExpired(expiry?: Date): Promise<void>;
};

export type TransactionCallback = (
  this: Methods,
  trx: Transaction<DatabaseSchema>
) => Promise<void>;

export class SimpleKV implements Methods {
  constructor(protected db: Database, protected type: string) {}

  // Queries:
  getQuery(dbOrTrx: Database | Transaction<DatabaseSchema>, key: string) {
    return dbOrTrx
      .selectFrom("simple_kv_store")
      .where("key", "=", key)
      .selectAll();
  }

  putQuery(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    key: string,
    value: Encodable,
    expiresAt?: Date | null
  ) {
    return dbOrTrx
      .insertInto("simple_kv_store")
      .orReplace()
      .values(this.recordToRow(`${this.type}:${key}`, value, expiresAt));
  }

  putMappingQuery(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    type: string,
    key: string,
    targetId: string
  ) {
    return dbOrTrx
      .insertInto("simple_kv_store")
      .orReplace()
      .values({
        type: `mapping_${type}`,
        key: `${type}:${key}`,
        value: `${this.type}:${targetId}`,
      });
  }

  removeMappingByValueQuery(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    value: string
  ) {
    return dbOrTrx
      .deleteFrom("simple_kv_store")
      .where("value", "=", value)
      .where("type", "like", `mapping_%`);
  }

  removeQuery(dbOrTrx: Database | Transaction<DatabaseSchema>, key: string) {
    return dbOrTrx
      .deleteFrom("simple_kv_store")
      .where("key", "=", key)
      .returningAll();
  }

  removeExpiredQuery(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    expiry: Date
  ) {
    return dbOrTrx
      .deleteFrom("simple_kv_store")
      .where("expiresAt", "<", toDateISO(expiry));
  }

  // Methods:
  async get(key: string): Promise<SimpleKVRecord | null> {
    return this.getInternal(this.db, `${this.type}:${key}`);
  }

  async getMapping(type: string, key?: string): Promise<SimpleKVRecord | null> {
    return this.getInternal(this.db, key ? `${type}:${key}` : type);
  }

  async put(key: string, value: Encodable, expiresAt?: Date | null) {
    return this.putInternal(this.db, key, value, expiresAt);
  }

  async putMapping(type: string, key: string, target: string) {
    return this.putMappingInternal(this.db, type, key, target);
  }

  async remove(key: string, addPrefix?: boolean) {
    return this.removeInternal(this.db, key, addPrefix);
  }

  async removeExpired(expiry?: Date) {
    return this.removeExpiredInternal(this.db, expiry);
  }

  async transaction(transactionCallback: TransactionCallback) {
    await this.db.transaction().execute(async (trx) => {
      const api = {
        get: (key: string) => {
          return this.getInternal(trx, `${this.type}:${key}`);
        },
        put: (key: string, value: Encodable, expiresAt?: Date | null) => {
          return this.putInternal(trx, key, value, expiresAt);
        },
        putMapping: (type: string, key: string, target: string) => {
          return this.putMappingInternal(trx, type, key, target);
        },
        remove: (key: string, addPrefix?: boolean) => {
          return this.removeInternal(trx, key, addPrefix);
        },
        removeExpired: (expiry?: Date) => {
          return this.removeExpiredInternal(trx, expiry);
        },
      };

      await transactionCallback.call(api, trx);
    });
  }

  // Internal methods:
  private async getInternal(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    key: string
  ): Promise<SimpleKVRecord | null> {
    const row = await this.getQuery(dbOrTrx, key).executeTakeFirst();
    if (!row) return null;
    return this.rowToRecord(row);
  }

  private async putInternal(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    key: string,
    value: Encodable,
    expiresAt?: Date | null
  ) {
    await dbOrTrx.executeQuery(this.putQuery(dbOrTrx, key, value, expiresAt));
  }

  private async putMappingInternal(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    type: string,
    key: string,
    target: string
  ) {
    await dbOrTrx.executeQuery(
      this.putMappingQuery(dbOrTrx, type, key, target)
    );
  }

  private async removeInternal(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    key: string,
    addPrefix: boolean = true
  ) {
    const row = await this.removeQuery(
      dbOrTrx,
      addPrefix ? `${this.type}:${key}` : key
    ).executeTakeFirst();

    if (!row) return null;

    await this.removeMappingByValueQuery(
      dbOrTrx,
      addPrefix ? `${this.type}:${key}` : key
    ).execute();

    return this.rowToRecord(row);
  }

  private async removeExpiredInternal(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    expiry?: Date
  ) {
    await dbOrTrx.executeQuery(
      this.removeExpiredQuery(dbOrTrx, expiry ? expiry : new Date())
    );
  }

  // Transformers:
  private rowToRecord(row: SimpleKVRowEntry): SimpleKVRecord {
    return {
      key: row.key.split(":", 2)[1],
      type: row.type,
      value: row.value,
      expiresAt: row.expiresAt ? fromDateISO(row.expiresAt) : null,
    };
  }

  private recordToRow(
    key: string,
    value: Encodable,
    expiresAt?: Date | null
  ): SimpleKVRow {
    return {
      type: this.type,
      key: key,
      value: toJson(value),
      expiresAt: expiresAt ? toDateISO(expiresAt) : null,
    };
  }
}
