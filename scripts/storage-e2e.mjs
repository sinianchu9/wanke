// Phase 5 acceptance (§9.5 存储与备份): ownership & isolation, unguessable names,
// download auth with Range, delete-is-a-real-delete, orphan sweep, disk alarm,
// registry-vs-disk reconciliation, verified backup and restore, §39 work management.
//
//   ./scripts/e2e-run.sh scripts/storage-e2e.mjs
//
// The upstream video service is the protocol mock (scripts/modelstudio-mock.mjs), so
// the real archive path downloads real bytes over HTTP before anything is asserted.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { startModelStudioMock } from "./modelstudio-mock.mjs";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:3100").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@wanke.test";
const DB_PATH = process.env.E2E_DB || "./data/e2e.db";
const OUTPUT_DIR = path.resolve(process.env.WANKE_OUTPUT_DIR || "./data/e2e-outputs");
const INPUT_DIR = path.resolve(process.env.WANKE_INPUT_DIR || "./data/e2e-inputs");
const BACKUP_DIR = path.resolve(process.env.E2E_BACKUP_DIR || `${DB_PATH.replace(/\.db$/, "")}-backups`);
const PROVIDER_PORT = Number(process.env.E2E_STORAGE_PROVIDER_PORT || 3132);

const TECHNICAL_PATTERN = /Provider|Endpoint|RequestId|Request Id|MediaId|task_id|task_status|X-DashScope|Bearer|InvalidApiKey|Throttling|InternalError|fetch failed|ECONNRESET|socket hang up|SQLITE|WORKER_|__mock|at [A-Za-z0-9_$.]+\s*\(/i;
const UPSTREAM_ENUM_PATTERN = /\b(?:PENDING|RUNNING|SUCCEEDED|FAILED|CANCELED|SUSPENDED|UNKNOWN)\b/;

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`); }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function call(route, { method = "GET", body, cookie, headers = {}, raw = false } = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    cache: "no-store",
  });
  if (raw) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, buffer };
  }
  let text = "";
  let json = null;
  try { text = await response.text(); json = JSON.parse(text); } catch { /* html */ }
  const setCookie = response.headers.get("set-cookie");
  return { status: response.status, json, text, session: setCookie ? setCookie.split(";")[0] : null };
}

const Database = (await import("better-sqlite3")).default;
function withDb(fn) {
  const db = new Database(DB_PATH, { timeout: 15000 });
  try { return fn(db); } finally { db.close(); }
}
function query(sql, ...params) { return withDb(db => db.prepare(sql).all(...params)); }
function queryOne(sql, ...params) { return query(sql, ...params)[0] || null; }
function execute(sql, ...params) { return withDb(db => db.prepare(sql).run(...params)); }

async function register(email, name, password = "storage-pass-123") {
  const result = await call("/api/auth/register", { method: "POST", body: { email, name, password, termsAccepted: true } });
  if (result.status !== 201) throw new Error(`register ${email} failed: ${result.status} ${result.text.slice(0, 200)}`);
  return { cookie: result.session, id: result.json.user.id, email, name };
}

function makeJobsDue() {
  const past = new Date(Date.now() - 120_000).toISOString();
  execute(`UPDATE jobs SET updated_at=? WHERE status IN ('queued','running','unknown') AND updated_at > ?`, past, past);
}

async function tickUntil(predicate, { maxTicks = 10 } = {}) {
  for (let index = 0; index < maxTicks; index += 1) {
    makeJobsDue();
    await call("/api/admin/worker", { method: "POST", cookie: admin.cookie });
    if (predicate()) return true;
    await sleep(150);
  }
  return predicate();
}

function runScript(command, args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: process.cwd(), env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("exit", code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function scanMemberWork(label, work) {
  // videoUrl is result content (like job outputs in worker-e2e); everything else a
  // member reads must be business language with no internal identifiers.
  const text = JSON.stringify(work ?? "").replace(/"videoUrl":"[^"]*"/g, '"videoUrl":"<结果链接>"');
  const hit = TECHNICAL_PATTERN.exec(text) || UPSTREAM_ENUM_PATTERN.exec(text);
  check(`${label} 没有泄露内部技术信息`, !hit, hit ? `命中「${hit[0]}」：${text.slice(0, 200)}` : "");
}

// ---------- fixtures ----------

const provider = await startModelStudioMock({ port: PROVIDER_PORT, apiKey: "sk-ws-e2e-storage-key" });
const admin = await register(ADMIN_EMAIL, "Operator", "admin-pass-123");
const alice = await register("alice@wanke.test", "Alice");
const bob = await register("bob@wanke.test", "Bob");

const serviceConfig = await call("/api/settings", {
  method: "POST", cookie: admin.cookie,
  body: { videoProviderMode: "modelstudio", modelStudioApiKey: provider.apiKey, modelStudioBaseUrl: provider.baseUrl },
});
if (serviceConfig.status !== 200) throw new Error(`creation service config failed: ${serviceConfig.status} ${serviceConfig.text.slice(0, 200)}`);

await call("/api/admin/system-settings", {
  method: "POST", cookie: admin.cookie,
  body: {
    values: {
      worker_enabled: false,
      notify_job_email: false,
      guard_max_submits_per_minute: 600,
      guard_free_max_submits_per_minute: 600,
      guard_burst_max_submits: 600,
      guard_min_concurrent_jobs: 2,
      guard_max_concurrent_jobs: 12,
      guard_user_daily_cost_cents: 0,
      cost_per_video_second_cents: 0,
    },
  },
});

await provider.configure({ outcome: "succeeded", pollsToFinish: 1, transientCount: 0 });

async function createSucceededJob(user, title) {
  const created = await call("/api/jobs", {
    method: "POST", cookie: user.cookie,
    body: { kind: "video_generation", title, input: { prompt: "一只在雪地里奔跑的柴犬", jobType: "text_to_video" }, clientRequestId: `s-${randomUUID().replace(/-/g, "").slice(0, 16)}` },
  });
  if (created.status !== 201) throw new Error(`submit failed: ${created.status} ${created.text.slice(0, 200)}`);
  const jobId = created.json.job.id;
  const done = await tickUntil(() => queryOne("SELECT status FROM jobs WHERE id=?", jobId)?.status === "succeeded");
  if (!done) throw new Error(`job ${jobId} did not succeed`);
  return queryOne("SELECT * FROM jobs WHERE id=?", jobId);
}

try {
  // ---------- 归档登记（写文件与登记同生） ----------
  console.log("== 归档登记与归属 ==");
  let jobRow = await createSucceededJob(alice, "存储验收 · 甲");
  check("成功后结果先指向上游链接", Boolean(JSON.parse(jobRow.output_json || "[]")[0]?.outputUrl));
  const archiveAction = await call(`/api/jobs/${jobRow.id}`, { method: "POST", cookie: alice.cookie, body: { action: "archive", index: 0 } });
  check("一键保存到平台存储", archiveAction.status === 200 && Boolean(archiveAction.json?.output?.archivedFile), `${archiveAction.status} ${archiveAction.text.slice(0, 200)}`);
  check("他人不能归档我的任务", (await call(`/api/jobs/${jobRow.id}`, { method: "POST", cookie: bob.cookie, body: { action: "archive", index: 0 } })).status === 404);
  jobRow = queryOne("SELECT * FROM jobs WHERE id=?", jobRow.id);
  const outputs = JSON.parse(jobRow.output_json || "[]");
  const archivedName = outputs[0]?.archivedFile || "";
  check("结果已归档到本地", Boolean(archivedName), JSON.stringify(outputs).slice(0, 200));
  check("文件名不可猜测（随机标识，不含标题与邮箱）", /^[0-9a-f]{8}-[0-9a-f-]+-\d+\.[a-z0-9]+$/i.test(archivedName) && !archivedName.includes("alice") && !archivedName.includes("存储"), archivedName);
  const filePath = path.join(OUTPUT_DIR, archivedName);
  check("归档文件真实存在", fs.existsSync(filePath) && fs.statSync(filePath).size > 0);
  const object = queryOne("SELECT * FROM storage_objects WHERE storage_key=?", archivedName);
  check("登记行记录归属与大小", object?.user_id === alice.id && Number(object?.size_bytes) === fs.statSync(filePath).size, JSON.stringify(object));
  check("任务持有该文件的引用", Boolean(queryOne("SELECT 1 FROM storage_object_refs WHERE storage_key=? AND ref_type='job' AND ref_id=?", archivedName, jobRow.id)));
  check("上游确实被下载过", provider.state.videoDownloads >= 1, `${provider.state.videoDownloads}`);

  // ---------- 下载鉴权与 Range ----------
  console.log("== 下载鉴权与断点续传 ==");
  const full = await call(`/api/archive/${encodeURIComponent(archivedName)}`, { cookie: alice.cookie, raw: true });
  check("主人可以下载自己的归档", full.status === 200 && full.buffer.length === fs.statSync(filePath).size, `${full.status}`);
  check("下载是私有缓存", String(full.headers.get("cache-control") || "").includes("private"), full.headers.get("cache-control"));
  const ranged = await call(`/api/archive/${encodeURIComponent(archivedName)}`, { cookie: alice.cookie, raw: true, headers: { range: "bytes=0-9" } });
  check("Range 请求返回 206 与前 10 字节", ranged.status === 206 && ranged.buffer.length === 10 && String(ranged.headers.get("content-range")).startsWith("bytes 0-9/"), `${ranged.status} ${ranged.headers.get("content-range")}`);
  const badRange = await call(`/api/archive/${encodeURIComponent(archivedName)}`, { cookie: alice.cookie, raw: true, headers: { range: "bytes=999999999-" } });
  check("越界 Range 返回 416", badRange.status === 416, `${badRange.status}`);
  check("他人下载一律 404", (await call(`/api/archive/${encodeURIComponent(archivedName)}`, { cookie: bob.cookie, raw: true })).status === 404);
  check("未登录下载被拦", [401, 404].includes((await call(`/api/archive/${encodeURIComponent(archivedName)}`, { raw: true })).status));
  check("管理员可以代查", (await call(`/api/archive/${encodeURIComponent(archivedName)}`, { cookie: admin.cookie, raw: true })).status === 200);
  const download = await call(`/api/archive/${encodeURIComponent(archivedName)}?download=1`, { cookie: alice.cookie, raw: true });
  check("下载动作带附件响应头", download.status === 200 && String(download.headers.get("content-disposition") || "").startsWith("attachment"), `${download.headers.get("content-disposition")}`);
  check("访问时间被记录", Boolean(queryOne("SELECT last_accessed_at FROM storage_objects WHERE storage_key=?", archivedName)?.last_accessed_at));
  check("路径穿越被拦", (await call(`/api/archive/..%2F..%2Fwanke`, { cookie: admin.cookie, raw: true })).status !== 200);

  // ---------- §39 作品管理 ----------
  console.log("== 作品管理（§39） ==");
  const saved = await call("/api/works", { method: "POST", cookie: alice.cookie, body: { jobId: jobRow.id, outputIndex: 0, title: "雪地柴犬" } });
  check("保存为作品", saved.status === 201, `${saved.status} ${saved.text.slice(0, 160)}`);
  const work = saved.json?.work;
  check("作品带大小与格式等基本信息", Number(work?.sizeBytes) > 0 && work?.format === "MP4" && "durationSeconds" in (work || {}), JSON.stringify(work).slice(0, 200));
  check("作品带来源任务", work?.source?.jobId === jobRow.id && work?.source?.jobTitle === "存储验收 · 甲", JSON.stringify(work?.source));
  check("作品持有该文件的引用", Boolean(queryOne("SELECT 1 FROM storage_object_refs WHERE storage_key=? AND ref_type='work' AND ref_id=?", archivedName, work?.id)));
  scanMemberWork("作品视图", work);
  check("他人不能保存我的任务为作品", (await call("/api/works", { method: "POST", cookie: bob.cookie, body: { jobId: jobRow.id, outputIndex: 0 } })).status === 404);

  // 来源项目：把任务挂到一个项目的镜头上，作品必须能看到来源项目
  const projectId = randomUUID();
  const shotId = randomUUID();
  const nowIso = new Date().toISOString();
  execute("INSERT INTO projects (id, user_id, name, description, created_at, updated_at) VALUES (?,?,?,?,?,?)", projectId, alice.id, "验收项目", "", nowIso, nowIso);
  execute("INSERT INTO shots (id, project_id, name, brief, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", shotId, projectId, "镜头一", "", 1, nowIso, nowIso);
  execute("INSERT INTO shot_jobs (shot_id, job_id, created_at) VALUES (?,?,?)", shotId, jobRow.id, nowIso);
  const workList = await call("/api/works", { cookie: alice.cookie });
  const listed = (workList.json?.works || []).find(item => item.id === work.id);
  check("作品列表能看到来源项目", listed?.source?.projectId === projectId && listed?.source?.projectName === "验收项目", JSON.stringify(listed?.source));

  const renamed = await call(`/api/works/${work.id}`, { method: "PATCH", cookie: alice.cookie, body: { title: "雪地柴犬 · 改名" } });
  check("作品可以改名", renamed.status === 200 && renamed.json?.work?.title === "雪地柴犬 · 改名", `${renamed.status}`);
  check("他人不能改我的作品", (await call(`/api/works/${work.id}`, { method: "PATCH", cookie: bob.cookie, body: { title: "越权" } })).status === 404);
  check("他人列表里看不到我的作品", !(await call("/api/works", { cookie: bob.cookie })).json?.works?.some(item => item.id === work.id));

  const similar = await call(`/api/jobs/${jobRow.id}`, { method: "POST", cookie: alice.cookie, body: { action: "similar" } });
  check("再生成一个版本可用", similar.status === 201 && similar.json?.job?.id && similar.json.job.id !== jobRow.id, `${similar.status}`);
  const continueNoPrompt = await call(`/api/jobs/${jobRow.id}`, { method: "POST", cookie: alice.cookie, body: { action: "continue", outputIndex: 0 } });
  check("继续创作必须填写创作要求", continueNoPrompt.status === 400, `${continueNoPrompt.status}`);
  const continued = await call(`/api/jobs/${jobRow.id}`, { method: "POST", cookie: alice.cookie, body: { action: "continue", outputIndex: 0, prompt: "柴犬回头看镜头" } });
  check("继续创作可用", continued.status === 201, `${continued.status} ${continued.text.slice(0, 160)}`);

  // ---------- 删除是真删除，作品在任务删除后仍可播放 ----------
  console.log("== 删除同步清理 ==");
  check("删除来源任务", (await call(`/api/jobs/${jobRow.id}`, { method: "DELETE", cookie: alice.cookie })).status === 200);
  check("作品仍引用时文件保留", fs.existsSync(filePath) && Boolean(queryOne("SELECT 1 FROM storage_objects WHERE storage_key=?", archivedName)));
  check("任务删除后作品仍可播放", (await call(`/api/archive/${encodeURIComponent(archivedName)}`, { cookie: alice.cookie, raw: true })).status === 200);
  check("删除作品", (await call(`/api/works/${work.id}`, { method: "DELETE", cookie: alice.cookie })).status === 200);
  check("文件与登记行同死", !fs.existsSync(filePath) && !queryOne("SELECT 1 FROM storage_objects WHERE storage_key=?", archivedName) && !queryOne("SELECT 1 FROM storage_object_refs WHERE storage_key=?", archivedName));
  check("文件删除后下载 404", (await call(`/api/archive/${encodeURIComponent(archivedName)}`, { cookie: alice.cookie, raw: true })).status === 404);

  // ---------- 本地输入归属 ----------
  console.log("== 本地输入归属 ==");
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "参考图.png");
  const uploadResponse = await fetch(`${BASE}/api/video-inputs`, { method: "POST", headers: { cookie: alice.cookie }, body: form });
  const uploadBody = await uploadResponse.json();
  check("上传本地输入", uploadResponse.status === 201 && Boolean(uploadBody?.input?.ref), `${uploadResponse.status}`);
  const inputRef = uploadBody.input.ref;
  const inputName = inputRef.replace("wanke-input://", "");
  check("本地输入登记归属", queryOne("SELECT user_id, bucket FROM storage_objects WHERE storage_key=?", inputName)?.user_id === alice.id);
  const bobDelete = await call(`/api/video-inputs?ref=${encodeURIComponent(inputRef)}`, { method: "DELETE", cookie: bob.cookie });
  check("他人删除我的本地输入一律 404", bobDelete.status === 404, `${bobDelete.status} ${bobDelete.text.slice(0, 120)}`);
  check("他人删除后文件仍在", fs.existsSync(path.join(INPUT_DIR, inputName)));
  const aliceDelete = await call(`/api/video-inputs?ref=${encodeURIComponent(inputRef)}`, { method: "DELETE", cookie: alice.cookie });
  check("主人可以删除本地输入", aliceDelete.status === 200 && aliceDelete.json?.deleted === true, JSON.stringify(aliceDelete.json));
  check("本地输入文件与登记同死", !fs.existsSync(path.join(INPUT_DIR, inputName)) && !queryOne("SELECT 1 FROM storage_objects WHERE storage_key=?", inputName));

  // ---------- 孤儿清理与在用文件保护 ----------
  console.log("== 孤儿清理 ==");
  await call("/api/admin/system-settings", { method: "POST", cookie: admin.cookie, body: { values: { storage_orphan_grace_minutes: 5 } } });
  const liveJob = await createSucceededJob(bob, "存储验收 · 乙");
  // 保存为作品时结果尚未归档：保存动作必须自动完成归档，作品才不会随着上游链接过期而打不开。
  const liveWork = await call("/api/works", { method: "POST", cookie: bob.cookie, body: { jobId: liveJob.id, outputIndex: 0, title: "乙的作品" } });
  check("保存作品时自动归档", liveWork.status === 201 && Boolean(liveWork.json?.work?.archivedFile), `${liveWork.status} ${liveWork.text.slice(0, 200)}`);
  const liveName = liveWork.json?.work?.archivedFile || "";
  const liveObject = queryOne("SELECT user_id FROM storage_objects WHERE storage_key=?", liveName);
  check("自动归档同样登记归属", liveObject?.user_id === bob.id, JSON.stringify(liveObject));
  const oldOrphan = `zz-orphan-${randomUUID()}.mp4`;
  const freshOrphan = `zz-fresh-${randomUUID()}.mp4`;
  fs.writeFileSync(path.join(OUTPUT_DIR, oldOrphan), Buffer.alloc(4096, 1));
  fs.writeFileSync(path.join(OUTPUT_DIR, freshOrphan), Buffer.alloc(2048, 2));
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(path.join(OUTPUT_DIR, oldOrphan), old, old);
  execute(`INSERT INTO storage_objects (id, user_id, bucket, storage_key, driver, content_type, size_bytes, ref_type, ref_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, randomUUID(), bob.id, "outputs", `zz-dangling-${randomUUID()}.mp4`, "local", "video/mp4", 100, "", "", nowIso);
  const staleInput = `${randomUUID()}.png`;
  fs.writeFileSync(path.join(INPUT_DIR, staleInput), png);
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
  fs.utimesSync(path.join(INPUT_DIR, staleInput), stale, stale);

  const sweep = await call("/api/admin/storage", { method: "POST", cookie: admin.cookie, body: { action: "sweep" } });
  check("手动清扫成功", sweep.status === 200 && sweep.json?.sweep, `${sweep.status}`);
  const summary = sweep.json?.sweep || {};
  check("过期孤儿文件被清理", summary.orphanFilesRemoved >= 1 && !fs.existsSync(path.join(OUTPUT_DIR, oldOrphan)), JSON.stringify(summary).slice(0, 200));
  check("宽限期内的文件不被误删", fs.existsSync(path.join(OUTPUT_DIR, freshOrphan)));
  check("在用文件不被误删", fs.existsSync(path.join(OUTPUT_DIR, liveName)) && Boolean(queryOne("SELECT 1 FROM storage_objects WHERE storage_key=?", liveName)));
  check("无文件的登记行被清理", summary.danglingRowsRemoved >= 1 && !queryOne("SELECT 1 FROM storage_objects WHERE storage_key LIKE 'zz-dangling-%'"));
  check("过期本地输入被清理", summary.staleInputsRemoved >= 1 && !fs.existsSync(path.join(INPUT_DIR, staleInput)));
  check("清扫结果写入设置供后台展示", Boolean(queryOne("SELECT value FROM settings WHERE key='storage_last_sweep'")?.value));
  check("成员不能触发清扫", (await call("/api/admin/storage", { method: "POST", cookie: alice.cookie, body: { action: "sweep" } })).status === 403);

  // ---------- 磁盘报警与统计对账 ----------
  console.log("== 磁盘报警与统计对账 ==");
  await call("/api/admin/system-settings", { method: "POST", cookie: admin.cookie, body: { values: { storage_disk_warn_free_percent: 99 } } });
  const alarmed = await call("/api/admin/business", { cookie: admin.cookie });
  check("阈值触发磁盘报警", alarmed.json?.business?.risks?.storage?.disk?.warn === true, JSON.stringify(alarmed.json?.business?.risks?.storage?.disk));
  await call("/api/admin/system-settings", { method: "POST", cookie: admin.cookie, body: { values: { storage_disk_warn_free_percent: 1 } } });
  const calmed = await call("/api/admin/business", { cookie: admin.cookie });
  check("阈值调低后报警解除", calmed.json?.business?.risks?.storage?.disk?.warn === false, JSON.stringify(calmed.json?.business?.risks?.storage?.disk));
  check("成员看不到存储统计", (await call("/api/admin/storage", { cookie: alice.cookie })).status === 403);

  const stats = (await call("/api/admin/storage", { cookie: admin.cookie })).json?.storage;
  const registrySum = Number(queryOne("SELECT COALESCE(SUM(size_bytes),0) AS bytes, COUNT(*) AS c FROM storage_objects")?.bytes || 0);
  check("统计的登记总量与账本一致", stats?.totals?.bytes === registrySum, `${stats?.totals?.bytes} vs ${registrySum}`);
  const freshOrphanSize = fs.statSync(path.join(OUTPUT_DIR, freshOrphan)).size;
  check("登记与磁盘的对账差异就是已知孤儿", stats?.reconciliation?.differenceBytes === freshOrphanSize, JSON.stringify(stats?.reconciliation));
  check("统计含分桶与按用户用量", Array.isArray(stats?.buckets) && stats.buckets.length >= 1 && Array.isArray(stats?.topUsers));
  fs.unlinkSync(path.join(OUTPUT_DIR, freshOrphan));
  const resynced = (await call("/api/admin/storage", { method: "POST", cookie: admin.cookie, body: { action: "sweep" } })).json?.storage;
  check("孤儿清掉后登记与磁盘一致", resynced?.reconciliation?.differenceBytes === 0, JSON.stringify(resynced?.reconciliation));

  // ---------- 自动备份与恢复演练 ----------
  console.log("== 自动备份与恢复演练 ==");
  const backupEnv = { WANKE_DB_PATH: DB_PATH, WANKE_BACKUP_DIR: BACKUP_DIR, WANKE_BACKUP_KEEP: "2" };
  const before = await call("/api/account/profile", { cookie: alice.cookie });
  const originalName = before.json?.profile?.name;
  const first = await runScript("node", ["scripts/backup.mjs"], backupEnv);
  check("备份执行成功", first.code === 0 && first.stdout.includes("校验通过"), `${first.code} ${first.stderr.slice(0, 200)}`);
  const backups = () => fs.readdirSync(BACKUP_DIR).filter(name => /^wanke-\d{8}-\d{6}\.db$/.test(name)).sort();
  check("备份文件落盘", backups().length === 1, backups().join(","));
  check("备份状态后台可见", (await call("/api/admin/business", { cookie: admin.cookie })).json?.business?.risks?.storage?.backup?.lastOk === true);

  await runScript("node", ["scripts/backup.mjs"], backupEnv);
  await sleep(1100); // 备份文件名精确到秒，保证第三份是新文件
  await runScript("node", ["scripts/backup.mjs"], backupEnv);
  check("超过保留份数自动清理旧备份", backups().length === 2, backups().join(","));

  execute("UPDATE users SET name=? WHERE id=?", "已损坏的数据", alice.id);
  const corrupted = await call("/api/account/profile", { cookie: alice.cookie });
  check("数据确实被改坏", corrupted.json?.profile?.name === "已损坏的数据", corrupted.json?.profile?.name);

  const restoreFile = path.join(BACKUP_DIR, backups().at(-1));
  const restored = await runScript("node", ["scripts/backup.mjs", "--restore", restoreFile], backupEnv);
  check("从备份恢复成功", restored.code === 0, `${restored.code} ${restored.stderr.slice(0, 200)}`);
  const recovered = await call("/api/account/profile", { cookie: alice.cookie });
  check("运行中的服务读到恢复后的数据", recovered.json?.profile?.name === originalName, `${recovered.json?.profile?.name} vs ${originalName}`);
  const recoveredJob = await call(`/api/jobs/${liveJob.id}`, { cookie: bob.cookie });
  check("恢复后业务接口正常", recoveredJob.status === 200, `${recoveredJob.status}`);

  console.log(failures === 0 ? "\nALL STORAGE CHECKS PASSED" : `\n${failures} 项失败`);
} finally {
  await provider.stop().catch(() => undefined);
}

if (failures > 0) process.exit(1);
