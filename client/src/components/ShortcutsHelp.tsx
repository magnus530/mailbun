import { X } from "lucide-react";
import { SHORTCUTS } from "../lib/shortcuts";

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const groups = new Map<string, typeof SHORTCUTS>();
  for (const s of SHORTCUTS) {
    const arr = groups.get(s.group) ?? [];
    arr.push(s);
    groups.set(s.group, arr);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl border border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-bg-hover">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 p-5">
          {[...groups.entries()].map(([group, items]) => (
            <div key={group}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">{group}</h3>
              <ul className="space-y-1.5">
                {items.map((s) => (
                  <li key={s.keys} className="flex items-center justify-between text-sm">
                    <span className="text-fg-muted">{s.description}</span>
                    <kbd className="rounded border border-border bg-bg-subtle px-2 py-0.5 text-xs font-mono">
                      {s.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
