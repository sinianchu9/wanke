import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMembership } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({ user, membership: getMembership(user.id) });
}
