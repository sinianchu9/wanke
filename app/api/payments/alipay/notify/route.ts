import { NextResponse } from "next/server";
import { handleAlipayNotification, parseNotifyBody } from "@/lib/billing/alipay-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Alipay asynchronous notification endpoint.
 *
 * Public by design: there is no session here, the caller is authenticated by its RSA2
 * signature. The body must be answered with the plain text `success` or `failure` —
 * anything else makes Alipay keep retrying for 24 hours.
 */
function reply(text: "success" | "failure") {
  return new NextResponse(text, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const body = await request.text().catch(() => "");
  let outcome;
  try {
    outcome = handleAlipayNotification(parseNotifyBody(body));
  } catch {
    // An unexpected crash must be retryable, and must never look like success.
    return reply("failure");
  }
  return reply(outcome.reply);
}

export async function GET() {
  return reply("failure");
}
