import { createReadStream, statSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { FolderRole, ServerEvent } from "@mailclient/shared";
import { vault } from "../crypto/vault.js";
import { accountsRepo } from "../db/accounts.js";
import { foldersRepo } from "../db/folders.js";
import { messagesRepo, threadsRepo } from "../db/threads.js";
import { tagsRepo } from "../db/tags.js";
import { filtersRepo } from "../db/filters.js";
import { db } from "../db/index.js";
import { syncManager } from "../sync/manager.js";
import { events } from "../sync/events.js";
import { mutations } from "../sync/mutations.js";
import { sendMessage } from "../sync/send.js";
import { outbox } from "../sync/outbox.js";
import { registerOAuthRoutes } from "./oauth-routes.js";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({ ok: true }));

  // Vault
  app.get("/api/vault/state", async () => ({
    configured: vault.isConfigured(),
    unlocked: vault.isUnlocked(),
  }));
  app.post<{ Body: { password: string } }>("/api/vault/setup", async (req, reply) => {
    const { password } = req.body ?? {};
    if (!password) return reply.code(400).send({ error: "password required" });
    if (vault.isConfigured()) return reply.code(409).send({ error: "already configured" });
    await vault.setup(password);
    syncManager.startAll().catch(() => {});
    return { ok: true };
  });
  app.post<{ Body: { password: string } }>("/api/vault/unlock", async (req, reply) => {
    const { password } = req.body ?? {};
    if (!password) return reply.code(400).send({ error: "password required" });
    const ok = await vault.unlock(password);
    if (!ok) return reply.code(401).send({ error: "invalid password" });
    syncManager.startAll().catch(() => {});
    return { ok: true };
  });
  app.post("/api/vault/lock", async () => {
    await syncManager.shutdown();
    vault.lock();
    return { ok: true };
  });

  // Vault gate for everything below. The OAuth callback enforces it
  // separately and renders an HTML error page on lock instead of a JSON 423.
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url.startsWith("/api/vault") || req.url === "/api/health") return;
    if (req.url.startsWith("/api/oauth/")) return;
    if (!vault.isUnlocked()) {
      return reply.code(423).send({ error: "vault locked" });
    }
  });

  await registerOAuthRoutes(app);

  // Accounts
  app.get("/api/accounts", async () => accountsRepo.list());
  app.post("/api/accounts", async (req, reply) => {
    const body = req.body as any;
    if (!body?.email || !body?.password || !body?.imapHost || !body?.smtpHost) {
      return reply.code(400).send({ error: "email, password, imapHost, smtpHost required" });
    }
    const account = accountsRepo.create(body);
    syncManager.startAccount(account.id).catch((err) =>
      app.log.error({ err, accountId: account.id }, "sync start failed"),
    );
    return account;
  });
  app.delete<{ Params: { id: string } }>("/api/accounts/:id", async (req) => {
    const id = Number(req.params.id);
    await syncManager.stopAccount(id);
    accountsRepo.delete(id);
    return { ok: true };
  });
  app.put<{ Params: { id: string } }>("/api/accounts/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const patch = req.body as any;
    const updated = accountsRepo.update(id, patch ?? {});
    if (!updated) return reply.code(404).send({ error: "account not found" });
    // Restart sync so the new creds/hosts take effect on the next pass.
    await syncManager.stopAccount(id);
    syncManager.startAccount(id).catch((err) =>
      app.log.error({ err, accountId: id }, "sync restart after update failed"),
    );
    return updated;
  });
  app.post<{ Params: { id: string } }>("/api/accounts/:id/sync", async (req) => {
    const id = Number(req.params.id);
    syncManager.syncOnce(id).catch((err) => app.log.error({ err }, "manual sync failed"));
    return { ok: true };
  });

  // Folders
  app.get("/api/folders", async () => foldersRepo.listAll());

  // Threads + search
  app.get<{ Querystring: any }>("/api/threads", async (req) => {
    const q: any = req.query;
    return threadsRepo.list({
      folderRole: q.folderRole as FolderRole | undefined,
      accountId: q.accountId ? Number(q.accountId) : undefined,
      category: q.category === "promotions" || q.category === "primary" ? q.category : undefined,
      tag: q.tag,
      starred: q.starred === "true",
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });
  app.get<{ Params: { id: string } }>("/api/threads/:id", async (req, reply) => {
    const out = threadsRepo.get(Number(req.params.id));
    if (!out) return reply.code(404).send({ error: "thread not found" });
    return out;
  });

  app.get<{ Params: { id: string } }>("/api/messages/:id", async (req, reply) => {
    const m = messagesRepo.get(Number(req.params.id));
    if (!m) return reply.code(404).send({ error: "message not found" });
    return m;
  });

  app.get<{ Querystring: any }>("/api/search", async (req) => {
    const q: any = req.query;
    return threadsRepo.search({
      q: q.q,
      from: q.from,
      to: q.to,
      subject: q.subject,
      hasAttachment: q.hasAttachment === "true",
      unread: q.unread === "true",
      starred: q.starred === "true",
      accountId: q.accountId ? Number(q.accountId) : undefined,
      folderRole: q.folderRole as FolderRole | undefined,
      tag: q.tag,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });

  // Mutations
  app.post<{ Body: { messageIds: number[]; read: boolean } }>(
    "/api/messages/read",
    async (req, reply) => {
      const { messageIds, read } = req.body ?? ({} as any);
      if (!Array.isArray(messageIds)) return reply.code(400).send({ error: "messageIds required" });
      await mutations.setRead(messageIds, !!read);
      return { ok: true };
    },
  );
  app.post<{ Body: { messageIds: number[]; starred: boolean } }>(
    "/api/messages/star",
    async (req, reply) => {
      const { messageIds, starred } = req.body ?? ({} as any);
      if (!Array.isArray(messageIds)) return reply.code(400).send({ error: "messageIds required" });
      await mutations.setStarred(messageIds, !!starred);
      return { ok: true };
    },
  );
  app.post<{ Body: { messageIds: number[] } }>("/api/messages/delete", async (req, reply) => {
    const { messageIds } = req.body ?? ({} as any);
    if (!Array.isArray(messageIds)) return reply.code(400).send({ error: "messageIds required" });
    await mutations.deleteMessages(messageIds);
    return { ok: true };
  });

  // Bulk action over a set of threads. Server expands each thread to its
  // messages so the client doesn't need every message id locally.
  app.post<{ Body: { threadIds: number[]; action: "read" | "unread" | "star" | "unstar" | "archive" | "delete" } }>(
    "/api/threads/bulk",
    async (req, reply) => {
      const { threadIds, action } = req.body ?? ({} as any);
      if (!Array.isArray(threadIds) || threadIds.length === 0) {
        return reply.code(400).send({ error: "threadIds required" });
      }
      const ph = threadIds.map(() => "?").join(",");
      const rows = db
        .prepare(`SELECT id FROM messages WHERE thread_id IN (${ph})`)
        .all(...threadIds) as { id: number }[];
      const messageIds = rows.map((r) => r.id);
      if (messageIds.length === 0) return { ok: true, count: 0 };
      switch (action) {
        case "read":    await mutations.setRead(messageIds, true); break;
        case "unread":  await mutations.setRead(messageIds, false); break;
        case "star":    await mutations.setStarred(messageIds, true); break;
        case "unstar":  await mutations.setStarred(messageIds, false); break;
        case "archive": await mutations.archiveMessages(messageIds); break;
        case "delete":  await mutations.deleteMessages(messageIds); break;
        default: return reply.code(400).send({ error: "unknown action" });
      }
      return { ok: true, count: messageIds.length };
    },
  );

  // Compose / send. If SMTP fails (e.g. offline), drop into the outbox queue
  // so the message is retried in the background.
  app.post("/api/messages/send", async (req, reply) => {
    try {
      const result = await sendMessage(req.body as any);
      return result;
    } catch (err: any) {
      const isNetwork = /ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|getaddrinfo/i.test(err?.message ?? "");
      if (isNetwork) {
        const id = outbox.enqueue(req.body as any);
        return reply.code(202).send({ queued: true, outboxId: id });
      }
      return reply.code(500).send({ error: err?.message ?? String(err) });
    }
  });

  // Tags
  app.get("/api/tags", async () => tagsRepo.list());
  app.post<{ Body: { name: string; color?: string } }>("/api/tags", async (req, reply) => {
    const { name, color } = req.body ?? ({} as any);
    if (!name) return reply.code(400).send({ error: "name required" });
    return tagsRepo.upsert(name, color ?? "#94a3b8");
  });
  app.delete<{ Params: { id: string } }>("/api/tags/:id", async (req) => {
    tagsRepo.delete(Number(req.params.id));
    return { ok: true };
  });
  app.post<{ Params: { threadId: string }; Body: { tagId: number } }>(
    "/api/threads/:threadId/tags",
    async (req) => {
      tagsRepo.attach(Number(req.params.threadId), Number(req.body.tagId));
      return { ok: true };
    },
  );
  app.delete<{ Params: { threadId: string; tagId: string } }>(
    "/api/threads/:threadId/tags/:tagId",
    async (req) => {
      tagsRepo.detach(Number(req.params.threadId), Number(req.params.tagId));
      return { ok: true };
    },
  );

  // Filters
  app.get("/api/filters", async () => filtersRepo.list());
  app.post("/api/filters", async (req) => filtersRepo.create(req.body as any));
  app.put<{ Params: { id: string } }>("/api/filters/:id", async (req) => {
    filtersRepo.update(Number(req.params.id), req.body as any);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/api/filters/:id", async (req) => {
    filtersRepo.delete(Number(req.params.id));
    return { ok: true };
  });

  // Attachments
  app.get<{ Params: { id: string } }>("/api/attachments/:id", async (req, reply) => {
    const row = db
      .prepare("SELECT filename, content_type, size, storage_path FROM attachments WHERE id = ?")
      .get(Number(req.params.id)) as
      | { filename: string; content_type: string; size: number; storage_path: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: "not found" });
    try {
      statSync(row.storage_path);
    } catch {
      return reply.code(404).send({ error: "attachment file missing" });
    }
    reply.header("Content-Type", row.content_type);
    reply.header("Content-Length", String(row.size));
    reply.header("Content-Disposition", `inline; filename="${row.filename.replace(/"/g, "")}"`);
    return reply.send(createReadStream(row.storage_path));
  });

  // WebSocket — push sync + thread events to the client
  app.register(async (s) => {
    s.get("/ws", { websocket: true }, (socket /* SocketStream */) => {
      const handler = (ev: ServerEvent) => {
        if (socket.readyState === 1) socket.send(JSON.stringify(ev));
      };
      events.on("event", handler);
      socket.on("close", () => events.off("event", handler));
    });
  });
}
