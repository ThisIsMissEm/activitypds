import { Transaction } from "kysely";
import { Database, DatabaseSchema, SimpleKVRow, SimpleKVRowEntry } from "../db";
import {
  Encodable,
  fromDateISO,
  fromJson,
  JsonEncoded,
  toDateISO,
  toJson,
} from "../db/cast";

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

export type Methods<Mappings extends string[]> = {
  get(key: string): Promise<SimpleKVRecord | null>;
  put(key: string, value: Encodable, expiresAt?: Date | null): Promise<void>;

  getMapping<T extends Encodable>(
    type: Mappings[number],
    key?: string
  ): Promise<T | null>;
  getMultiMapping<T extends Encodable>(
    type: Mappings[number],
    key?: string
  ): Promise<T[] | null>;

  putMapping(
    type: Mappings[number],
    key: string,
    targetId: string | string[]
  ): Promise<void>;

  removeMapping<T extends Encodable>(
    type: Mappings[number],
    key?: string
  ): Promise<T | null>;
  removeMultiMapping<T extends Encodable>(
    type: Mappings[number],
    key?: string
  ): Promise<T[] | null>;

  remove(key: string, addPrefix?: boolean): Promise<SimpleKVRecord | null>;
  removeExpired(expiry?: Date): Promise<void>;
};

export type TransactionCallback<Mapping extends string[]> = (
  this: Methods<Mapping>,
  trx: Transaction<DatabaseSchema>
) => Promise<void>;

export class SimpleKV<Mappings extends Array<string> = []>
  implements Methods<Mappings>
{
  constructor(
    protected db: Database,
    protected type: string,
    protected mappings?: Mappings[number][]
  ) {}

  getPrefix() {
    return `${this.type}:`;
  }

  // Queries:
  getQuery(dbOrTrx: Database | Transaction<DatabaseSchema>, key: string) {
    return dbOrTrx
      .selectFrom("simple_kv_store")
      .where("key", "=", key)
      .selectAll();
  }

  getLikeQuery(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    type: string,
    value: string
  ) {
    return dbOrTrx
      .selectFrom("simple_kv_store")
      .where("key", "like", `${type}:%`)
      .where("value", "like", `%${value}%`)
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
    type: Mappings[number],
    key: string,
    value: string
  ) {
    return dbOrTrx
      .insertInto("simple_kv_store")
      .orReplace()
      .values({
        type: `mapping_${type}_to_${this.type}`,
        key: `${type}:${key}`,
        value,
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
  async get(
    key: string,
    withoutPrefix: boolean = false
  ): Promise<SimpleKVRecord | null> {
    return this.getInternal(
      this.db,
      withoutPrefix ? key : `${this.type}:${key}`
    );
  }

  async getMapping<T extends Encodable>(
    type: Mappings[number],
    key?: string
  ): Promise<T | null> {
    return this.getMappingInternal<T>(this.db, false, type, key);
  }

  async getMultiMapping<T extends Encodable>(
    type: Mappings[number],
    key?: string
  ): Promise<T[] | null> {
    return this.getMappingInternal<T[]>(this.db, true, type, key);
  }

  async put(key: string, value: Encodable, expiresAt?: Date | null) {
    return this.putInternal(this.db, key, value, expiresAt);
  }

  async putMapping(
    type: Mappings[number],
    key: string,
    value: string | string[]
  ) {
    return this.putMappingInternal(this.db, type, key, value);
  }

  async removeMapping<T extends Encodable>(
    type: Mappings[number],
    key?: string
  ) {
    return this.removeMappingInternal<T>(this.db, false, type, key);
  }
  async removeMultiMapping<T extends Encodable>(
    type: Mappings[number],
    key?: string
  ) {
    return this.removeMappingInternal<T[]>(this.db, true, type, key);
  }

  async remove(key: string, addPrefix?: boolean) {
    return this.removeInternal(this.db, key, addPrefix);
  }

  async removeExpired(expiry?: Date) {
    return this.removeExpiredInternal(this.db, expiry);
  }

  async transaction(transactionCallback: TransactionCallback<Mappings>) {
    await this.db.transaction().execute(async (trx) => {
      const api = {
        get: (key: string) => {
          return this.getInternal(trx, `${this.type}:${key}`);
        },
        put: (key: string, value: Encodable, expiresAt?: Date | null) => {
          return this.putInternal(trx, key, value, expiresAt);
        },
        getMapping: <T extends Encodable>(
          type: Mappings[number],
          key?: string
        ) => {
          return this.getMappingInternal<T>(trx, false, type, key);
        },
        getMultiMapping: <T extends Encodable>(
          type: Mappings[number],
          key?: string
        ) => {
          return this.getMappingInternal<T[]>(trx, true, type, key);
        },
        putMapping: (
          type: Mappings[number],
          key: string,
          value: string | string[]
        ) => {
          return this.putMappingInternal(trx, type, key, value);
        },
        removeMapping: <T extends Encodable>(
          type: Mappings[number],
          key?: string
        ) => {
          return this.removeMappingInternal<T>(trx, false, type, key);
        },
        removeMultiMapping: <T extends Encodable>(
          type: Mappings[number],
          key?: string
        ) => {
          return this.removeMappingInternal<T[]>(trx, true, type, key);
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

  private async getMappingInternal<T extends Encodable>(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    multi: boolean,
    type: Mappings[number],
    key?: string
  ) {
    const row = await this.getQuery(
      dbOrTrx,
      key ? `${type}:${key}` : type
    ).executeTakeFirst();
    if (!row) return null;
    if (multi) {
      return fromJson<T>(row.value as JsonEncoded<T>);
    } else {
      return row.value as T;
    }
  }

  private async putMappingInternal(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    type: string,
    key: string,
    target: string | string[]
  ) {
    await dbOrTrx.executeQuery(
      this.putMappingQuery(
        dbOrTrx,
        type,
        key,
        Array.isArray(target) ? toJson(target) : target
      )
    );
  }

  private async removeMappingInternal<T extends Encodable>(
    dbOrTrx: Database | Transaction<DatabaseSchema>,
    multi: boolean,
    type: Mappings[number],
    key?: string
  ) {
    const row = await this.removeQuery(
      dbOrTrx,
      key ? `${type}:${key}` : type
    ).executeTakeFirst();

    if (!row) return null;
    if (multi) {
      return fromJson<T>(row.value as JsonEncoded<T>);
    } else {
      return row.value as T;
    }
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
