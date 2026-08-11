import { NextResponse } from "next/server";
import { z } from "zod";
import { createAsset, deleteAsset, getAsset, listAssets } from "@/lib/repository";
import { detachAssetFromSubjectCards } from "@/lib/subjects";
import { deleteAssetCloud, registerAsset } from "@/lib/yike/provider";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).max(200),
  sourceUrl: z.string().url().refine(value => {
    try { const u = new URL(value); return u.protocol === "http:" || u.protocol === "https:"; }
    catch { return false; }
  }, "素材地址必须是公网 HTTP/HTTPS URL"),
  mediaType: z.string().min(1).max(32),
  trackOnly: z.boolean().optional().default(false),
});

function yikeConfigured() {
  return Boolean(process.env.ALIYUN_ACCESS_KEY_ID && process.env.ALIYUN_ACCESS_KEY_SECRET);
}

function createUrlOnlyAsset(input: z.infer<typeof schema>, registration: string, extensionRegistrationError?: string) {
  return createAsset({
    name: input.name,
    mediaType: input.mediaType,
    sourceUrl: input.sourceUrl,
    provider: {
      storage: "external-url",
      registration,
      ...(extensionRegistrationError ? { extensionRegistrationError } : {}),
    },
  });
}

export async function GET() {
  return NextResponse.json({ assets: listAssets() });
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (input.trackOnly || !yikeConfigured()) {
      const asset = createUrlOnlyAsset(input, input.trackOnly ? "track-only" : "provider-neutral");
      return NextResponse.json({ asset }, { status: 201 });
    }

    try {
      const registered = await registerAsset({ inputURL: input.sourceUrl, mediaType: input.mediaType, title: input.name });
      const asset = createAsset({ providerMediaId: registered.mediaId, name: input.name, mediaType: input.mediaType, sourceUrl: input.sourceUrl, provider: registered.provider });
      return NextResponse.json({ asset }, { status: 201 });
    } catch (error) {
      const extensionError = describeError(error);
      const asset = createUrlOnlyAsset(input, "provider-neutral", extensionError);
      return NextResponse.json({ asset, warning: "素材已保存，可用于基础视频生成；扩展工作流登记暂未成功。" }, { status: 201 });
    }
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
    if (url.searchParams.get("cloud") === "1" && (asset.providerMediaId || asset.provider)) await deleteAssetCloud(asset.provider, asset.providerMediaId);
    if (!deleteAsset(id)) return NextResponse.json({ error: "本地素材删除失败" }, { status: 500 });
    detachAssetFromSubjectCards(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
