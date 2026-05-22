import type { OAuthProvider } from "@mailclient/shared";

// Per-provider OAuth configuration.
//
// Client IDs are read from environment variables. The user must register one
// OAuth client per provider (one-time, ~15 min) and set the env var. Until
// then, that provider's "Sign in" button is hidden in the UI.
//
// We use the OAuth 2.0 PKCE flow for installed apps, so no client secret is
// required (or stored) on this side.

export interface ProviderConfig {
  provider: OAuthProvider;
  displayName: string;
  authorizeUrl: string;
  tokenUrl: string;
  // Scopes that grant IMAP/SMTP via XOAUTH2 plus a way to read the user's
  // email address.
  scopes: string[];
  clientId: string | undefined;
  // Some providers (notably Google for "Desktop app" clients) require the
  // client_secret in the token exchange POST even when we use PKCE. Google's
  // own docs note this secret isn't actually secret for installed apps —
  // it's expected to ship with the distributed binary. Optional: providers
  // that support pure public-client flows (Microsoft with "Allow public
  // client flows" enabled) leave this undefined.
  clientSecret?: string | undefined;
  // Default IMAP/SMTP host config that we know works for this provider.
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  // Pulls the user's email from the token response. Some providers ship it in
  // the id_token, others require a separate userinfo call.
  resolveEmail: (tokens: TokenResponse, fetchImpl: typeof fetch) => Promise<string>;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

const decodeJwtPayload = (jwt: string): Record<string, any> | null => {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
};

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  google: {
    provider: "google",
    displayName: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://mail.google.com/",
      "openid",
      "email",
    ],
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    async resolveEmail(tokens) {
      const claims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null;
      if (claims?.email) return String(claims.email);
      throw new Error("could not resolve email from Google id_token");
    },
  },
  microsoft: {
    provider: "microsoft",
    displayName: "Microsoft",
    // Use the /common authority so both personal and work/school accounts work.
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "https://outlook.office.com/SMTP.Send",
      "offline_access",
      "openid",
      "email",
    ],
    clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false, // STARTTLS
    async resolveEmail(tokens, fetchImpl) {
      const claims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null;
      if (claims?.email) return String(claims.email);
      if (claims?.preferred_username) return String(claims.preferred_username);
      // Fall back to Graph /me. Requires a User.Read scope which we don't
      // request — so this rarely runs.
      const r = await fetchImpl("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!r.ok) throw new Error(`Graph /me failed: ${r.status}`);
      const j = (await r.json()) as any;
      return j.mail || j.userPrincipalName;
    },
  },
};

export function getProviderConfig(provider: OAuthProvider): ProviderConfig {
  return PROVIDERS[provider];
}

export function listProviders(): ProviderConfig[] {
  return Object.values(PROVIDERS);
}

export function redirectUri(): string {
  // Loopback redirect — the only safe option for an installed app, per Google's
  // OAuth policy. Must match the redirect URI registered in Google Cloud.
  const port = Number(process.env.PORT ?? 4100);
  return `http://127.0.0.1:${port}/api/oauth/callback`;
}
