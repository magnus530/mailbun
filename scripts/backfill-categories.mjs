/**
 * One-time backfill of the messages.category column for mail synced before
 * categorization existed.
 *
 *   node scripts/backfill-categories.mjs [--apply] [--db <path>]
 *
 * Dry-run by default: reports how many messages WOULD flip to 'promotions'
 * without writing. Pass --apply to persist.
 *
 * These old rows never retained raw headers, so this uses the weaker
 * sender+subject heuristic (categorizeFromFields) — it catches obvious
 * newsletters/marketing but misses header-only signals. New mail synced after
 * this change is categorized accurately at persist time from full headers.
 *
 * Requires a built server: `npm run build -w server` first.
 */
import Database from "better-sqlite3";
import { categorizeFromFields } from "../server/dist/sync/categorize.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dbPath = (() => {
  const i = args.indexOf("--db");
  return i >= 0 ? args[i + 1] : "data/mailclient.sqlite";
})();

const db = new Database(dbPath);

// Guard: column must exist (migration 4 applied).
const hasCategory = db
  .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('messages') WHERE name = 'category'")
  .get().n;
if (!hasCategory) {
  console.error("messages.category not found — start the server once to run migrations, then retry.");
  process.exit(1);
}

const rows = db
  .prepare("SELECT id, from_json, subject, category FROM messages")
  .all();

let promo = 0;
const update = db.prepare("UPDATE messages SET category = ? WHERE id = ?");
const flip = db.transaction((items) => {
  for (const { id, cat } of items) update.run(cat, id);
});

const toFlip = [];
for (const r of rows) {
  let from = [];
  try { from = JSON.parse(r.from_json); } catch { /* leave empty */ }
  const cat = categorizeFromFields(from, r.subject ?? "");
  if (cat === "promotions") promo++;
  if (cat !== r.category) toFlip.push({ id: r.id, cat });
}

console.log(`scanned ${rows.length} messages`);
console.log(`would be promotions: ${promo}`);
console.log(`rows changing: ${toFlip.length}`);
if (apply) {
  flip(toFlip);
  console.log(`applied ${toFlip.length} updates to ${dbPath}`);
} else {
  console.log("dry run — pass --apply to write");
}
db.close();
