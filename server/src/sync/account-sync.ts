import type { ImapFlow } from "imapflow";
import type { FastifyBaseLogger } from "fastify";
import { accountsRepo } from "../db/accounts.js";
import { foldersRepo } from "../db/folders.js";
import { createImap, listFolders, withMailbox } from "./imap.js";
import { imapConfigForAccount } from "./auth.js";
import { persistMessage, removeMessageByUid, updateFolderCounts } from "./persist.js";
import { emit } from "./events.js";

const INITIAL_FETCH_LIMIT_PER_FOLDER = 200;

export interface AccountSyncDeps {
  log: FastifyBaseLogger;
}

export class AccountSync {
  private client: ImapFlow | null = null;
  private connecting: Promise<void> | null = null;
  private syncing = false;
  private idleStop: (() => void) | null = null;

  constructor(public readonly accountId: number, private deps: AccountSyncDeps) {}

  private get log() {
    return this.deps.log.child({ accountId: this.accountId, scope: "imap" });
  }

  private async connect(): Promise<ImapFlow> {
    if (this.client && this.client.usable) return this.client;
    if (this.connecting) {
      await this.connecting;
      return this.client!;
    }
    const account = accountsRepo.getRow(this.accountId);
    if (!account) throw new Error(`account ${this.accountId} not found`);
    const config = await imapConfigForAccount(account);
    const client = createImap(config);
    // Register listeners BEFORE connect so any 'error' event emitted during
    // the handshake doesn't escape as an uncaughtException.
    client.on("error", (err: any) => this.log.error({ err: err?.message ?? err }, "imap error"));
    client.on("close", () => {
      this.log.info("imap closed");
      if (this.client === client) this.client = null;
    });
    this.connecting = (async () => {
      this.log.info("connecting to IMAP");
      await client.connect();
      this.client = client;
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
    return this.client!;
  }

  async syncAll(): Promise<void> {
    if (this.syncing) {
      this.log.debug("sync already in progress, skipping");
      return;
    }
    this.syncing = true;
    emit({ type: "sync:start", accountId: this.accountId });
    try {
      const client = await this.connect();
      const remoteFolders = await listFolders(client);

      // Persist folder list (preserves uidvalidity etc.)
      for (const f of remoteFolders) {
        foldersRepo.upsert({
          accountId: this.accountId,
          path: f.path,
          name: f.name,
          delimiter: f.delimiter,
          role: f.role,
        });
      }

      // Sync content for inbox first, then other "interesting" folders.
      const ordered = [...remoteFolders].sort((a, b) => priority(a.role) - priority(b.role));
      for (const f of ordered) {
        if (f.flags.has("\\Noselect")) continue;
        await this.syncFolder(client, f.path).catch((err) => {
          this.log.error({ err, folder: f.path }, "folder sync failed");
        });
      }

      accountsRepo.updateSyncedAt(this.accountId, Date.now());
      emit({ type: "sync:done", accountId: this.accountId });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      this.log.error({ err }, "account sync failed");
      accountsRepo.setError(this.accountId, msg);
      emit({ type: "sync:error", accountId: this.accountId, error: msg });
    } finally {
      this.syncing = false;
    }
  }

  // Targeted refresh of just the inbox. Used for IMAP IDLE new-mail events,
  // where running a full syncAll() — which also walks Sent, Drafts,
  // [Gmail]/All Mail, Trash, etc. — delays the one folder the user is
  // actually watching by many seconds. The withMailbox lock inside
  // syncFolder serializes against any concurrent poll-driven syncAll, and
  // persistMessage's existence check makes a double-fetch harmless.
  async syncInbox(): Promise<void> {
    const inbox = foldersRepo
      .listForAccount(this.accountId)
      .find((f) => f.role === "inbox");
    if (!inbox) {
      // Inbox not discovered yet — only the first full sync finds folders.
      await this.syncAll();
      return;
    }
    try {
      const client = await this.connect();
      await this.syncFolder(client, inbox.path);
    } catch (err: any) {
      this.log.error({ err }, "inbox sync failed");
    }
  }

  private async syncFolder(client: ImapFlow, path: string): Promise<void> {
    const localRow = foldersRepo
      .listForAccount(this.accountId)
      .find((f) => f.path === path);
    if (!localRow) return;
    const folderId = localRow.id;

    await withMailbox(client, path, async () => {
      const status = client.mailbox;
      if (!status || typeof status === "boolean") return;

      const uidvalidity = Number(status.uidValidity);
      const uidnext = Number(status.uidNext);

      const persisted = foldersRepo.getRow(folderId);
      if (!persisted) return;

      // UIDVALIDITY changed — discard everything for this folder and refetch.
      if (persisted.uidvalidity && persisted.uidvalidity !== uidvalidity) {
        this.log.warn({ folder: path, was: persisted.uidvalidity, now: uidvalidity }, "UIDVALIDITY changed, resyncing");
        // Re-fetch all by clearing local state for this folder.
        const localUids = foldersRepo.deleteFolderUidsNotIn(folderId, []);
        for (const uid of localUids) removeMessageByUid(this.accountId, folderId, uid);
      }
      foldersRepo.setUidvalidity(folderId, uidvalidity);

      // 1) Determine UIDs to fetch (new ones since last uidnext).
      const fromUid = persisted.uidnext ?? Math.max(1, uidnext - INITIAL_FETCH_LIMIT_PER_FOLDER);
      const range = `${fromUid}:*`;

      let count = 0;
      let total = 0;
      const toFetch: number[] = [];
      try {
        for await (const msg of client.fetch(range, { uid: true }, { uid: true })) {
          toFetch.push(Number(msg.uid));
        }
      } catch (err: any) {
        // Empty mailbox or invalid range — ignore.
        if (!/empty/i.test(err?.message ?? "")) throw err;
      }
      total = toFetch.length;
      if (total === 0) {
        foldersRepo.setUidnext(folderId, uidnext);
        updateFolderCounts(folderId);
        emit({ type: "folder:update", folderId });
        return;
      }

      for (const uid of toFetch) {
        try {
          const msg = await client.fetchOne(
            String(uid),
            { uid: true, flags: true, internalDate: true, size: true, source: true },
            { uid: true },
          );
          if (!msg || !msg.source) continue;
          await persistMessage({
            accountId: this.accountId,
            folderId,
            uid: Number(msg.uid),
            flags: Array.from(msg.flags ?? []) as string[],
            internalDate: msg.internalDate ? new Date(msg.internalDate).getTime() : Date.now(),
            size: Number(msg.size ?? 0),
            source: msg.source as Buffer,
          });
        } catch (err) {
          this.log.warn({ err, uid }, "failed to fetch/parse message");
        }
        count++;
        if (count % 25 === 0 || count === total) {
          emit({
            type: "sync:progress",
            accountId: this.accountId,
            folder: path,
            done: count,
            total,
          });
        }
      }

      foldersRepo.setUidnext(folderId, uidnext);
      updateFolderCounts(folderId);
      emit({ type: "folder:update", folderId });
    });
  }

  async disconnect(): Promise<void> {
    if (this.idleStop) {
      this.idleStop();
      this.idleStop = null;
    }
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
  }
}

function priority(role: string | null): number {
  if (role === "inbox") return 0;
  if (role === "sent") return 1;
  if (role === "drafts") return 2;
  if (role === "archive") return 3;
  if (role === "all") return 4;
  if (role === "trash") return 6;
  if (role === "spam") return 7;
  return 5;
}
