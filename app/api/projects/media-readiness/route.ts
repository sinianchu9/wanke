import { NextResponse } from "next/server";
import { z } from "zod";
import { listProjects } from "@/lib/projects";
import { getJob } from "@/lib/repository";
import { ffprobeAvailable, mediaProfileKey, probeResultMedia } from "@/lib/video/media-probe";
import { describeError } from "@/lib/errors";
import type { ResultMedia } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ projectId: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const project = listProjects().find(item => item.id === input.projectId);
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

    if (!(await ffprobeAvailable())) {
      return NextResponse.json({
        available: false,
        tool: "ffprobe",
        projectId: project.id,
        message: "服务器未检测到 ffprobe。项目和定稿功能仍可正常使用，但暂时不能验证视频编码、分辨率、FPS 与音频规格。安装 FFmpeg/ffprobe 或配置 FFPROBE_PATH 后可直接使用此检查。",
      });
    }

    const shots = [] as any[];
    for (const [index, shot] of project.shots.entries()) {
      if (!shot.selectedJobId) {
        shots.push({ shotId: shot.id, shotName: shot.name, index: index + 1, ready: false, reason: "这个镜头还没有采用版本" });
        continue;
      }
      const job = getJob(shot.selectedJobId);
      const output = job ? firstVideoOutput(job.outputs) : null;
      if (!job || !output) {
        shots.push({ shotId: shot.id, shotName: shot.name, index: index + 1, jobId: shot.selectedJobId, ready: false, reason: "采用任务不存在或没有视频输出" });
        continue;
      }
      try {
        const probe = await probeResultMedia(output);
        shots.push({ shotId: shot.id, shotName: shot.name, index: index + 1, jobId: job.id, jobTitle: job.title, ready: true, probe, profileKey: mediaProfileKey(probe) });
      } catch (error) {
        shots.push({ shotId: shot.id, shotName: shot.name, index: index + 1, jobId: job.id, jobTitle: job.title, ready: false, reason: describeError(error) });
      }
    }

    const readyShots = shots.filter(item => item.ready && item.profileKey);
    const profiles = new Set(readyShots.map(item => item.profileKey));
    const complete = project.shots.length > 0 && shots.length === project.shots.length && shots.every(item => item.ready);
    const profilesAligned = complete && profiles.size === 1;

    return NextResponse.json({
      available: true,
      tool: "ffprobe",
      projectId: project.id,
      projectName: project.name,
      complete,
      profilesAligned,
      normalizationRequired: !profilesAligned,
      readyCount: readyShots.length,
      totalCount: project.shots.length,
      profileCount: profiles.size,
      shots,
      note: profilesAligned
        ? "当前定稿视频的主要编码规格一致。真正拼接前仍应由装配层处理时间基、容器与边界条件。"
        : "定稿视频存在缺失、探测失败或主要媒体规格差异；进入拼接前需要先补齐或统一规格。",
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join("；") }, { status: 400 });
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

function firstVideoOutput(outputs: ResultMedia[]) {
  return outputs.find(output => output.kind === "video") || outputs.find(output => /\.(mp4|mov|webm)(\?|$)/i.test(String(output.outputUrl || ""))) || null;
}
