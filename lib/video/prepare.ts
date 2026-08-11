import "server-only";
import type { JobKind, StoredAsset } from "@/lib/types";
import { listAssets } from "@/lib/repository";
import { resolveStudioAssetUrl } from "@/lib/yike/assets";
import { isLocalInputRef, localInputToDataUrl } from "@/lib/video/local-input";

function providerIds(asset: StoredAsset) {
  const provider: any = asset.provider || {};
  return {
    coreMediaId: provider.coreMediaId || "",
    studioMediaId: provider.studioMediaId || "",
    fallbackMediaId: asset.providerMediaId || "",
  };
}

function findStoredAsset(assets: StoredAsset[], media: any) {
  const url = typeof media?.url === "string" ? media.url.trim() : "";
  const mediaId = typeof media?.mediaId === "string" ? media.mediaId.trim() : "";

  if (url) {
    const exact = assets.find(asset => asset.sourceUrl === url);
    if (exact) return exact;
  }
  if (mediaId) {
    return assets.find(asset => {
      const ids = providerIds(asset);
      return mediaId === ids.coreMediaId || mediaId === ids.studioMediaId || mediaId === ids.fallbackMediaId;
    }) || null;
  }
  return null;
}

function isYikeManagedPrivateUrl(value: string) {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.startsWith("ice-ai-saas") && host.endsWith(".aliyuncs.com");
  } catch {
    return false;
  }
}

function isPublicHttpUrl(value: string) {
  if (!value || isYikeManagedPrivateUrl(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Prepare stable Wanke asset references for whichever video provider will actually run.
 *
 * Public URLs remain public and do not trigger any Yike API call. Local image refs are kept
 * small in SQLite and converted to Base64 only for the outbound generation/editing request.
 */
export async function prepareJobInput(kind: JobKind, input: Record<string, any>) {
  if (kind === "video_editing") {
    const referenceImages = Array.isArray(input.referenceImages) ? input.referenceImages : [];
    return {
      ...input,
      referenceImages: await Promise.all(referenceImages.map(async (value: unknown) => {
        const ref = typeof value === "string" ? value.trim() : "";
        return isLocalInputRef(ref) ? localInputToDataUrl(ref) : ref;
      })),
    };
  }

  if (kind !== "video_generation" || !Array.isArray(input.medias) || !input.medias.length) return input;

  const assets = listAssets();
  const medias = await Promise.all(input.medias.map(async (media: any) => {
    const url = typeof media?.url === "string" ? media.url.trim() : "";
    const mediaId = typeof media?.mediaId === "string" ? media.mediaId.trim() : "";

    if (isLocalInputRef(url)) {
      if (media?.type !== "image") throw new Error("Wanke 本地输入当前只支持图片");
      return { ...media, url: await localInputToDataUrl(url), mediaId: "" };
    }

    const stored = findStoredAsset(assets, { url, mediaId });

    if (isPublicHttpUrl(url)) return { ...media, url, mediaId: "" };

    if (stored) {
      if (isPublicHttpUrl(stored.sourceUrl)) {
        return { ...media, url: stored.sourceUrl, mediaId: "" };
      }

      const ids = providerIds(stored);
      if (ids.studioMediaId) {
        try {
          const resolved = await resolveStudioAssetUrl(ids.studioMediaId);
          return { ...media, url: resolved.url, mediaId: "" };
        } catch (error) {
          if (isYikeManagedPrivateUrl(stored.sourceUrl)) {
            throw new Error(`素材“${stored.name}”来自旧版私有素材空间，当前无法直接读取。请重新提供公网素材 URL，或恢复兼容工作流凭证后再试。`);
          }
          throw error;
        }
      }

      return { ...media, url: "", mediaId: ids.coreMediaId || ids.fallbackMediaId || mediaId };
    }

    if (url) return { ...media, url, mediaId: "" };
    return { ...media, url: "", mediaId };
  }));

  return { ...input, medias };
}
