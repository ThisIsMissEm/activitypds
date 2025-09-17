import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("account")
    .addColumn("handle", "varchar", (col) => col.primaryKey())
    .addColumn("email", "varchar", (col) => col.notNull())
    .addColumn("emailConfirmedAt", "varchar")
    .addColumn("passwordScrypt", "varchar", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex(`account_email_lower_idx`)
    .unique()
    .on("account")
    .expression(sql`lower("email")`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("account").execute();
}
