import "server-only";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, isEncryptedSecret, maskSecret, secretFingerprint } from "@/lib/crypto-secrets";

/**
 * Unified secret store. Sensitive credentials (payment keys, provider keys, mail
 * passwords) live here encrypted; the plain `settings` table only ever holds
 * non-sensitive configuration. Read APIs return masks/fingerprints, never values.
 */

function nowIso() {
  return new Date().toISOString();
}

export function readSecret(key: string): string {
  const row = db.prepare("SELECT ciphertext FROM secrets WHERE key=?").get(key) as { ciphertext?: string } | undefined;
  const stored = row?.ciphertext?.trim();
  if (!stored) return "";
  try {
    return decryptSecret(stored);
  } catch {
    // A value sealed with a lost key must fail closed instead of being treated as
    // "not configured", otherwise payments would silently run unsigned.
    throw new Error(`秘密配置 ${key} 无法解密，请检查主密钥配置`);
  }
}

export function hasSecret(key: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM secrets WHERE key=?").get(key));
}

export function writeSecret(key: string, plain: string): void {
  const value = plain.trim();
  if (!value) {
    clearSecret(key);
    return;
  }
  db.prepare(`INSERT INTO secrets (key, ciphertext, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET ciphertext=excluded.ciphertext, updated_at=excluded.updated_at`)
    .run(key, encryptSecret(value), nowIso());
}

export function clearSecret(key: string): void {
  db.prepare("DELETE FROM secrets WHERE key=?").run(key);
}

/** Never send a raw secret to the browser: configured flag + mask + fingerprint only. */
export function describeSecret(key: string): { configured: boolean; masked: string; fingerprint: string } {
  let value = "";
  try {
    value = readSecret(key);
  } catch {
    return { configured: true, masked: "配置需要重新保存", fingerprint: "" };
  }
  if (!value) return { configured: false, masked: "", fingerprint: "" };
  return { configured: true, masked: maskSecret(value), fingerprint: secretFingerprint(value) };
}

/**
 * Apply the "blank keeps the current value" rule used by every admin secret form.
 * Returns true when the stored value actually changed (for audit metadata).
 */
export function applySecretInput(key: string, input: { value?: string | null; clear?: boolean | null }): boolean {
  const had = hasSecret(key);
  if (input.clear) {
    clearSecret(key);
    return had;
  }
  const next = (input.value ?? "").trim();
  if (!next) return false;
  const current = (() => { try { return readSecret(key); } catch { return null; } })();
  if (current === next) return false;
  writeSecret(key, next);
  return true;
}

export { isEncryptedSecret, maskSecret };
