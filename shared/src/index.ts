// Shared DTOs between server and client.
// Database row shapes live in server/src/db; these are the wire types.

export type AuthMethod = "password" | "oauth";
export type OAuthProvider = "google" | "microsoft";

export interface AccountDto {
  id: number;
  email: string;
  displayName: string | null;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  color: string;
  syncedAt: string | null;
  lastError: string | null;
  authMethod: AuthMethod;
  oauthProvider: OAuthProvider | null;
}

export interface OAuthProviderInfo {
  provider: OAuthProvider;
  configured: boolean;
  displayName: string;
}

export interface NewAccountInput {
  email: string;
  displayName?: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  color?: string;
}

// Patch type for editing an existing account. Anything omitted/undefined is
// left alone. Pass an empty `password` to keep the existing one.
export interface UpdateAccountInput {
  displayName?: string | null;
  password?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  color?: string;
}

export interface FolderDto {
  id: number;
  accountId: number;
  path: string;
  name: string;
  role: FolderRole | null;
  unreadCount: number;
  totalCount: number;
}

export type FolderRole =
  | "inbox"
  | "sent"
  | "drafts"
  | "trash"
  | "spam"
  | "archive"
  | "all";

export interface AddressDto {
  name: string | null;
  address: string;
}

export interface MessageSummaryDto {
  id: number;
  accountId: number;
  threadId: number;
  folderId: number;
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  from: AddressDto[];
  to: AddressDto[];
  cc: AddressDto[];
  bcc: AddressDto[];
  subject: string;
  preview: string;
  date: string;
  flags: string[];
  hasAttachments: boolean;
  size: number;
  unread: boolean;
  starred: boolean;
}

export interface MessageBodyDto extends MessageSummaryDto {
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: AttachmentDto[];
}

export interface AttachmentDto {
  id: number;
  filename: string;
  contentType: string;
  size: number;
}

export interface ThreadDto {
  id: number;
  subject: string;
  participants: AddressDto[];
  messageCount: number;
  unreadCount: number;
  hasStarred: boolean;
  hasAttachments: boolean;
  lastDate: string;
  preview: string;
  tags: TagDto[];
  accountIds: number[];
  folderRoles: FolderRole[];
}

export interface TagDto {
  id: number;
  name: string;
  color: string;
}

export interface FilterDto {
  id: number;
  name: string;
  enabled: boolean;
  matchType: "all" | "any";
  conditions: FilterCondition[];
  actions: FilterAction[];
}

export interface FilterCondition {
  field: "from" | "to" | "subject" | "body" | "any";
  op: "contains" | "equals" | "startsWith" | "endsWith";
  value: string;
}

export interface FilterAction {
  type: "tag" | "markRead" | "star" | "moveToFolder" | "delete";
  value?: string;
}

export interface ComposeInput {
  accountId: number;
  to: AddressDto[];
  cc?: AddressDto[];
  bcc?: AddressDto[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  inReplyTo?: string | null;
  references?: string[];
  draftId?: number | null;
}

export interface SearchQuery {
  q?: string;
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  unread?: boolean;
  starred?: boolean;
  accountId?: number;
  folderRole?: FolderRole;
  tag?: string;
  limit?: number;
  offset?: number;
}

// WebSocket events server -> client
export type ServerEvent =
  | { type: "sync:start"; accountId: number }
  | { type: "sync:progress"; accountId: number; folder: string; done: number; total: number }
  | { type: "sync:done"; accountId: number }
  | { type: "sync:error"; accountId: number; error: string }
  | { type: "thread:new"; threadId: number }
  | { type: "thread:update"; threadId: number }
  | { type: "thread:delete"; threadId: number }
  | { type: "folder:update"; folderId: number };
