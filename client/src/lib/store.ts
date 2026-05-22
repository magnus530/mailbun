import { create } from "zustand";
import type { FolderRole } from "@mailclient/shared";

// Views that can be picked at the top level or scoped to one account.
// "starred" is virtual (filter on m.starred=1). The rest map to folder roles.
// Archive is also virtual under the hood — see threadsRepo.list — but from
// the UI's perspective it's still the "archive" role.
export type MailboxView = FolderRole | "starred";

export type Selection =
  | { kind: "folder"; role: FolderRole }
  | { kind: "starred" }
  | { kind: "tag"; name: string }
  | { kind: "account"; accountId: number; view: MailboxView }
  | { kind: "search"; query: string };

export type Theme = "dark" | "light";

// Page size for the thread list. Shared between ThreadList (renders the page
// and the prev/next buttons) and Layout (queries the same window so j/k
// keyboard nav matches what the user sees).
export const THREAD_LIST_PAGE_SIZE = 50;

// UI zoom bounds. In the Electron desktop shell this drives native Chromium
// zoom (webFrame.setZoomFactor); in a plain browser it drives the --zoom CSS
// variable (see index.css). The range is wide because Electron's 100% can
// render denser than a browser's, so matching the web look needs headroom.
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3.0;
export const ZOOM_STEP = 0.1;

interface AppState {
  selection: Selection;
  selectedThreadId: number | null;
  composing: { open: boolean; replyTo?: number | null };
  searchInput: string;
  theme: Theme;
  listPage: number;
  sidebarOpen: boolean;
  zoom: number;
  setSelection: (s: Selection) => void;
  selectThread: (id: number | null) => void;
  setSearchInput: (q: string) => void;
  openCompose: (replyTo?: number | null) => void;
  closeCompose: () => void;
  setTheme: (t: Theme) => void;
  setListPage: (p: number) => void;
  toggleSidebar: () => void;
  setZoom: (z: number) => void;
}

// localStorage key shared with the pre-render bootstrap in main.tsx so the
// initial paint matches whatever the user picked last session — no flash.
const THEME_KEY = "mailclient.theme";
const SIDEBAR_KEY = "mailclient.sidebarOpen";
const ZOOM_KEY = "mailbun.zoom";

function readSavedTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const v = window.localStorage.getItem(THEME_KEY);
  return v === "light" ? "light" : "dark";
}

function readSavedSidebarOpen(): boolean {
  if (typeof window === "undefined") return true;
  // Default to open. The key only exists once the user has interacted with
  // the collapse button.
  return window.localStorage.getItem(SIDEBAR_KEY) !== "false";
}

function applyThemeClass(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("theme-light", t === "light");
}

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  // Round to 2 dp so repeated +/- steps don't drift on float math.
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
}

function readSavedZoom(): number {
  if (typeof window === "undefined") return 1;
  return clampZoom(Number(window.localStorage.getItem(ZOOM_KEY)));
}

function applyZoom(z: number) {
  if (typeof window === "undefined") return;
  // Desktop shell: real Chromium zoom, so it doesn't fight Electron's own
  // built-in zoom. Browser: the --zoom CSS variable (#root compensates its
  // own size — see index.css).
  if (window.mailbun?.isElectron) {
    window.mailbun.setZoom(z);
  } else {
    document.documentElement.style.setProperty("--zoom", String(z));
  }
}

// Marks a thread as read in every cached threads list. Called the moment a
// row is clicked so the row goes from bold to dim instantly, before any
// network round-trip. The actual server mutation runs afterwards from
// ThreadView's effect; if it fails, the next sync reconciles.
export function optimisticallyMarkThreadRead(
  qc: { setQueriesData: (filter: any, updater: any) => void },
  threadId: number,
) {
  qc.setQueriesData({ queryKey: ["threads"] }, (prev: any) => {
    if (!Array.isArray(prev)) return prev;
    return prev.map((t: any) => (t.id === threadId ? { ...t, unreadCount: 0 } : t));
  });
}

export const useAppStore = create<AppState>((set) => ({
  selection: { kind: "folder", role: "inbox" },
  selectedThreadId: null,
  composing: { open: false, replyTo: null },
  searchInput: "",
  theme: readSavedTheme(),
  listPage: 0,
  sidebarOpen: readSavedSidebarOpen(),
  zoom: readSavedZoom(),
  setSelection: (selection) => set({ selection, selectedThreadId: null, listPage: 0 }),
  selectThread: (id) => set({ selectedThreadId: id }),
  setSearchInput: (q) => set({ searchInput: q }),
  openCompose: (replyTo = null) => set({ composing: { open: true, replyTo } }),
  closeCompose: () => set({ composing: { open: false, replyTo: null } }),
  setTheme: (theme) => {
    if (typeof window !== "undefined") window.localStorage.setItem(THEME_KEY, theme);
    applyThemeClass(theme);
    set({ theme });
  },
  setListPage: (listPage) => set({ listPage }),
  toggleSidebar: () =>
    set((s) => {
      const sidebarOpen = !s.sidebarOpen;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen));
      }
      return { sidebarOpen };
    }),
  setZoom: (z) => {
    const zoom = clampZoom(z);
    if (typeof window !== "undefined") window.localStorage.setItem(ZOOM_KEY, String(zoom));
    applyZoom(zoom);
    set({ zoom });
  },
}));
