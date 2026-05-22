import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the data dir. In a packaged build MAILCLIENT_DATA_DIR is always set
// (Electron points it at the OS per-user app dir), so the import.meta.url
// branch below never runs — which also keeps the esbuild CJS server bundle
// working, since a CJS bundle has no real import.meta.url. In dev / standalone
// we fall back to `<repo>/data`, resolved relative to this source file (not
// process.cwd()) so `dev:server` and `node dist/index.js` agree.
function resolveBaseDir(): string {
  const fromEnv = process.env.MAILCLIENT_DATA_DIR;
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));   // …/server/src or …/server/dist
  return resolve(here, "..", "..", "data");
}

const baseDir = resolveBaseDir();

mkdirSync(baseDir, { recursive: true });

export const paths = {
  baseDir,
  dbFile: resolve(baseDir, "mailclient.sqlite"),
  attachmentsDir: resolve(baseDir, "attachments"),
};

mkdirSync(paths.attachmentsDir, { recursive: true });
