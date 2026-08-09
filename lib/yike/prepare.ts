import "server-only";
import type { JobKind, StoredAsset } from "@/lib/types";
import { listAssets } from "@/lib/repository";
import { resolveStudioAssetUrl } from "@/lib/yike/assets";

function providerIds(asset: StoredAsset) {
  const provider: any = asset.provider || {};
  return {
    coreMediaId: provider.coreMediaId || "",
    studioMediaId: provider.studioMediaId || "",
    fallbackMediaId: asset.providerMediaId || "",
  };
}

function findStoredAsset(assets: StoredAsset[], media: any) {
  const url = typeof media?.url === "string" ? media.url : "";
  const mediaId = typeof media?.mediaId === "string" ? media.mediaId : "";

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

/**
 * Convert Wanke's stable asset references into a form that Yike can download now.
 *
 * Yike's CreateYikeAssetUpload may return a private OSS FileURL. We keep that URL only
 * as an internal identity for the asset. Before a video-generation request, resolve the
 * Studio MediaId through GetYikeAssetMediaInfo and use the fresh signed FileUrl.
 *
 * For a manually edited URL, URL wins and any stale hidden MediaId is discarded.
 */
export async function prepareJobInput(kind: JobKind, input: Record<string, any>) {
  if (kind !== "video_generation" || !Array.isArray(input.medias) || !input.medias.length) return input;

  const assets = listAssets();
  const medias = await Promise.all(input.medias.map(async (media: any) => {
    const url = typeof media?.url === "string" ? media.url.trim() : "";
    const mediaId = typeof media?.mediaId === "string" ? media.mediaId.trim() : "";
    const stored = findStoredAsset(assets, { url, mediaId });

    if (stored) {
      const ids = providerIds(stored);
      if (ids.studioMediaId) {
        const resolved = await resolveStudioAssetUrl(ids.studioMediaId);
        return { ...media, url: resolved.url, mediaId: "" };
      }
      // Old records without a Studio MediaId can still use a genuinely public URL.
      if (stored.sourceUrl) return { ...media, url: stored.sourceUrl, mediaId: "" };
    }

    // A visible/manual URL must never be contaminated by an old hidden MediaId.
    if (url) return { ...media, url, mediaId: "" };

    // Unknown MediaIds are left intact so 2026-07-07 can still accept a valid Core MediaId.
    return { ...media, url: "", mediaId };
  }));

  return { ...input, medias };
}
