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
 * Public URLs remain public and do not trigger any Yike API call. Only legacy assets that
 * physically live in Yike's private ICE bucket need a fresh signed URL. This keeps direct
 * Model Studio generation independent from Yike whenever the source asset is already public.
 */
export async function prepareJobInput(kind: JobKind, input: Record<string, any>) {
  if (kind !== "video_generation" || !Array.isArray(input.medias) || !input.medias.length) return input;

  const assets = listAssets();
  const medias = await Promise.all(input.medias.map(async (media: any) => {
    const url = typeof media?.url === "string" ? media.url.trim() : "";
    const mediaId = typeof media?.mediaId === "string" ? media.mediaId.trim() : "";
    const stored = findStoredAsset(assets, { url, mediaId });

    // A visible public URL is provider-neutral. Never replace it with a Yike URL or MediaId.
    if (isPublicHttpUrl(url)) return { ...media, url, mediaId: "" };

    if (stored) {
      if (isPublicHttpUrl(stored.sourceUrl)) {
        return { ...media, url: stored.sourceUrl, mediaId: "" };
      }

      const ids = providerIds(stored);
      if (ids.studioMediaId) {
        const resolved = await resolveStudioAssetUrl(ids.studioMediaId);
        return { ...media, url: resolved.url, mediaId: "" };
      }

      // Legacy records that cannot be resolved to a URL are left as MediaId so the Yike
      // compatibility provider still has a chance to accept them.
      return { ...media, url: "", mediaId: ids.coreMediaId || ids.fallbackMediaId || mediaId };
    }

    // Unknown manual URLs are preserved for validation; unknown MediaIds stay available to Yike.
    if (url) return { ...media, url, mediaId: "" };
    return { ...media, url: "", mediaId };
  }));

  return { ...input, medias };
}
