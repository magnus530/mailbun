import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Loader2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useVaultState } from "../lib/hooks";

export function VaultGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useVaultState();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (!data) {
    return <div className="flex h-full items-center justify-center text-fg-muted">cannot reach server</div>;
  }
  if (!data.configured) return <SetupForm />;
  if (!data.unlocked) return <UnlockForm />;
  return <>{children}</>;
}

function SetupForm() {
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const setup = useMutation({
    mutationFn: (password: string) => api.vaultSetup(password),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vault", "state"] }),
  });
  const error = setup.error instanceof ApiError ? setup.error.message : null;
  const mismatched = pw && pw2 && pw !== pw2;
  const tooShort = pw && pw.length < 8;
  return (
    <CenterCard
      title="Welcome to mailbun"
      subtitle="Choose a master password. It encrypts every IMAP/SMTP password you save and never leaves your machine."
    >
      <input
        type="password"
        autoFocus
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="Master password"
        className="input"
      />
      <input
        type="password"
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        placeholder="Confirm"
        className="input"
      />
      {tooShort ? <p className="text-xs text-amber-400">Use at least 8 characters.</p> : null}
      {mismatched ? <p className="text-xs text-amber-400">Passwords do not match.</p> : null}
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      <button
        className="btn-primary"
        disabled={!pw || pw.length < 8 || pw !== pw2 || setup.isPending}
        onClick={() => setup.mutate(pw)}
      >
        {setup.isPending ? "Encrypting…" : "Create vault"}
      </button>
    </CenterCard>
  );
}

function UnlockForm() {
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const unlock = useMutation({
    mutationFn: (password: string) => api.vaultUnlock(password),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vault", "state"] }),
  });
  const error = unlock.error instanceof ApiError ? unlock.error.message : null;
  return (
    <CenterCard title="Unlock mailbun" subtitle="Enter your master password to decrypt your accounts.">
      <input
        type="password"
        autoFocus
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && pw) unlock.mutate(pw);
        }}
        placeholder="Master password"
        className="input"
      />
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      <button
        className="btn-primary"
        disabled={!pw || unlock.isPending}
        onClick={() => unlock.mutate(pw)}
      >
        {unlock.isPending ? "Unlocking…" : "Unlock"}
      </button>
    </CenterCard>
  );
}

function CenterCard({
  title, subtitle, children,
}: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg-subtle">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-bg p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <Lock className="h-6 w-6 text-accent" />
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        <p className="text-sm text-fg-muted">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
