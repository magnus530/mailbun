// End-to-end OAuth flow test against a mock Google provider running on
// localhost. Uses an isolated MAILCLIENT_DATA_DIR so the user's vault is
// untouched.
//
// Run from project root:
//   node scripts/test-oauth.mjs
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import http from "node:http";

const dataDir = mkdtempSync(join(tmpdir(), "mailclient-oauth-test-"));
process.env.MAILCLIENT_DATA_DIR = dataDir;
process.env.PORT = "4117";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client";

// Stand up a mock Google. /authorize redirects with a code; /token returns
// fake tokens with an id_token whose payload says email=alice@example.com.
const MOCK_PORT = 4118;
const idTokenPayload = Buffer.from(JSON.stringify({ email: "alice@example.com" }))
  .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const idToken = `header.${idTokenPayload}.sig`;
const expectedChallenge = (verifier) =>
  createHash("sha256").update(verifier).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const codeToVerifier = new Map();

const mock = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  if (url.pathname === "/authorize") {
    const state = url.searchParams.get("state");
    const challenge = url.searchParams.get("code_challenge");
    const redirect = url.searchParams.get("redirect_uri");
    const code = "mock-auth-code-" + Date.now();
    codeToVerifier.set(code, challenge);
    res.writeHead(302, { Location: `${redirect}?code=${code}&state=${state}` });
    res.end();
    return;
  }
  if (url.pathname === "/token" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const code = params.get("code");
      const verifier = params.get("code_verifier");
      const expected = codeToVerifier.get(code);
      if (!expected || expectedChallenge(verifier) !== expected) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      codeToVerifier.delete(code);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        id_token: idToken,
        expires_in: 3600,
        token_type: "Bearer",
      }));
    });
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));

// Override Google endpoints to point at our mock BEFORE importing the server.
const cfgModule = await import("/home/magnus/mailclient/server/src/oauth/config.ts");
const realConfig = cfgModule.getProviderConfig("google");
realConfig.authorizeUrl = `http://127.0.0.1:${MOCK_PORT}/authorize`;
realConfig.tokenUrl = `http://127.0.0.1:${MOCK_PORT}/token`;

const { buildServer } = await import("/home/magnus/mailclient/server/src/server.ts");
const { vault } = await import("/home/magnus/mailclient/server/src/crypto/vault.ts");
const { accountsRepo } = await import("/home/magnus/mailclient/server/src/db/accounts.ts");

const app = await buildServer();
await app.listen({ port: 4117, host: "127.0.0.1" });
await vault.setup("smoketest12");

// 1. Discover providers — should report google as configured.
const providers = await fetch("http://127.0.0.1:4117/api/oauth/providers").then((r) => r.json());
console.log("providers:", providers);

// 2. Start the flow. The server should 302 to our mock.
const startRes = await fetch("http://127.0.0.1:4117/api/oauth/google/start", { redirect: "manual" });
const authUrl = startRes.headers.get("location");
console.log("redirected to:", authUrl?.slice(0, 60) + "...");

// 3. Follow the mock authorize URL — it 302s back to our callback.
const authRes = await fetch(authUrl, { redirect: "manual" });
const callbackUrl = authRes.headers.get("location");
console.log("mock authorize redirected to:", callbackUrl?.slice(0, 60) + "...");

// 4. Hit the callback. Server exchanges code, persists account.
const cbRes = await fetch(callbackUrl);
console.log("callback status:", cbRes.status, "ok:", cbRes.ok);

// 5. Account should now exist with auth_method='oauth'.
const accounts = accountsRepo.list();
console.log("accounts after oauth:", accounts.map((a) => ({
  id: a.id, email: a.email, authMethod: a.authMethod, oauthProvider: a.oauthProvider,
})));

// 6. Refresh token round-trip.
const refresh = accountsRepo.getOAuthRefresh(accounts[0].id);
console.log("decrypted refresh token:", refresh);

await app.close();
mock.close();
rmSync(dataDir, { recursive: true, force: true });
console.log("\n✓ OAuth flow works end-to-end");
process.exit(0);
