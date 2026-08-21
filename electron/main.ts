import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
// electron-updater is CJS with named exports and no default export — a
// default import resolves to undefined. `autoUpdater` is a lazy getter, so
// it's only constructed when first accessed (inside app.whenReady below).
import { autoUpdater } from "electron-updater";

// Prefer native Wayland when running in a Wayland session, falling back to
// X11 otherwise. Without this, a packaged Linux build launched from a desktop
// launcher (which doesn't inherit the shell's ELECTRON_OZONE_PLATFORM_HINT)
// runs under XWayland, where the render buffer and the compositor's size
// desync under a tiling WM — the window won't reflow when tiled smaller.
// "auto" is a no-op on X11/macOS/Windows. Must run before app is ready.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}

// Fixed port — the OAuth redirect URI registered with Google/Microsoft is
// http://127.0.0.1:4100/api/oauth/callback, so the server must bind here.
const PORT = 4100;
const HOST = "127.0.0.1";
const DEV_URL = "http://127.0.0.1:5173";        // Vite dev server
const PROD_URL = `http://${HOST}:${PORT}`;       // in-process Fastify server

// Packaged build → start the bundled server in-process and load from it.
// Dev (electron run against source) → attach to the already-running
// `npm run dev` server + Vite, so HMR works and no native rebuild is needed.
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let serverInstance: { close: () => Promise<void> } | null = null;

// OAuth client IDs for release builds. credentials.ts is gitignored and only
// present in official builds; without it (dev / open-source checkout) the
// server falls back to reading .env.
async function loadBakedCredentials(): Promise<Record<string, string>> {
  try {
    const mod = await import(pathToFileURL(path.join(__dirname, "credentials.js")).href);
    return (mod.bakedCredentials ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
}

async function startServer(): Promise<void> {
  const appPath = app.getAppPath();
  // Data (SQLite DB, encrypted creds, attachments) lives in the OS per-user
  // app directory — never next to the binary.
  process.env.MAILCLIENT_DATA_DIR = app.getPath("userData");
  // Tell the server where the built SPA is so it serves it same-origin.
  process.env.MAILBUN_CLIENT_DIR = path.join(appPath, "client", "dist");
  process.env.PORT = String(PORT);
  process.env.HOST = HOST;
  // Plain (non-pretty) logging — no pino-pretty worker thread in the bundle.
  process.env.NODE_ENV = "production";

  // Bake OAuth IDs in so packaged users never touch a .env file.
  const baked = await loadBakedCredentials();
  for (const [key, value] of Object.entries(baked)) {
    if (value) process.env[key] = value;
  }

  // Dynamic import AFTER env is set — server modules (notably oauth/config.ts)
  // snapshot process.env at module-evaluation time. The server is an esbuild
  // CJS bundle (single file with all deps inlined except the native
  // better-sqlite3) — see `npm run server:bundle`.
  const serverEntry = path.join(appPath, "server", "bundle", "server.cjs");
  const mod = await import(pathToFileURL(serverEntry).href);
  const buildServer = mod.buildServer ?? mod.default?.buildServer;
  const fastify = await buildServer();
  await fastify.listen({ port: PORT, host: HOST });
  serverInstance = fastify;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: "#0b0e14",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const appUrl = isDev ? DEV_URL : PROD_URL;
  const appOrigin = new URL(appUrl).origin;
  void mainWindow.loadURL(appUrl);
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // target=_blank links (email bodies, etc.) → system browser, never a new
  // Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // In-window navigations: keep same-origin app navigation, push everything
  // else — and crucially the OAuth start URL — to the system browser. OAuth
  // in the system browser is the RFC 8252 native-app flow; it sidesteps
  // Google's block on OAuth inside embedded webviews. The loopback callback
  // still hits our in-process server, and the SPA picks up the new account
  // from the sync WebSocket event.
  mainWindow.webContents.on("will-navigate", (e, url) => {
    let u: URL;
    try { u = new URL(url); } catch { return; }
    const isOAuthStart =
      u.pathname.startsWith("/api/oauth/") && u.pathname.endsWith("/start");
    if (u.origin !== appOrigin || isOAuthStart) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  if (!isDev) {
    try {
      await startServer();
    } catch (err) {
      console.error("[mailbun] failed to start bundled server:", err);
    }
  }
  createWindow();

  if (!isDev) {
    // Check GitHub Releases for a newer version, download in the background,
    // and notify the user; the update installs on next quit. No-op in dev.
    // macOS auto-update only works once builds are code-signed.
    autoUpdater.checkForUpdatesAndNotify().catch((err) =>
      console.error("[mailbun] update check failed:", err),
    );
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => console.error("[mailbun] startup failed:", err));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Best-effort graceful close. SQLite is consistent per-statement, so an
// abrupt exit is safe too — this just lets Fastify drain.
app.on("before-quit", () => {
  const s = serverInstance;
  serverInstance = null;
  s?.close().catch(() => { /* ignore */ });
});
