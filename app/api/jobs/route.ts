import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob, listJobsForUser, updateJobRemote } from "@/lib/repository";
import { assignJobToShot, getShot, shotOwnedBy } from "@/lib/projects";
import { JOB_KINDS } from "@/lib/types";
import { submitJob } from "@/lib/video/provider";
import { prepareJobInput } from "@/lib/video/prepare";
import { describeError } from "@/lib/errors";
import { errorResponse, requireUser, type SessionUser } from "@/lib/auth";
import { refundQuota, reserveQuota } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  kind: z.enum(JOB_KINDS),
  title: z.string().max(160).optional(),
  input: z.record(z.string(), z.unknown()),
  parentJobId: z.string().optional().nullable(),
  shotId: z.string().optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    return NextResponse.json({ jobs: listJobsForUser(user.id) });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let user: SessionUser;
  try {
    user = requireUser(request);
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }

  let job: ReturnType<typeof createJob> | null = null;
  let reserved = false;
  try {
    const payload = createSchema.parse(await request.json());
    if (payload.shotId) {
      if (!getShot(payload.shotId) || !shotOwnedBy(payload.shotId, user.id)) {
        return NextResponse.json({ error: "当前项目镜头已经不存在，请重新选择镜头" }, { status: 400 });
      }
    }
    // Quota: reserve before provider submission; refund when the provider rejects synchronously.
    reserveQuota(user.id, 1);
    reserved = true;
    job = createJob({ kind: payload.kind, title: payload.title, request: payload.input, parentJobId: payload.parentJobId, userId: user.id });
    if (payload.shotId) assignJobToShot(payload.shotId, job.id);
    const preparedInput = await prepareJobInput(payload.kind, payload.input);
    const submitted = await submitJob(payload.kind, preparedInput);
    job = updateJobRemote(job.id, {
      providerJobId: submitted.providerJobId,
      status: submitted.initialStatus,
      provider: submitted.provider,
      requestId: submitted.requestId,
      error: null,
      details: submitted.details,
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    const message = errorMessage(error);
    if (reserved) refundQuota(user.id, 1);
    if (job) updateJobRemote(job.id, { status: "failed", error: message });
    return NextResponse.json({ error: message, job: job ? updateJobRemote(job.id, {}) : null }, { status: 400 });
  }
}

function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) return (error as any).issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("；");
  return describeError(error);
}
