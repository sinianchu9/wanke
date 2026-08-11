import "server-only";
import { db } from "@/lib/db";

export type VideoProviderMode = "auto" | "modelstudio" | "yike";
export type SettingsSource = "ui" | "environment" | "default";

type SettingKey =
  | "video_provider_mode"
  | "modelstudio_api_key"
  | "modelstudio_workspace_id"
  | "modelstudio_base_url"
  | "yike_access_key_id"
  | "yike_access_key_secret"
  | "yike_region_id"
  | "yike_endpoint";

type UpdateInput = {
  videoProviderMode?: VideoProviderMode;
  modelStudioApiKey?: string;
  modelStudioWorkspaceId?: string;
  modelStudioBaseUrl?: string;
  yikeAccessKeyId?: string;
  yikeAccessKeySecret?: string;
  yikeRegionId?: "ap-southeast-1" | "cn-shanghai";
  yikeEndpoint?: string;
  clearModelStudioApiKey?: boolean;
  clearYikeAccessKeyId?: boolean;
  clearYikeAccessKeySecret?: boolean;
};

function storedValue(key: SettingKey) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value?.trim() || "";
}

function writeValue(key: SettingKey, value: string) {
  const clean = value.trim();
  if (!clean) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    return;
  }
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, clean, new Date().toISOString());
}

function removeValue(key: SettingKey) {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

function effective(stored: string, env: string | undefined, fallback = "") {
  if (stored) return { value: stored, source: "ui" as SettingsSource };
  const fromEnv = env?.trim() || "";
  if (fromEnv) return { value: fromEnv, source: "environment" as SettingsSource };
  return { value: fallback, source: "default" as SettingsSource };
}

function masked(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export function getVideoProviderMode(): VideoProviderMode {
  const value = storedValue("video_provider_mode");
  return value === "modelstudio" || value === "yike" ? value : "auto";
}

export function getModelStudioRuntimeConfig() {
  const apiKey = effective(
    storedValue("modelstudio_api_key"),
    process.env.DASHSCOPE_API_KEY?.trim() || process.env.ALIYUN_MODELSTUDIO_API_KEY?.trim(),
  );
  const workspaceId = effective(storedValue("modelstudio_workspace_id"), process.env.ALIYUN_MODELSTUDIO_WORKSPACE_ID);
  const baseUrl = effective(storedValue("modelstudio_base_url"), process.env.ALIYUN_MODELSTUDIO_BASE_URL);
  return {
    apiKey: apiKey.value,
    workspaceId: workspaceId.value,
    baseUrl: baseUrl.value,
    sources: { apiKey: apiKey.source, workspaceId: workspaceId.source, baseUrl: baseUrl.source },
  };
}

export function getYikeRuntimeConfig() {
  const accessKeyId = effective(storedValue("yike_access_key_id"), process.env.ALIYUN_ACCESS_KEY_ID);
  const accessKeySecret = effective(storedValue("yike_access_key_secret"), process.env.ALIYUN_ACCESS_KEY_SECRET);
  const regionId = effective(storedValue("yike_region_id"), process.env.ALIYUN_REGION_ID, "ap-southeast-1");
  const endpoint = effective(storedValue("yike_endpoint"), process.env.ALIYUN_YIKE_ENDPOINT);
  return {
    accessKeyId: accessKeyId.value,
    accessKeySecret: accessKeySecret.value,
    regionId: regionId.value,
    endpoint: endpoint.value,
    sources: {
      accessKeyId: accessKeyId.source,
      accessKeySecret: accessKeySecret.source,
      regionId: regionId.source,
      endpoint: endpoint.source,
    },
  };
}

export function getPublicSettings() {
  const modelStudio = getModelStudioRuntimeConfig();
  const yike = getYikeRuntimeConfig();
  return {
    videoProviderMode: getVideoProviderMode(),
    modelStudio: {
      apiKeyConfigured: Boolean(modelStudio.apiKey),
      apiKeyMasked: masked(modelStudio.apiKey),
      apiKeySource: modelStudio.sources.apiKey,
      workspaceId: modelStudio.workspaceId,
      workspaceIdSource: modelStudio.sources.workspaceId,
      baseUrl: modelStudio.baseUrl,
      baseUrlSource: modelStudio.sources.baseUrl,
    },
    yike: {
      accessKeyIdConfigured: Boolean(yike.accessKeyId),
      accessKeyIdMasked: masked(yike.accessKeyId),
      accessKeyIdSource: yike.sources.accessKeyId,
      accessKeySecretConfigured: Boolean(yike.accessKeySecret),
      accessKeySecretMasked: masked(yike.accessKeySecret),
      accessKeySecretSource: yike.sources.accessKeySecret,
      regionId: yike.regionId || "ap-southeast-1",
      regionIdSource: yike.sources.regionId,
      endpoint: yike.endpoint,
      endpointSource: yike.sources.endpoint,
    },
  };
}

export function updateAppSettings(input: UpdateInput) {
  const transaction = db.transaction(() => {
    if (input.videoProviderMode) writeValue("video_provider_mode", input.videoProviderMode);

    if (input.clearModelStudioApiKey) removeValue("modelstudio_api_key");
    else if (input.modelStudioApiKey?.trim()) writeValue("modelstudio_api_key", input.modelStudioApiKey);
    if (input.modelStudioWorkspaceId !== undefined) writeValue("modelstudio_workspace_id", input.modelStudioWorkspaceId);
    if (input.modelStudioBaseUrl !== undefined) writeValue("modelstudio_base_url", input.modelStudioBaseUrl);

    if (input.clearYikeAccessKeyId) removeValue("yike_access_key_id");
    else if (input.yikeAccessKeyId?.trim()) writeValue("yike_access_key_id", input.yikeAccessKeyId);
    if (input.clearYikeAccessKeySecret) removeValue("yike_access_key_secret");
    else if (input.yikeAccessKeySecret?.trim()) writeValue("yike_access_key_secret", input.yikeAccessKeySecret);
    if (input.yikeRegionId) writeValue("yike_region_id", input.yikeRegionId);
    if (input.yikeEndpoint !== undefined) writeValue("yike_endpoint", input.yikeEndpoint);
  });
  transaction();
  return getPublicSettings();
}
