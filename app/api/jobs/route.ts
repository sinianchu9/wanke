import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob, getJobForUser, listJobsForUser, updateJobRemote } from "@/lib/repository";
import { assignJobToShot, getShot, shotOwnedBy } from "@/lib/projects";
import { JOB_KINDS } from "@/lib/types";
import { submitJob } from "@/lib/video/provider";
import { prepareJobInput } from "@/lib/video/prepare";
import { describeError } from "@/lib/errors";
import { errorResponse, requireUser, type SessionUser } from "@/lib/auth";
import { attachJobToCharge, beginSubmitCharge, existingChargeForRequest, failSubmitCharge, quoteSubmit } from "@/lib/billing/charges";
import { publicErrorMessage } from "@/lib/copy";
import { memberJobView, memberJobListView } from "@/lib/job-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  kind: z.enum(JOB_KINDS),
  title: z.string().max(160).optional(),
  input: z.record(z.string(), z.unknown()),
  parentJobId: z.string().optional().nullable(),
  shotId: z.string().optional().nullable(),
  // Client-generated request id. Re-submitting the same id (double click, retry after a
  // network hiccup) returns the original job instead of charging and generating again.
  clientRequestId: z.string().min(8).max(128).optional(),
});

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    return NextResponse.json({ jobs: memberJobListView(listJobsForUser(user.id), user.role === "admin") });
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
  let chargeId: string | null = null;
  try {
    const payload = createSchema.parse(await request.json());
    if (payload.shotId) {
      if (!getShot(payload.shotId) || !shotOwnedBy(payload.shotId, user.id)) {
        return NextResponse.json({ error: "当前项目镜头已经不存在，请重新选择镜头" }, { status: 400 });
      }
    }
    const duplicate = existingChargeForRequest(user.id, payload.clientRequestId);
    if (duplicate?.jobId) {
      const existingJob = getJobForUser(duplicate.jobId, user.id, user.role === "admin");
      if (existingJob) return NextResponse.json({ job: memberJobView(existingJob, user.role === "admin"), deduplicated: true, quote: duplicate.quote });
    }
    // Credits: quote -> reserve -> attach. Refund/void is decided by the failure class.
    const quote = quoteSubmit({ userId: user.id, kind: payload.kind, jobInput: payload.input });
    const { charge } = beginSubmitCharge({ userId: user.id, kind: payload.kind, jobInput: payload.input, clientRequestId: payload.clientRequestId });
    chargeId = charge.id;
    job = createJob({ kind: payload.kind, title: payload.title, request: payload.input, parentJobId: payload.parentJobId, userId: user.id });
    attachJobToCharge(charge.id, job.id);
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
    return NextResponse.json({ job: memberJobView(job, user.role === "admin"), quote }, { status: 201 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    const message = errorMessage(error);
    if (chargeId) failSubmitCharge(chargeId, message, job?.id ?? null);
    if (job) updateJobRemote(job.id, { status: "failed", error: message });
    const failedJob = job ? updateJobRemote(job.id, {}) : null;
    return NextResponse.json({
      error: publicErrorMessage(message) || "本次创作没有完成，请稍后重试。",
      job: failedJob ? memberJobView(failedJob, user.role === "admin") : null,
    }, { status: 400 });
  }
}

function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) return (error as any).issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("；");
  return describeError(error);
}
