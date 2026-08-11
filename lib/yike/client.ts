import "server-only";
import CoreYikeClient from "@alicloud/yike20260707";
import StudioYikeClient from "@alicloud/yike20260319";
import { getYikeRuntimeConfig } from "@/lib/settings";

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
  const runtime = getYikeRuntimeConfig();
  const requested = (runtime.regionId || "ap-southeast-1").trim();
  if (!(requested in YIKE_REGIONS)) {
    throw new Error(`Wanke 当前仅支持万镜一刻地域 ap-southeast-1（新加坡）或 cn-shanghai（上海），收到：${requested}`);
  }
  const regionId = requested as YikeRegionId;
  return { regionId, ...YIKE_REGIONS[regionId] };
}

function config() {
  const runtime = getYikeRuntimeConfig();
  const region = resolveRegion();
  const endpoint = (runtime.endpoint || region.endpoint).trim();
  if (!runtime.accessKeyId || !runtime.accessKeySecret) {
    throw new Error("未配置万镜一刻 AccessKey，请到设置中填写 AccessKey ID / Secret");
  }
  return {
    accessKeyId: runtime.accessKeyId,
    accessKeySecret: runtime.accessKeySecret,
    type: "access_key",
    regionId: region.regionId,
    endpoint,
  } as any;
}

/** 2026-07-07: core video generation / breakdown / remake / render / translation / media. */
export function getCoreYikeClient() {
  return new CoreYikeClient(config());
}

/** 2026-03-19: marketing agents / storyboard / upload credential APIs that are not exposed by 2026-07-07 SDK. */
export function getStudioYikeClient() {
  return new StudioYikeClient(config());
}

export function yikeConfigSummary() {
  const runtime = getYikeRuntimeConfig();
  const region = resolveRegion();
  return {
    configured: Boolean(runtime.accessKeyId && runtime.accessKeySecret),
    regionId: region.regionId,
    regionName: region.label,
    endpoint: (runtime.endpoint || region.endpoint).trim(),
    endpointOverridden: Boolean(runtime.endpoint),
    configSource: runtime.sources,
    apiVersions: ["2026-07-07", "2026-03-19"],
    supportedRegions: Object.entries(YIKE_REGIONS).map(([id, value]) => ({ id, ...value })),
  };
}
