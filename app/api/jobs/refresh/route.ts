import { NextResponse } from "next/server";
import { runJobWorker } from "@/lib/worker";
import { errorResponse, requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A member's browser may ask the server worker to run one pass early over their own
 * creations (§20). It does not schedule, poll or settle anything itself: the same worker
 * keeps every creation moving whether or not this endpoint is ever called, so closing
 * the tab, the laptop or the mobile network changes nothing.
 */
export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const isAdmin = user.role === "admin";
    // Admins keep the platform-wide view they already had; members only ever move their own jobs.
    const result = await runJobWorker({ trigger: "browser", userId: isAdmin ? undefined : user.id });
    return NextResponse.json({
      refreshed: result.processed - result.claimLost,
      failed: result.failed,
      autoArchived: result.archived,
      archivePending: 0,
      skipped: result.skipped,
      backlog: result.backlog,
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
