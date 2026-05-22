import type { OAuthProvider } from "@mailclient/shared";
import { accountsRepo } from "../db/accounts.js";
import { getProviderConfig, redirectUri, type TokenResponse } from "./config.js";

interface CachedAccess {
  accessToken: string;
  expiresAt: number;
}

const cache = new Map<number, CachedAccess>();
const SAFETY_WINDOW_MS = 60_000;

// Exchange an authorization code for tokens.
export async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const cfg = getProviderConfig(provider);
  if (!cfg.clientId) throw new Error(`${cfg.displayName} OAuth client ID not configured`);

  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    code_verifier: verifier,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

// Refresh an access token using the stored refresh token. Some providers
// rotate refresh tokens — if we get a new one, persist it.
export async function refreshAccessToken(accountId: number): Promise<string> {
  const account = accountsRepo.getRow(accountId);
  if (!account || account.auth_method !== "oauth" || !account.oauth_provider) {
    throw new Error(`account ${accountId} is not an oauth account`);
  }
  const refresh = accountsRepo.getOAuthRefresh(accountId);
  if (!refresh) throw new Error(`account ${accountId} has no refresh token`);

  const cfg = getProviderConfig(account.oauth_provider);
  if (!cfg.clientId) throw new Error(`${cfg.displayName} OAuth client ID not configured`);

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token refresh failed: ${res.status} ${text}`);
  }
  const tokens = (await res.json()) as TokenResponse;
  if (tokens.refresh_token && tokens.refresh_token !== refresh) {
    accountsRepo.setOAuthRefresh(accountId, tokens.refresh_token);
  }
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  cache.set(accountId, { accessToken: tokens.access_token, expiresAt });
  return tokens.access_token;
}

// Get a valid access token for an account, refreshing if needed. Used by the
// IMAP/SMTP layers via XOAUTH2.
export async function getAccessToken(accountId: number): Promise<string> {
  const cached = cache.get(accountId);
  if (cached && cached.expiresAt - SAFETY_WINDOW_MS > Date.now()) {
    return cached.accessToken;
  }
  return refreshAccessToken(accountId);
}

export function invalidateAccessToken(accountId: number) {
  cache.delete(accountId);
}
