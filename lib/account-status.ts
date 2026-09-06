import "server-only";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { getBooleanSetting } from "@/lib/system-settings";

/**
 * Account readiness gate.
 *
 * §13「注册后必须验证邮箱」is enforced when a creation is submitted, never at login:
 * an unverified member can still sign in, read their works, see their orders and ask
 * for a new verification link. The check lives here (and is called from the single
 * charging choke point) so no submit path can forget it and the message stays business
 * language instead of an internal flag.
 */

export interface AccountReadiness {
  emailVerified: boolean;
  verificationRequired: boolean;
  /** True when the account may not start a creation right now. */
  blocked: boolean;
  code: "OK" | "EMAIL_NOT_VERIFIED" | "USER_NOT_FOUND";
  message: string;
  hint: string;
}

export const EMAIL_NOT_VERIFIED_MESSAGE = "请先验证邮箱，验证通过后就可以开始创作";
export const EMAIL_NOT_VERIFIED_HINT = "在「账号设置 → 验证邮箱」里重新发送验证邮件，点击邮件中的链接即可完成验证。";

export function verificationRequired(): boolean {
  return getBooleanSetting("require_email_verification");
}

export function accountReadiness(userId: string): AccountReadiness {
  const row = db.prepare("SELECT email_verified FROM users WHERE id=?").get(userId) as { email_verified?: number } | undefined;
  if (!row) {
    return {
      emailVerified: false, verificationRequired: false, blocked: true, code: "USER_NOT_FOUND",
      message: "账号不存在", hint: "",
    };
  }
  const emailVerified = Boolean(row.email_verified);
  const required = verificationRequired();
  const blocked = required && !emailVerified;
  return {
    emailVerified,
    verificationRequired: required,
    blocked,
    code: blocked ? "EMAIL_NOT_VERIFIED" : "OK",
    message: blocked ? EMAIL_NOT_VERIFIED_MESSAGE : "",
    hint: blocked ? EMAIL_NOT_VERIFIED_HINT : "",
  };
}

/** Throw a member-readable 403 when this account may not start a creation. */
export function assertCanCreate(userId: string): AccountReadiness {
  const readiness = accountReadiness(userId);
  if (readiness.code === "USER_NOT_FOUND") throw new HttpError(404, "USER_NOT_FOUND", "账号不存在");
  if (readiness.blocked) throw new HttpError(403, readiness.code, readiness.message);
  return readiness;
}
