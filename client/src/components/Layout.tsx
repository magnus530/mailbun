import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerEvents } from "../lib/hooks";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ThreadList } from "./ThreadList";
import { ThreadView } from "./ThreadView";
import { Compose } from "./Compose";
import { OfflineBanner } from "./OfflineBanner";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { useKeyboardShortcuts } from "../lib/shortcuts";
import { THREAD_LIST_PAGE_SIZE, useAppStore } from "../lib/store";
import { api } from "../lib/api";
import { parseSearch } from "../lib/search-parser";
import { useQuery } from "@tanstack/react-query";
import { useThreads } from "../lib/hooks";

export function Layout() {
  useServerEvents();
  const qc = useQueryClient();
  const [helpOpen, setHelpOpen] = useState(false);

  // Mirror the same query the ThreadList runs so shortcuts can navigate the
  // visible list without prop-drilling. Same limit/offset so j/k cycles
  // within the page the user is actually looking at.
  const sel = useAppStore((s) => s.selection);
  const inboxTab = useAppStore((s) => s.inboxTab);
  const page = useAppStore((s) => s.listPage);
  const limit = THREAD_LIST_PAGE_SIZE;
  const offset = page * THREAD_LIST_PAGE_SIZE;
  const folderQ = useThreads(
    sel.kind === "folder"
      ? { folderRole: sel.role, category: sel.role === "inbox" ? inboxTab : undefined, limit, offset }
      : sel.kind === "starred"
      ? { starred: true, limit, offset }
      : sel.kind === "account"
      ? sel.view === "starred"
        ? { accountId: sel.accountId, starred: true, limit, offset }
        : { accountId: sel.accountId, folderRole: sel.view, category: sel.view === "inbox" ? inboxTab : undefined, limit, offset }
      : sel.kind === "tag"
      ? { tag: sel.name, limit, offset }
      : { folderRole: "inbox", category: inboxTab, limit, offset },
  );
  const searchQ = useQuery({
    queryKey: ["search", sel.kind === "search" ? sel.query : null, limit, offset],
    queryFn: () => api.search({ ...parseSearch(sel.kind === "search" ? sel.query : ""), limit, offset }),
    enabled: sel.kind === "search",
  });
  const threads = (sel.kind === "search" ? searchQ.data : folderQ.data) ?? [];

  useKeyboardShortcuts({ qc, threads, showHelp: () => setHelpOpen(true) });

  // Gmail-style: when a thread is selected, the right pane shows it full-width.
  // Otherwise the right pane shows the thread list. Esc / back button clears
  // the selection and returns to the list.
  const selectedThreadId = useAppStore((s) => s.selectedThreadId);
  // Mount/unmount the sidebar from the parent so the toggle in either the
  // Sidebar header or the TopBar takes effect immediately. Doing this in
  // the parent (which subscribes to sidebarOpen via a selector) means
  // there's no chance of a stale subscription on the child side.
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);

  return (
    <div className="flex h-full">
      {sidebarOpen ? <Sidebar /> : null}
      {/* min-w-0 stops flex children with long content from pushing the
          column wider than the viewport. */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <TopBar />
        <div className="flex min-h-0 min-w-0 flex-1">
          {selectedThreadId == null ? <ThreadList /> : <ThreadView />}
        </div>
      </div>
      <Compose />
      {helpOpen ? <ShortcutsHelp onClose={() => setHelpOpen(false)} /> : null}
    </div>
  );
}
