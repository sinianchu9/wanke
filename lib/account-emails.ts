import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/system-settings";
import { issueAccountToken, tokenTtlMinutes, type TokenPurpose } from "@/lib/account-tokens";
import {
  DEFAULT_RESET_TEMPLATE, DEFAULT_VERIFY_TEMPLATE, publicBaseUrl, renderEmailTemplate, sendEmail, siteName,
  type EmailResult,
} from "@/lib/mailer";

/**
 * The two account links a member can receive: 邮箱验证 and 找回密码.
 *
 * A token is never returned to the caller — the only place it exists is inside the
 * message the mail transport accepted. That keeps the reset flow honest even when the
 * transport falls back to the development outbox.
 */

export interface AccountEmailTarget {
  id: string;
  email: string;
  name: string;
}

export function accountEmailTarget(userId: string): AccountEmailTarget | null {
  const row = db.prepare("SELECT id, email, name FROM users WHERE id=?").get(userId) as AccountEmailTarget | undefined;
  return row || null;
}

export function verificationUrl(baseUrl: string, token: string) {
  return `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
}

export function passwordResetUrl(baseUrl: string, token: string) {
  return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

function contactEmail() {
  return getSetting("contact_email").trim();
}

function issueAndSend(purpose: TokenPurpose, target: AccountEmailTarget, request?: Request): Promise<EmailResult> {
  const { token } = issueAccountToken(target.id, purpose);
  const minutes = tokenTtlMinutes(purpose);
  const baseUrl = publicBaseUrl(request);
  const site = siteName();
  const variables = {
    name: target.name || "用户",
    site,
    minutes,
    contact: contactEmail() || "平台客服",
    link: purpose === "verify_email" ? verificationUrl(baseUrl, token) : passwordResetUrl(baseUrl, token),
  };
  if (purpose === "verify_email") {
    const template = getSetting("email_verify_body").trim() || DEFAULT_VERIFY_TEMPLATE;
    return sendEmail({
      to: target.email,
      subject: `验证你的 ${site} 邮箱`,
      text: renderEmailTemplate(template, variables),
      kind: "verify_email",
      userId: target.id,
      refId: target.id,
    });
  }
  const template = getSetting("email_reset_body").trim() || DEFAULT_RESET_TEMPLATE;
  return sendEmail({
    to: target.email,
    subject: `${site} 密码重置`,
    text: renderEmailTemplate(template, variables),
    kind: "password_reset",
    userId: target.id,
    refId: target.id,
  });
}

/** Issue a fresh verification link (revoking any older one) and hand it to the transport. */
export async function sendVerificationEmail(userId: string, request?: Request): Promise<EmailResult> {
  const target = accountEmailTarget(userId);
  if (!target) throw new Error("账号不存在");
  return issueAndSend("verify_email", target, request);
}

/** Issue a fresh password-reset link (revoking any older one) and hand it to the transport. */
export async function sendPasswordResetEmail(userId: string, request?: Request): Promise<EmailResult> {
  const target = accountEmailTarget(userId);
  if (!target) throw new Error("账号不存在");
  return issueAndSend("reset_password", target, request);
}
