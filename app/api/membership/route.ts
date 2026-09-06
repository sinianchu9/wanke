import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/auth";
import { getMembership, purchasablePlans } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    return NextResponse.json({
      membership: getMembership(user.id),
      plans: purchasablePlans("membership"),
      packs: purchasablePlans("quota_pack"),
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
