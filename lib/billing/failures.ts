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
  if (/DataInspection|risk|审核|违规|sensitive|portrait|face|肖像|肖像权|公众人物|celebrity/i.test(message)) return "content";
  return "unknown";
}

export function refundPolicyFor(failureClass: FailureClass): RefundPolicy {
  // 商业退款原则：除 user_input 属于未发往上游外，其余失败状态均优先自动退回额度
  if (failureClass === "content" || failureClass === "unknown" || failureClass === "provider" || failureClass === "platform") {
    return getFailureRule(failureClass)?.refundPolicy ?? "auto_refund";
  }
  return getFailureRule(failureClass)?.refundPolicy ?? "auto_refund";
}

/**
 * Decide the credit outcome of a terminal failure.
 * `user_input` never consumed credits in the first place (rejected before submit),
 * so it voids the reservation instead of refunding a real charge.
 * All other failures (content moderation / portrait rights, upstream errors, unknown)
 * are auto-refunded to protect the user's credits.
 */
export function resolveFailureChargeAction(failureClass: FailureClass): "void" | "refund" | "hold" {
  if (failureClass === "user_input") return "void";
  const policy = refundPolicyFor(failureClass);
  if (policy === "no_refund") return "hold";
  return "refund";
}

export function userMessageFor(failureClass: FailureClass): string {
  if (failureClass === "content") {
    return "本次内容未通过服务安全审核（如人物肖像权或敏感内容），无法生成视频，创作额度已全额退回。请更换素材或调整描述后重试。";
  }
  if (failureClass === "unknown") {
    return "本次创作未能完成，创作额度已全额退回，请稍后重试。";
  }
  return getFailureRule(failureClass)?.userMessage || "本次创作没有完成，创作额度已退回，请稍后重试。";
}

export function labelFor(failureClass: FailureClass): string {
  return getFailureRule(failureClass)?.label || "状态确认中";
}

