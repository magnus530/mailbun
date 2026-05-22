// Side-effect-only module: loads .env from the repo root before anything
// else reads process.env.
//
// MUST be the first import in src/index.ts. Several modules (notably
// oauth/config.ts) snapshot env vars into top-level consts during their
// initial evaluation, so if .env loads later those snapshots are stuck on
// the pre-load values (i.e. undefined) and OAuth providers report
// "not configured" even when the file is correct.
//
// Shell env vars still win — loadEnvFile won't overwrite an already-set key.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const here = dirname(fileURLToPath(import.meta.url));
  // server/src/env.ts (dev) or server/dist/env.js (build) → repo root is ../..
  process.loadEnvFile(resolve(here, "..", "..", ".env"));
} catch {
  // No .env or unreadable. Shell env still applies.
}
