import "server-only";
import { CreateYikeAssetUploadRequest, DeleteYikeAssetMediaInfosRequest, ListYikeWorkspacesRequest, RegisterYikeAssetMediaInfoRequest } from "@alicloud/yike20260319";
import { DeleteMediasRequest, ImportMediaRequest, ListAssetCategoriesRequest } from "@alicloud/yike20260707";
import { getCoreYikeClient, getStudioYikeClient } from "@/lib/yike/client";
import { bodyOf, errorText } from "@/lib/yike/shared";

export async function createUploadCredential(fileExt: string, fileType?: string) {
  const response = await getStudioYikeClient().createYikeAssetUpload(new CreateYikeAssetUploadRequest({
    fileExt: fileExt.replace(/^\./, "").toLowerCase(),
    fileType: fileType || undefined,
  }));
  const body = bodyOf(response);
  return {
    fileURL: body.fileURL ?? body.FileURL,
    uploadAddress: body.uploadAddress ?? body.UploadAddress,
    uploadAuth: body.uploadAuth ?? body.UploadAuth,
    requestId: body.requestId ?? body.RequestId,
  };
}

/**
 * Register the same URL on both API surfaces. The two Yike versions expose different
 * product areas, so keeping both IDs avoids assuming that MediaId namespaces are interchangeable.
 */
export async function registerAsset(input: { inputURL: string; mediaType: string; title?: string }) {
  const [coreResult, studioResult] = await Promise.allSettled([
    getCoreYikeClient().importMedia(new ImportMediaRequest({
      importSource: "url",
      inputURL: input.inputURL,
      mediaType: input.mediaType,
      title: input.title || undefined,
      overwrite: false,
    })),
    getStudioYikeClient().registerYikeAssetMediaInfo(new RegisterYikeAssetMediaInfoRequest({
      inputURL: input.inputURL,
      mediaType: input.mediaType,
    })),
  ]);
  const coreBody = coreResult.status === "fulfilled" ? bodyOf(coreResult.value) : null;
  const studioBody = studioResult.status === "fulfilled" ? bodyOf(studioResult.value) : null;
  const coreMediaId = coreBody?.mediaId ?? coreBody?.MediaId ?? null;
  const studioMediaId = studioBody?.mediaId ?? studioBody?.MediaId ?? null;
  if (!coreMediaId && !studioMediaId) {
    const errors = [coreResult, studioResult].filter(x => x.status === "rejected").map((x: any) => x.reason?.message || String(x.reason));
    throw new Error(`素材注册失败：${errors.join("；")}`);
  }
  return {
    mediaId: coreMediaId || studioMediaId,
    requestId: coreBody?.requestId ?? coreBody?.RequestId ?? studioBody?.requestId ?? studioBody?.RequestId ?? null,
    provider: { coreMediaId, studioMediaId, core: coreBody, studio: studioBody },
  };
}

export async function deleteAssetCloud(provider: Record<string, unknown> | null, fallbackMediaId?: string | null) {
  const p: any = provider || {};
  const hasDual = Object.prototype.hasOwnProperty.call(p, "coreMediaId") || Object.prototype.hasOwnProperty.call(p, "studioMediaId");
  const coreId = hasDual ? p.coreMediaId : fallbackMediaId;
  const studioId = hasDual ? p.studioMediaId : fallbackMediaId;
  const operations: Promise<any>[] = [];
  if (coreId) operations.push(getCoreYikeClient().deleteMedias(new DeleteMediasRequest({ mediaIds: String(coreId), deletePhysicalFiles: false })));
  if (studioId) operations.push(getStudioYikeClient().deleteYikeAssetMediaInfos(new DeleteYikeAssetMediaInfosRequest({ mediaIds: String(studioId), logicDelete: true })));
  if (!operations.length) return { ok: true, deleted: 0 };
  const results = await Promise.allSettled(operations);
  const failed = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];
  if (failed.length) throw new Error(`云端媒资清理部分失败：${failed.map(r => errorText(r.reason)).join("；")}`);
  return { ok: true, deleted: results.length };
}

export async function testConnection() {
  const [core, studio] = await Promise.allSettled([
    getCoreYikeClient().listAssetCategories(new ListAssetCategoriesRequest({})),
    getStudioYikeClient().listYikeWorkspaces(new ListYikeWorkspacesRequest({})),
  ]);
  const coreBody = core.status === "fulfilled" ? bodyOf(core.value) : null;
  const studioBody = studio.status === "fulfilled" ? bodyOf(studio.value) : null;
  return {
    ok: core.status === "fulfilled",
    core: core.status === "fulfilled" ? { ok: true, requestId: coreBody?.requestId ?? coreBody?.RequestId ?? null } : { ok: false, error: errorText(core.reason) },
    studio: studio.status === "fulfilled" ? { ok: true, requestId: studioBody?.requestId ?? studioBody?.RequestId ?? null } : { ok: false, error: errorText(studio.reason) },
  };
}
