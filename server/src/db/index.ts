import Database from "better-sqlite3";
import { paths } from "../paths.js";
import { applyMigrations } from "./migrations.js";

export const db = new Database(paths.dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");
db.pragma("temp_store = MEMORY");

// Migrations run on import — guarantees prepared statements in other modules
// can rely on the schema regardless of import order.
applyMigrations(db);

export function initDb() {
  // No-op kept for backwards compatibility with server.ts call site.
}
