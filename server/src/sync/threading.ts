import type { AddressDto } from "@mailclient/shared";
import { db } from "../db/index.js";

const SUBJECT_PREFIX_RE = /^\s*((re|fw|fwd|aw|sv|tr|rv|res)\s*(\[\d+\])?\s*:\s*)+/i;

export function normalizeSubject(subject: string): string {
  let s = (subject ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(SUBJECT_PREFIX_RE, "");
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase();
}

interface ThreadResolveInput {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  date: number;
  fromAddrs: AddressDto[];
  preview: string;
  hasAttachments: boolean;
  unread: boolean;
  starred: boolean;
}

const findByMessageIds = db.prepare<[string], { thread_id: number }>(
  "SELECT thread_id FROM messages WHERE message_id = ? LIMIT 1",
);

const insertThread = db.prepare<[string, number, string, string]>(
  `INSERT INTO threads (subject_normalized, last_date, preview, participants_json)
   VALUES (?, ?, ?, ?)`,
);

export function resolveThreadId(input: ThreadResolveInput): number {
  // 1) Strongest signal: an existing message we already have whose Message-ID
  //    matches one of this message's references / in-reply-to.
  const candidates = [input.inReplyTo, ...input.references].filter(
    (x): x is string => !!x,
  );
  for (const ref of candidates) {
    const hit = findByMessageIds.get(ref);
    if (hit) return hit.thread_id;
  }
  // 2) If THIS message's Message-ID is already known (re-fetch), reuse.
  if (input.messageId) {
    const hit = findByMessageIds.get(input.messageId);
    if (hit) return hit.thread_id;
  }
  // 3) Subject-based fallback: same normalized subject within 14 days, between
  //    overlapping participants. Conservative — only matches obvious follow-ups.
  const normalized = normalizeSubject(input.subject);
  if (normalized.length > 0) {
    const cutoff = input.date - 14 * 24 * 60 * 60 * 1000;
    const row = db
      .prepare(
        `SELECT id FROM threads
         WHERE subject_normalized = ? AND last_date >= ?
         ORDER BY last_date DESC LIMIT 1`,
      )
      .get(normalized, cutoff) as { id: number } | undefined;
    if (row) return row.id;
  }
  // 4) New thread.
  const result = insertThread.run(
    normalized,
    input.date,
    input.preview,
    JSON.stringify(input.fromAddrs),
  );
  return result.lastInsertRowid as number;
}

const recomputeStmts = {
  agg: db.prepare<[number, number]>(
    `SELECT
       COUNT(*) AS cnt,
       SUM(unread) AS unread_cnt,
       MAX(starred) AS any_starred,
       MAX(has_attachments) AS any_attach,
       MAX(date) AS last_date,
       (SELECT preview FROM messages WHERE thread_id = ? ORDER BY date DESC LIMIT 1) AS preview
     FROM messages WHERE thread_id = ?`,
  ),
  participants: db.prepare<[number]>(
    `SELECT from_json FROM messages WHERE thread_id = ? ORDER BY date`,
  ),
  update: db.prepare(
    `UPDATE threads SET
       message_count = ?, unread_count = ?, has_starred = ?, has_attachments = ?,
       last_date = ?, preview = ?, participants_json = ?
     WHERE id = ?`,
  ),
};

export function recomputeThread(threadId: number) {
  const agg = recomputeStmts.agg.get(threadId, threadId) as {
    cnt: number;
    unread_cnt: number | null;
    any_starred: number | null;
    any_attach: number | null;
    last_date: number | null;
    preview: string | null;
  };
  if (!agg || agg.cnt === 0) {
    db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
    return;
  }
  const rows = recomputeStmts.participants.all(threadId) as { from_json: string }[];
  const seen = new Map<string, AddressDto>();
  for (const r of rows) {
    try {
      const list = JSON.parse(r.from_json) as AddressDto[];
      for (const a of list) {
        const k = (a.address || "").toLowerCase();
        if (k && !seen.has(k)) seen.set(k, a);
      }
    } catch {
      /* ignore */
    }
  }
  recomputeStmts.update.run(
    agg.cnt,
    agg.unread_cnt ?? 0,
    agg.any_starred ?? 0,
    agg.any_attach ?? 0,
    agg.last_date ?? 0,
    agg.preview ?? "",
    JSON.stringify([...seen.values()]),
    threadId,
  );
}
