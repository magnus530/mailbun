# mailbun

##### Email — all in one place.

Local-first multi-account email client. Browser UI on localhost talks to a Node backend that handles IMAP/SMTP. Designed to wrap as an installable app (Electron/Tauri) later.

## Architecture

```
client/   React + Vite + Tailwind        (browser UI)
server/   Fastify + SQLite + imapflow    (IMAP/SMTP, sync, API)
shared/   TypeScript types               (DTOs shared across client/server)
```

## Quick start

```bash
npm install
npm run dev
```

- Server runs on `http://localhost:4100`
- Client runs on `http://localhost:5173` and proxies `/api` and `/ws` to the server

On first launch the UI prompts you to set a master password — this encrypts the IMAP/SMTP credentials of every account you add.

## Adding an account

Two paths:

- **OAuth (recommended for Gmail / Outlook):** one-time setup of a free
  OAuth client per provider — see [docs/oauth-setup.md](docs/oauth-setup.md).
  After setup, "Sign in with Google / Microsoft" buttons appear in the
  Add-account dialog, no app password needed.
- **App password (works for any IMAP/SMTP provider):** generate an
  app-specific password in your provider's account settings, paste it into
  the dialog. For Gmail this lives at
  <https://myaccount.google.com/apppasswords>. For Purelymail, Fastmail, or
  any custom domain, use the standard account password.
