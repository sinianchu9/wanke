import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { writeAudit } from "@/lib/admin";
import { listPlans, publicPlanView, setPlanRecommended, upsertPlan } from "@/lib/billing/catalog";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().min(2).max(40),
  kind: z.enum(["membership", "quota_pack"]),
  name: z.string().min(1).max(60),
  subtitle: z.string().max(160).optional(),
  priceCents: z.number().int().min(0),
  originalPriceCents: z.number().int().min(0).optional(),
  credits: z.number().int().min(0),
  validityDays: z.number().int().min(1).max(3650),
  features: z.array(z.string().max(80)).max(12).optional(),
  maxConcurrentJobs: z.number().int().min(0).max(100).optional(),
  maxAssetMb: z.number().int().min(0).max(1_000_000).optional(),
  maxWorks: z.number().int().min(0).max(1_000_000).optional(),
  maxResolution: z.string().max(20).optional(),
  purchasable: z.boolean().optional(),
  recommended: z.boolean().optional(),
  public: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json({ plans: listPlans({ includeArchived: true }).map(publicPlanView) });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = requireAdmin(request);
    const input = schema.parse(await request.json());
    const plan = upsertPlan(input);
    writeAudit(admin.id, "plan.upsert", "plan", plan.id, {
      name: plan.name, priceCents: plan.priceCents, credits: plan.credits, validityDays: plan.validityDays, status: plan.status,
    });
    return NextResponse.json({ ok: true, plan: publicPlanView(plan), plans: listPlans({ includeArchived: true }).map(publicPlanView) });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = requireAdmin(request);
    const input = z.object({ id: z.string().min(2).max(40), recommended: z.boolean() }).parse(await request.json());
    const plan = setPlanRecommended(input.id, input.recommended);
    writeAudit(admin.id, "plan.recommend", "plan", plan.id, { recommended: plan.recommended });
    return NextResponse.json({ ok: true, plans: listPlans({ includeArchived: true }).map(publicPlanView) });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
