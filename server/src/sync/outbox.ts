import type { ComposeInput } from "@mailclient/shared";
import { db } from "../db/index.js";
import { sendMessage } from "./send.js";

const RETRY_INTERVAL_MS = 60_000;
const MAX_ATTEMPTS = 8;
// Anything older than this stuck in 'pending'/'sending' is assumed to have
// already been delivered (or to predate the route's "no enqueue after SMTP
// success" guarantee) and is dropped instead of replayed. The cost of
// dropping a genuinely-undelivered queued message is one missing email; the
// cost of replaying an already-delivered one is the recipient seeing
// duplicates — and we've taken that hit before.
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

interface OutboxRow {
  id: number;
  account_id: number;
  payload_json: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
}

export const outbox = {
  enqueue(input: ComposeInput): number {
    const result = db
      .prepare(
        "INSERT INTO outbox (account_id, payload_json, status, attempts, created_at) VALUES (?, ?, 'pending', 0, ?)",
      )
      .run(input.accountId, JSON.stringify(input), Date.now());
    return result.lastInsertRowid as number;
  },
  pending(): OutboxRow[] {
    return db
      .prepare("SELECT * FROM outbox WHERE status = 'pending' AND attempts < ? ORDER BY id LIMIT 20")
      .all(MAX_ATTEMPTS) as OutboxRow[];
  },
  // Atomic claim — only one caller wins per row. Returns true if this caller
  // is now responsible for the row, false if someone else already claimed it.
  claim(id: number): boolean {
    const res = db
      .prepare("UPDATE outbox SET status = 'sending' WHERE id = ? AND status = 'pending'")
      .run(id);
    return res.changes > 0;
  },
  markSent(id: number) {
    db.prepare("UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ?").run(Date.now(), id);
  },
  markFailure(id: number, err: string) {
    db.prepare(
      "UPDATE outbox SET attempts = attempts + 1, last_error = ?, status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END WHERE id = ?",
    ).run(err, MAX_ATTEMPTS, id);
  },
};

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startOutbox() {
  if (timer) return;

  // Boot-time cleanup. Any row stuck in 'pending' or 'sending' past the
  // stale threshold is marked 'failed' so the ticker won't replay it. This
  // is what stops an old, accumulated queue from re-sending a message
  // every time the server restarts.
  const cutoff = Date.now() - STALE_THRESHOLD_MS;
  db.prepare(
    "UPDATE outbox SET status = 'failed', last_error = COALESCE(last_error, ?) WHERE status IN ('pending', 'sending') AND created_at < ?",
  ).run("expired before retry", cutoff);

  const tick = async () => {
    // Re-entrancy guard. Without this, a tick that runs longer than the
    // 60s interval would have a second tick start in parallel; both would
    // call outbox.pending() and grab the same rows. Combined with the
    // claim() check below this gives us defense in depth.
    if (running) return;
    running = true;
    try {
      const rows = outbox.pending();
      for (const row of rows) {
        if (!outbox.claim(row.id)) continue;
        try {
          const input = JSON.parse(row.payload_json) as ComposeInput;
          await sendMessage(input);
          outbox.markSent(row.id);
        } catch (err: any) {
          outbox.markFailure(row.id, err?.message ?? String(err));
        }
      }
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => { tick().catch(() => {}); }, RETRY_INTERVAL_MS);
  timer.unref();
  // Try once on startup.
  tick().catch(() => {});
}

export function stopOutbox() {
  if (timer) clearInterval(timer);
  timer = null;
}
