import { NextResponse } from "next/server";
import { runJobWorker, workerHealth } from "@/lib/worker";
import { describeError } from "@/lib/errors";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { writeAudit } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Backoffice view of the creation worker (§20/§46). An operator must be able to see that
 * creations keep moving with nobody's browser open, and must be able to see a stopped
 * worker, a growing backlog or a repeatedly failing upstream without reading server logs.
 */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json({ worker: workerHealth() });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

/** Run one worker pass now. Same code path as the unattended scheduler. */
export async function POST(request: Request) {
  try {
    const admin = requireAdmin(request);
    const result = await runJobWorker({ trigger: "admin" });
    writeAudit(admin.id, "worker.tick", "worker", "jobs", {
      processed: result.processed, succeeded: result.succeeded, failed: result.failed,
      settled: result.settled, refunded: result.refunded, timedOut: result.timedOut,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}
