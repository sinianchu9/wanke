import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { writeAudit } from "@/lib/admin";
import { describeError } from "@/lib/errors";
import { getPricingRule, listPricingRules, upsertPricingRule } from "@/lib/billing/pricing";
import { getNumberSetting, setSetting } from "@/lib/system-settings";
import { creditUnitValueCents } from "@/lib/billing/costs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  jobKind: z.string().default("*"),
  baseCredits: z.number().min(0).default(0),
  perSecondCredits: z.number().min(0).default(1),
  modelCreditsPerSecond: z.record(z.string(), z.number().min(0)).default({}),
  minCredits: z.number().min(0).default(1),
  maxCreditsPerUnit: z.number().min(1).default(2000),
  resolutionMultiplier: z.record(z.string(), z.number().min(0)).optional(),
  modelCostsPerSecondCents: z.record(z.string(), z.number().min(0)).optional(),
  note: z.string().max(200).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const rules = listPricingRules();
    const defaultRule = getPricingRule("*");
    const costs = {
      wan3_cost_cents_per_second: getNumberSetting("cost_wan3_per_second_cents", 15),
      happyhorse_cost_cents_per_second: getNumberSetting("cost_happyhorse_per_second_cents", 10),
      default_cost_cents_per_second: getNumberSetting("cost_per_video_second_cents", 10),
    };
    const creditUnit = creditUnitValueCents();
    return NextResponse.json({ ok: true, rules, defaultRule, costs, creditUnit });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const input = schema.parse(body);

    const rule = upsertPricingRule({
      jobKind: input.jobKind,
      baseCredits: input.baseCredits,
      perSecondCredits: input.perSecondCredits,
      modelCreditsPerSecond: input.modelCreditsPerSecond,
      minCredits: input.minCredits,
      maxCreditsPerUnit: input.maxCreditsPerUnit,
      resolutionMultiplier: input.resolutionMultiplier,
      enabled: input.enabled,
      note: input.note,
    });

    if (input.modelCostsPerSecondCents) {
      if (input.modelCostsPerSecondCents["wan3.0"] !== undefined) {
        setSetting("cost_wan3_per_second_cents", String(Math.round(input.modelCostsPerSecondCents["wan3.0"])));
      }
      if (input.modelCostsPerSecondCents["happyhorse-1.1"] !== undefined) {
        setSetting("cost_happyhorse_per_second_cents", String(Math.round(input.modelCostsPerSecondCents["happyhorse-1.1"])));
      }
      if (input.modelCostsPerSecondCents["default"] !== undefined) {
        setSetting("cost_per_video_second_cents", String(Math.round(input.modelCostsPerSecondCents["default"])));
      }
    }

    writeAudit(admin.id, "pricing_rules.update", "pricing", input.jobKind, {
      baseCredits: input.baseCredits,
      modelCreditsPerSecond: input.modelCreditsPerSecond,
      modelCostsPerSecondCents: input.modelCostsPerSecondCents,
      perSecondCredits: input.perSecondCredits,
    });

    const costs = {
      wan3_cost_cents_per_second: getNumberSetting("cost_wan3_per_second_cents", 15),
      happyhorse_cost_cents_per_second: getNumberSetting("cost_happyhorse_per_second_cents", 10),
      default_cost_cents_per_second: getNumberSetting("cost_per_video_second_cents", 10),
    };
    const creditUnit = creditUnitValueCents();

    return NextResponse.json({
      ok: true,
      rule,
      defaultRule: getPricingRule("*"),
      rules: listPricingRules(),
      costs,
      creditUnit,
    });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map(i => i.message).join("；") }, { status: 400 });
    }
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
