import { Kysely } from "kysely";

const TABLE = "simple_kv_store";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable(TABLE)
    .addColumn("key", "varchar", (col) => col.primaryKey())
    .addColumn("type", "varchar", (col) => col.notNull())
    .addColumn("value", "varchar", (col) => col.notNull())
    .addColumn("expiresAt", "varchar")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable(TABLE).execute();
}
