import type {
  AddressDto,
  FolderRole,
  MessageBodyDto,
  MessageSummaryDto,
  SearchQuery,
  TagDto,
  ThreadDto,
} from "@mailclient/shared";
import { db } from "./index.js";

interface ThreadRow {
  id: number;
  subject_normalized: string;
  last_date: number;
  message_count: number;
  unread_count: number;
  has_starred: number;
  has_attachments: number;
  preview: string;
  participants_json: string;
}

interface MessageRow {
  id: number;
  account_id: number;
  folder_id: number;
  thread_id: number;
  uid: number;
  message_id: string | null;
  in_reply_to: string | null;
  references_json: string;
  subject: string;
  from_json: string;
  to_json: string;
  cc_json: string;
  bcc_json: string;
  date: number;
  flags_json: string;
  unread: number;
  starred: number;
  size: number;
  preview: string;
  body_text: string | null;
  body_html: string | null;
  has_attachments: number;
}

function parseAddrs(json: string): AddressDto[] {
  try { return JSON.parse(json) as AddressDto[]; } catch { return []; }
}
function parseFlags(json: string): string[] {
  try { return JSON.parse(json) as string[]; } catch { return []; }
}

function messageRowToSummary(r: MessageRow): MessageSummaryDto {
  return {
    id: r.id,
    accountId: r.account_id,
    threadId: r.thread_id,
    folderId: r.folder_id,
    uid: r.uid,
    messageId: r.message_id,
    inReplyTo: r.in_reply_to,
    from: parseAddrs(r.from_json),
    to: parseAddrs(r.to_json),
    cc: parseAddrs(r.cc_json),
    bcc: parseAddrs(r.bcc_json),
    subject: r.subject,
    preview: r.preview,
    date: new Date(r.date).toISOString(),
    flags: parseFlags(r.flags_json),
    hasAttachments: !!r.has_attachments,
    size: r.size,
    unread: !!r.unread,
    starred: !!r.starred,
  };
}

function threadRowToDto(
  r: ThreadRow,
  msgs: MessageRow[],
  tags: TagDto[],
): ThreadDto {
  const subject = msgs.find((m) => !m.in_reply_to)?.subject ?? msgs[0]?.subject ?? "(no subject)";
  const accountIds = [...new Set(msgs.map((m) => m.account_id))];
  const folderIdsToRoles = new Map<number, FolderRole | null>();
  const folderRoles = new Set<FolderRole>();
  if (msgs.length > 0) {
    const ids = msgs.map((m) => m.folder_id);
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, role FROM folders WHERE id IN (${placeholders})`)
      .all(...ids) as { id: number; role: FolderRole | null }[];
    for (const f of rows) {
      folderIdsToRoles.set(f.id, f.role);
      if (f.role) folderRoles.add(f.role);
    }
  }
  return {
    id: r.id,
    subject,
    participants: parseAddrs(r.participants_json),
    // Counts are derived from the (deduped) msgs caller passes in rather
    // than the threads-table aggregates. That stops Gmail-mirrored threads
    // from showing "2 messages" when there's actually one logical message
    // living in INBOX + [Gmail]/All Mail.
    messageCount: msgs.length,
    unreadCount: msgs.filter((m) => !!m.unread).length,
    hasStarred: !!r.has_starred,
    hasAttachments: !!r.has_attachments,
    lastDate: new Date(r.last_date).toISOString(),
    preview: r.preview,
    tags,
    accountIds,
    folderRoles: [...folderRoles],
  };
}

// Folder-role preference order for picking which copy of a Gmail-mirrored
// message to keep. Inbox wins so the "primary" location is what the user
// sees in the thread view.
const ROLE_RANK: Record<string, number> = {
  inbox: 0,
  sent: 1,
  drafts: 2,
  archive: 3,
  trash: 5,
  spam: 6,
  all: 7,
};

// Collapse messages that share a Message-ID (different folder copies of the
// same logical email — Gmail INBOX + [Gmail]/All Mail being the canonical
// case). NULL message_ids are always kept distinct because we can't tell
// them apart.
function dedupeMessageRows(msgs: MessageRow[]): MessageRow[] {
  if (msgs.length < 2) return msgs;
  const folderIds = [...new Set(msgs.map((m) => m.folder_id))];
  const rolesByFolder = new Map<number, string | null>();
  if (folderIds.length > 0) {
    const ph = folderIds.map(() => "?").join(",");
    const rs = db
      .prepare(`SELECT id, role FROM folders WHERE id IN (${ph})`)
      .all(...folderIds) as { id: number; role: string | null }[];
    for (const f of rs) rolesByFolder.set(f.id, f.role);
  }
  const rank = (m: MessageRow) => {
    const role = rolesByFolder.get(m.folder_id);
    return role && role in ROLE_RANK ? ROLE_RANK[role] : 4;
  };
  // Walk preferred copies first so dedupe-keep-first keeps the one we want.
  const ranked = [...msgs].sort((a, b) => rank(a) - rank(b));
  const seen = new Set<string>();
  const kept: MessageRow[] = [];
  for (const m of ranked) {
    if (!m.message_id) { kept.push(m); continue; }
    if (seen.has(m.message_id)) continue;
    seen.add(m.message_id);
    kept.push(m);
  }
  // Restore date-asc ordering — callers (and the thread view) expect it.
  kept.sort((a, b) => a.date - b.date);
  return kept;
}

const tagsForThread = db.prepare<[number]>(`
  SELECT t.id, t.name, t.color FROM tags t
  JOIN thread_tags tt ON tt.tag_id = t.id
  WHERE tt.thread_id = ?
`);

function getThreadTags(threadId: number): TagDto[] {
  return tagsForThread.all(threadId) as TagDto[];
}

export const messagesRepo = {
  get(id: number): MessageBodyDto | null {
    const m = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    if (!m) return null;
    const summary = messageRowToSummary(m);
    const atts = db
      .prepare("SELECT id, filename, content_type, size FROM attachments WHERE message_id = ?")
      .all(id) as { id: number; filename: string; content_type: string; size: number }[];
    return {
      ...summary,
      bodyText: m.body_text,
      bodyHtml: m.body_html,
      attachments: atts.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.content_type,
        size: a.size,
      })),
    };
  },
};

export const threadsRepo = {
  list(opts: { folderRole?: FolderRole; accountId?: number; tag?: string; starred?: boolean; limit?: number; offset?: number; }): ThreadDto[] {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const where: string[] = [];
    const params: any[] = [];
    if (opts.folderRole === "archive") {
      // Virtual archive view. Two flavours per account:
      //   (a) provider has a dedicated archive folder — message in it counts.
      //   (b) provider only has an 'all' folder (Gmail) — archived = present
      //       in 'all' for an account but not in 'inbox' for that same
      //       account. The account-correlated NOT EXISTS is what lets a
      //       single thread be "archived" for one account and still in the
      //       inbox for another.
      const archiveSql = `t.id IN (
        SELECT m.thread_id FROM messages m JOIN folders f ON f.id = m.folder_id
        WHERE f.role = 'archive' ${opts.accountId ? "AND m.account_id = ?" : ""}
      ) OR t.id IN (
        SELECT m.thread_id FROM messages m JOIN folders f ON f.id = m.folder_id
        WHERE f.role = 'all' ${opts.accountId ? "AND m.account_id = ?" : ""}
        AND NOT EXISTS (
          SELECT 1 FROM messages m2 JOIN folders f2 ON f2.id = m2.folder_id
          WHERE m2.thread_id = m.thread_id AND m2.account_id = m.account_id AND f2.role = 'inbox'
        )
      )`;
      where.push(`(${archiveSql})`);
      if (opts.accountId) { params.push(opts.accountId, opts.accountId); }
    } else if (opts.folderRole) {
      where.push(`t.id IN (
        SELECT m.thread_id FROM messages m JOIN folders f ON f.id = m.folder_id
        WHERE f.role = ? ${opts.accountId ? "AND m.account_id = ?" : ""}
      )`);
      params.push(opts.folderRole);
      if (opts.accountId) params.push(opts.accountId);
    } else if (opts.accountId) {
      where.push(`t.id IN (SELECT thread_id FROM messages WHERE account_id = ?)`);
      params.push(opts.accountId);
    }
    if (opts.starred) {
      where.push(`t.id IN (
        SELECT thread_id FROM messages WHERE starred = 1 ${opts.accountId ? "AND account_id = ?" : ""}
      )`);
      if (opts.accountId) params.push(opts.accountId);
    }
    if (opts.tag) {
      where.push(`t.id IN (
        SELECT thread_id FROM thread_tags tt JOIN tags g ON g.id = tt.tag_id WHERE g.name = ?
      )`);
      params.push(opts.tag);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM threads t ${whereSql} ORDER BY t.last_date DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as ThreadRow[];
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const allMsgs = db
      .prepare(`SELECT * FROM messages WHERE thread_id IN (${placeholders}) ORDER BY date`)
      .all(...ids) as MessageRow[];
    const byThread = new Map<number, MessageRow[]>();
    for (const m of allMsgs) {
      const arr = byThread.get(m.thread_id) ?? [];
      arr.push(m);
      byThread.set(m.thread_id, arr);
    }
    return rows.map((r) => threadRowToDto(r, dedupeMessageRows(byThread.get(r.id) ?? []), getThreadTags(r.id)));
  },
  get(id: number): { thread: ThreadDto; messages: MessageBodyDto[] } | null {
    const r = db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as ThreadRow | undefined;
    if (!r) return null;
    const msgs = dedupeMessageRows(
      db
        .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY date")
        .all(id) as MessageRow[],
    );
    const messages: MessageBodyDto[] = msgs.map((m) => {
      const summary = messageRowToSummary(m);
      const atts = db
        .prepare("SELECT id, filename, content_type, size FROM attachments WHERE message_id = ?")
        .all(m.id) as { id: number; filename: string; content_type: string; size: number }[];
      return {
        ...summary,
        bodyText: m.body_text,
        bodyHtml: m.body_html,
        attachments: atts.map((a) => ({
          id: a.id,
          filename: a.filename,
          contentType: a.content_type,
          size: a.size,
        })),
      };
    });
    return { thread: threadRowToDto(r, msgs, getThreadTags(id)), messages };
  },
  search(q: SearchQuery): ThreadDto[] {
    const limit = Math.min(q.limit ?? 50, 200);
    const offset = q.offset ?? 0;
    const where: string[] = [];
    const params: any[] = [];

    let messageIds: Set<number> | null = null;
    if (q.q && q.q.trim().length > 0) {
      const term = q.q.trim().replace(/[\"'`]/g, " ");
      const rows = db
        .prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH ? LIMIT 5000`)
        .all(term) as { rowid: number }[];
      messageIds = new Set(rows.map((r) => r.rowid));
      if (messageIds.size === 0) return [];
    }

    if (q.from) { where.push("m.from_json LIKE ?"); params.push(`%${q.from}%`); }
    if (q.to) { where.push("(m.to_json LIKE ? OR m.cc_json LIKE ?)"); params.push(`%${q.to}%`, `%${q.to}%`); }
    if (q.subject) { where.push("m.subject LIKE ?"); params.push(`%${q.subject}%`); }
    if (q.unread) { where.push("m.unread = 1"); }
    if (q.starred) { where.push("m.starred = 1"); }
    if (q.hasAttachment) { where.push("m.has_attachments = 1"); }
    if (q.accountId) { where.push("m.account_id = ?"); params.push(q.accountId); }
    if (q.folderRole) { where.push("EXISTS (SELECT 1 FROM folders f WHERE f.id = m.folder_id AND f.role = ?)"); params.push(q.folderRole); }
    if (messageIds) {
      const ids = [...messageIds];
      const ph = ids.map(() => "?").join(",");
      where.push(`m.id IN (${ph})`);
      params.push(...ids);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const threadIds = db
      .prepare(`
        SELECT m.thread_id, MAX(m.date) AS last_date FROM messages m
        ${whereSql}
        GROUP BY m.thread_id
        ORDER BY last_date DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, limit, offset) as { thread_id: number; last_date: number }[];

    if (threadIds.length === 0) return [];
    const ids = threadIds.map((r) => r.thread_id);
    const ph = ids.map(() => "?").join(",");
    const tRows = db.prepare(`SELECT * FROM threads WHERE id IN (${ph})`).all(...ids) as ThreadRow[];
    const allMsgs = db
      .prepare(`SELECT * FROM messages WHERE thread_id IN (${ph}) ORDER BY date`)
      .all(...ids) as MessageRow[];
    const byThread = new Map<number, MessageRow[]>();
    for (const m of allMsgs) {
      const arr = byThread.get(m.thread_id) ?? [];
      arr.push(m);
      byThread.set(m.thread_id, arr);
    }
    const order = new Map<number, number>();
    threadIds.forEach((r, i) => order.set(r.thread_id, i));
    tRows.sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
    return tRows.map((r) => threadRowToDto(r, dedupeMessageRows(byThread.get(r.id) ?? []), getThreadTags(r.id)));
  },
};
