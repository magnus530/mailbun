import type {
  AccountDto, AuthMethod, NewAccountInput, OAuthProvider, UpdateAccountInput,
} from "@mailclient/shared";
import { db } from "./index.js";
import { vault } from "../crypto/vault.js";

export interface AccountRow {
  id: number;
  email: string;
  display_name: string | null;
  imap_host: string;
  imap_port: number;
  imap_secure: number;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number;
  encrypted_password: Buffer;
  color: string;
  created_at: number;
  synced_at: number | null;
  last_error: string | null;
  auth_method: AuthMethod;
  oauth_provider: OAuthProvider | null;
  encrypted_oauth_refresh: Buffer | null;
}

function rowToDto(row: AccountRow): AccountDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: !!row.imap_secure,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: !!row.smtp_secure,
    color: row.color,
    syncedAt: row.synced_at ? new Date(row.synced_at).toISOString() : null,
    lastError: row.last_error,
    authMethod: row.auth_method,
    oauthProvider: row.oauth_provider,
  };
}

export const accountsRepo = {
  list(): AccountDto[] {
    const rows = db.prepare("SELECT * FROM accounts ORDER BY id").all() as AccountRow[];
    return rows.map(rowToDto);
  },
  get(id: number): AccountDto | null {
    const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
    return row ? rowToDto(row) : null;
  },
  getRow(id: number): AccountRow | null {
    const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
    return row ?? null;
  },
  create(input: NewAccountInput): AccountDto {
    const encrypted = vault.encryptString(input.password);
    const stmt = db.prepare(`
      INSERT INTO accounts (
        email, display_name, imap_host, imap_port, imap_secure,
        smtp_host, smtp_port, smtp_secure, encrypted_password, color, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.email,
      input.displayName ?? null,
      input.imapHost,
      input.imapPort,
      input.imapSecure ? 1 : 0,
      input.smtpHost,
      input.smtpPort,
      input.smtpSecure ? 1 : 0,
      encrypted,
      input.color ?? "#3b82f6",
      Date.now(),
    );
    return this.get(result.lastInsertRowid as number)!;
  },
  delete(id: number) {
    db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  },
  update(id: number, patch: UpdateAccountInput): AccountDto | null {
    const existing = this.getRow(id);
    if (!existing) return null;
    const next = {
      display_name: patch.displayName !== undefined ? patch.displayName : existing.display_name,
      imap_host: patch.imapHost ?? existing.imap_host,
      imap_port: patch.imapPort ?? existing.imap_port,
      imap_secure: patch.imapSecure !== undefined ? (patch.imapSecure ? 1 : 0) : existing.imap_secure,
      smtp_host: patch.smtpHost ?? existing.smtp_host,
      smtp_port: patch.smtpPort ?? existing.smtp_port,
      smtp_secure: patch.smtpSecure !== undefined ? (patch.smtpSecure ? 1 : 0) : existing.smtp_secure,
      color: patch.color ?? existing.color,
      encrypted_password:
        patch.password && patch.password.length > 0
          ? vault.encryptString(patch.password)
          : existing.encrypted_password,
    };
    db.prepare(
      `UPDATE accounts SET
         display_name = ?, imap_host = ?, imap_port = ?, imap_secure = ?,
         smtp_host = ?, smtp_port = ?, smtp_secure = ?, color = ?, encrypted_password = ?,
         last_error = NULL
       WHERE id = ?`,
    ).run(
      next.display_name,
      next.imap_host,
      next.imap_port,
      next.imap_secure,
      next.smtp_host,
      next.smtp_port,
      next.smtp_secure,
      next.color,
      next.encrypted_password,
      id,
    );
    return this.get(id);
  },
  updateSyncedAt(id: number, ts: number) {
    db.prepare("UPDATE accounts SET synced_at = ?, last_error = NULL WHERE id = ?").run(ts, id);
  },
  setError(id: number, error: string) {
    db.prepare("UPDATE accounts SET last_error = ? WHERE id = ?").run(error, id);
  },
  getPassword(id: number): string {
    const row = this.getRow(id);
    if (!row) throw new Error(`account ${id} not found`);
    return vault.decryptString(row.encrypted_password);
  },
  getOAuthRefresh(id: number): string | null {
    const row = this.getRow(id);
    if (!row || !row.encrypted_oauth_refresh) return null;
    return vault.decryptString(row.encrypted_oauth_refresh);
  },
  upsertOAuth(input: {
    email: string;
    displayName?: string | null;
    provider: OAuthProvider;
    refreshToken: string;
    imapHost: string;
    imapPort: number;
    imapSecure: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    color?: string;
  }): AccountDto {
    const encRefresh = vault.encryptString(input.refreshToken);
    const empty = vault.encryptString(""); // placeholder for the NOT NULL password column
    // If an account with this email already exists, swap it to OAuth.
    const existing = db.prepare("SELECT id FROM accounts WHERE email = ?").get(input.email) as
      | { id: number } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE accounts SET
           display_name = COALESCE(?, display_name),
           imap_host = ?, imap_port = ?, imap_secure = ?,
           smtp_host = ?, smtp_port = ?, smtp_secure = ?,
           color = COALESCE(?, color),
           auth_method = 'oauth', oauth_provider = ?,
           encrypted_oauth_refresh = ?,
           encrypted_password = ?,
           last_error = NULL
         WHERE id = ?`,
      ).run(
        input.displayName ?? null,
        input.imapHost, input.imapPort, input.imapSecure ? 1 : 0,
        input.smtpHost, input.smtpPort, input.smtpSecure ? 1 : 0,
        input.color ?? null,
        input.provider, encRefresh, empty, existing.id,
      );
      return this.get(existing.id)!;
    }
    const result = db.prepare(`
      INSERT INTO accounts (
        email, display_name, imap_host, imap_port, imap_secure,
        smtp_host, smtp_port, smtp_secure, encrypted_password, color, created_at,
        auth_method, oauth_provider, encrypted_oauth_refresh
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'oauth', ?, ?)
    `).run(
      input.email, input.displayName ?? null,
      input.imapHost, input.imapPort, input.imapSecure ? 1 : 0,
      input.smtpHost, input.smtpPort, input.smtpSecure ? 1 : 0,
      empty, input.color ?? "#3b82f6", Date.now(),
      input.provider, encRefresh,
    );
    return this.get(result.lastInsertRowid as number)!;
  },
  setOAuthRefresh(id: number, refreshToken: string) {
    const enc = vault.encryptString(refreshToken);
    db.prepare("UPDATE accounts SET encrypted_oauth_refresh = ? WHERE id = ?").run(enc, id);
  },
};
