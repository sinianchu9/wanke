import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { quoteSubmit } from "@/lib/billing/charges";
import { readBalance } from "@/lib/billing/quota";
import { JOB_KINDS } from "@/lib/types";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.enum(JOB_KINDS),
  input: z.record(z.string(), z.unknown()).optional(),
  quantity: z.number().int().min(1).max(50).optional(),
});

/** Pre-submit quote: every creation button shows the cost before the member commits. */
export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const input = schema.parse(await request.json());
    const quote = quoteSubmit({ userId: user.id, kind: input.kind, jobInput: input.input || {}, quantity: input.quantity });
    const balance = readBalance(user.id);
    return NextResponse.json({
      quote: {
        credits: quote.credits,
        label: quote.jobKindLabel,
        breakdown: quote.breakdown,
        quantity: quote.quantity,
      },
      available: balance?.available ?? 0,
      sufficient: (balance?.available ?? 0) >= quote.credits,
    });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
