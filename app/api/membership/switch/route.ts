import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { PLAN_IDS, switchPlan } from "@/lib/membership";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ plan: z.enum(PLAN_IDS) });

// Demo billing: simulated payment/switch. Replace with a real payment webhook later
// (see docs/SAAS.md "Billing extension point").
export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const input = schema.parse(await request.json());
    return NextResponse.json({ membership: switchPlan(user.id, input.plan) });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
