import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { readAllPreferences, writeCreationPreferences, writeNotificationPreferences } from "@/lib/account-preferences";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  creation: z.object({
    aspectRatio: z.string().max(10).optional(),
    resolution: z.string().max(10).optional(),
    subtitleEnabled: z.boolean().optional(),
    language: z.string().max(10).optional(),
    defaultDuration: z.number().int().min(1).max(600).optional(),
    favoriteTool: z.string().max(40).optional(),
  }).optional(),
  notifications: z.object({
    job: z.boolean().optional(),
    quota: z.boolean().optional(),
    order: z.boolean().optional(),
    system: z.boolean().optional(),
    email: z.boolean().optional(),
  }).optional(),
});

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    return NextResponse.json({ preferences: readAllPreferences(user.id) });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = requireUser(request);
    const input = schema.parse(await request.json());
    if (input.creation) writeCreationPreferences(user.id, input.creation);
    if (input.notifications) writeNotificationPreferences(user.id, input.notifications);
    return NextResponse.json({ ok: true, preferences: readAllPreferences(user.id) });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    const message = error instanceof Error ? error.message : describeError(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
