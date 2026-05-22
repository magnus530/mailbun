# OAuth setup (one-time)

mailclient supports "Sign in with Google" / "Sign in with Microsoft" so users
don't need to mess with app passwords. To enable it you need to register an
OAuth client with each provider once. Both are free.

After setup, set the appropriate environment variable and restart the server.
The "Sign in with X" button only appears in the UI for providers whose client
ID is configured.

---

## Google (Gmail)

1. Visit <https://console.cloud.google.com/>.
2. Create a project (or pick an existing one). Any name works — e.g. `mailclient`.
3. Open **APIs & Services → OAuth consent screen**.
   - User type: **External** (allows any Google account, including yours).
   - App name: `mailclient`. User support email + developer email: your address.
   - On the **Scopes** screen, click **Add or Remove Scopes** and add:
     - `openid`
     - `email`
     - `https://mail.google.com/`  (look for "Gmail API – read, compose, send")
     - This last one usually requires you to first enable the **Gmail API** under
       **APIs & Services → Library** if it isn't already enabled.
   - On the **Test users** screen, add your own Gmail address. While the app is
     in "Testing" status (the default) only listed test users can sign in, but
     you don't have to submit for verification — fine for personal use.
4. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Desktop app**.
   - Name: `mailclient`.
   - Click **Create**. **There is no redirect URI field** for desktop clients,
     and that's intentional — Google automatically accepts loopback redirects
     (`http://127.0.0.1:<any-port>/...`) for the Desktop app type, so you
     don't have to register one. mailclient sends the correct redirect URI
     (`http://127.0.0.1:4100/api/oauth/callback` by default) at sign-in time
     and Google validates it's a loopback address.
5. Copy **both** the **Client ID** (looks like `1234567890-abcdef.apps.googleusercontent.com`)
   and the **Client secret** (a short string like `GOCSPX-...`).

   > Even though we use PKCE, Google requires the client secret in the token
   > exchange for the Desktop app type. Per Google's own documentation this
   > "secret" isn't really secret — it's expected to ship with the
   > distributed binary of any installed app — but you do have to send it.
6. Set both before starting the server:
   ```bash
   export GOOGLE_OAUTH_CLIENT_ID='1234567890-abcdef.apps.googleusercontent.com'
   export GOOGLE_OAUTH_CLIENT_SECRET='GOCSPX-...'
   npm run dev
   ```
   Or persist them: add the `export` lines to `~/.bashrc` / `~/.zshrc`, or create
   a `.env` file at the repo root and source it before `npm run dev`.

When you next click **Add account → Sign in with Google**, you'll see the
normal Google consent screen. Approve once and Gmail starts syncing.

> The first time you sign in, Google may show a yellow "Google hasn't
> verified this app" warning because the app is still in "Testing" mode.
> That's fine for personal use — click **Advanced → Go to mailclient (unsafe)**.
> Verification is only needed if you want to publish this for other users.

---

## Microsoft (Outlook / Office 365)

1. Visit <https://entra.microsoft.com/> (Microsoft Entra ID, formerly Azure AD).
2. Open **Applications → App registrations → New registration**.
   - Name: `mailclient`.
   - Supported account types: **Personal Microsoft accounts only** (or
     "Accounts in any organizational directory and personal Microsoft accounts"
     if you also want to add work/school accounts).
   - Redirect URI: select **Public client/native (mobile & desktop)** and enter
     `http://127.0.0.1:4100/api/oauth/callback`.
3. Once created, copy the **Application (client) ID** from the Overview page.
4. Open **Authentication → Advanced settings**, set **Allow public client flows**
   to **Yes**, and save.
5. Open **API permissions → Add a permission → Microsoft Graph →
   Delegated permissions** and add:
   - `IMAP.AccessAsUser.All`
   - `SMTP.Send`
   - `offline_access`
   - `email`
   - `openid`
6. Set the env var and restart:
   ```bash
   export MICROSOFT_OAUTH_CLIENT_ID='your-client-id-uuid'
   npm run dev
   ```

---

## What if I don't want to set this up?

App-password auth still works for every provider — including Gmail, where you
generate one at <https://myaccount.google.com/apppasswords>. The OAuth path is
strictly nicer UX; the password path remains the fallback.
