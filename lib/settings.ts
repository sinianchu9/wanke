import "server-only";
import { db } from "@/lib/db";
import { clearSecret, readSecret, writeSecret } from "@/lib/secrets";

// Keep this guard here as well as in db.ts so a dev hot reload can pick up the
// settings feature without requiring the existing SQLite connection to restart.
db.exec(`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);

export type VideoProviderMode = "auto" | "modelstudio" | "yike";
export type SettingsSource = "ui" | "environment" | "inherited_ui" | "inherited_env" | "default";
export type ModelStudioChannel = "happyhorse" | "wan" | "default";

type SettingKey =
  | "video_provider_mode"
  | "modelstudio_api_key"
  | "modelstudio_workspace_id"
  | "modelstudio_base_url"
  | "happyhorse_api_key"
  | "happyhorse_workspace_id"
  | "happyhorse_base_url"
  | "wan_api_key"
  | "wan_workspace_id"
  | "wan_base_url"
  | "yike_access_key_id"
  | "yike_access_key_secret"
  | "yike_region_id"
  | "yike_endpoint";

type UpdateInput = {
  videoProviderMode?: VideoProviderMode;
  modelStudioApiKey?: string;
  modelStudioWorkspaceId?: string;
  modelStudioBaseUrl?: string;
  happyhorseApiKey?: string;
  happyhorseWorkspaceId?: string;
  happyhorseBaseUrl?: string;
  wanApiKey?: string;
  wanWorkspaceId?: string;
  wanBaseUrl?: string;
  yikeAccessKeyId?: string;
  yikeAccessKeySecret?: string;
  yikeRegionId?: "ap-southeast-1" | "cn-shanghai";
  yikeEndpoint?: string;
  clearModelStudioApiKey?: boolean;
  clearHappyhorseApiKey?: boolean;
  clearWanApiKey?: boolean;
  clearYikeAccessKeyId?: boolean;
  clearYikeAccessKeySecret?: boolean;
};

const TOKEN_PLAN_BLOCK = "Token Plan / Coding Plan 专属 Key 不能直接用于 Wanke 应用后端。阿里云当前仅允许这类套餐在受支持的 AI 编程工具或 Agent 中交互式使用；Wanke 直连视频请使用 Pay-As-You-Go API Key。";
const COMPATIBLE_URL_BLOCK = "这里需要百炼原生视频 API Root，不是 /compatible-mode/v1 或 /apps/anthropic。Wanke 会自动追加 /api/v1/services/aigc/video-generation/video-synthesis。";

/**
 * Provider credentials live encrypted in `secrets` (see `migrateLegacyPlainSecrets`).
 * Reading them from the plain `settings` table only would silently drop the key the
 * moment that migration runs, which reads to a member as "还没有配置 API Key" and stops
 * every creation. So these keys are stored and read from the secret store, and the plain
 * row is only kept as a fallback for a database that has not been migrated yet.
 */
const SECRET_BACKED_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
  "modelstudio_api_key",
  "happyhorse_api_key",
  "wan_api_key",
  "yike_access_key_id",
  "yike_access_key_secret",
]);

function plainStoredValue(key: SettingKey) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value?.trim() || "";
}

function dropPlainValue(key: SettingKey) {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

function storedValue(key: SettingKey) {
  if (!SECRET_BACKED_KEYS.has(key)) return plainStoredValue(key);
  const secret = readSecret(key).trim();
  return secret || plainStoredValue(key);
}

function writeValue(key: SettingKey, value: string) {
  const clean = value.trim();
  if (SECRET_BACKED_KEYS.has(key)) {
    if (clean) writeSecret(key, clean);
    else clearSecret(key);
    // Never keep the same credential in two places, plain text least of all.
    dropPlainValue(key);
    return;
  }
  if (!clean) {
    dropPlainValue(key);
    return;
  }
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, clean, new Date().toISOString());
}

function removeValue(key: SettingKey) {
  if (SECRET_BACKED_KEYS.has(key)) clearSecret(key);
  dropPlainValue(key);
}

function effective(stored: string, env: string | undefined, fallback = "") {
  if (stored) return { value: stored, source: "ui" as SettingsSource };
  const fromEnv = env?.trim() || "";
  if (fromEnv) return { value: fromEnv, source: "environment" as SettingsSource };
  return { value: fallback, source: "default" as SettingsSource };
}

function channelEffective(
  dedicatedStored: string,
  dedicatedEnv: string | undefined,
  fallbackStored: string,
  fallbackEnv: string | undefined,
  defaultFallback = ""
): { value: string; source: SettingsSource } {
  if (dedicatedStored) return { value: dedicatedStored, source: "ui" };
  const dEnv = dedicatedEnv?.trim() || "";
  if (dEnv) return { value: dEnv, source: "environment" };
  if (fallbackStored) return { value: fallbackStored, source: "inherited_ui" };
  const fEnv = fallbackEnv?.trim() || "";
  if (fEnv) return { value: fEnv, source: "inherited_env" };
  return { value: defaultFallback, source: "default" };
}

function masked(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function modelStudioEnvironmentApiKey() {
  return process.env.DASHSCOPE_API_KEY?.trim() || process.env.ALIYUN_MODELSTUDIO_API_KEY?.trim() || "";
}

function modelStudioEnvironmentBaseUrl() {
  return process.env.ALIYUN_MODELSTUDIO_BASE_URL?.trim() || "";
}

function modelStudioEffectiveValues() {
  const apiKey = effective(storedValue("modelstudio_api_key"), modelStudioEnvironmentApiKey());
  const workspaceId = effective(storedValue("modelstudio_workspace_id"), process.env.ALIYUN_MODELSTUDIO_WORKSPACE_ID);
  const baseUrl = effective(storedValue("modelstudio_base_url"), modelStudioEnvironmentBaseUrl());
  return { apiKey, workspaceId, baseUrl };
}

export function modelStudioDirectUseBlockReason(apiKeyValue: string, baseUrlValue: string) {
  const key = apiKeyValue.trim().toLowerCase();
  if (key.startsWith("sk-sp-")) return TOKEN_PLAN_BLOCK;

  const baseUrl = baseUrlValue.trim();
  if (!baseUrl) return "";
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase().replace(/\/+$/, "");
    if (host.startsWith("token-plan.") || host.startsWith("coding.") || host.includes("coding.dashscope")) return TOKEN_PLAN_BLOCK;
    if (pathname.includes("/compatible-mode") || pathname.includes("/apps/anthropic")) return COMPATIBLE_URL_BLOCK;
  } catch {
    // URL shape is validated by the API route. Runtime config remains defensive.
  }
  return "";
}

export function getVideoProviderMode(): VideoProviderMode {
  const value = storedValue("video_provider_mode");
  return value === "modelstudio" || value === "yike" ? value : "auto";
}

export function getModelStudioChannelConfig(channel: ModelStudioChannel = "default") {
  const universal = modelStudioEffectiveValues();
  if (channel === "default") {
    const blockedReason = modelStudioDirectUseBlockReason(universal.apiKey.value, universal.baseUrl.value);
    return {
      channel: "default" as const,
      apiKey: blockedReason ? "" : universal.apiKey.value,
      workspaceId: universal.workspaceId.value,
      baseUrl: universal.baseUrl.value,
      blockedReason,
      credentialPresent: Boolean(universal.apiKey.value),
      apiKeyMasked: masked(universal.apiKey.value),
      sources: { apiKey: universal.apiKey.source, workspaceId: universal.workspaceId.source, baseUrl: universal.baseUrl.source },
      isOverridden: { apiKey: false, workspaceId: false, baseUrl: false },
    };
  }

  const prefix = channel === "happyhorse" ? "happyhorse" : "wan";
  const dedicatedApiKey = storedValue(`${prefix}_api_key` as SettingKey);
  const dedicatedEnvKey = (channel === "happyhorse" ? process.env.HAPPYHORSE_API_KEY : process.env.WAN_API_KEY)?.trim() || "";
  const apiKey = channelEffective(dedicatedApiKey, dedicatedEnvKey, storedValue("modelstudio_api_key"), modelStudioEnvironmentApiKey());

  const dedicatedWs = storedValue(`${prefix}_workspace_id` as SettingKey);
  const dedicatedEnvWs = (channel === "happyhorse" ? process.env.HAPPYHORSE_WORKSPACE_ID : process.env.WAN_WORKSPACE_ID)?.trim() || "";
  const workspaceId = channelEffective(dedicatedWs, dedicatedEnvWs, storedValue("modelstudio_workspace_id"), process.env.ALIYUN_MODELSTUDIO_WORKSPACE_ID);

  const dedicatedUrl = storedValue(`${prefix}_base_url` as SettingKey);
  const dedicatedEnvUrl = (channel === "happyhorse" ? process.env.HAPPYHORSE_BASE_URL : process.env.WAN_BASE_URL)?.trim() || "";
  const baseUrl = channelEffective(dedicatedUrl, dedicatedEnvUrl, storedValue("modelstudio_base_url"), modelStudioEnvironmentBaseUrl());

  const blockedReason = modelStudioDirectUseBlockReason(apiKey.value, baseUrl.value);
  return {
    channel,
    apiKey: blockedReason ? "" : apiKey.value,
    workspaceId: workspaceId.value,
    baseUrl: baseUrl.value,
    blockedReason,
    credentialPresent: Boolean(apiKey.value),
    apiKeyMasked: masked(apiKey.value),
    sources: { apiKey: apiKey.source, workspaceId: workspaceId.source, baseUrl: baseUrl.source },
    isOverridden: {
      apiKey: apiKey.source === "ui" || apiKey.source === "environment",
      workspaceId: workspaceId.source === "ui" || workspaceId.source === "environment",
      baseUrl: baseUrl.source === "ui" || baseUrl.source === "environment",
    },
  };
}

export function getModelStudioRuntimeConfig() {
  return getModelStudioChannelConfig("default");
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
  const modelStudio = getModelStudioChannelConfig("default");
  const happyhorse = getModelStudioChannelConfig("happyhorse");
  const wan = getModelStudioChannelConfig("wan");
  const yike = getYikeRuntimeConfig();
  return {
    videoProviderMode: getVideoProviderMode(),
    modelStudio: {
      apiKeyConfigured: modelStudio.credentialPresent,
      apiKeyMasked: modelStudio.apiKeyMasked,
      apiKeySource: modelStudio.sources.apiKey,
      workspaceId: modelStudio.workspaceId,
      workspaceIdSource: modelStudio.sources.workspaceId,
      baseUrl: modelStudio.baseUrl,
      baseUrlSource: modelStudio.sources.baseUrl,
      blockedReason: modelStudio.blockedReason,
    },
    happyhorse: {
      apiKeyConfigured: happyhorse.credentialPresent,
      apiKeyMasked: happyhorse.apiKeyMasked,
      apiKeySource: happyhorse.sources.apiKey,
      workspaceId: happyhorse.workspaceId,
      workspaceIdSource: happyhorse.sources.workspaceId,
      baseUrl: happyhorse.baseUrl,
      baseUrlSource: happyhorse.sources.baseUrl,
      blockedReason: happyhorse.blockedReason,
      isOverridden: happyhorse.isOverridden,
    },
    wan: {
      apiKeyConfigured: wan.credentialPresent,
      apiKeyMasked: wan.apiKeyMasked,
      apiKeySource: wan.sources.apiKey,
      workspaceId: wan.workspaceId,
      workspaceIdSource: wan.sources.workspaceId,
      baseUrl: wan.baseUrl,
      baseUrlSource: wan.sources.baseUrl,
      blockedReason: wan.blockedReason,
      isOverridden: wan.isOverridden,
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
  const current = modelStudioEffectiveValues();
  const nextModelStudioApiKey = input.clearModelStudioApiKey
    ? modelStudioEnvironmentApiKey()
    : input.modelStudioApiKey?.trim() || current.apiKey.value;
  const nextModelStudioBaseUrl = input.modelStudioBaseUrl !== undefined
    ? input.modelStudioBaseUrl.trim() || modelStudioEnvironmentBaseUrl()
    : current.baseUrl.value;
  const blockReason = modelStudioDirectUseBlockReason(nextModelStudioApiKey, nextModelStudioBaseUrl);
  if (blockReason) throw new Error(`${blockReason} 请清除 Token Plan/Coding Plan Key 或兼容模式 Base URL 后再保存。`);

  if (input.happyhorseApiKey || input.happyhorseBaseUrl) {
    const hhBlock = modelStudioDirectUseBlockReason(input.happyhorseApiKey || "", input.happyhorseBaseUrl || "");
    if (hhBlock) throw new Error(`HappyHorse 配置校验未通过：${hhBlock}`);
  }

  if (input.wanApiKey || input.wanBaseUrl) {
    const wanBlock = modelStudioDirectUseBlockReason(input.wanApiKey || "", input.wanBaseUrl || "");
    if (wanBlock) throw new Error(`Wan 配置校验未通过：${wanBlock}`);
  }

  const transaction = db.transaction(() => {
    if (input.videoProviderMode) writeValue("video_provider_mode", input.videoProviderMode);

    if (input.clearModelStudioApiKey) removeValue("modelstudio_api_key");
    else if (input.modelStudioApiKey?.trim()) writeValue("modelstudio_api_key", input.modelStudioApiKey);
    if (input.modelStudioWorkspaceId !== undefined) writeValue("modelstudio_workspace_id", input.modelStudioWorkspaceId);
    if (input.modelStudioBaseUrl !== undefined) writeValue("modelstudio_base_url", input.modelStudioBaseUrl);

    if (input.clearHappyhorseApiKey) removeValue("happyhorse_api_key");
    else if (input.happyhorseApiKey?.trim()) writeValue("happyhorse_api_key", input.happyhorseApiKey);
    if (input.happyhorseWorkspaceId !== undefined) writeValue("happyhorse_workspace_id", input.happyhorseWorkspaceId);
    if (input.happyhorseBaseUrl !== undefined) writeValue("happyhorse_base_url", input.happyhorseBaseUrl);

    if (input.clearWanApiKey) removeValue("wan_api_key");
    else if (input.wanApiKey?.trim()) writeValue("wan_api_key", input.wanApiKey);
    if (input.wanWorkspaceId !== undefined) writeValue("wan_workspace_id", input.wanWorkspaceId);
    if (input.wanBaseUrl !== undefined) writeValue("wan_base_url", input.wanBaseUrl);

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

