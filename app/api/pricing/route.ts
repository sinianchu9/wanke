import { NextResponse } from "next/server";
import { getPricingRule } from "@/lib/billing/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rule = getPricingRule("video_generation");
  return NextResponse.json({
    ok: true,
    modelCreditsPerSecond: rule.modelCreditsPerSecond || {
      "wan3.0": 2,
      "happyhorse-1.1": 1,
      default: 1,
    },
    baseCredits: rule.baseCredits || 0,
    minCredits: rule.minCredits || 1,
    resolutionMultiplier: rule.resolutionMultiplier || {
      "480p": 0.8,
      "720p": 1.0,
      "1080p": 1.0,
      "2k": 1.5,
      "4k": 2.0,
    },
  });
}
