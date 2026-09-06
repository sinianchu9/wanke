import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { writeAudit } from "@/lib/admin";
import { applySettingUpdate, describeSystemSettings, type SettingScope } from "@/lib/system-settings";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES: SettingScope[] = ["site", "payment", "storage", "email", "security", "worker"];

const schema = z.object({
  values: z.record(z.string(), z.union([z.string().max(8192), z.number(), z.boolean(), z.null()])).optional(),
  clear: z.array(z.string().max(64)).max(40).optional(),
});

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") || "";
    return NextResponse.json({
      settings: describeSystemSettings(SCOPES.includes(scope as SettingScope) ? (scope as SettingScope) : undefined),
    });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = requireAdmin(request);
    const input = schema.parse(await request.json());
    const changed = applySettingUpdate(input);
    // Audit which fields changed, never the values themselves (they can be credentials).
    writeAudit(admin.id, "system_settings.update", "settings", "system", { fields: changed });
    return NextResponse.json({ ok: true, changed, settings: describeSystemSettings() });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
