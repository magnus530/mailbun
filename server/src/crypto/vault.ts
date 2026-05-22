import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { db } from "../db/index.js";

function scryptAsync(password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) => {
      if (err) reject(err);
      else resolve(key as Buffer);
    });
  });
}

// Vault layout
//   settings.kdf_salt              hex (16 bytes)
//   settings.verifier_ciphertext   AES-GCM(plaintext = "mailclient-vault-v1") with master key
//   settings.verifier_iv           hex (12 bytes)
//   settings.verifier_tag          hex (16 bytes)
//
// On unlock, we derive the master key from the password + salt, decrypt the verifier;
// success means the password is correct, and we cache the key in memory until logout.

const SCRYPT_KEYLEN = 32;
const SCRYPT_N = 1 << 15; // 32768 — ~150ms on a modern laptop
const VERIFIER_PLAINTEXT = "mailclient-vault-v1";

function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

class Vault {
  private masterKey: Buffer | null = null;
  private initialized = false;

  initFromDb() {
    this.initialized = true;
  }

  isConfigured(): boolean {
    return getSetting("kdf_salt") !== null;
  }

  isUnlocked(): boolean {
    return this.masterKey !== null;
  }

  async setup(password: string) {
    if (this.isConfigured()) {
      throw new Error("vault already configured");
    }
    if (password.length < 8) {
      throw new Error("master password must be at least 8 characters");
    }
    const salt = randomBytes(16);
    const key = await deriveKey(password, salt);

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(VERIFIER_PLAINTEXT, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const tx = db.transaction(() => {
      setSetting("kdf_salt", salt.toString("hex"));
      setSetting("verifier_ciphertext", ciphertext.toString("hex"));
      setSetting("verifier_iv", iv.toString("hex"));
      setSetting("verifier_tag", tag.toString("hex"));
    });
    tx();

    this.masterKey = key;
  }

  async unlock(password: string): Promise<boolean> {
    if (!this.isConfigured()) {
      throw new Error("vault not configured — call setup first");
    }
    const salt = Buffer.from(getSetting("kdf_salt")!, "hex");
    const ciphertext = Buffer.from(getSetting("verifier_ciphertext")!, "hex");
    const iv = Buffer.from(getSetting("verifier_iv")!, "hex");
    const tag = Buffer.from(getSetting("verifier_tag")!, "hex");

    const key = await deriveKey(password, salt);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const expected = Buffer.from(VERIFIER_PLAINTEXT, "utf8");
      if (plaintext.length !== expected.length || !timingSafeEqual(plaintext, expected)) {
        return false;
      }
      this.masterKey = key;
      return true;
    } catch {
      return false;
    }
  }

  lock() {
    if (this.masterKey) this.masterKey.fill(0);
    this.masterKey = null;
  }

  encryptString(plaintext: string): Buffer {
    this.requireUnlocked();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey!, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Layout: iv(12) || tag(16) || ciphertext
    return Buffer.concat([iv, tag, ct]);
  }

  decryptString(blob: Buffer): string {
    this.requireUnlocked();
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const ct = blob.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.masterKey!, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  }

  private requireUnlocked() {
    if (!this.masterKey) throw new Error("vault is locked");
  }
}

export const vault = new Vault();
