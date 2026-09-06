import type { JobKind, JobStatus } from "@/lib/types";

/**
 * Business language layer.
 *
 * Internal enums (`queued`, `running`, `succeeded`, provider errors, request ids) are
 * the data contract and stay untouched in the database. Everything a member can see
 * goes through this module, so the UI never leaks engineering vocabulary and never
 * invents a second meaning for the same state.
 */

export type BusinessJobStatus = "waiting" | "generating" | "processing" | "done" | "retry_needed" | "confirming" | "canceled";

export const JOB_STATUS_COPY: Record<JobStatus, string> = {
  queued: "等待开始",
  running: "正在生成",
  succeeded: "已完成",
  failed: "未完成",
  unknown: "状态确认中",
};

export const BUSINESS_JOB_STATUS_COPY: Record<BusinessJobStatus, string> = {
  waiting: "等待开始",
  generating: "正在生成",
  processing: "正在处理",
  done: "已完成",
  retry_needed: "需要重新尝试",
  confirming: "状态确认中",
  canceled: "已取消",
};

const PROCESSING_KINDS: JobKind[] = ["video_analysis", "remake_script"];

export interface BusinessJobState {
  code: BusinessJobStatus;
  label: string;
  hint: string;
  tone: "neutral" | "progress" | "success" | "attention";
  /** Internal status, for admins and diagnostics only. */
  internalStatus: JobStatus;
}

export function businessJobStatus(job: {
  status: JobStatus;
  kind: JobKind;
  error?: string | null;
  details?: Record<string, unknown> | null;
}): BusinessJobState {
  const internalStatus = job.status;
  if (job.details && (job.details as any).canceled === true) {
    return { code: "canceled", label: BUSINESS_JOB_STATUS_COPY.canceled, hint: "本次创作已经取消。", tone: "neutral", internalStatus };
  }
  switch (job.status) {
    case "queued":
      return { code: "waiting", label: BUSINESS_JOB_STATUS_COPY.waiting, hint: "已收到你的创作，正在排队开始。", tone: "neutral", internalStatus };
    case "running":
      return PROCESSING_KINDS.includes(job.kind)
        ? { code: "processing", label: BUSINESS_JOB_STATUS_COPY.processing, hint: "正在处理你的素材。", tone: "progress", internalStatus }
        : { code: "generating", label: BUSINESS_JOB_STATUS_COPY.generating, hint: "视频正在生成中，完成后会自动出现在作品与任务里。", tone: "progress", internalStatus };
    case "succeeded":
      return { code: "done", label: BUSINESS_JOB_STATUS_COPY.done, hint: "创作已经完成，可以查看或下载。", tone: "success", internalStatus };
    case "failed":
      return {
        code: "retry_needed",
        label: BUSINESS_JOB_STATUS_COPY.retry_needed,
        hint: publicErrorMessage(job.error) || "本次创作没有完成，可以重新尝试。",
        tone: "attention",
        internalStatus,
      };
    default:
      return { code: "confirming", label: BUSINESS_JOB_STATUS_COPY.confirming, hint: "创作结果正在确认，稍后会自动更新。", tone: "neutral", internalStatus };
  }
}

export const MEMBERSHIP_STATUS_COPY: Record<string, string> = {
  active: "生效中",
  expired: "已到期",
  suspended: "已暂停",
};

export const ACCOUNT_STATUS_COPY: Record<string, string> = {
  active: "正常",
  disabled: "暂停使用",
  closed: "已注销",
};

export const ORDER_STATUS_COPY: Record<string, { label: string; hint: string }> = {
  pending: { label: "待支付", hint: "订单已经创建，请在有效期内完成支付。" },
  paying: { label: "支付处理中", hint: "正在等待支付结果确认。" },
  paid: { label: "已支付", hint: "权益已经到账。" },
  closed: { label: "已关闭", hint: "订单超时未支付，已经自动关闭。" },
  canceled: { label: "已取消", hint: "订单已取消。" },
  partial_refund: { label: "部分退款", hint: "该订单已经完成部分退款。" },
  refunded: { label: "已退款", hint: "退款已经原路退回。" },
  abnormal: { label: "需要确认", hint: "该订单的支付结果需要人工确认，请联系客服。" },
};

export const PAYMENT_STATUS_COPY: Record<string, string> = {
  created: "等待支付",
  success: "支付成功",
  failed: "支付未完成",
  closed: "已关闭",
  abnormal: "需要确认",
};

/**
 * Payment result page copy (§10.3). A pending payment is never described as failed:
 * the money may already be on its way, and telling the member otherwise invites a
 * second payment for the same order.
 */
export const PAYMENT_RESULT_COPY: Record<string, {
  headline: string;
  hint: string;
  tone: "success" | "progress" | "neutral" | "attention";
  settled: boolean;
}> = {
  paid: {
    headline: "支付成功，权益已经到账",
    hint: "套餐或创作额度已经发放，可以直接开始创作。",
    tone: "success",
    settled: true,
  },
  pending: {
    headline: "正在确认支付结果……",
    hint: "付款完成后权益会自动到账，通常只需要几秒钟。这个页面会自动刷新，请不要重复付款。",
    tone: "progress",
    settled: false,
  },
  paying: {
    headline: "正在确认支付结果……",
    hint: "付款完成后权益会自动到账，通常只需要几秒钟。这个页面会自动刷新，请不要重复付款。",
    tone: "progress",
    settled: false,
  },
  closed: {
    headline: "订单已经关闭",
    hint: "这笔订单超时没有完成支付。如果还需要，请重新下单；已经付款的话请联系客服。",
    tone: "neutral",
    settled: true,
  },
  canceled: {
    headline: "订单已经取消",
    hint: "这笔订单已经取消，不会产生任何扣费。",
    tone: "neutral",
    settled: true,
  },
  partial_refund: {
    headline: "该订单已经完成部分退款",
    hint: "退款金额已经原路退回，可以在「我的订单」查看明细。",
    tone: "neutral",
    settled: true,
  },
  refunded: {
    headline: "该订单已经完成退款",
    hint: "退款金额已经原路退回，可以在「我的订单」查看明细。",
    tone: "neutral",
    settled: true,
  },
  abnormal: {
    headline: "支付结果需要人工确认",
    hint: "我们已经记录了这笔支付，客服会尽快与你联系处理。请不要重复付款。",
    tone: "attention",
    settled: true,
  },
};

export const REFUND_STATUS_COPY: Record<string, string> = {
  requested: "已提交，等待处理",
  approved: "已通过审核",
  processing: "退款处理中",
  succeeded: "退款已完成",
  failed: "退款未成功",
  rejected: "退款未通过",
};

export const TICKET_STATUS_COPY: Record<string, string> = {
  open: "待处理",
  processing: "处理中",
  waiting_user: "等待你的回复",
  resolved: "已解决",
  closed: "已关闭",
};

export const INVOICE_STATUS_COPY: Record<string, string> = {
  pending: "待处理",
  issued: "已开票",
  rejected: "未通过",
};

const TECHNICAL_PATTERN = /Provider|Endpoint|RequestId|Request Id|MediaId|API\b|API Root|JSON|SDK|Token Plan|Model Studio|Workspace|workspace|Throttling|InvalidParameter|DataInspection|InternalError|ServiceUnavailable|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket hang up|fetch failed|SQLITE|better-sqlite3|next\/server|at [A-Za-z0-9_$.]+\s*\(|\b[45]\d{2}\b|undefined|null is not|stack/i;

/**
 * Schema-validation output (`jobType: Invalid option: expected one of "text_to_video"|…`).
 * It names internal fields and enums, so it is never shown to a member; it also proves
 * the creation never started, which is how the credit rules classify it.
 */
const VALIDATION_PATTERN = /Invalid option|expected one of|Expected\s.*received|invalid_type|too_small|too_big|Unrecognized key(?:s)?|Invalid input|ZodError|\bschema\b|"\d*\.?\d*[a-z0-9]+(_[a-z0-9]+)+"/i;

const GENERIC_SERVICE_MESSAGE = "当前创作服务暂时繁忙，请稍后再试。";
const INPUT_INCOMPLETE_MESSAGE = "创作要求还没有填写完整，请检查后重新提交。";

/** True when the text is schema-validation output rather than a business message. */
export function isValidationMessage(text: unknown): boolean {
  return VALIDATION_PATTERN.test(String(text ?? ""));
}

/**
 * Turn any internal error into something a member can act on. Technical detail is
 * kept in the database and the backoffice, never forwarded to the browser.
 */
export function publicErrorMessage(error: unknown): string {
  if (!error) return "";
  const message = typeof error === "string" ? error : (error as Error)?.message || String(error);
  const trimmed = message.trim();
  if (!trimmed) return "";
  if (TECHNICAL_PATTERN.test(trimmed)) return GENERIC_SERVICE_MESSAGE;
  if (isValidationMessage(trimmed)) return INPUT_INCOMPLETE_MESSAGE;
  // Anything with a stack trace or long latin run is engineering output.
  if (/[A-Za-z]{12,}/.test(trimmed)) return GENERIC_SERVICE_MESSAGE;
  return trimmed;
}

export const QUOTA_INSUFFICIENT_MESSAGE = "当前创作额度不足。";
export const CREATION_INPUT_MESSAGE = INPUT_INCOMPLETE_MESSAGE;
export const SERVICE_BUSY_MESSAGE = GENERIC_SERVICE_MESSAGE;
export const FEATURE_UNAVAILABLE_MESSAGE = "当前该创作能力暂时不可用，请稍后再试。";
