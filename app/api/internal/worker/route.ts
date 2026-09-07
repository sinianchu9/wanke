import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSetting } from "@/lib/system-settings";
import { runJobWorker } from "@/lib/worker";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduler entry point for deployments that drive the worker from cron / systemd instead
 * of the in-process loop (`scripts/worker-tick.mjs`).
 *
 * It is not a member or admin endpoint: it accepts only the operator's scheduling token,
 * compares it in constant time, and fails closed while no token is configured. The token
 * lives in the encrypted secret store (`worker_token`), never in the browser.
 */
export async function POST(request: Request) {
  const expected = getSetting("worker_token");
  if (!expected) {
    return NextResponse.json({ error: "调度令牌未配置，内部推进接口已关闭", code: "WORKER_TOKEN_MISSING" }, { status: 404 });
  }
  const provided = bearerToken(request);
  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: "调度令牌不正确", code: "WORKER_TOKEN_INVALID" }, { status: 401 });
  }
  try {
    const result = await runJobWorker({ trigger: "cron" });
    return NextResponse.json({
      ok: true,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      timedOut: result.timedOut,
      settled: result.settled,
      refunded: result.refunded,
      backlog: result.backlog,
      skipped: result.skipped,
      durationMs: result.durationMs,
    });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

function safeEqual(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
