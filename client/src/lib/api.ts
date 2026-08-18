import type {
  AccountDto,
  ComposeInput,
  FilterDto,
  FolderDto,
  MessageBodyDto,
  NewAccountInput,
  OAuthProviderInfo,
  SearchQuery,
  TagDto,
  ThreadDto,
  UpdateAccountInput,
} from "@mailclient/shared";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: any): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${method} ${path} -> ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const api = {
  // Vault
  vaultState: () => req<{ configured: boolean; unlocked: boolean }>("GET", "/api/vault/state"),
  vaultSetup: (password: string) => req("POST", "/api/vault/setup", { password }),
  vaultUnlock: (password: string) => req("POST", "/api/vault/unlock", { password }),
  vaultLock: () => req("POST", "/api/vault/lock", {}),

  // Accounts
  accounts: () => req<AccountDto[]>("GET", "/api/accounts"),
  createAccount: (input: NewAccountInput) => req<AccountDto>("POST", "/api/accounts", input),
  updateAccount: (id: number, input: UpdateAccountInput) =>
    req<AccountDto>("PUT", `/api/accounts/${id}`, input),
  deleteAccount: (id: number) => req("DELETE", `/api/accounts/${id}`),
  syncAccount: (id: number) => req("POST", `/api/accounts/${id}/sync`),

  // Folders
  folders: () => req<FolderDto[]>("GET", "/api/folders"),

  // Threads
  threads: (q: { folderRole?: string; accountId?: number; category?: string; tag?: string; starred?: boolean; limit?: number; offset?: number; }) => {
    const qs = new URLSearchParams(
      Object.entries(q)
        .filter(([, v]) => v !== undefined && v !== "" && v !== false)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return req<ThreadDto[]>("GET", `/api/threads${qs ? `?${qs}` : ""}`);
  },
  thread: (id: number) =>
    req<{ thread: ThreadDto; messages: MessageBodyDto[] }>("GET", `/api/threads/${id}`),
  message: (id: number) => req<MessageBodyDto>("GET", `/api/messages/${id}`),

  // Search
  search: (q: SearchQuery) => {
    const qs = new URLSearchParams(
      Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]),
    ).toString();
    return req<ThreadDto[]>("GET", `/api/search${qs ? `?${qs}` : ""}`);
  },

  // Mutations
  setRead: (messageIds: number[], read: boolean) =>
    req("POST", "/api/messages/read", { messageIds, read }),
  setStarred: (messageIds: number[], starred: boolean) =>
    req("POST", "/api/messages/star", { messageIds, starred }),
  deleteMessages: (messageIds: number[]) =>
    req("POST", "/api/messages/delete", { messageIds }),

  bulkAction: (
    threadIds: number[],
    action: "read" | "unread" | "star" | "unstar" | "archive" | "delete",
  ) => req<{ ok: boolean; count: number }>("POST", "/api/threads/bulk", { threadIds, action }),

  // Compose
  send: (input: ComposeInput) => req<{ ok: true; messageId: string }>("POST", "/api/messages/send", input),

  // Tags
  tags: () => req<TagDto[]>("GET", "/api/tags"),
  createTag: (name: string, color?: string) => req<TagDto>("POST", "/api/tags", { name, color }),
  deleteTag: (id: number) => req("DELETE", `/api/tags/${id}`),
  attachTag: (threadId: number, tagId: number) =>
    req("POST", `/api/threads/${threadId}/tags`, { tagId }),
  detachTag: (threadId: number, tagId: number) =>
    req("DELETE", `/api/threads/${threadId}/tags/${tagId}`),

  // OAuth
  oauthProviders: () => req<OAuthProviderInfo[]>("GET", "/api/oauth/providers"),

  // Filters
  filters: () => req<FilterDto[]>("GET", "/api/filters"),
  createFilter: (input: Omit<FilterDto, "id">) => req<FilterDto>("POST", "/api/filters", input),
  updateFilter: (id: number, input: Partial<Omit<FilterDto, "id">>) =>
    req("PUT", `/api/filters/${id}`, input),
  deleteFilter: (id: number) => req("DELETE", `/api/filters/${id}`),
};
