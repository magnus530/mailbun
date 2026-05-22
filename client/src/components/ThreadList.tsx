import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Inbox, MailOpen, Star, Archive, Trash2, X, Check, Minus, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { ThreadDto } from "@mailclient/shared";
import { optimisticallyMarkThreadRead, THREAD_LIST_PAGE_SIZE, useAppStore } from "../lib/store";
import { useThreads } from "../lib/hooks";
import { api } from "../lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseSearch } from "../lib/search-parser";
import { formatRowDate } from "../lib/format";

function useCurrentThreads(limit: number, offset: number) {
  const sel = useAppStore((s) => s.selection);
  if (sel.kind === "folder") {
    return useThreads({ folderRole: sel.role, limit, offset });
  }
  if (sel.kind === "starred") {
    return useThreads({ starred: true, limit, offset });
  }
  if (sel.kind === "account") {
    if (sel.view === "starred") {
      return useThreads({ accountId: sel.accountId, starred: true, limit, offset });
    }
    return useThreads({ accountId: sel.accountId, folderRole: sel.view, limit, offset });
  }
  if (sel.kind === "tag") {
    return useThreads({ tag: sel.name, limit, offset });
  }
  // search — parse Gmail-style operators into structured query
  return useQuery({
    queryKey: ["search", sel.query, limit, offset],
    queryFn: () => api.search({ ...parseSearch(sel.query), limit, offset }),
  });
}

export function ThreadList() {
  const sel = useAppStore((s) => s.selection);
  const selectedThreadId = useAppStore((s) => s.selectedThreadId);
  const selectThread = useAppStore((s) => s.selectThread);
  const page = useAppStore((s) => s.listPage);
  const setPage = useAppStore((s) => s.setListPage);
  const q = useCurrentThreads(THREAD_LIST_PAGE_SIZE, page * THREAD_LIST_PAGE_SIZE);
  const qc = useQueryClient();

  // Reset scroll on page change so Next/Previous lands the user at the top
  // of the new window instead of wherever they last scrolled to.
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [page]);

  // Local selection of thread IDs for bulk operations. Cleared whenever the
  // user navigates to a different list (selection key below) so we don't
  // carry stale picks across mailboxes.
  const selectionKey = JSON.stringify(sel);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  // Clear bulk selection whenever the user navigates to a different list,
  // so we don't carry stale picks across mailboxes.
  useEffect(() => { setChecked(new Set()); }, [selectionKey]);

  const visibleIds = useMemo(() => (q.data ?? []).map((t) => t.id), [q.data]);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checked.has(id));
  const someChecked = checked.size > 0 && !allChecked;

  const toggleAll = () => {
    if (allChecked) setChecked(new Set());
    else setChecked(new Set(visibleIds));
  };
  const toggleOne = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [bulkError, setBulkError] = useState<string | null>(null);
  const bulk = useMutation({
    mutationFn: async (action: "read" | "unread" | "star" | "unstar" | "archive" | "delete") => {
      const ids = [...checked];
      setBulkError(null);

      // Optimistic patch — update every cached threads list right away so
      // the user sees the change without waiting for the server round-trip.
      qc.setQueriesData<ThreadDto[]>({ queryKey: ["threads"] }, (prev) => {
        if (!prev) return prev;
        if (action === "delete" || action === "archive") {
          return prev.filter((t) => !checked.has(t.id));
        }
        return prev.map((t) => {
          if (!checked.has(t.id)) return t;
          if (action === "read")    return { ...t, unreadCount: 0 };
          if (action === "unread")  return { ...t, unreadCount: Math.max(t.unreadCount, 1) };
          if (action === "star")    return { ...t, hasStarred: true };
          if (action === "unstar")  return { ...t, hasStarred: false };
          return t;
        });
      });

      try {
        return await api.bulkAction(ids, action);
      } catch (err: any) {
        // Restore the cache from the server on failure.
        qc.invalidateQueries({ queryKey: ["threads"] });
        throw err;
      }
    },
    onSuccess: () => {
      setChecked(new Set());
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["search"] });
    },
    onError: (err: any) => {
      setBulkError(err?.message ?? "Bulk action failed");
    },
  });

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="flex items-center">
          <Checkbox
            checked={allChecked}
            indeterminate={someChecked}
            onChange={toggleAll}
            ariaLabel={allChecked ? "Deselect all" : "Select all"}
          />
          <ChevronDown className="h-3 w-3 text-fg-subtle" aria-hidden />
        </div>
        {checked.size === 0 ? (
          <>
            <h2 className="text-sm font-semibold capitalize">{titleFor(sel)}</h2>
            <span className="ml-auto text-xs text-fg-subtle">{q.data?.length ?? 0}</span>
          </>
        ) : (
          <BulkToolbar
            count={checked.size}
            disabled={bulk.isPending}
            onAction={(a) => bulk.mutate(a)}
            onClear={() => setChecked(new Set())}
          />
        )}
      </div>
      {bulkError ? (
        <div className="shrink-0 border-b border-rose-500/30 bg-rose-500/10 px-4 py-1.5 text-xs text-rose-300">
          {bulkError}
        </div>
      ) : null}
      {q.isLoading ? (
        <div className="flex flex-1 items-center justify-center text-fg-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : (q.data?.length ?? 0) === 0 && page === 0 ? (
        <EmptyList />
      ) : (
        <ul ref={listRef} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          {q.data!.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              active={selectedThreadId === t.id}
              checked={checked.has(t.id)}
              onCheck={() => toggleOne(t.id)}
              onClick={() => {
                // Apply read-state optimistically the instant the row is
                // clicked. ThreadView's effect still POSTs to the server.
                if (t.unreadCount > 0) optimisticallyMarkThreadRead(qc, t.id);
                selectThread(t.id);
              }}
            />
          ))}
        </ul>
      )}
      <PaginationBar
        page={page}
        pageSize={THREAD_LIST_PAGE_SIZE}
        count={q.data?.length ?? 0}
        loading={q.isLoading}
        onPrev={() => setPage(Math.max(0, page - 1))}
        onNext={() => setPage(page + 1)}
      />
    </div>
  );
}

function PaginationBar({
  page, pageSize, count, loading, onPrev, onNext,
}: {
  page: number;
  pageSize: number;
  count: number;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Disable Next when the current page came back short of the page size:
  // that's a confident "this is the last page" signal. When count === pageSize
  // we allow Next — there *might* be more (we'd need a server-side total to
  // be sure, and the cost of one wasted click is small).
  const start = count === 0 ? 0 : page * pageSize + 1;
  const end = page * pageSize + count;
  const canPrev = page > 0 && !loading;
  const canNext = count >= pageSize && !loading;
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-fg-muted">
      <span>{count === 0 ? "No results" : `${start}–${end}`}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          disabled={!canPrev}
          title="Previous page"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Previous</span>
        </button>
        <button
          onClick={onNext}
          disabled={!canNext}
          title="Next page"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
        >
          <span>Next</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function BulkToolbar({
  count, disabled, onAction, onClear,
}: {
  count: number;
  disabled: boolean;
  onAction: (a: "read" | "star" | "archive" | "delete") => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-1 items-center gap-1">
      <span className="text-sm font-medium">{count} selected</span>
      <div className="ml-auto flex items-center gap-1">
        <ToolbarBtn label="Mark as read" Icon={MailOpen} onClick={() => onAction("read")} disabled={disabled} />
        <ToolbarBtn label="Star" Icon={Star} onClick={() => onAction("star")} disabled={disabled} />
        <ToolbarBtn label="Archive" Icon={Archive} onClick={() => onAction("archive")} disabled={disabled} />
        <ToolbarBtn label="Delete" Icon={Trash2} onClick={() => onAction("delete")} disabled={disabled} />
        <button
          onClick={onClear}
          title="Clear selection"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ToolbarBtn({
  label, Icon, onClick, disabled,
}: {
  label: string; Icon: typeof Star; onClick: () => void; disabled: boolean;
}) {
  return (
    <button
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-50"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function Checkbox({
  checked, indeterminate, onChange, ariaLabel,
}: {
  checked: boolean; indeterminate?: boolean; onChange: () => void; ariaLabel: string;
}) {
  // Custom box: empty bordered square by default, filled with the accent
  // colour and a check glyph when selected; horizontal bar for the
  // indeterminate "some-of-many" select-all state.
  const filled = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={clsx(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition",
        filled
          ? "border-accent bg-accent text-white"
          : "border-border bg-bg-subtle hover:border-fg-muted",
      )}
    >
      {indeterminate ? (
        <Minus className="h-3 w-3" strokeWidth={3} />
      ) : checked ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : null}
    </button>
  );
}

function titleFor(sel: ReturnType<typeof useAppStore.getState>["selection"]): string {
  if (sel.kind === "folder") return sel.role;
  if (sel.kind === "starred") return "starred";
  if (sel.kind === "account") return sel.view;
  if (sel.kind === "tag") return `tag: ${sel.name}`;
  return sel.query ? `search: ${sel.query}` : "all mail";
}

function EmptyList() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-fg-muted">
      <Inbox className="h-10 w-10 text-fg-subtle" />
      <p className="text-sm">Nothing here yet.</p>
      <p className="text-xs text-fg-subtle">If you just added an account, sync may still be running.</p>
    </div>
  );
}

function ThreadRow({
  thread, active, checked, onCheck, onClick,
}: {
  thread: ThreadDto; active: boolean; checked: boolean; onCheck: () => void; onClick: () => void;
}) {
  const fromText = thread.participants
    .slice(0, 3)
    .map((a) => (a.name || a.address || "").split(" ")[0])
    .filter(Boolean)
    .join(", ");
  const ago = formatRowDate(thread.lastDate);
  const unread = thread.unreadCount > 0;

  return (
    <li className="min-w-0">
      <div
        className={clsx(
          "group flex w-full min-w-0 items-center gap-3 border-b border-border/50 px-4 py-2.5 transition",
          active ? "bg-accent/10" : "hover:bg-bg-hover",
          !unread && "opacity-60",
        )}
      >
        <Checkbox checked={checked} onChange={onCheck} ariaLabel={`Select thread: ${thread.subject || "(no subject)"}`} />
        <button
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
        {/* Sender column — fixed width so subject/preview line up between rows. */}
        <div className={clsx(
          "w-44 shrink-0 truncate text-sm",
          unread ? "font-semibold text-fg" : "text-fg-subtle",
        )}>
          {fromText || "(unknown)"}
          {thread.messageCount > 1 ? (
            <span className="ml-1 text-xs text-fg-subtle">{thread.messageCount}</span>
          ) : null}
        </div>
        {/* Subject + preview as inline text so the ellipsis attaches to the
            last visible character. CSS `truncate` only renders `…` when the
            line actually overflows — short messages stay clean. */}
        <div className="min-w-0 flex-1 truncate text-sm">
          <span className={unread ? "font-semibold text-fg" : "text-fg-subtle"}>
            {thread.subject || "(no subject)"}
          </span>
          {thread.preview ? (
            <span className="text-fg-subtle"> — {thread.preview}</span>
          ) : null}
        </div>
        {thread.tags.length > 0 ? (
          <div className="hidden shrink-0 gap-1 md:flex">
            {thread.tags.slice(0, 3).map((t) => (
              <span
                key={t.id}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: `${t.color}22`, color: t.color }}
              >
                {t.name}
              </span>
            ))}
          </div>
        ) : null}
        <span className="w-16 shrink-0 text-right text-xs text-fg-subtle">{ago}</span>
        </button>
      </div>
    </li>
  );
}
