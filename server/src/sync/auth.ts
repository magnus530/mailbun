import { accountsRepo, type AccountRow } from "../db/accounts.js";
import { getAccessToken } from "../oauth/tokens.js";
import type { ImapConfig } from "./imap.js";

// Build the correct ImapConfig for the given account, refreshing OAuth
// tokens on the way through if needed. Used by every IMAP/SMTP entry point
// so they don't have to know which auth method an account uses.
export async function imapConfigForAccount(account: AccountRow): Promise<ImapConfig> {
  const base = {
    host: account.imap_host,
    port: account.imap_port,
    secure: !!account.imap_secure,
    user: account.email,
  };
  if (account.auth_method === "oauth") {
    const accessToken = await getAccessToken(account.id);
    return { ...base, accessToken };
  }
  return { ...base, password: accountsRepo.getPassword(account.id) };
}

export interface SmtpAuth {
  user: string;
  // exactly one of pass / accessToken is set
  pass?: string;
  accessToken?: string;
}

export async function smtpAuthForAccount(account: AccountRow): Promise<SmtpAuth> {
  if (account.auth_method === "oauth") {
    return { user: account.email, accessToken: await getAccessToken(account.id) };
  }
  return { user: account.email, pass: accountsRepo.getPassword(account.id) };
}
