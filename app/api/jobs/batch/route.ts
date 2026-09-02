import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob, updateJobRemote } from "@/lib/repository";
import { assignJobToShot, getShot, shotOwnedBy } from "@/lib/projects";
import { submitJob } from "@/lib/video/provider";
import { prepareJobInput } from "@/lib/video/prepare";
import { describeError } from "@/lib/errors";
import { errorResponse, requireUser } from "@/lib/auth";
import { refundQuota, reserveQuota } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.literal("video_generation"),
  title: z.string().max(160).optional(),
  input: z.record(z.string(), z.unknown()),
  count: z.coerce.number().int().min(2).max(4),
  shotId: z.string().optional().nullable(),
});

type BatchMeta = { id: string; index: number; total: number };

export async function POST(request: Request) {
  let user;
  try {
    user = requireUser(request);
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
  try {
    const payload = schema.parse(await request.json());
    if (payload.shotId) {
      if (!getShot(payload.shotId) || !shotOwnedBy(payload.shotId, user.id)) {
        return NextResponse.json({ error: "当前项目镜头已经不存在，请重新选择镜头" }, { status: 400 });
      }
    }
    // Reserve the whole batch atomically up front; refund per version rejected synchronously.
    reserveQuota(user.id, payload.count);
    const batchId = randomUUID();
    const jobs: ReturnType<typeof createJob>[] = [];

    // Submit versions one by one. Each version remains a real independent Job.
    // Only the lightweight submit calls are serialized; remote video generation stays asynchronous.
    for (let index = 1; index <= payload.count; index += 1) {
      const batch: BatchMeta = { id: batchId, index, total: payload.count };
      const baseTitle = payload.title?.trim() || "AI 视频生成";
      const requestInput = { ...payload.input, _batch: batch };
      let job = createJob({ kind: "video_generation", title: `${baseTitle} · 版本 ${index}/${payload.count}`, request: requestInput, userId: user.id });
      if (payload.shotId) assignJobToShot(payload.shotId, job.id);

      try {
        const preparedInput = await prepareJobInput("video_generation", requestInput);
        const submitted = await submitJob("video_generation", preparedInput);
        job = updateJobRemote(job.id, {
          providerJobId: submitted.providerJobId,
          status: submitted.initialStatus,
          provider: submitted.provider,
          requestId: submitted.requestId,
          error: null,
          details: { ...(submitted.details || {}), batchId, batchIndex: index, batchTotal: payload.count },
        })!;
      } catch (error) {
        refundQuota(user.id, 1);
        job = updateJobRemote(job.id, {
          status: "failed",
          error: describeError(error),
          details: { batchId, batchIndex: index, batchTotal: payload.count },
        })!;
      }

      jobs.push(job);
    }

    const submitted = jobs.filter(job => job.providerJobId).length;
    const failed = jobs.filter(job => job.status === "failed").length;
    return NextResponse.json({ batchId, jobs, summary: { total: payload.count, submitted, failed } }, { status: 201 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    }
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
