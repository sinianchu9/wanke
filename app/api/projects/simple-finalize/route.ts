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
      const index = firstVideoOutputIndex(job.outputs);
      if (index < 0) throw new Error(`“${shot.name}”没有可用视频结果`);
      if (!job.outputs[index].archivedFile) {
        const archived = await archiveJobOutput(job, index);
        const outputs = job.outputs.map((item, outputIndex) => outputIndex === index ? archived : item);
        updateJobRemote(job.id, { outputs });
      }
    }

    try {
      const result = await assembleProject(projectId);
      return NextResponse.json({ ...result, assemblies: listProjectAssemblies(projectId) }, { status: 201 });
    } catch (error) {
      const message = describeError(error);
      if (/ffmpeg|ffprobe/i.test(message)) {
        throw new Error("镜头都已经准备好了，但服务器还没有准备好最终成片能力。请在高级设置中完成成片环境配置；已经生成的镜头不会丢失。");
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
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
