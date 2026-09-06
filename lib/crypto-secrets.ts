import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Server-side secret protection (AES-256-GCM).
 *
 * Master key resolution order:
 * 1. `WANKE_MASTER_KEY` (recommended for production)
 * 2. `AUTH_SECRET` (already required for session hardening)
 * 3. a generated key persisted next to the database with mode 0600 (development only)
 *
 * Ciphertext format: `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>` so a rotated key can
 * still decrypt values sealed with `WANKE_MASTER_KEY_PREVIOUS`. Nothing here ever
 * depends on the database, which lets the schema migration encrypt legacy plain
 * text settings while the connection is still being opened.
 */

const PREFIX = "enc:v1";

let cached: { key: Buffer; id: string; previous?: { key: Buffer; id: string } } | null = null;

function deriveKey(material: string, salt: string) {
  return scryptSync(material.normalize("NFKC"), `wanke-master:${salt}`, 32);
}

function keyId(key: Buffer) {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

function loadMaterial(): { material: string; source: "env" | "auth_secret" | "file" } {
  const fromEnv = process.env.WANKE_MASTER_KEY?.trim();
  if (fromEnv) return { material: fromEnv, source: "env" };
  const fromAuth = process.env.AUTH_SECRET?.trim();
  if (fromAuth) return { material: fromAuth, source: "auth_secret" };
  const dbPath = path.resolve(process.env.WANKE_DB_PATH || "./data/wanke.db");
  const keyPath = path.join(path.dirname(dbPath), ".wanke-master.key");
  try {
    const existing = fs.readFileSync(keyPath, "utf8").trim();
    if (existing) return { material: existing, source: "file" };
  } catch {
    /* generated below */
  }
  const generated = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, generated, { mode: 0o600 });
  try { fs.chmodSync(keyPath, 0o600); } catch { /* best effort on non-POSIX */ }
  if (process.env.NODE_ENV === "production") {
    console.warn("[wanke] WANKE_MASTER_KEY 未配置，已使用自动生成的本地主密钥文件；生产环境请显式配置并备份。");
  }
  return { material: generated, source: "file" };
}

function masterKey() {
  if (cached) return cached;
  const { material, source } = loadMaterial();
  const key = deriveKey(material, source === "file" ? "file" : "configured");
  const previousMaterial = process.env.WANKE_MASTER_KEY_PREVIOUS?.trim();
  cached = {
    key,
    id: keyId(key),
    previous: previousMaterial ? { key: deriveKey(previousMaterial, "previous"), id: keyId(deriveKey(previousMaterial, "previous")) } : undefined,
  };
  return cached;
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

export function encryptSecret(plain: string): string {
  const { key, id } = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, id, iv.toString("hex"), tag.toString("hex"), ciphertext.toString("hex")].join(":");
}

export function decryptSecret(stored: string): string {
  if (!isEncryptedSecret(stored)) return stored;
  // `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>` — six fields, because the version prefix
  // itself contains a colon. Counting five made every stored secret undecryptable.
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "enc" || parts[1] !== "v1") throw new Error("秘密配置格式无效");
  const [, , sealedKeyId, ivHex, tagHex, cipherHex] = parts;
  if (!/^[0-9a-f]+$/i.test(ivHex) || !/^[0-9a-f]+$/i.test(tagHex) || !/^[0-9a-f]+$/i.test(cipherHex)) {
    throw new Error("秘密配置格式无效");
  }
  const { key, id, previous } = masterKey();
  const candidates = sealedKeyId === id ? [key] : previous && sealedKeyId === previous.id ? [previous.key] : [key, ...(previous ? [previous.key] : [])];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", candidate, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(cipherHex, "hex")), decipher.final()]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`秘密配置无法解密（主密钥不匹配）：${(lastError as Error)?.message || ""}`);
}

export function maskSecret(plain: string): string {
  const value = plain.trim();
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}${"•".repeat(Math.min(12, Math.max(4, value.length - 8)))}${value.slice(-4)}`;
}

/** Stable, non-reversible fingerprint so an operator can compare two configured keys. */
export function secretFingerprint(plain: string): string {
  return createHash("sha256").update(plain).digest("hex").slice(0, 12);
}
