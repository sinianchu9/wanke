import fs from "node:fs";
import path from "node:path";

const checks = [];
const need = ["ALIYUN_ACCESS_KEY_ID", "ALIYUN_ACCESS_KEY_SECRET"];
for (const key of need) checks.push([key, Boolean(process.env[key]), process.env[key] ? "已设置" : "缺失"]);
const region = process.env.ALIYUN_REGION_ID || "cn-shanghai";
checks.push(["ALIYUN_REGION_ID", ["cn-shanghai", "ap-southeast-1"].includes(region), region]);
const db = path.resolve(process.env.WANKE_DB_PATH || "./data/wanke.db");
const out = path.resolve(process.env.WANKE_OUTPUT_DIR || "./data/outputs");
for (const [name, target] of [["数据库目录", path.dirname(db)], ["归档目录", out]]) {
  try { fs.mkdirSync(target, { recursive: true }); fs.accessSync(target, fs.constants.W_OK); checks.push([name, true, target]); }
  catch (e) { checks.push([name, false, e.message]); }
}
console.log("Wanke doctor\n");
for (const [name, ok, detail] of checks) console.log(`${ok ? "✓" : "✗"} ${name}: ${detail}`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
