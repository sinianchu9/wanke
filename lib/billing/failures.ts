import "server-only";
import { db } from "@/lib/db";
import { isValidationMessage } from "@/lib/copy";
import { HttpError } from "@/lib/auth";

/**
 * Failure classification drives the credit refund policy.
 *
 * The commercial rule is no longer "anything accepted remotely is non-refundable".
 * Every terminal failure is classified, the class decides auto-refund / no-refund /
 * manual review, and operators can tune both the matching keywords and the policy.
 */

export type FailureClass = "user_input" | "platform" | "provider" | "content" | "user_cancel" | "unknown";
export type RefundPolicy = "auto_refund" | "no_refund" | "manual_review";

export interface FailureRule {
  failureClass: FailureClass;
  label: string;
  userMessage: string;
  refundPolicy: RefundPolicy;
  match: string[];
  sortOrder: number;
  updatedAt: string;
}

export type FailureStage = "validate" | "submit" | "processing" | "post";

function rowToRule(row: any): FailureRule {
  let match: string[] = [];
  try {
    const parsed = JSON.parse(row.match_json || "[]");
    match = Array.isArray(parsed) ? parsed.map((item: unknown) => String(item)) : [];
  } catch {
    match = [];
  }
  return {
    failureClass: row.failure_class,
    label: row.label,
    userMessage: row.user_message,
    refundPolicy: row.refund_policy,
    match,
    sortOrder: Number(row.sort_order || 100),
    updatedAt: row.updated_at,
  };
}

export function listFailureRules(): FailureRule[] {
  return (db.prepare("SELECT * FROM failure_rules ORDER BY sort_order ASC").all() as any[]).map(rowToRule);
}

export function getFailureRule(failureClass: FailureClass): FailureRule | null {
  const row = db.prepare("SELECT * FROM failure_rules WHERE failure_class=?").get(failureClass);
  return row ? rowToRule(row) : null;
}

export function updateFailureRule(failureClass: FailureClass, patch: {
  label?: string;
  userMessage?: string;
  refundPolicy?: RefundPolicy;
  match?: string[];
}): FailureRule {
  const current = getFailureRule(failureClass);
  if (!current) throw new HttpError(404, "RULE_NOT_FOUND", "失败分类不存在");
  db.prepare(`UPDATE failure_rules SET label=?, user_message=?, refund_policy=?, match_json=?, updated_at=? WHERE failure_class=?`)
    .run(
      (patch.label ?? current.label).trim() || current.label,
      (patch.userMessage ?? current.userMessage).trim() || current.userMessage,
      patch.refundPolicy ?? current.refundPolicy,
      JSON.stringify(patch.match ?? current.match),
      new Date().toISOString(),
      failureClass,
    );
  return getFailureRule(failureClass)!;
}

const LOCAL_ERROR_CODES = [
  "QUOTA_EXCEEDED", "MEMBERSHIP_INACTIVE", "CSRF_REJECTED", "UNAUTHORIZED", "FORBIDDEN",
  "BAD_ORIGIN", "INVALID_", "NOT_FOUND", "STORAGE", "ARCHIVE", "DATABASE", "WORKER_",
];

/**
 * Classify one terminal failure. `stage` tells us whether the creation ever reached
 * the upstream service, which is what separates "never charged" from "charged".
 */
export function classifyFailure(errorText: string | null | undefined, stage: FailureStage = "processing"): FailureClass {
  const message = String(errorText || "").trim();
  if (!message) return stage === "validate" ? "user_input" : "unknown";
  if (stage === "validate") return "user_input";
  // Rejected by the creation schema: nothing was ever sent upstream, so the member is
  // never charged. Decided by the shape of the error, not by lucky keyword overlap.
  if (isValidationMessage(message)) return "user_input";

  const rules = listFailureRules();
  const lowered = message.toLowerCase();
  for (const rule of rules) {
    if (rule.failureClass === "user_input" || rule.failureClass === "platform" || rule.failureClass === "unknown") continue;
    if (rule.match.some(keyword => keyword && lowered.includes(String(keyword).toLowerCase()))) return rule.failureClass;
  }
  if (LOCAL_ERROR_CODES.some(code => message.includes(code))) return "platform";
  if (stage === "submit" && /InvalidParameter|BadRequest|input|prompt|image|format|unsupported/i.test(message)) return "user_input";
  if (/Throttling|InternalError|ServiceUnavailable|GatewayTimeout|socket hang up|ECONNRESET|ETIMEDOUT|fetch failed|\b5\d{2}\b/.test(message)) return "provider";
  if (/DataInspection|risk|审核|违规|sensitive/i.test(message)) return "content";
  return "unknown";
}

export function refundPolicyFor(failureClass: FailureClass): RefundPolicy {
  return getFailureRule(failureClass)?.refundPolicy ?? "manual_review";
}

/**
 * Decide the credit outcome of a terminal failure.
 * `user_input` never consumed credits in the first place (rejected before submit),
 * so it voids the reservation instead of refunding a real charge.
 */
export function resolveFailureChargeAction(failureClass: FailureClass): "void" | "refund" | "hold" {
  if (failureClass === "user_input") return "void";
  const policy = refundPolicyFor(failureClass);
  if (policy === "auto_refund") return "refund";
  if (policy === "no_refund") return "hold";
  return "hold";
}

export function userMessageFor(failureClass: FailureClass): string {
  return getFailureRule(failureClass)?.userMessage || "本次创作没有完成，请稍后重试。";
}

export function labelFor(failureClass: FailureClass): string {
  return getFailureRule(failureClass)?.label || "状态确认中";
}
