import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, X, Minimize2, Maximize2, Loader2, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { AddressDto, ComposeInput } from "@mailclient/shared";
import { api, ApiError } from "../lib/api";
import { useAccounts } from "../lib/hooks";
import { useAppStore } from "../lib/store";

export function Compose() {
  const composing = useAppStore((s) => s.composing);
  const close = useAppStore((s) => s.closeCompose);
  if (!composing.open) return null;
  return <ComposeInner replyTo={composing.replyTo ?? null} onClose={close} />;
}

interface InnerProps {
  replyTo: number | null;
  onClose: () => void;
}

function ComposeInner({ replyTo, onClose }: InnerProps) {
  const accounts = useAccounts();
  const qc = useQueryClient();
  const reply = useQuery({
    queryKey: ["message", replyTo],
    queryFn: () => api.message(replyTo!),
    enabled: replyTo != null,
  });

  const [accountId, setAccountId] = useState<number | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [minimized, setMinimized] = useState(false);

  // Default account = first one.
  useEffect(() => {
    if (accountId == null && accounts.data && accounts.data.length > 0) {
      setAccountId(accounts.data[0].id);
    }
  }, [accounts.data, accountId]);

  // When the reply target loads, prefill.
  useEffect(() => {
    if (!reply.data) return;
    const m = reply.data;
    setAccountId(m.accountId);
    const fromAddrs = m.from.map((a) => a.address);
    const allRecipients = [...m.to, ...m.cc].filter((a) => !fromAddrs.includes(a.address));
    setTo(addressListToString(m.from));
    setCc(addressListToString(allRecipients));
    if (allRecipients.length > 0) setShowCcBcc(true);
    setSubject(prefixReSubject(m.subject));
    setBody(buildQuote(m));
  }, [reply.data]);

  const send = useMutation({
    mutationFn: async () => {
      if (accountId == null) throw new Error("pick an account");
      const input: ComposeInput = {
        accountId,
        to: parseAddressList(to),
        cc: showCcBcc ? parseAddressList(cc) : undefined,
        bcc: showCcBcc ? parseAddressList(bcc) : undefined,
        subject,
        bodyText: body,
        inReplyTo: reply.data?.messageId ?? null,
        references: reply.data
          ? [...(reply.data.messageId ? [reply.data.messageId] : [])]
          : undefined,
      };
      return api.send(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["threads"] });
      onClose();
    },
  });
  const error = send.error instanceof ApiError ? send.error.message : (send.error?.message ?? null);

  const canSend = useMemo(() => {
    return accountId != null && parseAddressList(to).length > 0 && subject.trim().length > 0;
  }, [accountId, to, subject]);

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-4 right-4 z-30 rounded-xl border border-border bg-bg px-4 py-2 text-sm font-medium shadow-2xl hover:bg-bg-hover"
      >
        {subject || "New message"} — click to expand
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-30 flex h-[70vh] max-h-[640px] w-[640px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-border bg-bg shadow-2xl">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2 text-sm">
        <span className="font-medium">{reply.data ? "Reply" : "New message"}</span>
        <div className="flex gap-1">
          <button onClick={() => setMinimized(true)} className="rounded p-1 text-fg-muted hover:bg-bg-hover" title="Minimize">
            <Minimize2 className="h-4 w-4" />
          </button>
          <button onClick={() => setMinimized(false)} className="rounded p-1 text-fg-muted hover:bg-bg-hover" title="Expand">
            <Maximize2 className="h-4 w-4" />
          </button>
          <button onClick={() => { if (window.confirm("Discard draft?")) onClose(); }} className="rounded p-1 text-fg-muted hover:bg-bg-hover" title="Discard">
            <Trash2 className="h-4 w-4" />
          </button>
          <button onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-bg-hover" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <Row label="From">
          <select
            className="input"
            value={accountId ?? ""}
            onChange={(e) => setAccountId(Number(e.target.value))}
          >
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName ? `${a.displayName} <${a.email}>` : a.email}
              </option>
            ))}
          </select>
        </Row>
        <Row label="To">
          <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com" autoFocus />
          {!showCcBcc ? (
            <button
              type="button"
              onClick={() => setShowCcBcc(true)}
              className="text-xs text-fg-muted hover:text-fg"
            >
              add Cc / Bcc
            </button>
          ) : null}
        </Row>
        {showCcBcc ? (
          <>
            <Row label="Cc">
              <input className="input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@example.com" />
            </Row>
            <Row label="Bcc">
              <input className="input" value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="bcc@example.com" />
            </Row>
          </>
        ) : null}
        <Row label="Subject">
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
        </Row>
        <div className="px-4 pb-4 pt-2">
          <textarea
            className="h-full min-h-[12rem] w-full resize-none rounded-lg border border-border bg-bg-subtle p-3 text-sm leading-relaxed text-fg placeholder:text-fg-subtle focus:border-accent focus:ring-1 focus:ring-accent"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message…"
          />
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
        <button
          disabled={!canSend || send.isPending}
          onClick={() => send.mutate()}
          className={clsx(
            "inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow hover:bg-accent-hover",
            (!canSend || send.isPending) && "cursor-not-allowed opacity-50",
          )}
        >
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {send.isPending ? "Sending…" : "Send"}
        </button>
        {error ? <span className="text-xs text-rose-400">{error}</span> : null}
      </footer>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/40 px-4 py-2">
      <span className="w-16 shrink-0 text-xs font-medium text-fg-muted">{label}</span>
      <div className="flex-1 space-y-1">{children}</div>
    </div>
  );
}

function parseAddressList(raw: string): AddressDto[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // Support "Name <addr@x>" and bare addresses.
      const m = s.match(/^(.*?)\s*<\s*([^>]+)\s*>$/);
      if (m) return { name: m[1].trim() || null, address: m[2].trim() };
      return { name: null, address: s };
    });
}

function addressListToString(list: AddressDto[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
}

function prefixReSubject(s: string): string {
  return /^re:\s*/i.test(s) ? s : `Re: ${s}`;
}

function buildQuote(m: { from: AddressDto[]; date: string; bodyText: string | null; bodyHtml: string | null }): string {
  const senderName = m.from[0]?.name || m.from[0]?.address || "";
  const date = new Date(m.date).toLocaleString();
  const text = m.bodyText ?? stripHtml(m.bodyHtml ?? "");
  const quoted = text.split("\n").map((l) => `> ${l}`).join("\n");
  return `\n\nOn ${date}, ${senderName} wrote:\n${quoted}`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
