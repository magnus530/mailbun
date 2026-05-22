import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Trash2, RefreshCw, AlertTriangle, Save, KeyRound } from "lucide-react";
import clsx from "clsx";
import type { AccountDto, UpdateAccountInput } from "@mailclient/shared";
import { api, ApiError } from "../lib/api";
import { useAppStore } from "../lib/store";

interface Props {
  account: AccountDto;
  onClose: () => void;
}

export function AccountSettings({ account, onClose }: Props) {
  const qc = useQueryClient();

  const [displayName, setDisplayName] = useState(account.displayName ?? "");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState(account.imapHost);
  const [imapPort, setImapPort] = useState(account.imapPort);
  const [imapSecure, setImapSecure] = useState(account.imapSecure);
  const [smtpHost, setSmtpHost] = useState(account.smtpHost);
  const [smtpPort, setSmtpPort] = useState(account.smtpPort);
  const [smtpSecure, setSmtpSecure] = useState(account.smtpSecure);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const patch: UpdateAccountInput = {
        displayName: displayName.trim() || null,
        imapHost,
        imapPort,
        imapSecure,
        smtpHost,
        smtpPort,
        smtpSecure,
      };
      if (password.length > 0) patch.password = password;
      return api.updateAccount(account.id, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      onClose();
    },
  });

  const sync = useMutation({
    mutationFn: () => api.syncAccount(account.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(account.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      // If the user was viewing this account, drop the selection.
      const sel = useAppStore.getState().selection;
      if (sel.kind === "account" && sel.accountId === account.id) {
        useAppStore.getState().setSelection({ kind: "folder", role: "inbox" });
      }
      onClose();
    },
  });

  const error =
    save.error instanceof ApiError ? save.error.message
    : remove.error instanceof ApiError ? remove.error.message
    : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-bg shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Account settings</h2>
            <p className="text-xs text-fg-muted">{account.email}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-bg-hover">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          {account.lastError ? (
            <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Last sync error</p>
                <p className="opacity-80">{account.lastError}</p>
              </div>
            </div>
          ) : null}

          <Section title="Identity">
            <Field label="Display name">
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your Name" />
            </Field>
          </Section>

          <Section title="Credentials">
            <Field label="App password">
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank to keep existing"
              />
              <p className="text-xs text-fg-subtle">
                <KeyRound className="mr-1 inline h-3 w-3" />
                Stored encrypted with your master password.
              </p>
            </Field>
          </Section>

          <Section title="IMAP (incoming)">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Host" wide>
                <input className="input" value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
              </Field>
              <Field label="Port">
                <input className="input" type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} />
              </Field>
              <Field label="TLS">
                <select
                  className="input"
                  value={imapSecure ? "tls" : "starttls"}
                  onChange={(e) => setImapSecure(e.target.value === "tls")}
                >
                  <option value="tls">SSL/TLS</option>
                  <option value="starttls">STARTTLS</option>
                </select>
              </Field>
            </div>
          </Section>

          <Section title="SMTP (outgoing)">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Host" wide>
                <input className="input" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
              </Field>
              <Field label="Port">
                <input className="input" type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
              </Field>
              <Field label="TLS">
                <select
                  className="input"
                  value={smtpSecure ? "tls" : "starttls"}
                  onChange={(e) => setSmtpSecure(e.target.value === "tls")}
                >
                  <option value="tls">SSL/TLS</option>
                  <option value="starttls">STARTTLS</option>
                </select>
              </Field>
            </div>
          </Section>

          <Section title="Danger zone" tone="danger">
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/20"
              >
                <Trash2 className="h-4 w-4" />
                Delete this account
              </button>
            ) : (
              <div className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
                <p className="text-sm text-rose-200">
                  This removes the account, all locally cached messages, attachments, and folder state.
                  Your messages on the mail server are not deleted.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    {remove.isPending ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="btn-ghost">Cancel</button>
                </div>
              </div>
            )}
          </Section>

          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-bg-subtle px-5 py-3">
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="btn-ghost"
          >
            <RefreshCw className={clsx("h-4 w-4", sync.isPending && "animate-spin")} />
            {sync.isPending ? "Syncing…" : "Sync now"}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title, children, tone = "default",
}: { title: string; children: React.ReactNode; tone?: "default" | "danger" }) {
  return (
    <section className="space-y-2">
      <h3 className={clsx(
        "text-xs font-semibold uppercase tracking-wider",
        tone === "danger" ? "text-rose-300" : "text-fg-subtle",
      )}>{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={clsx("block space-y-1", wide && "col-span-1")}>
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
