import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { ThreadDto } from "@mailclient/shared";
import { useAppStore } from "./store";
import { api } from "./api";
import { parseSearch } from "./search-parser";

// Gmail-style shortcuts. Single keys; supports two-key chords (g + letter).
// We avoid binding while typing in inputs/textareas/contenteditable.

interface Shortcut {
  keys: string;
  description: string;
  group: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: "j / k", description: "Newer / older thread", group: "Navigation" },
  { keys: "↵ / o", description: "Open thread", group: "Navigation" },
  { keys: "Esc", description: "Back to list", group: "Navigation" },
  { keys: "/", description: "Focus search", group: "Navigation" },
  { keys: "g i", description: "Go to Inbox", group: "Jump" },
  { keys: "g s", description: "Go to Sent", group: "Jump" },
  { keys: "g d", description: "Go to Drafts", group: "Jump" },
  { keys: "g t", description: "Go to Trash", group: "Jump" },
  { keys: "g a", description: "Go to All mail", group: "Jump" },
  { keys: "c", description: "Compose new message", group: "Action" },
  { keys: "r", description: "Reply", group: "Action" },
  { keys: "s", description: "Star / unstar", group: "Action" },
  { keys: "u", description: "Mark unread", group: "Action" },
  { keys: "#", description: "Delete thread", group: "Action" },
  { keys: "?", description: "Show this help", group: "Help" },
];

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

interface Deps {
  qc: QueryClient;
  threads: ThreadDto[];
  showHelp: () => void;
}

export function useKeyboardShortcuts({ qc, threads, showHelp }: Deps) {
  const [chord, setChord] = useState<string | null>(null);

  useEffect(() => {
    if (!chord) return;
    const t = setTimeout(() => setChord(null), 1500);
    return () => clearTimeout(t);
  }, [chord]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore modifier-key combos and typing contexts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (isTyping(target)) {
        // Allow Esc to blur inputs.
        if (e.key === "Escape" && target instanceof HTMLElement) target.blur();
        return;
      }

      const state = useAppStore.getState();

      // Two-key chord: g + ?
      if (chord === "g") {
        const map: Record<string, () => void> = {
          i: () => state.setSelection({ kind: "folder", role: "inbox" }),
          s: () => state.setSelection({ kind: "folder", role: "sent" }),
          d: () => state.setSelection({ kind: "folder", role: "drafts" }),
          t: () => state.setSelection({ kind: "folder", role: "trash" }),
          a: () => state.setSelection({ kind: "search", query: "" }),
        };
        const fn = map[e.key.toLowerCase()];
        if (fn) {
          e.preventDefault();
          fn();
        }
        setChord(null);
        return;
      }

      switch (e.key) {
        case "g":
          setChord("g");
          e.preventDefault();
          return;
        case "/": {
          const inp = document.getElementById("search-input") as HTMLInputElement | null;
          if (inp) {
            e.preventDefault();
            inp.focus();
            inp.select();
          }
          return;
        }
        case "Escape":
          if (state.composing.open) state.closeCompose();
          else if (state.selectedThreadId != null) state.selectThread(null);
          return;
        case "c":
          e.preventDefault();
          state.openCompose();
          return;
        case "?":
          e.preventDefault();
          showHelp();
          return;
        case "j":
        case "k": {
          if (threads.length === 0) return;
          const cur = threads.findIndex((t) => t.id === state.selectedThreadId);
          let next = cur;
          if (e.key === "j") next = cur < 0 ? 0 : Math.min(cur + 1, threads.length - 1);
          else next = cur < 0 ? 0 : Math.max(cur - 1, 0);
          state.selectThread(threads[next].id);
          e.preventDefault();
          return;
        }
        case "Enter":
        case "o":
          if (state.selectedThreadId == null && threads.length > 0) {
            state.selectThread(threads[0].id);
          }
          return;
      }

      // Actions on current thread.
      if (state.selectedThreadId == null) return;
      const id = state.selectedThreadId;

      if (e.key === "r") {
        // Pre-fill compose with last message.
        const data = qc.getQueryData<{ messages: { id: number }[] }>(["thread", id]);
        const last = data?.messages[data.messages.length - 1]?.id ?? null;
        state.openCompose(last);
        e.preventDefault();
        return;
      }

      if (e.key === "s") {
        const data = qc.getQueryData<{ thread: ThreadDto; messages: { id: number }[] }>(["thread", id]);
        if (!data) return;
        const ids = data.messages.map((m) => m.id);
        api.setStarred(ids, !data.thread.hasStarred).then(() => {
          qc.invalidateQueries({ queryKey: ["thread", id] });
          qc.invalidateQueries({ queryKey: ["threads"] });
        });
        e.preventDefault();
        return;
      }

      if (e.key === "u") {
        const data = qc.getQueryData<{ messages: { id: number }[] }>(["thread", id]);
        if (!data) return;
        const ids = data.messages.map((m) => m.id);
        api.setRead(ids, false).then(() => {
          qc.invalidateQueries({ queryKey: ["thread", id] });
          qc.invalidateQueries({ queryKey: ["threads"] });
          qc.invalidateQueries({ queryKey: ["folders"] });
        });
        e.preventDefault();
        return;
      }

      if (e.key === "#") {
        const data = qc.getQueryData<{ messages: { id: number }[] }>(["thread", id]);
        if (!data) return;
        const ids = data.messages.map((m) => m.id);
        api.deleteMessages(ids).then(() => {
          state.selectThread(null);
          qc.invalidateQueries({ queryKey: ["threads"] });
          qc.invalidateQueries({ queryKey: ["folders"] });
        });
        e.preventDefault();
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chord, qc, threads, showHelp]);

  // Also expose what current selection's parsed search reveals (useful elsewhere).
  void parseSearch;
}
