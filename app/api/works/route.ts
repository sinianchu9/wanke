import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { createWorkFromJob, listWorksForUser, refreshWorkMediaFacts, workView } from "@/lib/works";
import { archiveJobOutput } from "@/lib/archive";
import { ffprobeAvailable, probeResultMedia } from "@/lib/video/media-probe";
import { getJob, updateJobRemote } from "@/lib/repository";
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
    return NextResponse.json({ works: listWorksForUser(user.id, includeArchived).map(workView) });
  } catch (error) {
    const handled = errorResponse(error);
    return handled || NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const input = createSchema.parse(await request.json());
    // A work must keep playing after the upstream link expires: archive the result
    // locally before saving. When archiving is momentarily impossible the work is
    // still saved with its current playback address, and the worker's auto-archive
    // upgrades it to a local file as soon as it can.
    const job = getJob(input.jobId);
    if (job && job.userId === user.id && job.status === "succeeded") {
      const output = job.outputs[input.outputIndex];
      if (output && !output.archivedFile && output.outputUrl) {
        try {
          const archived = await archiveJobOutput(job, input.outputIndex);
          updateJobRemote(job.id, { outputs: job.outputs.map((item, i) => i === input.outputIndex ? archived : item) });
        } catch (error) {
          console.warn("[works] save-as-work archive deferred:", describeError(error));
        }
      }
    }
    const work = createWorkFromJob(user.id, input);
    if (work.archivedFile && (await ffprobeAvailable().catch(() => false))) {
      try {
        const probe = await probeResultMedia({ archivedFile: work.archivedFile, kind: "video" });
        refreshWorkMediaFacts(work.id, { durationSeconds: probe.duration });
      } catch {
        // A missing duration never blocks saving; the basic info simply shows 未知.
      }
    }
    return NextResponse.json({ work: workView(work) }, { status: 201 });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
