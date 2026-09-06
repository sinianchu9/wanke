import "server-only";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/auth";

/**
 * Commercial catalog: the single source of truth for plans and credit packs.
 *
 * The landing page, member center, checkout, order creation and the backoffice all
 * read from here. Nothing price-related may be hardcoded in React any more.
 */

export type PlanKind = "membership" | "quota_pack";

export interface Plan {
  id: string;
  kind: PlanKind;
  name: string;
  subtitle: string;
  priceCents: number;
  originalPriceCents: number;
  credits: number;
  validityDays: number;
  features: string[];
  maxConcurrentJobs: number;
  maxAssetMb: number;
  maxWorks: number;
  maxResolution: string;
  purchasable: boolean;
  recommended: boolean;
  public: boolean;
  sortOrder: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

/** Snapshot frozen onto an order so later price changes never rewrite history. */
export interface PlanSnapshot {
  planId: string;
  kind: PlanKind;
  name: string;
  subtitle: string;
  priceCents: number;
  originalPriceCents: number;
  credits: number;
  validityDays: number;
  features: string[];
  maxConcurrentJobs: number;
  maxAssetMb: number;
  maxWorks: number;
  maxResolution: string;
  snapshotAt: string;
}

function parseFeatures(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : [];
  } catch {
    return [];
  }
}

function rowToPlan(row: any): Plan {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    subtitle: row.subtitle || "",
    priceCents: Number(row.price_cents || 0),
    originalPriceCents: Number(row.original_price_cents || 0),
    credits: Number(row.credits || 0),
    validityDays: Number(row.validity_days || 0),
    features: parseFeatures(row.features_json),
    maxConcurrentJobs: Number(row.max_concurrent_jobs || 0),
    maxAssetMb: Number(row.max_asset_mb || 0),
    maxWorks: Number(row.max_works || 0),
    maxResolution: row.max_resolution || "",
    purchasable: Boolean(row.purchasable),
    recommended: Boolean(row.recommended),
    public: Boolean(row.public),
    sortOrder: Number(row.sort_order || 0),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPlans(filter: { kind?: PlanKind; includeArchived?: boolean; publicOnly?: boolean } = {}): Plan[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.kind) { where.push("kind = ?"); params.push(filter.kind); }
  if (!filter.includeArchived) where.push("status = 'active'");
  if (filter.publicOnly) where.push("public = 1");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return (db.prepare(`SELECT * FROM plans ${whereSql} ORDER BY sort_order ASC, price_cents ASC`).all(...params) as any[]).map(rowToPlan);
}

export function getPlan(id: string): Plan | null {
  const row = db.prepare("SELECT * FROM plans WHERE id=?").get(id);
  return row ? rowToPlan(row) : null;
}

export function requirePurchasablePlan(id: string): Plan {
  const plan = getPlan(id);
  if (!plan || plan.status !== "active") throw new HttpError(404, "PLAN_NOT_FOUND", "该套餐已经下架，请重新选择");
  if (!plan.purchasable) throw new HttpError(400, "PLAN_NOT_PURCHASABLE", "该套餐当前不支持购买");
  return plan;
}

export function getFreePlan(): Plan {
  return getPlan("free") || listPlans({ kind: "membership" }).find(plan => plan.priceCents === 0) || fallbackFreePlan();
}

function fallbackFreePlan(): Plan {
  // Only reachable on a database whose catalog was emptied by an operator. Keep the
  // product usable (free tier) instead of failing every registration.
  const now = new Date().toISOString();
  return {
    id: "free", kind: "membership", name: "免费版", subtitle: "体验完整的 AI 视频创作",
    priceCents: 0, originalPriceCents: 0, credits: 10, validityDays: 30,
    features: ["每月 10 个创作额度"], maxConcurrentJobs: 1, maxAssetMb: 512, maxWorks: 50,
    maxResolution: "720p", purchasable: false, recommended: false, public: true, sortOrder: 0,
    status: "active", createdAt: now, updatedAt: now,
  };
}

export function planSnapshot(plan: Plan): PlanSnapshot {
  return {
    planId: plan.id, kind: plan.kind, name: plan.name, subtitle: plan.subtitle,
    priceCents: plan.priceCents, originalPriceCents: plan.originalPriceCents,
    credits: plan.credits, validityDays: plan.validityDays, features: plan.features,
    maxConcurrentJobs: plan.maxConcurrentJobs, maxAssetMb: plan.maxAssetMb,
    maxWorks: plan.maxWorks, maxResolution: plan.maxResolution,
    snapshotAt: new Date().toISOString(),
  };
}

/** Shape sent to browsers: business language + integer cents, no internal enums. */
export function publicPlanView(plan: Plan) {
  return {
    id: plan.id,
    kind: plan.kind,
    name: plan.name,
    subtitle: plan.subtitle,
    priceCents: plan.priceCents,
    priceText: plan.priceCents === 0 ? "免费" : formatCents(plan.priceCents),
    originalPriceText: plan.originalPriceCents > plan.priceCents ? formatCents(plan.originalPriceCents) : "",
    credits: plan.credits,
    validityDays: plan.validityDays,
    features: plan.features,
    recommended: plan.recommended,
    purchasable: plan.purchasable,
    maxResolution: plan.maxResolution,
    maxConcurrentJobs: plan.maxConcurrentJobs,
  };
}

export function formatCents(cents: number): string {
  const value = Math.round(cents) / 100;
  return `¥${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
}

export interface PlanUpsertInput {
  id: string;
  kind: PlanKind;
  name: string;
  subtitle?: string;
  priceCents: number;
  originalPriceCents?: number;
  credits: number;
  validityDays: number;
  features?: string[];
  maxConcurrentJobs?: number;
  maxAssetMb?: number;
  maxWorks?: number;
  maxResolution?: string;
  purchasable?: boolean;
  recommended?: boolean;
  public?: boolean;
  sortOrder?: number;
  status?: "active" | "archived";
}

export function upsertPlan(input: PlanUpsertInput): Plan {
  const id = input.id.trim();
  if (!/^[a-z0-9_]{2,40}$/i.test(id)) throw new HttpError(400, "INVALID_PLAN_ID", "套餐编号只能包含字母、数字和下划线");
  if (input.priceCents < 0) throw new HttpError(400, "INVALID_PRICE", "价格不能为负数");
  if (input.credits < 0) throw new HttpError(400, "INVALID_CREDITS", "创作额度不能为负数");
  if (input.validityDays < 1) throw new HttpError(400, "INVALID_VALIDITY", "有效天数至少为 1 天");
  const now = new Date().toISOString();
  const payload = {
    id,
    kind: input.kind,
    name: input.name.trim(),
    subtitle: (input.subtitle || "").trim(),
    priceCents: Math.round(input.priceCents),
    originalPriceCents: Math.round(input.originalPriceCents ?? input.priceCents),
    credits: Math.round(input.credits),
    validityDays: Math.round(input.validityDays),
    featuresJson: JSON.stringify(input.features || []),
    maxConcurrentJobs: Math.max(0, Math.round(input.maxConcurrentJobs ?? 2)),
    maxAssetMb: Math.max(0, Math.round(input.maxAssetMb ?? 512)),
    maxWorks: Math.max(0, Math.round(input.maxWorks ?? 100)),
    maxResolution: (input.maxResolution || "").trim(),
    purchasable: input.purchasable === false ? 0 : 1,
    recommended: input.recommended ? 1 : 0,
    public: input.public === false ? 0 : 1,
    sortOrder: Math.round(input.sortOrder ?? 100),
    status: input.status === "archived" ? "archived" : "active",
    now,
  };
  db.prepare(`INSERT INTO plans
    (id, kind, name, subtitle, price_cents, original_price_cents, credits, validity_days, features_json,
     max_concurrent_jobs, max_asset_mb, max_works, max_resolution, purchasable, recommended, public, sort_order,
     status, created_at, updated_at)
    VALUES (@id, @kind, @name, @subtitle, @priceCents, @originalPriceCents, @credits, @validityDays, @featuresJson,
     @maxConcurrentJobs, @maxAssetMb, @maxWorks, @maxResolution, @purchasable, @recommended, @public, @sortOrder,
     @status, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      kind=excluded.kind, name=excluded.name, subtitle=excluded.subtitle, price_cents=excluded.price_cents,
      original_price_cents=excluded.original_price_cents, credits=excluded.credits, validity_days=excluded.validity_days,
      features_json=excluded.features_json, max_concurrent_jobs=excluded.max_concurrent_jobs,
      max_asset_mb=excluded.max_asset_mb, max_works=excluded.max_works, max_resolution=excluded.max_resolution,
      purchasable=excluded.purchasable, recommended=excluded.recommended, public=excluded.public,
      sort_order=excluded.sort_order, status=excluded.status, updated_at=excluded.updated_at`)
    .run(payload);
  return getPlan(id)!;
}

/**
 * Only the recommended flag is a safe quick toggle: recommended plans must stay
 * purchasable and public so the landing page never advertises a dead product.
 */
export function setPlanRecommended(id: string, recommended: boolean): Plan {
  const plan = getPlan(id);
  if (!plan) throw new HttpError(404, "PLAN_NOT_FOUND", "套餐不存在");
  if (recommended && (!plan.purchasable || !plan.public || plan.status !== "active")) {
    throw new HttpError(400, "PLAN_NOT_RECOMMENDABLE", "只有已上架且可购买的套餐才能设为推荐");
  }
  db.prepare("UPDATE plans SET recommended=?, updated_at=? WHERE id=?")
    .run(recommended ? 1 : 0, new Date().toISOString(), id);
  return getPlan(id)!;
}
