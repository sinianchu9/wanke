import "server-only";
import { CreateYikeAssetUploadRequest, DeleteYikeAssetMediaInfosRequest, GetYikeAssetMediaInfoRequest, ListYikeWorkspacesRequest, RegisterYikeAssetMediaInfoRequest } from "@alicloud/yike20260319";
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
 * Register the same URL on both API surfaces when possible. Yike's own upload bucket
 * can be private, so the Core import may later become unusable even if it returns a MediaId.
 * Generation therefore resolves a fresh signed Studio FileUrl at submit time instead of
 * trusting a previously imported Core MediaId.
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

/**
 * Resolve a Yike Studio MediaId to a currently signed, downloadable FileUrl.
 * The raw FileURL returned by CreateYikeAssetUpload may point at a private bucket and is
 * not suitable as a durable public URL. GetYikeAssetMediaInfo returns the current signed URL.
 */
export async function resolveStudioAssetUrl(mediaId: string, options?: { timeoutMs?: number; pollMs?: number }) {
  const timeoutMs = Math.max(2_000, options?.timeoutMs ?? 20_000);
  const pollMs = Math.max(300, options?.pollMs ?? 1_000);
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "Unknown";

  while (true) {
    const response = await getStudioYikeClient().getYikeAssetMediaInfo(new GetYikeAssetMediaInfoRequest({ mediaId }));
    const body = bodyOf(response);
    const mediaInfo = body?.mediaInfo ?? body?.MediaInfo;
    const files = mediaInfo?.fileInfoList ?? mediaInfo?.FileInfoList ?? [];
    const basics = Array.isArray(files)
      ? files.map((file: any) => file?.fileBasicInfo ?? file?.FileBasicInfo).filter(Boolean)
      : [];
    const preferred = basics.find((basic: any) => String(basic?.fileType ?? basic?.FileType ?? "").toLowerCase() === "source_file") || basics[0];
    const status = String(preferred?.fileStatus ?? preferred?.FileStatus ?? "Unknown");
    const fileUrl = preferred?.fileUrl ?? preferred?.FileUrl ?? "";
    lastStatus = status;

    if (/^normal$/i.test(status) && fileUrl) {
      return {
        url: String(fileUrl),
        status,
        requestId: body?.requestId ?? body?.RequestId ?? null,
      };
    }
    if (/uploadfail|failed|error/i.test(status)) {
      throw new Error(`Yike 素材状态异常：${status}。该素材没有完成上传，请从素材库重新上传后再生成。`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Yike 素材尚未就绪：${lastStatus}。请稍后重试；如果持续不变，请重新上传素材。`);
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
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
