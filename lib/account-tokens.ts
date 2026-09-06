import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";

/**
 * Single-use account links: 邮箱验证 and 忘记密码.
 *
 * Only a salted digest of the token is stored, so a leaked database cannot be used to
 * verify an email or reset a password. Issuing a new token immediately revokes every
 * unconsumed token of the same purpose (§13「旧重置链接立即失效」), and consumption is a
 * single guarded UPDATE, so clicking a link twice — or in two tabs — works once.
 */

export type TokenPurpose = "verify_email" | "reset_password";

export const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  verify_email: 24 * 60,
  reset_password: 30,
};

export interface AccountToken {
  token: string;
  expiresAt: string;
  ttlMinutes: number;
}

function secret() {
  return process.env.AUTH_SECRET?.trim() || "wanke-default-secret-set-AUTH_SECRET";
}

export function tokenDigest(token: string): string {
  return createHash("sha256").update(secret()).update("account-token").update(token).digest("hex");
}

/** Drop every link of this purpose that has not been used yet. */
export function revokeAccountTokens(userId: string, purpose: TokenPurpose): number {
  return db.prepare("DELETE FROM account_tokens WHERE user_id=? AND purpose=? AND consumed_at IS NULL").run(userId, purpose).changes;
}

export function issueAccountToken(userId: string, purpose: TokenPurpose): AccountToken {
  revokeAccountTokens(userId, purpose);
  const token = randomBytes(32).toString("hex");
  const ttlMinutes = TOKEN_TTL_MINUTES[purpose];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
  db.prepare(`INSERT INTO account_tokens (id, user_id, purpose, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), userId, purpose, tokenDigest(token), expiresAt, now.toISOString());
  return { token, expiresAt, ttlMinutes };
}

export function tokenTtlMinutes(purpose: TokenPurpose): number {
  return TOKEN_TTL_MINUTES[purpose];
}

/**
 * Consume a link exactly once and return the account it belongs to.
 *
 * Deliberately vague: the browser only learns "this link cannot be used", never which
 * account it belonged to or whether it was already spent by someone else.
 */
export function consumeAccountToken(token: string, purpose: TokenPurpose): string {
  const clean = String(token || "").trim();
  if (!/^[a-f0-9]{64}$/.test(clean)) {
    throw new HttpError(400, "TOKEN_INVALID", "链接无效或已经失效，请重新获取一次");
  }
  const row = db.prepare("SELECT id, user_id, expires_at, consumed_at FROM account_tokens WHERE token_hash=? AND purpose=?")
    .get(tokenDigest(clean), purpose) as { id: string; user_id: string; expires_at: string; consumed_at: string | null } | undefined;
  if (!row) throw new HttpError(400, "TOKEN_INVALID", "链接无效或已经失效，请重新获取一次");
  if (row.consumed_at) throw new HttpError(400, "TOKEN_USED", "这个链接已经使用过了，请重新获取一次");
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM account_tokens WHERE id=?").run(row.id);
    throw new HttpError(400, "TOKEN_EXPIRED", "链接已经过期，请重新获取一次");
  }
  // Guarded single-use: two concurrent clicks leave exactly one winner.
  const consumed = db.prepare(`UPDATE account_tokens SET consumed_at=? WHERE id=? AND consumed_at IS NULL`)
    .run(new Date().toISOString(), row.id).changes;
  if (consumed !== 1) throw new HttpError(400, "TOKEN_USED", "这个链接已经使用过了，请重新获取一次");
  const user = db.prepare("SELECT id, status FROM users WHERE id=?").get(row.user_id) as { id: string; status: string } | undefined;
  if (!user) throw new HttpError(400, "TOKEN_INVALID", "链接无效或已经失效，请重新获取一次");
  if (user.status === "closed") throw new HttpError(403, "USER_CLOSED", "该账号已经注销，如需继续使用请重新注册");
  if (user.status !== "active") throw new HttpError(403, "USER_DISABLED", "账号已被暂停使用，请联系客服");
  return user.id;
}

export function purgeExpiredTokens(): number {
  return db.prepare("DELETE FROM account_tokens WHERE expires_at < ?").run(new Date().toISOString()).changes;
}
