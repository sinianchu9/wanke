import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { assertSafeStorageKey, contentTypeFor, inputDirectory, touchStorageAccess } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { name } = await ctx.params;
    let safeKey: string;
    try {
      safeKey = assertSafeStorageKey(name);
    } catch {
      return NextResponse.json({ error: "非法的文件请求路径" }, { status: 400 });
    }

    const filePath = path.join(inputDirectory(), safeKey);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile()) throw new Error("Not a file");
    } catch {
      return NextResponse.json({ error: "素材文件不存在或已被移除" }, { status: 404 });
    }

    try {
      touchStorageAccess(safeKey);
    } catch {
      // Best-effort access tracking
    }

    const download = new URL(request.url).searchParams.get("download") === "1";
    const range = request.headers.get("range");
    const mime = contentTypeFor(safeKey);

    const commonHeaders: Record<string, string> = {
      "Accept-Ranges": "bytes",
      "Content-Type": mime,
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    };

    if (download) {
      commonHeaders["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(safeKey)}`;
    }

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }

      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;

      if (!match[1] && match[2]) {
        const suffix = Number(match[2]);
        start = Math.max(0, stat.size - suffix);
        end = stat.size - 1;
      }

      if (start < 0 || end >= stat.size || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }

      const stream = fs.createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as any, {
        status: 206,
        headers: {
          ...commonHeaders,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }

    const stream = fs.createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as any, {
      headers: {
        ...commonHeaders,
        "Content-Length": String(stat.size),
      },
    });
  } catch (error) {
    console.error("[asset-file] Error reading asset file:", error);
    return NextResponse.json({ error: "读取素材文件失败" }, { status: 500 });
  }
}
