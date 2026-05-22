import type { FastifyBaseLogger } from "fastify";
import { accountsRepo } from "../db/accounts.js";
import { AccountSync } from "./account-sync.js";
import { IdleWatcher } from "./idle-watcher.js";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
// Short coalescing window for IDLE 'exists' bursts (providers often fire
// several in a row for one delivery). Kept small so a single new email
// surfaces in well under a second instead of waiting out a long debounce.
const NEW_MAIL_DEBOUNCE_MS = 300;

interface AccountWorker {
  sync: AccountSync;
  watcher: IdleWatcher;
  pollTimer: NodeJS.Timeout;
  newMailTimer: NodeJS.Timeout | null;
}

class SyncManager {
  private workers = new Map<number, AccountWorker>();
  private log!: FastifyBaseLogger;

  init(log: FastifyBaseLogger) {
    this.log = log.child({ scope: "sync-manager" });
  }

  async startAll() {
    if (!this.log) return;
    for (const a of accountsRepo.list()) {
      this.startAccount(a.id).catch((err) =>
        this.log.error({ err, accountId: a.id }, "failed to start account sync"),
      );
    }
  }

  async startAccount(accountId: number): Promise<void> {
    if (!this.log) return;
    if (this.workers.has(accountId)) return;

    const sync = new AccountSync(accountId, { log: this.log });

    const watcher = new IdleWatcher(accountId, {
      log: this.log,
      onNewMail: () => this.scheduleNewMailSync(accountId),
    });

    const pollTimer = setInterval(() => {
      sync.syncAll().catch((err) =>
        this.log.error({ err, accountId }, "scheduled sync failed"),
      );
    }, POLL_INTERVAL_MS);
    pollTimer.unref();

    const worker: AccountWorker = { sync, watcher, pollTimer, newMailTimer: null };
    this.workers.set(accountId, worker);

    // Initial full sync, then arm the IDLE watcher. Arming requires the inbox
    // folder to be discovered, which only happens after the first sync.
    sync.syncAll()
      .then(() => watcher.start())
      .catch((err) => this.log.error({ err, accountId }, "initial sync failed"));
  }

  // Many providers fire 'exists' multiple times in quick succession (one per
  // new UID, plus separate flag updates). Coalesce those into a single sync.
  // We sync only the inbox here, not the whole account — a new-mail push is
  // about the inbox, and a full syncAll would make the user wait on every
  // other folder (notably Gmail's huge All Mail) before the email appears.
  // The 5-minute poll still does the full syncAll to reconcile everything.
  private scheduleNewMailSync(accountId: number) {
    const w = this.workers.get(accountId);
    if (!w) return;
    if (w.newMailTimer) clearTimeout(w.newMailTimer);
    w.newMailTimer = setTimeout(() => {
      w.newMailTimer = null;
      w.sync.syncInbox().catch((err) =>
        this.log.error({ err, accountId }, "idle-triggered inbox sync failed"),
      );
    }, NEW_MAIL_DEBOUNCE_MS);
    if (typeof w.newMailTimer.unref === "function") w.newMailTimer.unref();
  }

  async stopAccount(accountId: number): Promise<void> {
    const w = this.workers.get(accountId);
    if (!w) return;
    clearInterval(w.pollTimer);
    if (w.newMailTimer) clearTimeout(w.newMailTimer);
    await w.watcher.stop();
    await w.sync.disconnect();
    this.workers.delete(accountId);
  }

  async syncOnce(accountId: number): Promise<void> {
    if (!this.log) return;
    let worker = this.workers.get(accountId);
    if (!worker) {
      const sync = new AccountSync(accountId, { log: this.log });
      await sync.syncAll();
      return;
    }
    await worker.sync.syncAll();
  }

  async shutdown() {
    for (const [id, w] of this.workers) {
      clearInterval(w.pollTimer);
      if (w.newMailTimer) clearTimeout(w.newMailTimer);
      try { await w.watcher.stop(); } catch (err) {
        this.log?.warn({ err, accountId: id }, "shutdown watcher stop failed");
      }
      try { await w.sync.disconnect(); } catch (err) {
        this.log?.warn({ err, accountId: id }, "shutdown disconnect failed");
      }
    }
    this.workers.clear();
  }
}

export const syncManager = new SyncManager();
