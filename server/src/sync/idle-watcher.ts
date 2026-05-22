import type { ImapFlow, MailboxLockObject } from "imapflow";
import type { FastifyBaseLogger } from "fastify";
import { accountsRepo } from "../db/accounts.js";
import { foldersRepo } from "../db/folders.js";
import { createImap } from "./imap.js";
import { imapConfigForAccount } from "./auth.js";

const RECONNECT_DELAY_MS = 10_000;
const RECONNECT_MAX_DELAY_MS = 5 * 60_000;

// Long-lived per-account watcher that sits in IMAP IDLE on the inbox.
// On 'exists' (new mail arrived on the server) it invokes onNewMail, which
// the SyncManager wires to a syncOnce call.
//
// IDLE / NOOP keepalive is handled by imapflow internally as long as we hold
// the mailbox lock without releasing it. We use a dedicated client so it
// doesn't block mutations or scheduled folder syncs that need to lock other
// mailboxes.
export class IdleWatcher {
  private client: ImapFlow | null = null;
  private lock: MailboxLockObject | null = null;
  private stopping = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentBackoff = RECONNECT_DELAY_MS;
  // The "no inbox / vault locked / token refresh failed" cases all loop
  // every 20s+ until the upstream issue is resolved. Logging at warn each
  // time produces a wall of noise; track the last reason so we only re-log
  // when the situation actually changes.
  private lastDeferReason: string | null = null;

  constructor(
    public readonly accountId: number,
    private deps: { log: FastifyBaseLogger; onNewMail: () => void },
  ) {}

  async start(): Promise<void> {
    if (this.stopping || this.client) return;
    const log = this.deps.log.child({ accountId: this.accountId, scope: "idle" });

    const account = accountsRepo.getRow(this.accountId);
    if (!account) return;
    const inbox = foldersRepo
      .listForAccount(this.accountId)
      .find((f) => f.role === "inbox");
    if (!inbox) {
      // Surface the actual upstream error so the user doesn't have to grep
      // earlier log lines to find out *why* sync hasn't seen an Inbox yet.
      // The lastError field is set by AccountSync's catch block.
      const detail = account.last_error ?? "initial sync hasn't completed";
      this.deferOnce(log, `no inbox folder yet — ${detail}`);
      this.scheduleReconnect();
      return;
    }

    let config;
    try {
      config = await imapConfigForAccount(account);
    } catch (err) {
      this.deferOnce(log, `imap config unavailable: ${(err as Error)?.message ?? err}`);
      this.scheduleReconnect();
      return;
    }

    const client = createImap(config);

    client.on("error", (err: any) => log.warn({ err: err?.message ?? err }, "idle client error"));
    client.on("close", () => {
      this.client = null;
      this.lock = null;
      if (!this.stopping) {
        log.info("idle connection closed, will reconnect");
        this.scheduleReconnect();
      }
    });
    client.on("exists", (data: any) => {
      // Fires when the mailbox EXISTS count grows (new message) — and also on
      // expunge/flag updates depending on server. Either way, kick a sync.
      log.info({ count: data?.count, prev: data?.prevCount }, "exists event");
      try {
        this.deps.onNewMail();
      } catch (err) {
        log.warn({ err }, "onNewMail handler threw");
      }
    });

    try {
      await client.connect();
      this.client = client;
      this.lock = await client.getMailboxLock(inbox.path);
      log.info({ folder: inbox.path }, "idle watcher armed");
      // Reset backoff + dedupe state after a successful arm.
      this.currentBackoff = RECONNECT_DELAY_MS;
      this.lastDeferReason = null;
    } catch (err: any) {
      log.warn({ err: err?.message ?? err }, "idle arm failed");
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
      this.client = null;
      this.scheduleReconnect();
    }
  }

  // Log a "deferred because X" message at warn the first time, and at debug
  // afterwards as long as the reason hasn't changed. Stops the same warning
  // from firing every backoff cycle.
  private deferOnce(log: FastifyBaseLogger, reason: string) {
    if (reason === this.lastDeferReason) {
      log.debug({ reason }, "idle watcher still deferred");
      return;
    }
    this.lastDeferReason = reason;
    log.warn({ reason }, "idle watcher deferred");
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.stopping) return;
    const delay = this.currentBackoff;
    this.currentBackoff = Math.min(this.currentBackoff * 2, RECONNECT_MAX_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch(() => {
        /* errors already logged */
      });
    }, delay);
    if (typeof this.reconnectTimer.unref === "function") this.reconnectTimer.unref();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.lock) {
      try { this.lock.release(); } catch { /* ignore */ }
      this.lock = null;
    }
    if (this.client) {
      try { await this.client.logout(); } catch { /* ignore */ }
      this.client = null;
    }
  }
}
