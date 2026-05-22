import type { FolderDto, FolderRole } from "@mailclient/shared";
import { db } from "./index.js";

interface FolderRow {
  id: number;
  account_id: number;
  path: string;
  name: string;
  delimiter: string;
  role: FolderRole | null;
  uidvalidity: number | null;
  uidnext: number | null;
  highest_modseq: number | null;
  unread_count: number;
  total_count: number;
}

function rowToDto(r: FolderRow): FolderDto {
  return {
    id: r.id,
    accountId: r.account_id,
    path: r.path,
    name: r.name,
    role: r.role,
    unreadCount: r.unread_count,
    totalCount: r.total_count,
  };
}

export const foldersRepo = {
  listForAccount(accountId: number): FolderDto[] {
    const rows = db
      .prepare("SELECT * FROM folders WHERE account_id = ? ORDER BY role IS NULL, role, path")
      .all(accountId) as FolderRow[];
    return rows.map(rowToDto);
  },
  listAll(): FolderDto[] {
    const rows = db.prepare("SELECT * FROM folders ORDER BY account_id, path").all() as FolderRow[];
    return rows.map(rowToDto);
  },
  upsert(input: {
    accountId: number;
    path: string;
    name: string;
    delimiter: string;
    role: FolderRole | null;
  }): FolderRow {
    db.prepare(
      `INSERT INTO folders (account_id, path, name, delimiter, role)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, path) DO UPDATE SET
         name = excluded.name, delimiter = excluded.delimiter, role = excluded.role`,
    ).run(input.accountId, input.path, input.name, input.delimiter, input.role);
    return db
      .prepare("SELECT * FROM folders WHERE account_id = ? AND path = ?")
      .get(input.accountId, input.path) as FolderRow;
  },
  setUidvalidity(folderId: number, uidvalidity: number) {
    db.prepare("UPDATE folders SET uidvalidity = ? WHERE id = ?").run(uidvalidity, folderId);
  },
  setUidnext(folderId: number, uidnext: number) {
    db.prepare("UPDATE folders SET uidnext = ? WHERE id = ?").run(uidnext, folderId);
  },
  getRow(folderId: number): FolderRow | null {
    const row = db.prepare("SELECT * FROM folders WHERE id = ?").get(folderId) as FolderRow | undefined;
    return row ?? null;
  },
  deleteFolderUidsNotIn(folderId: number, presentUids: number[]) {
    if (presentUids.length === 0) {
      // Folder is empty server-side — drop everything we have for it.
      db.prepare("DELETE FROM messages WHERE folder_id = ?").run(folderId);
      return [];
    }
    // Find local UIDs not in the present set and return them so caller can clean up.
    const local = db.prepare("SELECT uid FROM messages WHERE folder_id = ?").all(folderId) as { uid: number }[];
    const set = new Set(presentUids);
    return local.filter((r) => !set.has(r.uid)).map((r) => r.uid);
  },
};
