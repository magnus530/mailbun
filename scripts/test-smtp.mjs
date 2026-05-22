// Stand-alone SMTP auth check — bypasses mailclient entirely.
// Usage: node scripts/test-smtp.mjs <email> <password> [host] [port] [secure]
//   secure=true  → SSL/TLS (typically port 465)
//   secure=false → STARTTLS (typically port 587)
import nodemailer from "nodemailer";

const [, , email, password, host = "smtp.purelymail.com", portStr = "465", secureStr = "true"] = process.argv;

if (!email || !password) {
  console.error("usage: node scripts/test-smtp.mjs <email> <password> [host] [port] [secure]");
  process.exit(2);
}

const port = Number(portStr);
const secure = secureStr === "true";

console.log(`connecting to ${host}:${port} (secure=${secure}) as ${email}`);
const t = nodemailer.createTransport({
  host, port, secure,
  auth: { user: email, pass: password },
  logger: true,
  debug: true,
});

try {
  await t.verify();
  console.log("\n✓ AUTH OK — credentials accepted");
  process.exit(0);
} catch (err) {
  console.error("\n✗ AUTH FAILED:", err.message);
  process.exit(1);
}
