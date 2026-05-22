import type { FastifyInstance } from "fastify";
import type { OAuthProvider, OAuthProviderInfo } from "@mailclient/shared";
import { vault } from "../crypto/vault.js";
import { accountsRepo } from "../db/accounts.js";
import { syncManager } from "../sync/manager.js";
import { exchangeCodeForTokens } from "../oauth/tokens.js";
import {
  getProviderConfig, listProviders, redirectUri,
} from "../oauth/config.js";
import { stateStore } from "../oauth/state-store.js";
import { challengeFromVerifier, generateState, generateVerifier } from "../oauth/pkce.js";

const SUPPORTED: OAuthProvider[] = ["google", "microsoft"];

function isSupported(p: string): p is OAuthProvider {
  return (SUPPORTED as string[]).includes(p);
}

export async function registerOAuthRoutes(app: FastifyInstance) {
  // List of providers + whether each is configured (env var present). The
  // client uses this to decide which sign-in buttons to render.
  app.get("/api/oauth/providers", async () => {
    const out: OAuthProviderInfo[] = listProviders().map((p) => ({
      provider: p.provider,
      displayName: p.displayName,
      configured: !!p.clientId,
    }));
    return out;
  });

  // Step 1: client opens this URL in the browser. We generate state + PKCE
  // verifier, stash them, then 302 to the provider's authorize endpoint.
  app.get<{ Params: { provider: string } }>(
    "/api/oauth/:provider/start",
    async (req, reply) => {
      if (!vault.isUnlocked()) return reply.code(423).send({ error: "vault locked" });
      const provider = req.params.provider;
      if (!isSupported(provider)) return reply.code(404).send({ error: "unknown provider" });
      const cfg = getProviderConfig(provider);
      if (!cfg.clientId) {
        return reply.code(500).send({
          error: `${cfg.displayName} OAuth not configured. Set ${provider === "google" ? "GOOGLE_OAUTH_CLIENT_ID" : "MICROSOFT_OAUTH_CLIENT_ID"} and restart the server.`,
        });
      }

      const state = generateState();
      const verifier = generateVerifier();
      const spaOrigin = resolveSpaOrigin(req.headers);
      stateStore.put(state, { provider, verifier, createdAt: Date.now(), spaOrigin });

      const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri(),
        response_type: "code",
        scope: cfg.scopes.join(" "),
        state,
        code_challenge: challengeFromVerifier(verifier),
        code_challenge_method: "S256",
        // Force consent so we always get a refresh_token back. Google in
        // particular only returns refresh_token on first consent unless we
        // explicitly ask for it again.
        access_type: "offline",
        prompt: "consent",
      });
      const url = `${cfg.authorizeUrl}?${params.toString()}`;
      reply.redirect(url);
    },
  );

  // Step 2: provider redirects here. We exchange the code for tokens,
  // resolve the user's email, persist the account, then redirect back to the
  // SPA so the user lands in their unified inbox.
  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    "/api/oauth/callback",
    async (req, reply) => {
      const { code, state, error, error_description } = req.query;

      // If we don't recognize the state, fall back to whatever origin the
      // request came from for the "back to inbox" link. State validation
      // still happens below — this is purely so the link doesn't 404.
      const fallbackOrigin = resolveSpaOrigin(req.headers);

      if (error) return reply.type("text/html").send(failPage(error, error_description, fallbackOrigin));
      if (!code || !state) return reply.type("text/html").send(failPage("missing code/state", undefined, fallbackOrigin));

      const flow = stateStore.take(state);
      if (!flow) return reply.type("text/html").send(failPage("expired or unknown state", undefined, fallbackOrigin));

      if (!vault.isUnlocked()) {
        return reply.type("text/html").send(failPage("vault locked", "unlock the app and try again", flow.spaOrigin));
      }

      try {
        const tokens = await exchangeCodeForTokens(flow.provider, code, flow.verifier);
        if (!tokens.refresh_token) {
          return reply.type("text/html").send(
            failPage(
              "no refresh token returned",
              "Google sometimes only returns one on first consent — revoke this app at myaccount.google.com/permissions and try again.",
              flow.spaOrigin,
            ),
          );
        }
        const cfg = getProviderConfig(flow.provider);
        const email = await cfg.resolveEmail(tokens, fetch);

        const account = accountsRepo.upsertOAuth({
          email,
          provider: flow.provider,
          refreshToken: tokens.refresh_token,
          imapHost: cfg.imapHost, imapPort: cfg.imapPort, imapSecure: cfg.imapSecure,
          smtpHost: cfg.smtpHost, smtpPort: cfg.smtpPort, smtpSecure: cfg.smtpSecure,
        });

        // Kick off initial sync; safe to fire-and-forget.
        syncManager.startAccount(account.id).catch((err) =>
          app.log.error({ err, accountId: account.id }, "post-oauth sync start failed"),
        );

        reply.type("text/html").send(successPage(email, cfg.displayName, flow.spaOrigin));
      } catch (err: any) {
        app.log.error({ err }, "oauth callback failed");
        return reply.type("text/html").send(failPage("token exchange failed", err?.message ?? String(err), flow.spaOrigin));
      }
    },
  );
}

// Best-effort guess at the origin of the SPA that started this flow.
// Priority: Referer header → Origin header → backend self-origin (prod).
function resolveSpaOrigin(headers: Record<string, string | string[] | undefined>): string {
  const referer = pickHeader(headers, "referer");
  if (referer) {
    try { return new URL(referer).origin; } catch { /* ignore */ }
  }
  const origin = pickHeader(headers, "origin");
  if (origin) return origin;
  // Same-origin fallback. In production the SPA is typically served from the
  // same host:port as the API.
  return "/";
}

function pickHeader(h: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = h[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

function pageShell(title: string, message: string, color: "ok" | "fail", spaOrigin: string): string {
  const accent = color === "ok" ? "#10b981" : "#ef4444";
  // spaOrigin may be a full URL (cross-origin in dev) or "/" (same-origin in prod).
  const target = spaOrigin === "/" ? "/" : spaOrigin.replace(/\/+$/, "") + "/";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b0e14; color: #e6e9f0;
         display: grid; place-items: center; min-height: 100vh; margin: 0; }
  .card { max-width: 28rem; padding: 2rem; border-radius: 1rem;
          background: #11151d; border: 1px solid #232935; text-align: center; }
  h1 { margin: 0 0 0.5rem; color: ${accent}; }
  p { color: #a0a7b8; line-height: 1.5; }
  a { color: #60a5fa; }
  .meta { font-size: 0.75rem; color: #6e768a; margin-top: 1rem; }
</style></head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="meta">You can close this tab and return to mailbun.</p>
    <p><a href="${escapeAttr(target)}">Back to inbox →</a></p>
  </div>
  <script>
    setTimeout(() => { try { window.opener?.postMessage("oauth-done", "*"); } catch {} }, 100);
    setTimeout(() => { window.location.href = ${JSON.stringify(target)}; }, 1500);
  </script>
</body></html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function successPage(email: string, providerName: string, spaOrigin: string): string {
  return pageShell(
    `Connected ${providerName}`,
    `<strong>${email}</strong> is now syncing in your inbox.`,
    "ok",
    spaOrigin,
  );
}

function failPage(headline: string, detail: string | undefined, spaOrigin: string): string {
  return pageShell(
    "Sign-in failed",
    `${headline}${detail ? `<br><span style="color:#6e768a">${detail}</span>` : ""}`,
    "fail",
    spaOrigin,
  );
}
