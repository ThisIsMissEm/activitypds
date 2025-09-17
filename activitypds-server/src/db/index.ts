import { FileMigrationProvider, Kysely, Migrator, SqliteDialect } from "kysely";
import SqliteDb from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { DatabaseSchema } from "./schema";
import { dbLogger } from "../logger";

export * from "./schema";

const migrationProvider = new FileMigrationProvider({
  fs,
  path,
  // This needs to be an absolute path.
  migrationFolder: path.join(import.meta.dirname, "migrations"),
});

export const createDb = (location: string): Database => {
  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: new SqliteDb(location),
    }),
    log(event) {
      if (event.level === "error") {
        dbLogger.error(
          {
            durationMs: event.queryDurationMillis,
            error: event.error,
            params: event.query.parameters,
          },
          `Query failed: ${event.query.sql}`
        );
      } else {
        dbLogger.info(
          {
            durationMs: event.queryDurationMillis,
            params: event.query.parameters,
          },
          `Query executed: ${event.query.sql}`
        );
      }
    },
  });
};

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
};

export type Database = Kysely<DatabaseSchema>;
