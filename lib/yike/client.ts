import "server-only";
import CoreYikeClient from "@alicloud/yike20260707";
import StudioYikeClient from "@alicloud/yike20260319";

type GlobalWithYike = typeof globalThis & {
  __wankeCoreYike?: CoreYikeClient;
  __wankeStudioYike?: StudioYikeClient;
};

function config() {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
  const regionId = process.env.ALIYUN_REGION_ID || "cn-shanghai";
  const endpoint = process.env.ALIYUN_YIKE_ENDPOINT || undefined;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("未配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET");
  }
  return { accessKeyId, accessKeySecret, type: "access_key", regionId, endpoint } as any;
}

/** 2026-07-07: core video generation / breakdown / remake / render / translation / media. */
export function getCoreYikeClient() {
  const g = globalThis as GlobalWithYike;
  if (!g.__wankeCoreYike) g.__wankeCoreYike = new CoreYikeClient(config());
  return g.__wankeCoreYike;
}

/** 2026-03-19: marketing agents / storyboard / upload credential APIs that are not exposed by 2026-07-07 SDK. */
export function getStudioYikeClient() {
  const g = globalThis as GlobalWithYike;
  if (!g.__wankeStudioYike) g.__wankeStudioYike = new StudioYikeClient(config());
  return g.__wankeStudioYike;
}

export function yikeConfigSummary() {
  return {
    configured: Boolean(process.env.ALIYUN_ACCESS_KEY_ID && process.env.ALIYUN_ACCESS_KEY_SECRET),
    regionId: process.env.ALIYUN_REGION_ID || "cn-shanghai",
    endpoint: process.env.ALIYUN_YIKE_ENDPOINT || "自动选择区域 Endpoint",
    apiVersions: ["2026-07-07", "2026-03-19"],
  };
}
