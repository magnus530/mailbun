import { Minus, Moon, Plus, Sun, X } from "lucide-react";
import clsx from "clsx";
import { useAppStore, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, type Theme } from "../lib/store";

export function AppSettings({ onClose }: { onClose: () => void }) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-bg-hover">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              Appearance
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <ThemeOption
                  label="Dark"
                  Icon={Moon}
                  active={theme === "dark"}
                  onClick={() => setTheme("dark")}
                />
                <ThemeOption
                  label="Light"
                  Icon={Sun}
                  active={theme === "light"}
                  onClick={() => setTheme("light")}
                />
              </div>
              <ZoomControl />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ZoomControl() {
  const zoom = useAppStore((s) => s.zoom);
  const setZoom = useAppStore((s) => s.setZoom);
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-bg-subtle px-3 py-2">
      <span className="text-sm text-fg-muted">Zoom</span>
      <div className="flex items-center gap-1">
        <ZoomButton
          Icon={Minus}
          label="Decrease zoom"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => setZoom(zoom - ZOOM_STEP)}
        />
        <button
          type="button"
          onClick={() => setZoom(1)}
          title="Reset to 100%"
          className="w-12 rounded text-center text-sm tabular-nums text-fg hover:bg-bg-hover"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ZoomButton
          Icon={Plus}
          label="Increase zoom"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => setZoom(zoom + ZOOM_STEP)}
        />
      </div>
    </div>
  );
}

function ZoomButton({
  Icon, label, disabled, onClick,
}: {
  Icon: typeof Plus;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-md border border-border bg-bg p-1 text-fg-muted hover:border-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-fg-muted"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ThemeOption({
  label, Icon, active, onClick,
}: {
  label: string;
  Icon: typeof Moon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
        active
          ? "border-accent bg-accent/10 text-fg"
          : "border-border bg-bg-subtle text-fg-muted hover:border-fg-muted hover:text-fg",
      )}
    >
      <Icon className={clsx("h-4 w-4", active && "text-accent")} />
      <span>{label}</span>
    </button>
  );
}
