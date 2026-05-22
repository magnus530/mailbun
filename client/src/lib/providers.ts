// Common provider presets — user only needs email + app password for these.
// Anything else falls back to manual host entry.

import type { OAuthProvider } from "@mailclient/shared";

export interface ProviderPreset {
  name: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  hint?: string;
  // If set and the provider's OAuth client ID is configured on the server,
  // the UI offers a one-click "Sign in with X" button instead of an app
  // password field.
  oauth?: OAuthProvider;
}

const presets: { match: RegExp; preset: ProviderPreset }[] = [
  { match: /@(gmail\.com|googlemail\.com)$/i, preset: {
      name: "Gmail",
      imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true,
      smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true,
      hint: "Use \"Sign in with Google\" if available. Otherwise generate an App Password at myaccount.google.com/apppasswords.",
      oauth: "google",
  } },
  { match: /@(outlook\.com|hotmail\.com|live\.com|msn\.com)$/i, preset: {
      name: "Outlook",
      imapHost: "outlook.office365.com", imapPort: 993, imapSecure: true,
      smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecure: false,
      hint: "Use \"Sign in with Microsoft\" if available. Otherwise enable 2FA and create an App Password at account.microsoft.com/security.",
      oauth: "microsoft",
  } },
  { match: /@(yahoo\.com|ymail\.com)$/i, preset: {
      name: "Yahoo Mail",
      imapHost: "imap.mail.yahoo.com", imapPort: 993, imapSecure: true,
      smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecure: true,
      hint: "Yahoo requires an App Password — generate one in Account Security settings",
  } },
  { match: /@(icloud\.com|me\.com|mac\.com)$/i, preset: {
      name: "iCloud",
      imapHost: "imap.mail.me.com", imapPort: 993, imapSecure: true,
      smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecure: false,
      hint: "iCloud requires an App-Specific Password — generate one at appleid.apple.com",
  } },
  { match: /@(fastmail\.com|fastmail\.fm)$/i, preset: {
      name: "Fastmail",
      imapHost: "imap.fastmail.com", imapPort: 993, imapSecure: true,
      smtpHost: "smtp.fastmail.com", smtpPort: 465, smtpSecure: true,
      hint: "Fastmail requires an App Password — generate one in Settings → Privacy & Security",
  } },
  { match: /@(proton\.me|protonmail\.com)$/i, preset: {
      name: "Proton Mail",
      imapHost: "127.0.0.1", imapPort: 1143, imapSecure: false,
      smtpHost: "127.0.0.1", smtpPort: 1025, smtpSecure: false,
      hint: "Proton Mail requires running Proton Mail Bridge locally — these defaults assume Bridge is running.",
  } },
];

export function detectProvider(email: string): ProviderPreset | null {
  for (const p of presets) if (p.match.test(email)) return p.preset;
  return null;
}
