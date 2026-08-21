/**
 * Diagnose an IMAP login the way the app does it, but printing the FULL
 * server error instead of the app's collapsed "Command failed".
 *
 *   node scripts/test-imap.mjs <email> <password> [host] [port]
 *
 * Defaults host/port to Purelymail (imap.purelymail.com:993, TLS).
 * The password is read from argv and never stored — this runs locally.
 */
import { ImapFlow } from "imapflow";

const [, , email, password, host = "imap.purelymail.com", port = "993"] = process.argv;
if (!email || !password) {
  console.error("usage: node scripts/test-imap.mjs <email> <password> [host] [port]");
  process.exit(1);
}

const client = new ImapFlow({
  host,
  port: Number(port),
  secure: true,
  auth: { user: email, pass: password },
  logger: false,
});

try {
  await client.connect();
  console.log("✓ LOGIN ok");
  const boxes = await client.list();
  console.log(`✓ LIST ok — ${boxes.length} folders:`, boxes.map((b) => b.path).join(", "));
  await client.logout();
  console.log("✓ all good — these credentials work");
} catch (err) {
  console.error("✗ failed. Full detail:");
  console.error("  message:            ", err?.message);
  console.error("  authenticationFailed:", err?.authenticationFailed);
  console.error("  responseText:       ", err?.responseText);
  console.error("  serverResponseCode: ", err?.serverResponseCode);
  console.error("  response:           ", err?.response);
  process.exit(1);
}
