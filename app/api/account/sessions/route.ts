import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, getSessionToken, listSessions, revokeAllSessions, revokeOtherSessions, requireUser } from "@/lib/auth";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function describeAgent(userAgent: string) {
  const agent = userAgent.toLowerCase();
  if (!agent) return "未知设备";
  const device = /iphone|ipad|android|mobile/.test(agent) ? "手机" : /tablet/.test(agent) ? "平板" : "电脑";
  const browser = agent.includes("edg/") ? "Edge" : agent.includes("chrome") ? "Chrome" : agent.includes("safari") ? "Safari" : agent.includes("firefox") ? "Firefox" : "浏览器";
  return `${device} · ${browser}`;
}

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const sessions = listSessions(user.id, getSessionToken(request));
    return NextResponse.json({
      sessions: sessions.map(session => ({
        id: session.id,
        device: describeAgent(session.userAgent),
        ip: session.ip,
        current: session.current,
        lastActiveAt: session.lastSeenAt,
        createdAt: session.createdAt,
      })),
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = requireUser(request);
    const input = z.object({ scope: z.enum(["others", "all"]).default("others") }).parse(await request.json().catch(() => ({})));
    const revoked = input.scope === "all" ? revokeAllSessions(user.id) : revokeOtherSessions(user.id, getSessionToken(request));
    return NextResponse.json({ ok: true, revoked });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
