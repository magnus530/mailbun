import { PanelLeftOpen, Search, X } from "lucide-react";
import { useAppStore } from "../lib/store";

export function TopBar() {
  const { searchInput, setSearchInput, setSelection, selection } = useAppStore();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-bg px-4">
      {!sidebarOpen ? (
        <button
          onClick={toggleSidebar}
          title="Show sidebar"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      ) : null}
      <div className="flex flex-1 items-center gap-2 rounded-xl bg-bg-subtle px-3 py-1.5 ring-1 ring-transparent focus-within:ring-accent">
        <Search className="h-4 w-4 text-fg-muted" />
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setSelection({ kind: "search", query: searchInput });
            }
            if (e.key === "Escape") setSearchInput("");
          }}
          placeholder="Search mail (press / to focus)"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
          id="search-input"
        />
        {searchInput ? (
          <button onClick={() => { setSearchInput(""); }} className="text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {selection.kind === "search" && selection.query ? (
        <span className="rounded-full bg-bg-hover px-3 py-1 text-xs text-fg-muted">
          Searching: <span className="text-fg">{selection.query}</span>
        </span>
      ) : null}
    </div>
  );
}
