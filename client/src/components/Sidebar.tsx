import { useMemo, useState } from "react";
import {
  Inbox, Send, FileText, Star, Trash, AlertTriangle, Archive, Tag as TagIcon,
  Plus, Lock, RefreshCw, Pencil, Layers, Settings, AlertCircle, PanelLeftClose,
} from "lucide-react";
import clsx from "clsx";
import type { AccountDto, FolderRole } from "@mailclient/shared";
import { api } from "../lib/api";
import { useAccounts, useFolders, useTags } from "../lib/hooks";
import { useAppStore, type MailboxView } from "../lib/store";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AccountSetup } from "./AccountSetup";
import { AccountSettings } from "./AccountSettings";
import { AppSettings } from "./AppSettings";

const PRIMARY: { role: FolderRole; label: string; Icon: typeof Inbox }[] = [
  { role: "inbox", label: "Inbox", Icon: Inbox },
  { role: "sent", label: "Sent", Icon: Send },
  { role: "drafts", label: "Drafts", Icon: FileText },
  { role: "archive", label: "Archive", Icon: Archive },
  { role: "spam", label: "Spam", Icon: AlertTriangle },
  { role: "trash", label: "Trash", Icon: Trash },
];

// Order of per-account view buttons. "starred" is virtual; "archive" works
// against either a real Archive folder or All Mail (Gmail) — we synthesize
// the entry whenever either folder exists for the account.
const ACCOUNT_VIEW_ORDER: MailboxView[] = [
  "inbox", "starred", "sent", "drafts", "archive", "spam", "trash",
];

const VIEW_META: Record<MailboxView, { label: string; Icon: typeof Inbox }> = {
  inbox:   { label: "Inbox",   Icon: Inbox },
  starred: { label: "Starred", Icon: Star },
  sent:    { label: "Sent",    Icon: Send },
  drafts:  { label: "Drafts",  Icon: FileText },
  archive: { label: "Archive", Icon: Archive },
  spam:    { label: "Spam",    Icon: AlertTriangle },
  trash:   { label: "Trash",   Icon: Trash },
  all:     { label: "All",     Icon: Layers },
};

export function Sidebar() {
  const accounts = useAccounts();
  const folders = useFolders();
  const tags = useTags();
  const selection = useAppStore((s) => s.selection);
  const setSelection = useAppStore((s) => s.setSelection);
  const openCompose = useAppStore((s) => s.openCompose);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const qc = useQueryClient();
  const [setupOpen, setSetupOpen] = useState(false);
  const [settingsAccount, setSettingsAccount] = useState<AccountDto | null>(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const lock = useMutation({
    mutationFn: () => api.vaultLock(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vault", "state"] }),
  });

  // Aggregate unread counts per role across all accounts.
  const unreadByRole = useMemo(() => {
    const map = new Map<FolderRole, number>();
    for (const f of folders.data ?? []) {
      if (!f.role) continue;
      map.set(f.role, (map.get(f.role) ?? 0) + f.unreadCount);
    }
    return map;
  }, [folders.data]);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-bg-subtle">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="mailbun logo" className="app-logo h-6 w-6 object-contain" />
          <span className="text-sm font-semibold tracking-tight">Mailbun</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAppSettingsOpen(true)}
            title="Settings"
            className="rounded p-1 text-fg-muted hover:bg-bg-hover"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button onClick={() => lock.mutate()} title="Lock vault" className="rounded p-1 text-fg-muted hover:bg-bg-hover">
            <Lock className="h-4 w-4" />
          </button>
          <button
            onClick={toggleSidebar}
            title="Hide sidebar"
            className="rounded p-1 text-fg-muted hover:bg-bg-hover"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      <button onClick={() => openCompose()} className="mx-3 mb-3 flex items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-medium text-white shadow hover:bg-accent-hover">
        <Pencil className="h-4 w-4" />
        Compose
      </button>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <Section label="Mailboxes">
          {PRIMARY.map(({ role, label, Icon }) => (
            <NavItem
              key={role}
              icon={<Icon className="h-4 w-4" />}
              label={label}
              count={unreadByRole.get(role)}
              active={selection.kind === "folder" && selection.role === role}
              onClick={() => setSelection({ kind: "folder", role })}
            />
          ))}
          <NavItem
            icon={<Star className="h-4 w-4" />}
            label="Starred"
            active={selection.kind === "starred"}
            onClick={() => setSelection({ kind: "starred" })}
          />
          <NavItem
            icon={<Layers className="h-4 w-4" />}
            label="All mail"
            active={selection.kind === "search" && selection.query === ""}
            onClick={() => setSelection({ kind: "search", query: "" })}
          />
        </Section>

        {(tags.data?.length ?? 0) > 0 ? (
          <Section label="Tags">
            {tags.data!.map((t) => (
              <NavItem
                key={t.id}
                icon={<TagIcon className="h-4 w-4" style={{ color: t.color }} />}
                label={t.name}
                active={selection.kind === "tag" && selection.name === t.name}
                onClick={() => setSelection({ kind: "tag", name: t.name })}
              />
            ))}
          </Section>
        ) : null}

        <Section label="Accounts">
          {accounts.data?.map((a) => {
            const isCurrent = selection.kind === "account" && selection.accountId === a.id;
            // Build the per-account view list. Real folder roles (inbox,
            // sent, drafts, spam, trash) get rendered when the account
            // actually has a folder for them and carry that folder's unread
            // count. "starred" is virtual — always shown. "archive" is
            // shown whenever either a real archive folder OR an all-mail
            // folder (Gmail) exists; the Archive view in threadsRepo does
            // the right thing for both.
            const accountFolders = (folders.data ?? []).filter((f) => f.accountId === a.id);
            const has = (role: FolderRole) => accountFolders.some((f) => f.role === role);
            const unreadFor = (role: FolderRole) =>
              accountFolders.filter((f) => f.role === role).reduce((s, f) => s + f.unreadCount, 0);

            const accountViews: { view: MailboxView; unreadCount: number }[] = [];
            for (const v of ACCOUNT_VIEW_ORDER) {
              if (v === "starred") {
                accountViews.push({ view: "starred", unreadCount: 0 });
              } else if (v === "archive") {
                if (has("archive") || has("all")) {
                  accountViews.push({ view: "archive", unreadCount: unreadFor("archive") });
                }
              } else if (has(v)) {
                accountViews.push({ view: v, unreadCount: unreadFor(v) });
              }
            }
            return (
              <div key={a.id} className="space-y-0.5">
                <div
                  className={clsx(
                    "group flex w-full items-center gap-2 rounded-md pl-2 pr-1 py-1.5 text-sm",
                    isCurrent
                      ? "bg-bg-hover text-fg" : "text-fg-muted hover:bg-bg-hover hover:text-fg",
                  )}
                >
                  <button
                    onClick={() => setSelection({ kind: "account", accountId: a.id, view: "inbox" })}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={a.lastError ?? a.email}
                  >
                    <span className="truncate">{a.email}</span>
                    {a.lastError ? (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    ) : null}
                  </button>
                  <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      title="Sync now"
                      className="rounded p-1 hover:bg-bg-subtle"
                      onClick={(e) => { e.stopPropagation(); api.syncAccount(a.id).catch(() => {}); }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Account settings"
                      className="rounded p-1 hover:bg-bg-subtle"
                      onClick={(e) => { e.stopPropagation(); setSettingsAccount(a); }}
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {/* Indented folder list shown only when this account is selected. */}
                {isCurrent ? (
                  <div className="ml-3 border-l border-border pl-2">
                    {accountViews.map(({ view, unreadCount }) => {
                      const meta = VIEW_META[view];
                      const Icon = meta.Icon;
                      const active = selection.kind === "account"
                        && selection.accountId === a.id
                        && selection.view === view;
                      return (
                        <button
                          key={view}
                          onClick={() => setSelection({ kind: "account", accountId: a.id, view })}
                          className={clsx(
                            "flex w-full items-center gap-3 rounded-md px-2 py-1 text-xs transition",
                            active ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-bg-hover hover:text-fg",
                          )}
                        >
                          <Icon className={clsx("h-3.5 w-3.5", active && "text-accent")} />
                          <span className="flex-1 text-left">{meta.label}</span>
                          {unreadCount > 0 ? (
                            <span className={clsx(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                              active ? "bg-accent/30" : "bg-bg-hover",
                            )}>{unreadCount}</span>
                          ) : null}
                        </button>
                      );
                    })}
                    {accountViews.length === 0 ? (
                      <p className="px-2 py-1 text-[11px] text-fg-subtle">no folders synced yet</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <button
            onClick={() => setSetupOpen(true)}
            className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <Plus className="h-4 w-4" />
            <span>Add account</span>
          </button>
        </Section>
      </nav>

      {setupOpen ? <AccountSetup onClose={() => setSetupOpen(false)} /> : null}
      {settingsAccount ? (
        <AccountSettings
          account={settingsAccount}
          onClose={() => setSettingsAccount(null)}
        />
      ) : null}
      {appSettingsOpen ? <AppSettings onClose={() => setAppSettingsOpen(false)} /> : null}
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavItem({
  icon, label, count, active, onClick,
}: {
  icon: React.ReactNode; label: string; count?: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm transition",
        active ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-bg-hover hover:text-fg",
      )}
    >
      <span className={clsx(active && "text-accent")}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {count ? (
        <span className={clsx(
          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
          active ? "bg-accent/30" : "bg-bg-hover",
        )}>{count}</span>
      ) : null}
    </button>
  );
}
