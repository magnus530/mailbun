import { ImapFlow, type MailboxLockObject } from "imapflow";
import type { FolderRole } from "@mailclient/shared";

export interface ImapPasswordConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface ImapOAuthConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  accessToken: string;
}

export type ImapConfig = ImapPasswordConfig | ImapOAuthConfig;

function isOAuth(c: ImapConfig): c is ImapOAuthConfig {
  return "accessToken" in c;
}

export function createImap(config: ImapConfig) {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: isOAuth(config)
      ? { user: config.user, accessToken: config.accessToken }
      : { user: config.user, pass: config.password },
    logger: false,
    emitLogs: false,
  });
}

export type FolderInfo = {
  path: string;
  name: string;
  delimiter: string;
  role: FolderRole | null;
  flags: Set<string>;
};

export async function listFolders(client: ImapFlow): Promise<FolderInfo[]> {
  const list = await client.list({ statusQuery: { messages: false } });
  const out: FolderInfo[] = [];
  for (const item of list) {
    const flags = new Set(Array.from(item.flags ?? []) as string[]);
    if (item.subscribed === false) {
      // skip unsubscribed odd folders unless they're \Inbox or special-use
      const isSpecial = [...flags].some((f) => f.startsWith("\\") && f !== "\\Subscribed");
      const isInbox = (item.path || "").toLowerCase() === "inbox";
      if (!isSpecial && !isInbox) continue;
    }
    out.push({
      path: item.path,
      name: item.name,
      delimiter: item.delimiter || "/",
      role: detectRole(item.path, flags, item.specialUse),
      flags,
    });
  }
  return out;
}

function detectRole(path: string, flags: Set<string>, specialUse?: string): FolderRole | null {
  const su = (specialUse || "").replace("\\", "").toLowerCase();
  const lower = path.toLowerCase();
  if (lower === "inbox") return "inbox";
  if (su === "sent" || flags.has("\\Sent") || /\bsent\b/i.test(path)) return "sent";
  if (su === "drafts" || flags.has("\\Drafts") || /\bdrafts?\b/i.test(path)) return "drafts";
  if (su === "trash" || flags.has("\\Trash") || /\btrash\b/i.test(path) || /\bbin\b/i.test(path)) return "trash";
  if (su === "junk" || flags.has("\\Junk") || /\bspam\b/i.test(path) || /\bjunk\b/i.test(path)) return "spam";
  if (su === "archive" || flags.has("\\Archive") || /\barchive\b/i.test(path)) return "archive";
  if (su === "all" || flags.has("\\All")) return "all";
  return null;
}

export async function withMailbox<T>(
  client: ImapFlow,
  path: string,
  fn: (lock: MailboxLockObject) => Promise<T>,
): Promise<T> {
  const lock = await client.getMailboxLock(path);
  try {
    return await fn(lock);
  } finally {
    lock.release();
  }
}
