import { ImapFlow } from "imapflow";
import { db } from "../db/index.js";
import { accountsRepo } from "../db/accounts.js";
import { foldersRepo } from "../db/folders.js";
import { createImap, withMailbox } from "./imap.js";
import { imapConfigForAccount } from "./auth.js";
import { recomputeThread } from "./threading.js";
import { updateFolderCounts } from "./persist.js";
import { emit } from "./events.js";
import { syncManager } from "./manager.js";

interface ImapFlagMutation {
  kind: "flags";
  accountId: number;
  folderPath: string;
  uids: number[];
  add?: string[];
  remove?: string[];
}

interface ImapMoveMutation {
  kind: "move";
  accountId: number;
  sourcePath: string;
  targetPath: string;
  uids: number[];
}

interface ImapExpungeMutation {
  kind: "expunge";
  accountId: number;
  folderPath: string;
  uids: number[];
}

type ImapTask = ImapFlagMutation | ImapMoveMutation | ImapExpungeMutation;

// Per-account serial queue. Mutation handlers return immediately after
// committing to the local DB; the IMAP round-trip runs here in the
// background so the API response time stays in single-digit milliseconds
// even though `connect`+TLS+LOGIN takes ~1-2s on Gmail.
const queues = new Map<number, Promise<void>>();

function enqueue(accountId: number, task: ImapTask) {
  const prev = queues.get(accountId) ?? Promise.resolve();
  const next = prev.then(() => runTask(task)).catch(() => {
    // Swallow — best-effort. Next sync pass reconciles any divergence.
  });
  queues.set(accountId, next);
}

async function runTask(task: ImapTask): Promise<void> {
  const a = accountsRepo.getRow(task.accountId);
  if (!a) return;
  const client = createImap(await imapConfigForAccount(a));
  await client.connect();
  let didMove = false;
  try {
    if (task.kind === "flags") {
      await withMailbox(client, task.folderPath, async () => {
        if (task.add && task.add.length > 0) {
          await client.messageFlagsAdd(task.uids, task.add, { uid: true });
        }
        if (task.remove && task.remove.length > 0) {
          await client.messageFlagsRemove(task.uids, task.remove, { uid: true });
        }
      });
    } else if (task.kind === "move") {
      await withMailbox(client, task.sourcePath, async () => {
        await client.messageMove(task.uids, task.targetPath, { uid: true });
      });
      didMove = true;
    } else if (task.kind === "expunge") {
      await withMailbox(client, task.folderPath, async () => {
        await client.messageDelete(task.uids, { uid: true });
      });
    }
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
  if (didMove) {
    // The destination folder now has a new copy at a fresh UID. Pull it
    // down so the user sees the message land in Trash/Archive without
    // waiting on the regular 5-minute poll. syncOnce dedupes if a sync
    // is already in flight.
    syncManager.syncOnce(task.accountId).catch(() => { /* best-effort */ });
  }
}

function groupByFolder(messageIds: number[]): Map<number, { uids: number[]; localIds: number[]; accountId: number }> {
  if (messageIds.length === 0) return new Map();
  const ph = messageIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT id, account_id, folder_id, uid FROM messages WHERE id IN (${ph})`)
    .all(...messageIds) as { id: number; account_id: number; folder_id: number; uid: number }[];
  const out = new Map<number, { uids: number[]; localIds: number[]; accountId: number }>();
  for (const r of rows) {
    const key = r.folder_id;
    const cur = out.get(key) ?? { uids: [], localIds: [], accountId: r.account_id };
    cur.uids.push(r.uid);
    cur.localIds.push(r.id);
    out.set(key, cur);
  }
  return out;
}

// Defensive parse — older builds occasionally stored a JSON-encoded string
// instead of an array. Treat anything non-array as empty so callers can
// `.filter(...)` without throwing.
function parseFlagsArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function dropMessagesLocally(localIds: number[]): Set<number> {
  if (localIds.length === 0) return new Set();
  const ph = localIds.map(() => "?").join(",");
  const threadIds = new Set(
    (db.prepare(`SELECT DISTINCT thread_id FROM messages WHERE id IN (${ph})`)
      .all(...localIds) as { thread_id: number }[]).map((r) => r.thread_id),
  );
  db.prepare(`DELETE FROM messages_fts WHERE rowid IN (${ph})`).run(...localIds);
  db.prepare(`DELETE FROM messages WHERE id IN (${ph})`).run(...localIds);
  return threadIds;
}

export const mutations = {
  setRead(messageIds: number[], read: boolean) {
    const groups = groupByFolder(messageIds);
    for (const [folderId, g] of groups) {
      const folder = foldersRepo.getRow(folderId);
      if (!folder) continue;
      const ph = g.localIds.map(() => "?").join(",");

      const rows = db
        .prepare(`SELECT id, flags_json FROM messages WHERE id IN (${ph})`)
        .all(...g.localIds) as { id: number; flags_json: string }[];
      const updateOne = db.prepare(
        "UPDATE messages SET flags_json = ?, unread = ? WHERE id = ?",
      );
      for (const r of rows) {
        const next = parseFlagsArray(r.flags_json).filter((f) => f !== "\\Seen");
        if (read) next.push("\\Seen");
        updateOne.run(JSON.stringify(next), read ? 0 : 1, r.id);
      }

      const threadIds = new Set(
        (db.prepare(`SELECT DISTINCT thread_id FROM messages WHERE id IN (${ph})`)
          .all(...g.localIds) as { thread_id: number }[]).map((r) => r.thread_id),
      );
      for (const tid of threadIds) {
        recomputeThread(tid);
        emit({ type: "thread:update", threadId: tid });
      }
      updateFolderCounts(folderId);
      emit({ type: "folder:update", folderId });

      enqueue(g.accountId, {
        kind: "flags",
        accountId: g.accountId,
        folderPath: folder.path,
        uids: g.uids,
        add: read ? ["\\Seen"] : undefined,
        remove: read ? undefined : ["\\Seen"],
      });
    }
  },

  setStarred(messageIds: number[], starred: boolean) {
    const groups = groupByFolder(messageIds);
    for (const [folderId, g] of groups) {
      const folder = foldersRepo.getRow(folderId);
      if (!folder) continue;
      const ph = g.localIds.map(() => "?").join(",");

      const rows = db
        .prepare(`SELECT id, flags_json FROM messages WHERE id IN (${ph})`)
        .all(...g.localIds) as { id: number; flags_json: string }[];
      const updateOne = db.prepare(
        "UPDATE messages SET flags_json = ?, starred = ? WHERE id = ?",
      );
      for (const r of rows) {
        const next = parseFlagsArray(r.flags_json).filter((f) => f !== "\\Flagged");
        if (starred) next.push("\\Flagged");
        updateOne.run(JSON.stringify(next), starred ? 1 : 0, r.id);
      }

      const threadIds = new Set(
        (db.prepare(`SELECT DISTINCT thread_id FROM messages WHERE id IN (${ph})`)
          .all(...g.localIds) as { thread_id: number }[]).map((r) => r.thread_id),
      );
      for (const tid of threadIds) {
        recomputeThread(tid);
        emit({ type: "thread:update", threadId: tid });
      }

      enqueue(g.accountId, {
        kind: "flags",
        accountId: g.accountId,
        folderPath: folder.path,
        uids: g.uids,
        add: starred ? ["\\Flagged"] : undefined,
        remove: starred ? undefined : ["\\Flagged"],
      });
    }
  },

  // Archive: MOVE to the account's archive folder. Gmail has no \Archive —
  // its equivalent is removing the inbox label, which we model as MOVE to
  // [Gmail]/All Mail (role: "all"). After the IMAP move the next sync pulls
  // the archived copy back; we drop the local row immediately so the user
  // sees the message leave inbox without waiting on the round-trip.
  archiveMessages(messageIds: number[]) {
    const groups = groupByFolder(messageIds);
    for (const [folderId, g] of groups) {
      const sourceFolder = foldersRepo.getRow(folderId);
      if (!sourceFolder) continue;
      const accountFolders = foldersRepo.listForAccount(g.accountId);
      const target =
        accountFolders.find((f) => f.role === "archive") ??
        accountFolders.find((f) => f.role === "all");
      if (!target) continue;
      if (sourceFolder.id === target.id) continue;

      const threadIds = dropMessagesLocally(g.localIds);
      for (const tid of threadIds) {
        recomputeThread(tid);
        emit({ type: "thread:update", threadId: tid });
      }
      updateFolderCounts(folderId);
      emit({ type: "folder:update", folderId });

      enqueue(g.accountId, {
        kind: "move",
        accountId: g.accountId,
        sourcePath: sourceFolder.path,
        targetPath: target.path,
        uids: g.uids,
      });
    }
  },

  // Delete: MOVE to Trash when one exists and we're not already there;
  // otherwise expunge in place (already in trash, or the account has no
  // trash folder).
  deleteMessages(messageIds: number[]) {
    const groups = groupByFolder(messageIds);
    for (const [folderId, g] of groups) {
      const folder = foldersRepo.getRow(folderId);
      if (!folder) continue;
      const trash = foldersRepo
        .listForAccount(g.accountId)
        .find((f) => f.role === "trash");
      const moveToTrash = !!trash && trash.id !== folder.id;

      const threadIds = dropMessagesLocally(g.localIds);
      for (const tid of threadIds) {
        recomputeThread(tid);
        emit({ type: "thread:update", threadId: tid });
      }
      updateFolderCounts(folderId);
      emit({ type: "folder:update", folderId });

      if (moveToTrash) {
        enqueue(g.accountId, {
          kind: "move",
          accountId: g.accountId,
          sourcePath: folder.path,
          targetPath: trash!.path,
          uids: g.uids,
        });
      } else {
        enqueue(g.accountId, {
          kind: "expunge",
          accountId: g.accountId,
          folderPath: folder.path,
          uids: g.uids,
        });
      }
    }
  },
};
