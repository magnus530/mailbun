import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type { AddressDto, ComposeInput } from "@mailclient/shared";
import { accountsRepo } from "../db/accounts.js";
import { foldersRepo } from "../db/folders.js";
import { createImap } from "./imap.js";
import { imapConfigForAccount, smtpAuthForAccount } from "./auth.js";
import { syncManager } from "./manager.js";
import { persistMessage, updateFolderCounts } from "./persist.js";
import { emit } from "./events.js";

// SMTP submission endpoints we know save a copy of every outgoing message
// to the user's Sent folder server-side. APPENDing locally for these would
// produce two copies in Sent (one from us, one from the provider).
function smtpAutoSavesSent(host: string): boolean {
  const h = host.toLowerCase();
  return h === "smtp.gmail.com" || h === "smtp.googlemail.com";
}

export async function sendMessage(input: ComposeInput) {
  const a = accountsRepo.getRow(input.accountId);
  if (!a) throw new Error(`account ${input.accountId} not found`);

  const envelopeRcpts = [
    ...input.to.map((x) => x.address),
    ...(input.cc ?? []).map((x) => x.address),
    ...(input.bcc ?? []).map((x) => x.address),
  ].filter(Boolean);
  if (envelopeRcpts.length === 0) throw new Error("at least one recipient required");

  // Build the raw MIME ourselves. Doing this up-front (instead of letting
  // sendMail compile internally) means SMTP and IMAP APPEND share the same
  // bytes — and we no longer depend on `info.message`, which the SMTP
  // transport never sets. (That undefined was why APPEND used to silently
  // skip and the Sent tab stayed empty for non-Gmail accounts.)
  const composer = new MailComposer({
    from: a.display_name ? `"${a.display_name.replace(/"/g, "")}" <${a.email}>` : a.email,
    to: input.to.map(addrToString),
    cc: input.cc && input.cc.length > 0 ? input.cc.map(addrToString) : undefined,
    bcc: input.bcc && input.bcc.length > 0 ? input.bcc.map(addrToString) : undefined,
    subject: input.subject,
    text: input.bodyText,
    html: input.bodyHtml,
    inReplyTo: input.inReplyTo ?? undefined,
    references: input.references,
  });
  const raw: Buffer = await new Promise((resolve, reject) => {
    composer.compile().build((err, msg) => (err ? reject(err) : resolve(msg)));
  });

  const auth = await smtpAuthForAccount(a);
  const transporter = nodemailer.createTransport({
    host: a.smtp_host,
    port: a.smtp_port,
    secure: !!a.smtp_secure,
    auth: auth.accessToken
      ? { type: "OAuth2", user: auth.user, accessToken: auth.accessToken }
      : { user: auth.user, pass: auth.pass! },
  });

  const info = await transporter.sendMail({
    envelope: { from: a.email, to: envelopeRcpts },
    raw,
  });
  // From here on every error MUST be swallowed. SMTP has already accepted
  // the message; if anything thrown after this point reached the route's
  // catch block its network-error regex could enqueue the same payload
  // into the outbox, which would resend → recipient sees two copies.

  if (!smtpAutoSavesSent(a.smtp_host)) {
    try {
      await appendToSent(input.accountId, raw);
    } catch {
      /* see comment above — best-effort, must not throw */
    }
  }
  // Pre-insert the sent copy into the local DB right away so the user sees
  // it inside the original thread the moment the compose window closes —
  // instead of waiting 5-30s for the sync round-trip. We use a sentinel
  // negative uid (server UIDs are always positive); the sync pass later
  // finds this row by Message-ID and updates its uid to the real value
  // (see persistMessage's claim branch). If the Sent folder isn't known
  // yet (first sync hasn't run), the sync will pick it up on its own.
  try {
    await preInsertSent(input.accountId, raw);
  } catch {
    /* best-effort */
  }
  // Pull the just-sent copy into the local DB. For non-Gmail accounts this
  // claims the row we just pre-inserted; for Gmail it grabs the server-side
  // auto-save in [Gmail]/Sent Mail and likewise claims the pre-insert.
  syncManager.syncOnce(input.accountId).catch(() => {});

  return { ok: true, messageId: info.messageId };
}

async function preInsertSent(accountId: number, raw: Buffer): Promise<void> {
  const sent = foldersRepo.listForAccount(accountId).find((f) => f.role === "sent");
  if (!sent) return;
  await persistMessage({
    accountId,
    folderId: sent.id,
    uid: -Date.now(),
    flags: ["\\Seen"],
    internalDate: Date.now(),
    size: raw.length,
    source: raw,
  });
  updateFolderCounts(sent.id);
  emit({ type: "folder:update", folderId: sent.id });
}

function addrToString(x: AddressDto): string {
  return x.name ? `"${x.name.replace(/"/g, "")}" <${x.address}>` : x.address;
}

async function appendToSent(accountId: number, raw: Buffer): Promise<void> {
  const a = accountsRepo.getRow(accountId);
  if (!a) return;
  const sent = foldersRepo.listForAccount(accountId).find((f) => f.role === "sent");
  if (!sent) return;
  const client = createImap(await imapConfigForAccount(a));
  await client.connect();
  try {
    await client.append(sent.path, raw, ["\\Seen"]);
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
}
