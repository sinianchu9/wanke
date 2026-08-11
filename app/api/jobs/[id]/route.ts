import { NextResponse } from "next/server";
import { createJob, deleteJob, getJob, updateJobRemote } from "@/lib/repository";
import { refreshJob, resumeStoryboard, submitJob } from "@/lib/video/provider";
import { prepareJobInput } from "@/lib/video/prepare";
import { archiveJobOutput, deleteArchivedOutputs } from "@/lib/archive";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = getJob(id);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "任务不存在" }, { status: 404 });
}

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || "refresh";

    if (action === "refresh") {
      const remote = await refreshJob(job);
      const updated = updateJobRemote(id, remote);
      return NextResponse.json({ job: updated });
    }

    if (action === "retry") {
      const child = createJob({ kind: job.kind, title: `${job.title} · 重试`, request: job.request, parentJobId: job.id });
      try {
        const preparedInput = await prepareJobInput(job.kind, job.request);
        const submitted = await submitJob(job.kind, preparedInput);
        const updated = updateJobRemote(child.id, { providerJobId: submitted.providerJobId, status: submitted.initialStatus, provider: submitted.provider, requestId: submitted.requestId, error: null, details: submitted.details });
        return NextResponse.json({ job: updated }, { status: 201 });
      } catch (error) {
        updateJobRemote(child.id, { status: "failed", error: describeError(error) });
        throw error;
      }
    }

    if (action === "resume") {
      if (job.kind !== "storyboard" || !job.providerJobId) return NextResponse.json({ error: "只有故事板远端任务支持续跑" }, { status: 400 });
      const provider = await resumeStoryboard(job.providerJobId);
      const updated = updateJobRemote(id, { status: "running", provider, error: null, finishedAt: null });
      return NextResponse.json({ job: updated });
    }

    if (action === "archive") {
      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0 || index >= job.outputs.length) return NextResponse.json({ error: "无效的结果序号" }, { status: 400 });
      const archived = await archiveJobOutput(job, index);
      const outputs = job.outputs.map((item, i) => i === index ? archived : item);
      const updated = updateJobRemote(id, { outputs });
      return NextResponse.json({ job: updated, output: archived });
    }

    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function DELETE(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  deleteArchivedOutputs(job.outputs);
  return deleteJob(id) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "任务删除失败" }, { status: 500 });
}
