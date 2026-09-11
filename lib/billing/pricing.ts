import "server-only";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { JOB_KINDS, JOB_KIND_LABELS, type JobKind } from "@/lib/types";

/**
 * Creation-credit pricing (积分计费定价体系).
 * Operators configure the rules; users see the estimated credits before they submit.
 *
 * 核心升级：以秒为单位按模型独立定价（如 Wan 3.0、HappyHorse 1.1 分别定价），定价以积分计价。
 */

export interface PricingRule {
  jobKind: string;
  baseCredits: number;
  perSecondCredits: number;
  modelCreditsPerSecond: Record<string, number>;
  perMinuteCredits: number;
  minCredits: number;
  maxCreditsPerUnit: number;
  resolutionMultiplier: Record<string, number>;
  quantityFields: string[];
  durationFields: string[];
  resolutionFields: string[];
  estimatedCostCentsPerUnit: number;
  enabled: boolean;
  note: string;
  updatedAt: string;
}

export interface QuoteBreakdownItem {
  label: string;
  credits: number;
}

export interface CreditQuote {
  jobKind: JobKind | string;
  jobKindLabel: string;
  credits: number;
  quantity: number;
  perUnitCredits: number;
  estimatedCostCents: number;
  breakdown: QuoteBreakdownItem[];
  ruleJobKind: string;
}

export const DEFAULT_MODEL_CREDITS_PER_SECOND: Record<string, number> = {
  "wan3.0": 1,
  "happyhorse-1.1": 2,
  "default": 1,
};

const DEFAULT_RULE_BODY = {
  perSecondCredits: 1,
  modelCreditsPerSecond: DEFAULT_MODEL_CREDITS_PER_SECOND,
  perMinuteCredits: 0,
  minCredits: 1,
  maxCreditsPerUnit: 2000,
  resolutionMultiplier: {
    "480p": 0.8,
    "720p": 1.0,
    "1080p": 1.0,
    "2k": 1.5,
    "4k": 2.0,
  } as Record<string, number>,
  quantityFields: ["count", "batchSize", "shots", "variants"],
  durationFields: ["durationSeconds", "duration", "videoDuration", "targetDuration"],
  resolutionFields: ["resolution", "quality", "size", "videoResolution"],
  estimatedCostCentsPerUnit: 0,
};

function parseRule(row: any): PricingRule {
  let body: any = {};
  try { body = JSON.parse(row.rule_json || "{}"); } catch { body = {}; }
  return {
    jobKind: row.job_kind,
    baseCredits: Number(row.base_credits ?? 0),
    perSecondCredits: Number(body.perSecondCredits ?? DEFAULT_RULE_BODY.perSecondCredits),
    modelCreditsPerSecond: body.modelCreditsPerSecond && typeof body.modelCreditsPerSecond === "object"
      ? { ...DEFAULT_MODEL_CREDITS_PER_SECOND, ...body.modelCreditsPerSecond }
      : { ...DEFAULT_MODEL_CREDITS_PER_SECOND },
    perMinuteCredits: Number(body.perMinuteCredits ?? 0),
    minCredits: Number(body.minCredits ?? DEFAULT_RULE_BODY.minCredits),
    maxCreditsPerUnit: Number(body.maxCreditsPerUnit ?? DEFAULT_RULE_BODY.maxCreditsPerUnit),
    resolutionMultiplier: body.resolutionMultiplier && typeof body.resolutionMultiplier === "object"
      ? body.resolutionMultiplier
      : { ...DEFAULT_RULE_BODY.resolutionMultiplier },
    quantityFields: Array.isArray(body.quantityFields) ? body.quantityFields : DEFAULT_RULE_BODY.quantityFields,
    durationFields: Array.isArray(body.durationFields) ? body.durationFields : DEFAULT_RULE_BODY.durationFields,
    resolutionFields: Array.isArray(body.resolutionFields) ? body.resolutionFields : DEFAULT_RULE_BODY.resolutionFields,
    estimatedCostCentsPerUnit: Number(body.estimatedCostCentsPerUnit ?? 0),
    enabled: Boolean(row.enabled),
    note: row.note || "",
    updatedAt: row.updated_at,
  };
}

export function listPricingRules(): PricingRule[] {
  const rows = db.prepare("SELECT * FROM pricing_rules ORDER BY CASE WHEN job_kind='*' THEN 1 ELSE 0 END, job_kind ASC").all() as any[];
  return rows.map(parseRule);
}

export function getPricingRule(jobKind: string): PricingRule {
  const specific = db.prepare("SELECT * FROM pricing_rules WHERE job_kind=?").get(jobKind) as any;
  if (specific && specific.enabled) return parseRule(specific);
  const fallback = db.prepare("SELECT * FROM pricing_rules WHERE job_kind='*'").get() as any;
  if (fallback) return parseRule(fallback);
  return { jobKind: "*", baseCredits: 0, ...DEFAULT_RULE_BODY, enabled: true, note: "内置默认规则", updatedAt: new Date().toISOString() };
}

export function upsertPricingRule(input: {
  jobKind: string;
  baseCredits: number;
  perSecondCredits?: number;
  modelCreditsPerSecond?: Record<string, number>;
  perMinuteCredits?: number;
  minCredits?: number;
  maxCreditsPerUnit?: number;
  resolutionMultiplier?: Record<string, number>;
  estimatedCostCentsPerUnit?: number;
  enabled?: boolean;
  note?: string;
}): PricingRule {
  const jobKind = input.jobKind.trim();
  if (jobKind !== "*" && !(JOB_KINDS as readonly string[]).includes(jobKind)) {
    throw new HttpError(400, "INVALID_JOB_KIND", "未知的创作类型");
  }
  if (input.baseCredits < 0 || (input.minCredits ?? 0) < 0) throw new HttpError(400, "INVALID_RULE", "创作额度不能为负数");
  const body = {
    perSecondCredits: Math.max(0, Number(input.perSecondCredits ?? DEFAULT_RULE_BODY.perSecondCredits)),
    modelCreditsPerSecond: input.modelCreditsPerSecond || DEFAULT_MODEL_CREDITS_PER_SECOND,
    perMinuteCredits: Math.max(0, Number(input.perMinuteCredits ?? 0)),
    minCredits: Math.max(0, Math.round(input.minCredits ?? DEFAULT_RULE_BODY.minCredits)),
    maxCreditsPerUnit: Math.max(1, Math.round(input.maxCreditsPerUnit ?? DEFAULT_RULE_BODY.maxCreditsPerUnit)),
    resolutionMultiplier: input.resolutionMultiplier ?? DEFAULT_RULE_BODY.resolutionMultiplier,
    quantityFields: DEFAULT_RULE_BODY.quantityFields,
    durationFields: DEFAULT_RULE_BODY.durationFields,
    resolutionFields: DEFAULT_RULE_BODY.resolutionFields,
    estimatedCostCentsPerUnit: Math.max(0, Math.round(input.estimatedCostCentsPerUnit ?? 0)),
  };
  db.prepare(`INSERT INTO pricing_rules (job_kind, base_credits, rule_json, enabled, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_kind) DO UPDATE SET base_credits=excluded.base_credits, rule_json=excluded.rule_json,
      enabled=excluded.enabled, note=excluded.note, updated_at=excluded.updated_at`)
    .run(jobKind, Math.max(0, Math.round(input.baseCredits)), JSON.stringify(body),
      input.enabled === false ? 0 : 1, (input.note || "").trim(), new Date().toISOString());
  return getPricingRule(jobKind);
}

function readNumber(input: Record<string, unknown>, fields: string[]): number {
  for (const field of fields) {
    const raw = input[field];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.\-]/g, ""));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function readResolution(input: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const raw = input[field];
    if (typeof raw === "string" && raw.trim()) return raw.trim().toLowerCase();
  }
  return "";
}

export function readModelKey(input: Record<string, unknown>, durationSeconds: number): { key: string; label: string } {
  const fields = ["model", "preferredModel", "videoModel", "route", "shotModel"];
  for (const field of fields) {
    const raw = input[field];
    if (typeof raw === "string" && raw.trim() && raw.trim() !== "auto") {
      const lower = raw.trim().toLowerCase();
      if (lower.includes("happyhorse")) return { key: "happyhorse-1.1", label: "HappyHorse 1.1" };
      if (lower.includes("wan")) return { key: "wan3.0", label: "Wan 3.0" };
      return { key: raw.trim(), label: raw.trim() };
    }
  }
  // 智能/自动推荐：超长（>15s）自动路由 Wan 3.0，其余优先 HappyHorse 1.1
  if (durationSeconds > 15) return { key: "wan3.0", label: "Wan 3.0" };
  return { key: "happyhorse-1.1", label: "HappyHorse 1.1" };
}

function getModelRate(rule: PricingRule, modelKey: string): number {
  const map = rule.modelCreditsPerSecond || {};
  if (typeof map[modelKey] === "number" && map[modelKey] >= 0) return map[modelKey];
  const matched = Object.keys(map).find(k => modelKey.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(modelKey.toLowerCase()));
  if (matched && typeof map[matched] === "number" && map[matched] >= 0) return map[matched];
  if (typeof map["default"] === "number" && map["default"] >= 0) return map["default"];
  return typeof rule.perSecondCredits === "number" && rule.perSecondCredits >= 0 ? rule.perSecondCredits : 1;
}

function multiplierFor(rule: PricingRule, resolution: string): { multiplier: number; label: string } {
  if (!resolution) return { multiplier: 1, label: "" };
  const table = rule.resolutionMultiplier;
  const direct = table[resolution];
  if (typeof direct === "number" && direct > 0) return { multiplier: direct, label: resolution.toUpperCase() };
  const matchedKey = Object.keys(table).find(key => resolution.includes(key) || key.includes(resolution));
  if (matchedKey && typeof table[matchedKey] === "number" && table[matchedKey] > 0) {
    return { multiplier: table[matchedKey], label: matchedKey.toUpperCase() };
  }
  return { multiplier: 1, label: "" };
}

/** Deterministic pre-submit quote. Must never touch the network or the provider. */
export function quoteForJob(jobKind: string, input: Record<string, unknown> = {}): CreditQuote {
  const rule = getPricingRule(jobKind);
  const quantity = Math.max(1, Math.min(50, Math.floor(readNumber(input, rule.quantityFields) || 1)));
  let durationSeconds = readNumber(input, rule.durationFields);
  const isVideoJob = jobKind.includes("video") || jobKind === "storyboard";
  if (isVideoJob && durationSeconds <= 0) {
    durationSeconds = 5; // 视频生成未指定时长时，按标准 5 秒计算
  }

  const { key: modelKey, label: modelLabel } = readModelKey(input, durationSeconds);
  const ratePerSecond = getModelRate(rule, modelKey);
  const resolution = readResolution(input, rule.resolutionFields);
  const { multiplier, label } = multiplierFor(rule, resolution);

  const breakdown: QuoteBreakdownItem[] = [];
  let perUnit = rule.baseCredits;
  if (rule.baseCredits > 0) {
    breakdown.push({ label: `${JOB_KIND_LABELS[jobKind as JobKind] || jobKind}基础消耗`, credits: rule.baseCredits });
  }

  if (durationSeconds > 0) {
    const durationCredits = Math.ceil(durationSeconds * ratePerSecond);
    perUnit += durationCredits;
    breakdown.push({
      label: `${modelLabel}（${ratePerSecond} 积分/秒 × ${Math.round(durationSeconds)} 秒）`,
      credits: durationCredits,
    });
  } else if (rule.perMinuteCredits > 0) {
    const durationCredits = Math.ceil((durationSeconds / 60) * rule.perMinuteCredits);
    perUnit += durationCredits;
    if (durationCredits > 0) breakdown.push({ label: `时长 ${Math.round(durationSeconds)} 秒`, credits: durationCredits });
  }

  if (multiplier !== 1) {
    const before = perUnit;
    perUnit = Math.ceil(perUnit * multiplier);
    breakdown.push({ label: `清晰度 ${label}`, credits: perUnit - before });
  }
  perUnit = Math.max(rule.minCredits, Math.min(rule.maxCreditsPerUnit, Math.ceil(perUnit)));
  const credits = Math.max(0, Math.min(99999, perUnit * quantity));
  if (quantity > 1) breakdown.push({ label: `生成数量 × ${quantity}`, credits: credits - perUnit });

  return {
    jobKind,
    jobKindLabel: JOB_KIND_LABELS[jobKind as JobKind] || jobKind,
    credits,
    quantity,
    perUnitCredits: perUnit,
    estimatedCostCents: Math.round(rule.estimatedCostCentsPerUnit * quantity),
    breakdown: breakdown.filter(item => item.credits !== 0),
    ruleJobKind: rule.jobKind,
  };
}

/** Quote a whole batch (quick wizard / storyboard) as one submission. */
export function quoteForBatch(jobKind: string, input: Record<string, unknown>, quantity: number): CreditQuote {
  return quoteForJob(jobKind, { ...input, count: Math.max(1, Math.floor(quantity)) });
}
