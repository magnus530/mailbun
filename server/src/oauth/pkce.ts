import { createHash, randomBytes } from "node:crypto";

// PKCE per RFC 7636. The verifier is a high-entropy random string; the
// challenge is the URL-safe base64 SHA-256 of it. The client sends the
// challenge during /authorize and proves possession of the verifier when
// exchanging the code for tokens.

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

export function challengeFromVerifier(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

export function generateState(): string {
  return base64UrlEncode(randomBytes(16));
}
