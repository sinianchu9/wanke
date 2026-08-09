import { NextResponse } from "next/server";
import { z } from "zod";
import { createAsset, deleteAsset, getAsset, listAssets } from "@/lib/repository";
import { deleteAssetCloud, registerAsset } from "@/lib/yike/provider";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).max(200),
  sourceUrl: z.string().url(),
  mediaType: z.string().min(1).max(32),
  trackOnly: z.boolean().optional().default(false),
});

export async function GET() {
  return NextResponse.json({ assets: listAssets() });
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (input.trackOnly) {
      return NextResponse.json({ asset: createAsset({ name: input.name, mediaType: input.mediaType, sourceUrl: input.sourceUrl }) }, { status: 201 });
    }
    const registered = await registerAsset({ inputURL: input.sourceUrl, mediaType: input.mediaType, title: input.name });
    const asset = createAsset({ providerMediaId: registered.mediaId, name: input.name, mediaType: input.mediaType, sourceUrl: input.sourceUrl, provider: registered.provider });
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  const asset = getAsset(id);
  if (!asset) return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  try {
    if (url.searchParams.get("cloud") === "1") await deleteAssetCloud(asset.provider, asset.providerMediaId);
    return deleteAsset(id) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "本地素材删除失败" }, { status: 500 });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
