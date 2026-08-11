import { NextResponse } from "next/server";
import { z } from "zod";
import { archiveJobOutput } from "@/lib/archive";
import { listProjects, selectShotJob } from "@/lib/projects";
import { getJob, updateJobRemote } from "@/lib/repository";
import { assembleProject, listProjectAssemblies } from "@/lib/video/project-assembly";
import { describeError } from "@/lib/errors";
import type { ResultMedia, StoredJob } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ projectId: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const { projectId } = schema.parse(await request.json());
    let project = listProjects().find(item => item.id === projectId);
    if (!project) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
    if (!project.shots.length) return NextResponse.json({ error: "作品还没有镜头" }, { status: 400 });

    for (const shot of project.shots) {
      if (shot.selectedJobId) continue;
      const successful = shot.jobIds.map(id => getJob(id)).filter((job): job is StoredJob => Boolean(job && job.status === "succeeded" && firstVideoOutput(job.outputs)));
      if (successful.length === 0) throw new Error(`“${shot.name}”还没有生成完成，完成后再生成最终视频`);
      if (successful.length > 1) throw new Error(`“${shot.name}”有多个可用版本，请先选择你喜欢的版本；简单模式不会替你猜`);
      selectShotJob(shot.id, successful[0].id);
    }

    project = listProjects().find(item => item.id === projectId)!;
    for (const shot of project.shots) {
      const job = shot.selectedJobId ? getJob(shot.selectedJobId) : null;
      if (!job) throw new Error(`“${shot.name}”的采用版本不存在`);
      await ensureSelectedVideoArchived(job, shot.name);
    }

    try {
      const result = await assembleProject(projectId);
      return NextResponse.json({ ...result, assemblies: listProjectAssemblies(projectId) }, { status: 201 });
    } catch (error) {
      const message = describeError(error);
      if (/ffmpeg|ffprobe/i.test(message)) {
        throw new Error("镜头都已经准备好了，但服务器还没有准备好最终成片能力。请在高级设置中完成成片环境配置；已经生成和保存的镜头不会丢失。");
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

async function ensureSelectedVideoArchived(job: StoredJob, shotName: string) {
  let current = getJob(job.id) || job;
  let index = firstVideoOutputIndex(current.outputs);
  if (index < 0) throw new Error(`“${shotName}”没有可用视频结果`);
  if (current.outputs[index].archivedFile) return;

  try {
    const archived = await archiveJobOutput(current, index);
    const outputs = current.outputs.map((item, outputIndex) => outputIndex === index ? archived : item);
    updateJobRemote(current.id, {
      outputs,
      details: { ...(current.details || {}), quickArchive: "saved", quickArchiveError: null },
    });
    return;
  } catch (error) {
    // The background quick-archive path can finish at the same time as this explicit
    // finalization request. Re-read before treating the archive as failed.
    current = getJob(job.id) || current;
    index = firstVideoOutputIndex(current.outputs);
    if (index >= 0 && current.outputs[index]?.archivedFile) {
      updateJobRemote(current.id, {
        details: { ...(current.details || {}), quickArchive: "saved", quickArchiveError: null },
      });
      return;
    }

    const reason = describeError(error);
    updateJobRemote(current.id, {
      details: { ...(current.details || {}), quickArchive: "pending", quickArchiveError: reason },
    });
    throw new Error(`“${shotName}”已经生成成功，但暂时无法把结果安全保存到本机。可以稍后再次点击“生成最终视频”；如果持续失败，可能是云端结果链接已经过期，请在这个镜头下“再生成一个版本”。`);
  }
}

function firstVideoOutputIndex(outputs: ResultMedia[]) {
  const exact = outputs.findIndex(output => output.kind === "video");
  if (exact >= 0) return exact;
  return outputs.findIndex(output => /\.(mp4|mov|webm)(\?|$)/i.test(String(output.outputUrl || "")));
}

function firstVideoOutput(outputs: ResultMedia[]) {
  const index = firstVideoOutputIndex(outputs);
  return index >= 0 ? outputs[index] : null;
}
