import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, KeyRound } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useOAuthProviders } from "../lib/hooks";
import { detectProvider } from "../lib/providers";

interface Props {
  onClose: () => void;
}

export function AccountSetup({ onClose }: Props) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [usePasswordInstead, setUsePasswordInstead] = useState(false);

  const detected = useMemo(() => detectProvider(email), [email]);
  const oauthProviders = useOAuthProviders();
  const availableOAuth = useMemo(() => {
    return (oauthProviders.data ?? []).filter((p) => p.configured);
  }, [oauthProviders.data]);
  // If the typed email matches a known OAuth provider AND that provider is
  // configured server-side, recommend OAuth. The user can opt out via the
  // "Use a password instead" link.
  const oauthMatch = useMemo(() => {
    if (!detected?.oauth) return null;
    return availableOAuth.find((p) => p.provider === detected.oauth) ?? null;
  }, [detected, availableOAuth]);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [imapSecure, setImapSecure] = useState(true);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(465);
  const [smtpSecure, setSmtpSecure] = useState(true);

  // Auto-fill from detected provider until user explicitly edits.
  useEffect(() => {
    if (detected) {
      setImapHost(detected.imapHost);
      setImapPort(detected.imapPort);
      setImapSecure(detected.imapSecure);
      setSmtpHost(detected.smtpHost);
      setSmtpPort(detected.smtpPort);
      setSmtpSecure(detected.smtpSecure);
    }
  }, [detected]);

  const create = useMutation({
    mutationFn: () =>
      api.createAccount({
        email,
        displayName: displayName || undefined,
        password,
        imapHost, imapPort, imapSecure,
        smtpHost, smtpPort, smtpSecure,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      onClose();
    },
  });
  const error = create.error instanceof ApiError ? create.error.message : null;
  const formValid = email.includes("@") && password && imapHost && smtpHost;

  // Show the OAuth path if the typed email matches a configured provider and
  // the user hasn't explicitly opted into password auth for this account.
  const showOAuthPath = !!oauthMatch && !usePasswordInstead;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-border bg-bg shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Add an email account</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-bg-hover">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick OAuth shortcut shown only before the user starts typing. */}
        {availableOAuth.length > 0 && email === "" ? (
          <div className="shrink-0 space-y-2 border-b border-border bg-bg-subtle px-5 py-3">
            <p className="text-xs font-medium text-fg-muted">Quick sign-in</p>
            <div className="flex flex-col gap-2">
              {availableOAuth.map((p) => (
                <a
                  key={p.provider}
                  href={`/api/oauth/${p.provider}/start`}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-bg px-4 py-2 text-sm font-medium hover:bg-bg-hover"
                >
                  <ProviderGlyph provider={p.provider} />
                  Sign in with {p.displayName}
                </a>
              ))}
            </div>
            <p className="text-[11px] text-fg-subtle">
              Recommended for Gmail / Outlook — no app password required.
            </p>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input
                className="input" type="email" value={email}
                onChange={(e) => { setEmail(e.target.value); setUsePasswordInstead(false); }}
                placeholder="you@example.com"
                autoFocus
              />
            </Field>
            <Field label="Display name">
              <input
                className="input" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your Name"
              />
            </Field>
          </div>

          {showOAuthPath ? (
            <div className="space-y-2 rounded-xl border border-accent/40 bg-accent/5 p-4">
              <p className="text-sm">
                <strong>{oauthMatch!.displayName}</strong> account detected — sign in with one click.
              </p>
              <a
                href={`/api/oauth/${oauthMatch!.provider}/start`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                <ProviderGlyph provider={oauthMatch!.provider} className="text-white" />
                Continue with {oauthMatch!.displayName}
              </a>
              <button
                type="button"
                onClick={() => setUsePasswordInstead(true)}
                className="text-xs text-fg-muted hover:text-fg"
              >
                Use a password instead
              </button>
            </div>
          ) : null}

          <Field label="App password">
            <input
              className="input" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="App-specific password"
            />
            {detected?.hint ? (
              <p className="text-xs text-fg-muted"><KeyRound className="mr-1 inline h-3 w-3" />{detected.hint}</p>
            ) : null}
          </Field>

          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">IMAP (incoming)</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Host">
                <input className="input" value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
              </Field>
              <Field label="Port">
                <input className="input" type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} />
              </Field>
              <Field label="TLS">
                <select
                  className="input"
                  value={imapSecure ? "tls" : "starttls"}
                  onChange={(e) => setImapSecure(e.target.value === "tls")}
                >
                  <option value="tls">SSL/TLS</option>
                  <option value="starttls">STARTTLS</option>
                </select>
              </Field>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">SMTP (outgoing)</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Host">
                <input className="input" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
              </Field>
              <Field label="Port">
                <input className="input" type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
              </Field>
              <Field label="TLS">
                <select
                  className="input"
                  value={smtpSecure ? "tls" : "starttls"}
                  onChange={(e) => setSmtpSecure(e.target.value === "tls")}
                >
                  <option value="tls">SSL/TLS</option>
                  <option value="starttls">STARTTLS</option>
                </select>
              </Field>
            </div>
          </div>

          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-bg-subtle px-5 py-3">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            disabled={!formValid || create.isPending}
            onClick={() => create.mutate()}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" />
            {create.isPending ? "Connecting…" : "Add account"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function ProviderGlyph({ provider, className }: { provider: string; className?: string }) {
  if (provider === "google") {
    // Trimmed multicolor "G" mark — recognizable without trademark issues.
    return (
      <svg viewBox="0 0 24 24" className={`h-4 w-4 ${className ?? ""}`} aria-hidden>
        <path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6c-.2 1.3-1 2.4-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.5z"/>
        <path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-4.9-1.8-5.7-4.2H2.8v2.7C4.5 19.9 8 22 12 22z"/>
        <path fill="#FBBC05" d="M6.3 13.7c-.2-.6-.3-1.2-.3-1.7s.1-1.1.3-1.7V7.6H2.8C2.3 8.9 2 10.4 2 12s.3 3.1.8 4.4l3.5-2.7z"/>
        <path fill="#EA4335" d="M12 5.7c1.5 0 2.9.5 3.9 1.5l3-3C17.2 2.6 14.8 1.5 12 1.5 8 1.5 4.5 3.6 2.8 6.7l3.5 2.7c.8-2.4 3-4.2 5.7-4.2z"/>
      </svg>
    );
  }
  if (provider === "microsoft") {
    return (
      <svg viewBox="0 0 24 24" className={`h-4 w-4 ${className ?? ""}`} aria-hidden>
        <path fill="#F25022" d="M3 3h8.5v8.5H3z"/>
        <path fill="#7FBA00" d="M12.5 3H21v8.5h-8.5z"/>
        <path fill="#00A4EF" d="M3 12.5h8.5V21H3z"/>
        <path fill="#FFB900" d="M12.5 12.5H21V21h-8.5z"/>
      </svg>
    );
  }
  return null;
}
