import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getJobForUser } from "@/lib/repository";
import { archivedFilePath, archiveJobOutput } from "@/lib/archive";
import { errorResponse, requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n\t]+/g, "_").trim();
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const user = requireUser(request);
    const { id } = await ctx.params;
    const isAdmin = user.role === "admin";
    const job = getJobForUser(id, user.id, isAdmin);
    if (!job) {
      return NextResponse.json({ error: "任务不存在或无权访问" }, { status: 404 });
    }

    const urlObj = new URL(request.url);
    const indexParam = urlObj.searchParams.get("index");
    const index = indexParam ? parseInt(indexParam, 10) : 0;
    if (isNaN(index) || index < 0 || index >= job.outputs.length) {
      return NextResponse.json({ error: "无效的输出序号" }, { status: 400 });
    }

    const output = job.outputs[index];
    if (!output) {
      return NextResponse.json({ error: "未找到该视频输出" }, { status: 404 });
    }

    const rawTitle = output.label || job.title || "视频";
    const safeTitle = sanitizeFileName(rawTitle) || `video_${job.id.slice(0, 8)}`;
    const suffix = job.outputs.length > 1 ? `_版本${index + 1}` : "";
    const downloadFileName = `${safeTitle}${suffix}.mp4`;
    const asciiFallback = `video_${job.id.slice(0, 8)}_${index + 1}.mp4`;
    const encodedFileName = encodeURIComponent(downloadFileName);

    const disposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;

    // 1. 本地已归档文件优先
    if (output.archivedFile) {
      const filePath = archivedFilePath(output.archivedFile);
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          const stream = fs.createReadStream(filePath);
          return new Response(Readable.toWeb(stream) as any, {
            headers: {
              "Content-Type": "video/mp4",
              "Content-Length": String(stat.size),
              "Content-Disposition": disposition,
              "Cache-Control": "private, no-cache",
            },
          });
        }
      }
    }

    // 2. 云端远程直链，作为流代理并注入 attachment 响应头
    const remoteUrl = output.outputUrl?.trim();
    if (!remoteUrl) {
      return NextResponse.json({ error: "该任务结果暂无有效视频地址" }, { status: 404 });
    }

    const remoteRes = await fetch(remoteUrl);
    if (!remoteRes.ok || !remoteRes.body) {
      return NextResponse.json({ error: "获取远程视频流失败，请稍后再试" }, { status: 502 });
    }

    const headers: Record<string, string> = {
      "Content-Type": remoteRes.headers.get("content-type") || "video/mp4",
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-cache",
    };
    const contentLength = remoteRes.headers.get("content-length");
    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    // 异步尝试将结果持久化到服务器本地存储（避免下次再次拉取远端）
    if (!output.archivedFile) {
      archiveJobOutput(job, index).catch(() => {});
    }

    return new Response(remoteRes.body, { headers });
  } catch (error) {
    const handled = errorResponse(error);
    if (handled) return handled;
    return NextResponse.json({ error: "下载处理失败" }, { status: 500 });
  }
}
