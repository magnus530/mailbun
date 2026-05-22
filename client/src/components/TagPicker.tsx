import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Tag as TagIcon, Plus, Check } from "lucide-react";
import clsx from "clsx";
import type { TagDto } from "@mailclient/shared";
import { useTags } from "../lib/hooks";
import { api } from "../lib/api";

interface Props {
  threadId: number;
  currentTags: TagDto[];
}

const PALETTE = ["#ef4444", "#f59e0b", "#10b981", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#94a3b8"];

export function TagPicker({ threadId, currentTags }: Props) {
  const tags = useTags();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);

  const attached = new Set(currentTags.map((t) => t.id));

  const toggle = useMutation({
    mutationFn: async ({ tag, on }: { tag: TagDto; on: boolean }) => {
      if (on) await api.attachTag(threadId, tag.id);
      else await api.detachTag(threadId, tag.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["thread", threadId] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const t = await api.createTag(newName.trim(), newColor);
      await api.attachTag(threadId, t.id);
      return t;
    },
    onSuccess: () => {
      setNewName("");
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["thread", threadId] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg p-2 text-fg-muted hover:bg-bg-hover hover:text-fg"
        title="Tag thread"
      >
        <TagIcon className="h-4 w-4" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-border bg-bg p-2 shadow-2xl">
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {tags.data?.map((t) => {
                const on = attached.has(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggle.mutate({ tag: t, on: !on })}
                    className={clsx(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg-hover",
                      on && "bg-bg-hover",
                    )}
                  >
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="flex-1 text-left">{t.name}</span>
                    {on ? <Check className="h-3.5 w-3.5 text-accent" /> : null}
                  </button>
                );
              })}
              {(tags.data?.length ?? 0) === 0 ? (
                <p className="px-2 py-1.5 text-xs text-fg-subtle">No tags yet.</p>
              ) : null}
            </div>
            <div className="mt-2 border-t border-border pt-2">
              <div className="flex gap-1">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) create.mutate(); }}
                  placeholder="New tag name"
                  className="input flex-1 py-1.5 text-xs"
                />
                <button
                  onClick={() => newName.trim() && create.mutate()}
                  disabled={!newName.trim() || create.isPending}
                  className="rounded p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className={clsx(
                      "h-4 w-4 rounded-full border-2",
                      newColor === c ? "border-fg" : "border-transparent",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
