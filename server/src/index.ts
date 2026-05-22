// MUST be first — loads .env before any module that snapshots process.env
// (e.g. oauth/config.ts) is evaluated. See env.ts for details.
import "./env.js";
import { buildServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 4100);
const HOST = process.env.HOST ?? "127.0.0.1";

// Last-chance safety net. Without these, an unhandled rejection from a
// background sync/IDLE worker can bring the whole server down — and with
// `npm-run-all --parallel`, Vite goes with it. Log loudly and stay up.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const app = await buildServer();

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`mailbun server ready at http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error({ err }, "failed to start server");
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
