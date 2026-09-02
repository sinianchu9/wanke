import { NextResponse } from "next/server";
import { checkOrigin, clearSessionCookie, destroySession, getSessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  checkOrigin(request);
  const token = getSessionToken(request);
  if (token) destroySession(token);
  return clearSessionCookie(NextResponse.json({ ok: true }));
}
