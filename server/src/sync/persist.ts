import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import type { AddressDto } from "@mailclient/shared";
import { db } from "../db/index.js";
import { paths } from "../paths.js";
import { recomputeThread, resolveThreadId } from "./threading.js";
import { applyFiltersToMessage } from "./filters.js";
import { emit } from "./events.js";

function flattenAddresses(addr: AddressObject | AddressObject[] | undefined): AddressDto[] {
  if (!addr) return [];
  const arr = Array.isArray(addr) ? addr : [addr];
  const out: AddressDto[] = [];
  for (const a of arr) {
    for (const v of a.value) {
      if (v.address) out.push({ name: v.name || null, address: v.address });
    }
  }
  return out;
}

function makePreview(parsed: ParsedMail): string {
  const text = parsed.text ?? "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 280);
}

export interface PersistInput {
  accountId: number;
  folderId: number;
  uid: number;
  flags: string[];
  internalDate: number;
  size: number;
  source: Buffer;
}

const insertMessage = db.prepare(`
  INSERT INTO messages (
    account_id, folder_id, thread_id, uid, message_id, in_reply_to, references_json,
    subject, from_json, to_json, cc_json, bcc_json, date, flags_json,
    unread, starred, size, preview, body_text, body_html, has_attachments
  ) VALUES (
    @account_id, @folder_id, @thread_id, @uid, @message_id, @in_reply_to, @references_json,
    @subject, @from_json, @to_json, @cc_json, @bcc_json, @date, @flags_json,
    @unread, @starred, @size, @preview, @body_text, @body_html, @has_attachments
  )
`);

const insertAttachment = db.prepare(`
  INSERT INTO attachments (message_id, filename, content_type, size, content_id, storage_path)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const ftsInsert = db.prepare(`
  INSERT INTO messages_fts (rowid, subject, body, from_addr, to_addr)
  VALUES (?, ?, ?, ?, ?)
`);

const ftsDelete = db.prepare("DELETE FROM messages_fts WHERE rowid = ?");

const messageExists = db.prepare<[number, number, number]>(
  "SELECT id FROM messages WHERE account_id = ? AND folder_id = ? AND uid = ?",
);

const updateMessageFlags = db.prepare<[string, number, number, number]>(
  "UPDATE messages SET flags_json = ?, unread = ?, starred = ? WHERE id = ?",
);

const getMessage = db.prepare<[number]>(
  "SELECT thread_id FROM messages WHERE id = ?",
);

const deleteMessage = db.prepare<[number]>("DELETE FROM messages WHERE id = ?");

export async function persistMessage(input: PersistInput): Promise<number | null> {
  const existing = messageExists.get(input.accountId, input.folderId, input.uid) as
    | { id: number }
    | undefined;
  if (existing) {
    const unread = !input.flags.includes("\\Seen") ? 1 : 0;
    const starred = input.flags.includes("\\Flagged") ? 1 : 0;
    updateMessageFlags.run(JSON.stringify(input.flags), unread, starred, existing.id);
    const row = getMessage.get(existing.id) as { thread_id: number } | undefined;
    if (row) recomputeThread(row.thread_id);
    return existing.id;
  }

  const parsed = await simpleParser(input.source);

  const fromAddrs = flattenAddresses(parsed.from);
  const toAddrs = flattenAddresses(parsed.to);
  const ccAddrs = flattenAddresses(parsed.cc);
  const bccAddrs = flattenAddresses(parsed.bcc);
  const messageId = parsed.messageId ?? null;

  // Claim a pre-existing local row by Message-ID. send.ts pre-inserts
  // outgoing replies with a sentinel uid so they show up in the thread the
  // moment SMTP returns; when the regular sync pass later fetches the
  // server's copy of the same message we want to *update* that row with
  // the real uid + flags, not insert a duplicate. Scoped to the same
  // account+folder so unrelated Gmail-mirrored copies (different folders,
  // same Message-ID) don't accidentally collapse into one row.
  if (messageId) {
    const local = db
      .prepare(
        "SELECT id, thread_id FROM messages WHERE account_id = ? AND folder_id = ? AND message_id = ? LIMIT 1",
      )
      .get(input.accountId, input.folderId, messageId) as
        | { id: number; thread_id: number }
        | undefined;
    if (local) {
      const unread = !input.flags.includes("\\Seen") ? 1 : 0;
      const starred = input.flags.includes("\\Flagged") ? 1 : 0;
      db.prepare(
        "UPDATE messages SET uid = ?, flags_json = ?, unread = ?, starred = ? WHERE id = ?",
      ).run(input.uid, JSON.stringify(input.flags), unread, starred, local.id);
      recomputeThread(local.thread_id);
      return local.id;
    }
  }

  const inReplyTo = parsed.inReplyTo ?? null;
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
    ? [parsed.references]
    : [];
  const subject = parsed.subject ?? "";
  const date = (parsed.date ?? new Date(input.internalDate)).getTime();
  const preview = makePreview(parsed);
  const unread = !input.flags.includes("\\Seen");
  const starred = input.flags.includes("\\Flagged");
  const hasAttachments = (parsed.attachments?.length ?? 0) > 0;

  const threadId = resolveThreadId({
    accountId: input.accountId,
    messageId,
    inReplyTo,
    references,
    subject,
    date,
    fromAddrs,
    preview,
    hasAttachments,
    unread,
    starred,
  });

  const msgIdRowId = insertMessage.run({
    account_id: input.accountId,
    folder_id: input.folderId,
    thread_id: threadId,
    uid: input.uid,
    message_id: messageId,
    in_reply_to: inReplyTo,
    references_json: JSON.stringify(references),
    subject,
    from_json: JSON.stringify(fromAddrs),
    to_json: JSON.stringify(toAddrs),
    cc_json: JSON.stringify(ccAddrs),
    bcc_json: JSON.stringify(bccAddrs),
    date,
    flags_json: JSON.stringify(input.flags),
    unread: unread ? 1 : 0,
    starred: starred ? 1 : 0,
    size: input.size,
    preview,
    body_text: parsed.text ?? null,
    body_html: parsed.html || null,
    has_attachments: hasAttachments ? 1 : 0,
  }).lastInsertRowid as number;

  ftsInsert.run(
    msgIdRowId,
    subject,
    parsed.text ?? "",
    fromAddrs.map((a) => `${a.name ?? ""} ${a.address}`).join(" "),
    [...toAddrs, ...ccAddrs].map((a) => `${a.name ?? ""} ${a.address}`).join(" "),
  );

  for (const att of parsed.attachments ?? []) {
    const filename = att.filename || "attachment";
    const hash = createHash("sha1").update(att.content).digest("hex");
    const storagePath = join(paths.attachmentsDir, `${hash}-${filename}`);
    await writeFile(storagePath, att.content);
    insertAttachment.run(
      msgIdRowId,
      filename,
      att.contentType || "application/octet-stream",
      att.size || att.content.length,
      att.contentId ?? null,
      storagePath,
    );
  }

  applyFiltersToMessage(msgIdRowId);
  recomputeThread(threadId);
  emit({ type: "thread:update", threadId });
  return msgIdRowId;
}

export function removeMessageByUid(accountId: number, folderId: number, uid: number) {
  const row = db
    .prepare("SELECT id, thread_id FROM messages WHERE account_id = ? AND folder_id = ? AND uid = ?")
    .get(accountId, folderId, uid) as { id: number; thread_id: number } | undefined;
  if (!row) return;
  ftsDelete.run(row.id);
  deleteMessage.run(row.id);
  recomputeThread(row.thread_id);
}

export function updateFolderCounts(folderId: number) {
  const agg = db
    .prepare(
      "SELECT COUNT(*) AS total, SUM(unread) AS unread FROM messages WHERE folder_id = ?",
    )
    .get(folderId) as { total: number; unread: number | null };
  db.prepare("UPDATE folders SET total_count = ?, unread_count = ? WHERE id = ?").run(
    agg.total,
    agg.unread ?? 0,
    folderId,
  );
}
