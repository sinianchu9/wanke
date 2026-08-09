import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { archivedFilePath, contentTypeFor } from "@/lib/archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { name } = await ctx.params;
    const file = archivedFilePath(name);
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error("不是文件");
    const range = request.headers.get("range");
    const common = { "Accept-Ranges": "bytes", "Content-Type": contentTypeFor(name), "Cache-Control": "private, max-age=3600" };

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!match[1] && match[2]) { const suffix = Number(match[2]); start = Math.max(0, stat.size - suffix); end = stat.size - 1; }
      if (start < 0 || end >= stat.size || start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
      const stream = fs.createReadStream(file, { start, end });
      return new Response(Readable.toWeb(stream) as any, { status: 206, headers: { ...common, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) } });
    }

    const stream = fs.createReadStream(file);
    return new Response(Readable.toWeb(stream) as any, { headers: { ...common, "Content-Length": String(stat.size) } });
  } catch {
    return NextResponse.json({ error: "归档文件不存在" }, { status: 404 });
  }
}
