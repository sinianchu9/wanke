import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const checks = [];
const db = path.resolve(process.env.WANKE_DB_PATH || "./data/wanke.db");
const inputs = path.resolve(process.env.WANKE_INPUT_DIR || "./data/inputs");
const out = path.resolve(process.env.WANKE_OUTPUT_DIR || "./data/outputs");
const storedSettings = readStoredSettings(db);
const stored = key => String(storedSettings.get(key) || "").trim();
const effective = (key, envValue, fallback = "") => stored(key) || String(envValue || "").trim() || fallback;

const providerModeValue = stored("video_provider_mode");
const providerMode = providerModeValue === "modelstudio" || providerModeValue === "yike" ? providerModeValue : "auto";
const modelStudioKey = effective("modelstudio_api_key", process.env.DASHSCOPE_API_KEY || process.env.ALIYUN_MODELSTUDIO_API_KEY);
const workspaceId = effective("modelstudio_workspace_id", process.env.ALIYUN_MODELSTUDIO_WORKSPACE_ID);
const baseUrl = effective("modelstudio_base_url", process.env.ALIYUN_MODELSTUDIO_BASE_URL);
const modelStudioBlockReason = modelStudioDirectBlockReason(modelStudioKey, baseUrl);
const yikeAccessKeyId = effective("yike_access_key_id", process.env.ALIYUN_ACCESS_KEY_ID);
const yikeAccessKeySecret = effective("yike_access_key_secret", process.env.ALIYUN_ACCESS_KEY_SECRET);
const modelStudioReady = Boolean(modelStudioKey) && !modelStudioBlockReason;
const yikeReady = Boolean(yikeAccessKeyId && yikeAccessKeySecret);
const generationReady = providerMode === "modelstudio" ? modelStudioReady : providerMode === "yike" ? yikeReady : modelStudioReady || yikeReady;

checks.push(["Node.js", Number(process.versions.node.split(".")[0]) >= 22, `v${process.versions.node}（要求 22+）`]);
checks.push(["视频引擎模式", true, providerMode === "auto" ? "自动" : providerMode === "modelstudio" ? "百炼" : "万镜一刻"]);
checks.push(["视频生成凭证", generationReady, generationReady
  ? providerMode === "yike" ? "万镜一刻已配置" : modelStudioReady ? "百炼 Model Studio 已配置" : "万镜一刻已配置"
  : modelStudioBlockReason || (providerMode === "modelstudio" ? "当前选择百炼，但 API Key 未配置" : providerMode === "yike" ? "当前选择万镜一刻，但 AccessKey 未配置完整" : "缺少百炼 API Key / 万镜一刻 AccessKey"])]);
checks.push(["百炼直连计费通道", !modelStudioBlockReason, modelStudioBlockReason || "未检测到 Token Plan/Coding Plan 或兼容模式地址"]);
checks.push(["百炼 Model Studio", true, modelStudioReady ? "Pay-As-You-Go 直连配置已就绪；Key、Workspace 和模型权限在首次生成时校验" : modelStudioBlockReason ? "已阻止不适合应用后端直连的套餐配置" : "未配置或未启用"]);
checks.push(["扩展工作流", true, yikeReady ? "已配置，复刻 / 数字人 / 故事板可用" : "未配置，不影响百炼直连基础视频生成"]);

const region = effective("yike_region_id", process.env.ALIYUN_REGION_ID, "ap-southeast-1");
const validRegion = ["cn-shanghai", "ap-southeast-1"].includes(region);
checks.push(["扩展工作流地域", !yikeReady || validRegion, yikeReady ? region : "未启用，不参与基础生成检查"]);
checks.push(["Model Studio Endpoint", !modelStudioBlockReason, modelStudioBlockReason || baseUrl || (workspaceId ? `${workspaceId}.ap-southeast-1.maas.aliyuncs.com` : "dashscope-intl.aliyuncs.com（可用；建议配置 Workspace ID）")]);

for (const [name, target] of [["数据库目录", path.dirname(db)], ["本地输入目录", inputs], ["归档目录", out]]) {
  try { fs.mkdirSync(target, { recursive: true }); fs.accessSync(target, fs.constants.W_OK); checks.push([name, true, target]); }
  catch (e) { checks.push([name, false, e.message]); }
}

const ffmpeg = checkBinary(String(process.env.FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg");
const ffprobe = checkBinary(String(process.env.FFPROBE_PATH || "ffprobe").trim() || "ffprobe");
checks.push(["FFmpeg", ffmpeg.ok, ffmpeg.ok ? ffmpeg.path : `${ffmpeg.path} 不可用；最终成片需要安装 FFmpeg`]);
checks.push(["ffprobe", ffprobe.ok, ffprobe.ok ? ffprobe.path : `${ffprobe.path} 不可用；媒体检查与最终成片需要 ffprobe`]);

console.log("Wanke doctor\n");
for (const [name, ok, detail] of checks) console.log(`${ok ? "✓" : "✗"} ${name}: ${detail}`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;

function modelStudioDirectBlockReason(apiKey, endpoint) {
  const key = String(apiKey || "").trim().toLowerCase();
  if (key.startsWith("sk-sp-")) return "检测到 Token Plan 专属 Key（sk-sp-）：官方不允许用于 Wanke 这类自定义应用后端直连，请改用 Pay-As-You-Go Key";

  const value = String(endpoint || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase().replace(/\/+$/, "");
    if (host.startsWith("token-plan.") || host.startsWith("coding.") || host.includes("coding.dashscope")) return "检测到 Token Plan/Coding Plan Endpoint：该套餐不支持自定义应用后端直连";
    if (pathname.includes("/compatible-mode") || pathname.includes("/apps/anthropic")) return "检测到兼容模式 Base URL：Wanke 视频生成需要原生 API Root，不能使用 /compatible-mode/v1 或 /apps/anthropic";
  } catch {
    return "Model Studio Base URL 不是有效 URL";
  }
  return "";
}

function readStoredSettings(dbPath) {
  const values = new Map();
  if (!fs.existsSync(dbPath)) return values;
  try {
    const connection = new Database(dbPath, { readonly: true, fileMustExist: true });
    const hasSettings = connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'").get();
    if (hasSettings) {
      for (const row of connection.prepare("SELECT key, value FROM settings").all()) values.set(String(row.key), String(row.value || ""));
    }
    connection.close();
  } catch {
    // Doctor still checks environment configuration and writable paths if an old/corrupt DB cannot be inspected.
  }
  return values;
}

function checkBinary(binary) {
  const result = spawnSync(binary, ["-version"], { stdio: "ignore", timeout: 5000 });
  return { path: binary, ok: !result.error && result.status === 0 };
}
