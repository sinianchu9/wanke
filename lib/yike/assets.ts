import "server-only";
import { CreateYikeAssetUploadRequest, DeleteYikeAssetMediaInfosRequest, ListYikeWorkspacesRequest, RegisterYikeAssetMediaInfoRequest } from "@alicloud/yike20260319";
import { DeleteMediasRequest, ImportMediaRequest, ListAssetCategoriesRequest } from "@alicloud/yike20260707";
import { getCoreYikeClient, getStudioYikeClient, yikeConfigSummary } from "@/lib/yike/client";
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

function diagnoseProbeError(error: unknown, surface: "core" | "studio") {
  const message = errorText(error);
  if (/MainAccountUserNotFound/i.test(message)) {
    return {
      issue: "main_account_not_initialized",
      error: message,
      hint: surface === "studio"
        ? "当前地域的 Yike Studio 主账户未初始化或尚未开通。请先在万镜一刻完成该账号的产品开通/激活，再测试营销、口播与故事板接口。"
        : "当前地域的 Yike 主账户尚未初始化。",
    };
  }
  if (/MembershipRequired|membership validation failed/i.test(message)) {
    return {
      issue: "membership_required",
      error: message,
      hint: "请求已经到达 Yike，但当前会员等级不足以调用该能力。",
    };
  }
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|InvalidSecurityToken|AccessKey.*disabled/i.test(message)) {
    return {
      issue: "credential_error",
      error: message,
      hint: "AccessKey 无效、已禁用或签名不匹配。",
    };
  }
  return { issue: "api_error", error: message, hint: "接口返回业务错误，请根据 RequestId 继续定位。" };
}

export async function testConnection() {
  const config = yikeConfigSummary();
  const [core, studio] = await Promise.allSettled([
    getCoreYikeClient().listAssetCategories(new ListAssetCategoriesRequest({})),
    getStudioYikeClient().listYikeWorkspaces(new ListYikeWorkspacesRequest({})),
  ]);
  const coreBody = core.status === "fulfilled" ? bodyOf(core.value) : null;
  const studioBody = studio.status === "fulfilled" ? bodyOf(studio.value) : null;
  return {
    ok: core.status === "fulfilled",
    regionId: config.regionId,
    regionName: config.regionName,
    endpoint: config.endpoint,
    core: core.status === "fulfilled"
      ? {
          ok: true,
          state: "reachable",
          requestId: coreBody?.requestId ?? coreBody?.RequestId ?? null,
          note: "Core API 可访问；此探测不提交视频生成任务，因此不代表 AI Generation 会员资格已开通。",
        }
      : { ok: false, state: "blocked", ...diagnoseProbeError(core.reason, "core") },
    studio: studio.status === "fulfilled"
      ? {
          ok: true,
          state: "reachable",
          requestId: studioBody?.requestId ?? studioBody?.RequestId ?? null,
          note: "Studio 主账户与工作室接口可访问。",
        }
      : { ok: false, state: "blocked", ...diagnoseProbeError(studio.reason, "studio") },
    generationEligibility: {
      state: "not_probed",
      note: "为避免健康检查产生真实生成任务或费用，AI 视频生成会员资格只在实际提交任务时校验。",
    },
  };
}
