import type { AddressDto, FilterCondition, FilterDto } from "@mailclient/shared";
import { db } from "../db/index.js";
import { filtersRepo } from "../db/filters.js";
import { tagsRepo } from "../db/tags.js";

interface MessageFacts {
  messageId: number;
  threadId: number;
  from: AddressDto[];
  to: AddressDto[];
  subject: string;
  bodyText: string;
}

function checkCondition(c: FilterCondition, m: MessageFacts): boolean {
  const fields: string[] = [];
  if (c.field === "from" || c.field === "any") fields.push(addrText(m.from));
  if (c.field === "to" || c.field === "any") fields.push(addrText(m.to));
  if (c.field === "subject" || c.field === "any") fields.push(m.subject);
  if (c.field === "body" || c.field === "any") fields.push(m.bodyText);
  const haystack = fields.join("\n").toLowerCase();
  const needle = c.value.toLowerCase();
  switch (c.op) {
    case "contains":   return haystack.includes(needle);
    case "equals":     return haystack === needle;
    case "startsWith": return haystack.startsWith(needle);
    case "endsWith":   return haystack.endsWith(needle);
  }
}

function addrText(list: AddressDto[]): string {
  return list.map((a) => `${a.name ?? ""} ${a.address}`).join(" ");
}

function matchesFilter(f: FilterDto, m: MessageFacts): boolean {
  if (!f.enabled) return false;
  if (f.conditions.length === 0) return false;
  if (f.matchType === "all") return f.conditions.every((c) => checkCondition(c, m));
  return f.conditions.some((c) => checkCondition(c, m));
}

export function applyFiltersToMessage(messageId: number) {
  const filters = filtersRepo.list();
  if (filters.length === 0) return;
  const row = db
    .prepare(
      "SELECT id, thread_id, from_json, to_json, subject, body_text FROM messages WHERE id = ?",
    )
    .get(messageId) as
    | {
        id: number;
        thread_id: number;
        from_json: string;
        to_json: string;
        subject: string;
        body_text: string | null;
      }
    | undefined;
  if (!row) return;
  const facts: MessageFacts = {
    messageId: row.id,
    threadId: row.thread_id,
    from: JSON.parse(row.from_json),
    to: JSON.parse(row.to_json),
    subject: row.subject,
    bodyText: row.body_text ?? "",
  };
  for (const f of filters) {
    if (!matchesFilter(f, facts)) continue;
    for (const a of f.actions) {
      try {
        applyAction(a, facts);
      } catch {
        /* don't let one filter action break the whole pipeline */
      }
    }
  }
}

function applyAction(a: { type: string; value?: string }, m: MessageFacts) {
  switch (a.type) {
    case "tag": {
      if (!a.value) return;
      const t = tagsRepo.upsert(a.value, "#94a3b8");
      tagsRepo.attach(m.threadId, t.id);
      return;
    }
    case "markRead":
      db.prepare("UPDATE messages SET unread = 0 WHERE id = ?").run(m.messageId);
      return;
    case "star":
      db.prepare("UPDATE messages SET starred = 1 WHERE id = ?").run(m.messageId);
      return;
    case "delete":
      db.prepare("DELETE FROM messages WHERE id = ?").run(m.messageId);
      db.prepare("DELETE FROM messages_fts WHERE rowid = ?").run(m.messageId);
      return;
    case "moveToFolder":
      // Move requires an IMAP MOVE/COPY+EXPUNGE; deferred to a follow-up.
      return;
  }
}
