import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { registerRoutes } from "./api/routes.js";
import { initDb } from "./db/index.js";
import { vault } from "./crypto/vault.js";
import { syncManager } from "./sync/manager.js";
import { startOutbox, stopOutbox } from "./sync/outbox.js";

export async function buildServer() {
  const isDev = process.env.NODE_ENV !== "production";
  const app = Fastify({
    logger: isDev
      ? {
          level: process.env.LOG_LEVEL ?? "info",
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss" },
          },
        }
      : { level: process.env.LOG_LEVEL ?? "info" },
  });

  await app.register(cors, {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  });
  await app.register(websocket);

  initDb();
  vault.initFromDb();
  syncManager.init(app.log);
  await registerRoutes(app);
  startOutbox();

  // Packaged desktop builds set MAILBUN_CLIENT_DIR so the server also serves
  // the built SPA — the Electron window then loads UI + API same-origin from
  // one port. In dev this is unset and Vite serves the client instead.
  const clientDir = process.env.MAILBUN_CLIENT_DIR;
  if (clientDir) {
    await app.register(fastifyStatic, { root: clientDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      // API/WS misses stay JSON 404s; any other path falls back to the SPA
      // shell (the client has no server-side routes of its own).
      if (req.url.startsWith("/api/") || req.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
    app.log.info({ clientDir }, "serving bundled SPA");
  }

  if (vault.isConfigured()) {
    app.log.info("vault already configured — clients will see the unlock screen");
  } else {
    app.log.info("no vault configured — clients will see the welcome/setup screen");
  }

  app.addHook("onClose", async () => {
    stopOutbox();
    await syncManager.shutdown();
  });

  return app;
}
