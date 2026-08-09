import "server-only";
import CoreYikeClient from "@alicloud/yike20260707";
import StudioYikeClient from "@alicloud/yike20260319";

type GlobalWithYike = typeof globalThis & {
  __wankeCoreYike?: CoreYikeClient;
  __wankeStudioYike?: StudioYikeClient;
};

export const YIKE_REGIONS = {
  "ap-southeast-1": {
    label: "新加坡",
    endpoint: "yike.ap-southeast-1.aliyuncs.com",
  },
  "cn-shanghai": {
    label: "上海",
    endpoint: "yike.cn-shanghai.aliyuncs.com",
  },
} as const;

export type YikeRegionId = keyof typeof YIKE_REGIONS;

function resolveRegion() {
  const requested = (process.env.ALIYUN_REGION_ID || "ap-southeast-1").trim();
  if (!(requested in YIKE_REGIONS)) {
    throw new Error(`Wanke 当前仅支持万镜一刻地域 ap-southeast-1（新加坡）或 cn-shanghai（上海），收到：${requested}`);
  }
  const regionId = requested as YikeRegionId;
  return { regionId, ...YIKE_REGIONS[regionId] };
}

function config() {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
  const region = resolveRegion();
  const endpoint = (process.env.ALIYUN_YIKE_ENDPOINT || region.endpoint).trim();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("未配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET");
  }
  return {
    accessKeyId,
    accessKeySecret,
    type: "access_key",
    regionId: region.regionId,
    endpoint,
  } as any;
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
  const region = resolveRegion();
  return {
    configured: Boolean(process.env.ALIYUN_ACCESS_KEY_ID && process.env.ALIYUN_ACCESS_KEY_SECRET),
    regionId: region.regionId,
    regionName: region.label,
    endpoint: (process.env.ALIYUN_YIKE_ENDPOINT || region.endpoint).trim(),
    endpointOverridden: Boolean(process.env.ALIYUN_YIKE_ENDPOINT),
    apiVersions: ["2026-07-07", "2026-03-19"],
    supportedRegions: Object.entries(YIKE_REGIONS).map(([id, value]) => ({ id, ...value })),
  };
}
