import fs from "node:fs";
import path from "node:path";

const checks = [];
const modelStudioReady = Boolean(process.env.DASHSCOPE_API_KEY || process.env.ALIYUN_MODELSTUDIO_API_KEY);
const yikeReady = Boolean(process.env.ALIYUN_ACCESS_KEY_ID && process.env.ALIYUN_ACCESS_KEY_SECRET);
checks.push(["视频生成凭证", modelStudioReady || yikeReady, modelStudioReady ? "百炼 Model Studio 直连已配置" : yikeReady ? "兼容生成链路已配置" : "缺失 DASHSCOPE_API_KEY / 兼容工作流凭证"]);
checks.push(["DASHSCOPE_API_KEY", true, modelStudioReady ? "已配置；Key、Workspace 和模型权限在首次生成时校验" : "未配置，将使用兼容生成链路"]);
checks.push(["扩展工作流", true, yikeReady ? "已配置，复刻 / 数字人 / 故事板可用" : "未配置，不影响百炼直连基础视频生成"]);

const region = process.env.ALIYUN_REGION_ID || "ap-southeast-1";
const validRegion = ["cn-shanghai", "ap-southeast-1"].includes(region);
checks.push(["扩展工作流地域", !yikeReady || validRegion, yikeReady ? region : "未启用，不参与基础生成检查"]);
const workspaceId = process.env.ALIYUN_MODELSTUDIO_WORKSPACE_ID || "";
checks.push(["Model Studio Endpoint", true, workspaceId ? `${workspaceId}.ap-southeast-1.maas.aliyuncs.com` : "dashscope-intl.aliyuncs.com（可用；建议配置 Workspace ID）"]);

const db = path.resolve(process.env.WANKE_DB_PATH || "./data/wanke.db");
const inputs = path.resolve(process.env.WANKE_INPUT_DIR || "./data/inputs");
const out = path.resolve(process.env.WANKE_OUTPUT_DIR || "./data/outputs");
for (const [name, target] of [["数据库目录", path.dirname(db)], ["本地输入目录", inputs], ["归档目录", out]]) {
  try { fs.mkdirSync(target, { recursive: true }); fs.accessSync(target, fs.constants.W_OK); checks.push([name, true, target]); }
  catch (e) { checks.push([name, false, e.message]); }
}
console.log("Wanke doctor\n");
for (const [name, ok, detail] of checks) console.log(`${ok ? "✓" : "✗"} ${name}: ${detail}`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
