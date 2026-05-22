import { Mails, Trash2, Star, MailOpen, Reply, ReplyAll, Forward, RefreshCw, ArrowLeft } from "lucide-react";
import { TagPicker } from "./TagPicker";
import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import type { MessageBodyDto } from "@mailclient/shared";
import { useAppStore } from "../lib/store";
import { useThread } from "../lib/hooks";
import { api } from "../lib/api";
import { MessageBubble } from "./MessageBody";

export function ThreadView() {
  const id = useAppStore((s) => s.selectedThreadId);
  const openCompose = useAppStore((s) => s.openCompose);
  const q = useThread(id);
  const qc = useQueryClient();

  // Auto mark-as-read on open. The list row was already flipped optimistically
  // on click; this hits the server and writes through to caches when the
  // response lands.
  useEffect(() => {
    if (!q.data) return;
    const unreadIds = q.data.messages.filter((m) => m.unread).map((m) => m.id);
    if (unreadIds.length === 0) return;

    // Optimistic local cache writes — the message bubbles update immediately.
    qc.setQueryData(["thread", id], (prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        thread: { ...prev.thread, unreadCount: 0 },
        messages: prev.messages.map((m: any) => ({ ...m, unread: false })),
      };
    });

    api.setRead(unreadIds, true)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["thread", id] });
        qc.invalidateQueries({ queryKey: ["threads"] });
        qc.invalidateQueries({ queryKey: ["folders"] });
      })
      .catch((err) => {
        // On failure, refetch so the cache returns to the truth.
        qc.invalidateQueries({ queryKey: ["thread", id] });
        qc.invalidateQueries({ queryKey: ["threads"] });
        console.warn("mark-as-read failed:", err);
      });
  }, [q.data?.thread.id]);

  const star = useMutation({
    mutationFn: (starred: boolean) => api.setStarred(q.data!.messages.map((m) => m.id), starred),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["thread", id] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
  const setUnread = useMutation({
    mutationFn: () => api.setRead(q.data!.messages.map((m) => m.id), false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["thread", id] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
  });
  const del = useMutation({
    mutationFn: () => api.deleteMessages(q.data!.messages.map((m) => m.id)),
    onSuccess: () => {
      useAppStore.getState().selectThread(null);
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
  });

  if (!id) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-bg-subtle text-fg-muted">
        <div className="flex flex-col items-center gap-3">
          <Mails className="h-10 w-10 text-fg-subtle" />
          <p className="text-sm">Select a conversation</p>
        </div>
      </div>
    );
  }
  if (q.isLoading) return <div className="flex h-full flex-1 items-center justify-center bg-bg-subtle text-fg-muted">loading…</div>;
  if (!q.data) return null;

  const lastMessage = q.data.messages[q.data.messages.length - 1] as MessageBodyDto | undefined;

  return (
    // min-h-0 + min-w-0 are critical — without them the flex column expands to
    // fit content instead of constraining children with overflow-y-auto.
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-bg-subtle">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-bg px-4 py-3">
        <button
          onClick={() => useAppStore.getState().selectThread(null)}
          title="Back to list (Esc)"
          className="rounded-lg p-2 text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{q.data.thread.subject || "(no subject)"}</h1>
          <p className="text-xs text-fg-muted">
            {q.data.thread.messageCount} message{q.data.thread.messageCount === 1 ? "" : "s"}
            {q.data.thread.tags.length > 0 ? (
              <>
                {" • "}
                {q.data.thread.tags.map((t) => (
                  <span
                    key={t.id}
                    className="ml-1 rounded-full px-2 py-0.5 text-[10px]"
                    style={{ backgroundColor: `${t.color}22`, color: t.color }}
                  >
                    {t.name}
                  </span>
                ))}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <ToolbarButton
            label={q.data.thread.hasStarred ? "Unstar" : "Star"}
            icon={<Star className={clsx("h-4 w-4", q.data.thread.hasStarred && "fill-yellow-400 text-yellow-400")} />}
            onClick={() => star.mutate(!q.data!.thread.hasStarred)}
          />
          <TagPicker threadId={id} currentTags={q.data.thread.tags} />
          <ToolbarButton label="Mark unread" icon={<MailOpen className="h-4 w-4" />} onClick={() => setUnread.mutate()} />
          <ToolbarButton label="Delete" icon={<Trash2 className="h-4 w-4" />} onClick={() => del.mutate()} />
          <ToolbarButton label="Refresh" icon={<RefreshCw className="h-4 w-4" />} onClick={() => qc.invalidateQueries({ queryKey: ["thread", id] })} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-4">
        <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-3">
          {q.data.messages.map((m, i) => (
            <MessageBubble key={m.id} message={m} defaultOpen={i === q.data.messages.length - 1} />
          ))}
        </div>
      </div>

      {lastMessage ? (
        <div className="shrink-0 border-t border-border bg-bg px-6 py-3">
          <div className="mx-auto flex max-w-3xl gap-2">
            <button className="btn-ghost flex-1 justify-center" onClick={() => openCompose(lastMessage.id)}>
              <Reply className="h-4 w-4" /> Reply
            </button>
            <button className="btn-ghost flex-1 justify-center" onClick={() => openCompose(lastMessage.id)}>
              <ReplyAll className="h-4 w-4" /> Reply all
            </button>
            <button className="btn-ghost flex-1 justify-center" onClick={() => openCompose(lastMessage.id)}>
              <Forward className="h-4 w-4" /> Forward
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToolbarButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      title={label}
      onClick={onClick}
      className="rounded-lg p-2 text-fg-muted hover:bg-bg-hover hover:text-fg"
    >
      {icon}
    </button>
  );
}
