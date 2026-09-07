import "server-only";
import { db } from "@/lib/db";
import { quoteForJob, type CreditQuote } from "@/lib/billing/pricing";
import {
  attachChargeToJob, ensureSufficientCredits, getCharge, getChargeByJob, getChargeByIdempotencyKey, refundCharge,
  reserveForJob, settleCharge, voidCharge, writeTransaction, type TaskCharge,
} from "@/lib/billing/quota";
import { classifyFailure, resolveFailureChargeAction, userMessageFor, type FailureClass, type FailureStage } from "@/lib/billing/failures";
import { assertCanCreate } from "@/lib/account-status";
import { assertSubmitAllowed } from "@/lib/guardrails";

/**
 * Creation charging lifecycle, used by every submit path (single, batch, retry,
 * quick wizard, storyboard).
 *
 *   quote (before submit) -> reserve -> attach job -> settle | refund | void
 *
 * Exactly-once guarantees:
 * - the reservation carries an idempotency key, so a double-clicked submit, a page
 *   refresh or a retried request charges once and returns the same job;
 * - settle/refund/void are guarded by the charge's current state, so 100 status
 *   polls, worker restarts and repeated callbacks cannot move credits again.
 */

export interface SubmitChargeInput {
  userId: string;
  kind: string;
  jobInput: Record<string, unknown>;
  clientRequestId?: string | null;
  quantity?: number;
  /**
   * `batch_member` means the whole submission was already approved as one unit by
   * `assertBatchAffordable` (batch versions, quick-creation shots). Re-checking the
   * concurrency and rate limits per version would block the batch it just approved.
   */
  guard?: "single" | "batch_member";
}

export function submitIdempotencyKey(userId: string, clientRequestId: string) {
  return `submit:${userId}:${clientRequestId}`;
}

export function quoteSubmit(input: SubmitChargeInput): CreditQuote {
  return quoteForJob(input.kind, input.quantity && input.quantity > 1 ? { ...input.jobInput, count: input.quantity } : input.jobInput);
}

/** Find an already-charged submission for the same client request id (duplicate submit). */
export function existingChargeForRequest(userId: string, clientRequestId?: string | null): TaskCharge | null {
  if (!clientRequestId) return null;
  return getChargeByIdempotencyKey(submitIdempotencyKey(userId, clientRequestId));
}

export function beginSubmitCharge(input: SubmitChargeInput): { charge: TaskCharge; quote: CreditQuote } {
  // Single choke point for §13「注册后必须验证邮箱」: every submit path (single, batch,
  // retry, continue-creation, quick wizard) reserves through here, so none can forget it.
  assertCanCreate(input.userId);
  // §48 成本保护: refuse runaway submits before a single credit is reserved.
  if (input.guard !== "batch_member") assertSubmitAllowed(input.userId, { quantity: input.quantity ?? 1, kind: input.kind });
  const quote = quoteSubmit(input);
  const idempotencyKey = input.clientRequestId
    ? submitIdempotencyKey(input.userId, input.clientRequestId)
    : `submit:${input.userId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const charge = reserveForJob({
    userId: input.userId,
    kind: input.kind,
    credits: quote.credits,
    quote: { ...quote, jobId: null },
    estimatedCostCents: quote.estimatedCostCents,
    idempotencyKey,
  });
  return { charge, quote };
}

export function attachJobToCharge(chargeId: string, jobId: string) {
  attachChargeToJob(chargeId, jobId);
}

/** Creation reached a terminal state: apply the configured refund policy once. */
export function completeJobCharge(jobId: string, input: {
  status: "succeeded" | "failed" | "canceled";
  errorText?: string | null;
  stage?: FailureStage;
  provider?: string;
  actualCostCents?: number | null;
  /**
   * Set when the caller already knows the business reason (a worker timeout on an
   * unresolved upstream state, for example) and keyword matching would guess wrong.
   */
  failureClass?: FailureClass;
}): { charge: TaskCharge | null; failureClass: FailureClass | null; refunded: number; userMessage: string } {
  const charge = getChargeByJob(jobId);
  if (!charge) return { charge: null, failureClass: null, refunded: 0, userMessage: "" };
  if (charge.status === "settled" || charge.status === "refunded" || charge.status === "voided") {
    return { charge, failureClass: charge.failureClass as FailureClass | null, refunded: 0, userMessage: charge.status === "refunded" ? userMessageFor((charge.failureClass as FailureClass) || "unknown") : "" };
  }
  if (input.status === "succeeded") {
    settleCharge(charge.id, { actualCostCents: input.actualCostCents ?? null, provider: input.provider });
    return { charge: getCharge(charge.id), failureClass: null, refunded: 0, userMessage: "" };
  }

  const failureClass = input.status === "canceled"
    ? "user_cancel"
    : input.failureClass || classifyFailure(input.errorText, input.stage || "processing");
  const action = resolveFailureChargeAction(failureClass);
  let refunded = 0;
  if (action === "void") {
    voidCharge(charge.id, userMessageFor(failureClass));
  } else if (action === "refund") {
    refunded = refundCharge(charge.id, { failureClass, note: userMessageFor(failureClass) }).refunded;
  } else {
    writeTransaction(() => {
      db.prepare("UPDATE task_charges SET failure_class=?, updated_at=? WHERE id=? AND status='reserved'")
        .run(failureClass, new Date().toISOString(), charge.id);
    });
  }
  return { charge: getCharge(charge.id), failureClass, refunded, userMessage: userMessageFor(failureClass) };
}

/** Synchronous submit failure: the creation never started upstream. */
export function failSubmitCharge(chargeId: string, errorText: string, jobId?: string | null): { failureClass: FailureClass; refunded: number; userMessage: string } {
  const failureClass = classifyFailure(errorText, "submit");
  const action = resolveFailureChargeAction(failureClass);
  let refunded = 0;
  if (action === "void" || failureClass === "platform" || failureClass === "provider") {
    // Nothing was produced: give the credits back (void keeps the row as never-charged).
    refunded = action === "void" ? (voidCharge(chargeId, userMessageFor(failureClass)) ? getCharge(chargeId)?.credits ?? 0 : 0) : refundCharge(chargeId, { failureClass, note: userMessageFor(failureClass) }).refunded;
  } else {
    refundCharge(chargeId, { failureClass, note: userMessageFor(failureClass) });
    refunded = getCharge(chargeId)?.credits ?? 0;
  }
  if (jobId) {
    writeTransaction(() => {
      db.prepare("UPDATE task_charges SET failure_class=? WHERE id=?").run(failureClass, chargeId);
    });
  }
  return { failureClass, refunded, userMessage: userMessageFor(failureClass) };
}

export function chargeSummaryForUser(userId: string) {
  const rows = db.prepare(`SELECT status, COUNT(*) AS c, COALESCE(SUM(credits),0) AS credits FROM task_charges WHERE user_id=? GROUP BY status`).all(userId) as any[];
  const summary: Record<string, { count: number; credits: number }> = {};
  for (const row of rows) summary[row.status] = { count: Number(row.c || 0), credits: Number(row.credits || 0) };
  return summary;
}

export function assertBatchAffordable(userId: string, kind: string, jobInput: Record<string, unknown>, quantity: number): CreditQuote {
  assertCanCreate(userId);
  const count = Math.max(1, Math.floor(quantity));
  const quote = quoteForJob(kind, { ...jobInput, count });
  // Insufficient credits is the more actionable answer, so it is decided first; the cost
  // guard then approves the whole submission as one unit.
  ensureSufficientCredits(userId, quote.credits, `本次需要 ${quote.credits} 个创作额度，当前额度不足`);
  assertSubmitAllowed(userId, { quantity: count, kind });
  return quote;
}

export { getCharge, getChargeByJob };
