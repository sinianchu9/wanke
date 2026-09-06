import "server-only";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { JOB_KINDS, JOB_KIND_LABELS, type JobKind } from "@/lib/types";

/**
 * Creation-credit pricing. Operators configure the rules; users only ever see the
 * resulting number ("本次预计消耗 N 个创作额度") before they submit.
 *
 * Defaults are seeded at 1 credit per creation so the commercial rollout does not
 * change what existing users pay until a rule is tuned in the backoffice.
 */

export interface PricingRule {
  jobKind: string;
  baseCredits: number;
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

const DEFAULT_RULE_BODY = {
  perMinuteCredits: 0,
  minCredits: 1,
  maxCreditsPerUnit: 20,
  resolutionMultiplier: {} as Record<string, number>,
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
    baseCredits: Number(row.base_credits ?? 1),
    perMinuteCredits: Number(body.perMinuteCredits ?? DEFAULT_RULE_BODY.perMinuteCredits),
    minCredits: Number(body.minCredits ?? DEFAULT_RULE_BODY.minCredits),
    maxCreditsPerUnit: Number(body.maxCreditsPerUnit ?? DEFAULT_RULE_BODY.maxCreditsPerUnit),
    resolutionMultiplier: body.resolutionMultiplier && typeof body.resolutionMultiplier === "object" ? body.resolutionMultiplier : {},
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
  return { jobKind: "*", baseCredits: 1, ...DEFAULT_RULE_BODY, enabled: true, note: "内置默认规则", updatedAt: new Date().toISOString() };
}

export function upsertPricingRule(input: {
  jobKind: string;
  baseCredits: number;
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
    perMinuteCredits: Math.max(0, Number(input.perMinuteCredits ?? DEFAULT_RULE_BODY.perMinuteCredits)),
    minCredits: Math.max(0, Math.round(input.minCredits ?? DEFAULT_RULE_BODY.minCredits)),
    maxCreditsPerUnit: Math.max(1, Math.round(input.maxCreditsPerUnit ?? DEFAULT_RULE_BODY.maxCreditsPerUnit)),
    resolutionMultiplier: input.resolutionMultiplier ?? {},
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
  const durationSeconds = readNumber(input, rule.durationFields);
  const resolution = readResolution(input, rule.resolutionFields);
  const { multiplier, label } = multiplierFor(rule, resolution);

  const breakdown: QuoteBreakdownItem[] = [];
  let perUnit = rule.baseCredits;
  if (rule.baseCredits > 0) breakdown.push({ label: `${JOB_KIND_LABELS[jobKind as JobKind] || jobKind}基础消耗`, credits: rule.baseCredits });
  if (durationSeconds > 0 && rule.perMinuteCredits > 0) {
    const durationCredits = Math.ceil((durationSeconds / 60) * rule.perMinuteCredits);
    perUnit += durationCredits;
    breakdown.push({ label: `时长 ${Math.round(durationSeconds)} 秒`, credits: durationCredits });
  }
  if (multiplier !== 1) {
    const before = perUnit;
    perUnit = Math.ceil(perUnit * multiplier);
    breakdown.push({ label: `清晰度 ${label}`, credits: perUnit - before });
  }
  perUnit = Math.max(rule.minCredits, Math.min(rule.maxCreditsPerUnit, Math.ceil(perUnit)));
  const credits = Math.max(0, Math.min(9999, perUnit * quantity));
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
