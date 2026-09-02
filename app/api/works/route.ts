import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { createWorkFromJob, listWorksForUser } from "@/lib/works";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  jobId: z.string().min(1),
  outputIndex: z.number().int().min(0),
  title: z.string().max(160).optional(),
  description: z.string().max(2000).optional(),
});

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "1";
    return NextResponse.json({ works: listWorksForUser(user.id, includeArchived) });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const input = createSchema.parse(await request.json());
    const work = createWorkFromJob(user.id, input);
    return NextResponse.json({ work }, { status: 201 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
