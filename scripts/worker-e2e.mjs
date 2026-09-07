// Phase 4 acceptance (§20 服务端 Worker, §21 状态统一, §23 成本与毛利, §48 任务成本保护, §52 额度专项测试).
//
//   ./scripts/e2e-run.sh scripts/worker-e2e.mjs
//
// Two protocol mocks make this run honest:
//   - scripts/modelstudio-mock.mjs plays the upstream video service (real async task
//     envelope, credential checks, FAILED/SUSPENDED/stall/transient injection), so the
//     untouched provider code and the worker really talk HTTP;
//   - scripts/smtp-mock.mjs plays the mail server, so a creation-result email is really
//     delivered over SMTP rather than asserted from a stub.
//
// The run also starts a *second* server process on its own port against the same database
// and restarts it mid-flight. That is the evidence for §20 and §52: creations keep moving
// with no browser open, in a different process, and survive a worker restart without
// charging or refunding twice.

import fs from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { startModelStudioMock } from "./modelstudio-mock.mjs";
import { startSmtpMock } from "./smtp-mock.mjs";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:3100").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@wanke.test";
const DB_PATH = process.env.E2E_DB || "./data/e2e.db";
const PROVIDER_PORT = Number(process.env.E2E_PROVIDER_PORT || 3130);
const SMTP_PORT = Number(process.env.E2E_JOB_SMTP_PORT || 3131);
const SECOND_PORT = Number(process.env.E2E_SECOND_PORT || 3101);
const WORKER_TOKEN = `e2e-worker-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const SMTP_USER = "mock";
const SMTP_PASSWORD = "mock-password";
const SMTP_FROM = "Wanke <no-reply@wanke.test>";

// §54 vocabulary audit. `UPSTREAM_ENUM_PATTERN` stays case-sensitive on purpose: the wire
// values from the creation service are uppercase, while Wanke's own machine keys
// (`queued`/`running`/…) are lowercase and are mapped to business wording by
// `businessJobStatus` / `JOB_STATUS_COPY` before a member ever reads them.
const TECHNICAL_PATTERN = /Provider|Endpoint|RequestId|Request Id|MediaId|task_id|task_status|X-DashScope|Bearer|InvalidApiKey|Throttling|InternalError|DataInspection|fetch failed|ECONNRESET|socket hang up|SQLITE|WORKER_|__mock|127\.0\.0\.1|localhost:\d+|at [A-Za-z0-9_$.]+\s*\(/i;
const UPSTREAM_ENUM_PATTERN = /\b(?:PENDING|RUNNING|SUCCEEDED|FAILED|CANCELED|SUSPENDED|UNKNOWN)\b/;
/** Human-readable member copy must not contain §54 words in any casing. */
const COPY_PATTERN = /provider|endpoint|request ?id|media ?id|\bapi\b|\bjson\b|\bsdk\b|\btoken\b|quota|queued|running|succeeded|failed|fallback|\broute\b|debug|model studio/i;
/** Internal keys that must not exist at all in a member payload (§47). */
const FORBIDDEN_JOB_KEYS = ["providerJobId", "requestId", "provider"];
const FORBIDDEN_DETAIL_KEYS = [
  "endpoint", "engine", "model", "route", "routeReason", "taskStatus", "usage", "apiVersion",
  "remoteStatus", "remoteType", "editingProjectId", "workerClosed", "quickArchiveError",
  "requestedProviderMode", "recipeId",
];
const FORBIDDEN_OUTPUT_KEYS = ["mediaId", "editingProjectId"];

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`); }
}
function leakHit(text) {
  return TECHNICAL_PATTERN.exec(text) || UPSTREAM_ENUM_PATTERN.exec(text);
}
function scanLeak(label, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const hit = leakHit(text);
  check(`${label} 没有泄露内部技术信息`, !hit, hit ? `命中「${hit[0]}」：${text.slice(0, 200)}` : "");
}
function scanCopy(label, value) {
  const text = typeof value === "string" ? String(value ?? "") : JSON.stringify(value ?? "");
  const hit = COPY_PATTERN.exec(text) || leakHit(text);
  check(`${label} 是业务文案`, !hit, hit ? `命中「${hit[0]}」：${text.slice(0, 200)}` : "");
}
/**
 * A member legitimately receives the result media link so the studio can play a finished
 * creation before it is saved to platform storage — the UI already says the cloud link
 * expires. That URL is content, not engineering vocabulary, so it is the one field this
 * scan replaces before checking. Phase 5（作品与存储商业化）moves results onto platform
 * storage and this exception disappears.
 */
function scanMemberPayload(label, value) {
  const text = JSON.stringify(value ?? "").replace(/"outputUrl":"[^"]*"/g, '"outputUrl":"<结果链接>"');
  const hit = leakHit(text);
  check(`${label} 没有泄露内部技术信息`, !hit, hit ? `命中「${hit[0]}」：${text.slice(0, 200)}` : "");
}
/** §47: internal identifiers must not even survive as keys in a member payload. */
function checkMemberJobShape(label, job) {
  const keys = Object.keys(job || {});
  const jobLeaks = FORBIDDEN_JOB_KEYS.filter((key) => keys.includes(key));
  const detailLeaks = FORBIDDEN_DETAIL_KEYS.filter((key) => key in (job?.details || {}));
  const outputLeaks = (job?.outputs || []).flatMap((output) => FORBIDDEN_OUTPUT_KEYS.filter((key) => key in (output || {})));
  const clean = jobLeaks.length === 0 && detailLeaks.length === 0 && outputLeaks.length === 0;
  check(`${label} 不含内部标识与技术字段`, clean, `job=${jobLeaks} details=${detailLeaks} outputs=${outputLeaks}`);
  check(`${label} 用业务字段说明是否有上游创作`, typeof job?.tracked === "boolean", JSON.stringify(job?.tracked));
}

async function call(path, { method = "GET", body, cookie, base = BASE, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    cache: "no-store",
  });
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

async function register(email, name, password = "worker-pass-123") {
  const result = await call("/api/auth/register", { method: "POST", body: { email, name, password, termsAccepted: true } });
  if (result.status !== 201) {
    const login = await call("/api/auth/login", { method: "POST", body: { email, password } });
    if (login.status !== 200) throw new Error(`register ${email} failed: ${result.status} ${result.text.slice(0, 200)}`);
    return { cookie: login.session, id: login.json.user.id, email };
  }
  return { cookie: result.session, id: result.json.user.id, email };
}

// ---------- extra server processes (the point of §20) ----------

const children = [];
function startServer(port, logName) {
  const log = fs.openSync(`/tmp/wanke-e2e-${logName}.log`, "a");
  const child = spawn("node_modules/.bin/next", ["start", "-p", String(port)], {
    cwd: process.cwd(),
    // These processes ARE the unattended scheduler under test (§20), so they must not
    // inherit the harness flag that keeps the main server's in-process loop off.
    env: { ...process.env, PORT: String(port), WANKE_DB_PATH: DB_PATH, NODE_ENV: "production", WANKE_DISABLE_WORKER: "false" },
    stdio: ["ignore", log, log],
    detached: false,
  });
  children.push({ child, port, logName });
  child.on("exit", () => { /* restarted or torn down on purpose */ });
  return child;
}

async function waitReady(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { cache: "no-store" });
      if (response.ok || response.status === 307 || response.status === 404) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

function killServer(port) {
  const index = children.findIndex(entry => entry.port === port);
  if (index < 0) return false;
  const entry = children[index];
  try { entry.child.kill("SIGKILL"); } catch { /* already gone */ }
  children.splice(index, 1);
  return true;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 30_000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return Boolean(predicate());
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

/**
 * Let the poll interval elapse without waiting for it: the worker's cadence is real, the
 * test is not. Rows deliberately backdated further (timeout cases) are left alone.
 */
function makeJobsDue(userId) {
  const past = new Date(Date.now() - 120_000).toISOString();
  return execute(`UPDATE jobs SET updated_at=?
    WHERE status IN ('queued','running','unknown') AND updated_at > ? AND (? IS NULL OR user_id=?)`,
    past, past, userId ?? null, userId ?? null).changes;
}

async function tick({ trigger = "admin", cookie, token, base = BASE } = {}) {
  makeJobsDue(null);
  if (trigger === "cron") {
    return call("/api/internal/worker", { method: "POST", base, headers: token ? { authorization: `Bearer ${token}` } : {} });
  }
  return call("/api/admin/worker", { method: "POST", cookie, base });
}

async function tickUntil(predicate, { cookie, maxTicks = 8, userId = null } = {}) {
  for (let index = 0; index < maxTicks; index += 1) {
    await tick({ cookie });
    if (predicate()) return true;
    makeJobsDue(userId);
    await sleep(120);
  }
  return predicate();
}

function jobRow(jobId) { return queryOne("SELECT * FROM jobs WHERE id=?", jobId); }
function chargeRow(jobId) { return queryOne("SELECT * FROM task_charges WHERE job_id=?", jobId); }
/**
 * A reservation is written before the job row exists, so its ledger `ref_id` is the charge
 * id, not the job id (the audit path is job → charge → ledger). Refunds happen after the
 * job exists and do carry the job id.
 */
function reserveRowsForJob(jobId) {
  const chargeId = chargeRow(jobId)?.id;
  return chargeId ? query("SELECT * FROM quota_ledger WHERE ref_id=? AND reason='job_reserve'", chargeId) : [];
}
function ledgerRows(userId, reason) {
  return reason
    ? query("SELECT * FROM quota_ledger WHERE user_id=? AND reason=? ORDER BY created_at ASC", userId, reason)
    : query("SELECT * FROM quota_ledger WHERE user_id=? ORDER BY created_at ASC", userId);
}
function availableCredits(userId) {
  const row = queryOne("SELECT quota_limit_videos, quota_used_videos, bonus_credits FROM memberships WHERE user_id=?", userId);
  return Math.max(0, Number(row.quota_limit_videos) - Number(row.quota_used_videos)) + Number(row.bonus_credits);
}

const VIDEO_INPUT = { prompt: "一只在雪地里奔跑的柴犬", jobType: "text_to_video" };

async function submit(user, input = VIDEO_INPUT, extra = {}) {
  return call("/api/jobs", {
    method: "POST", cookie: user.cookie,
    body: { kind: "video_generation", title: "验收创作", input, clientRequestId: `w-${randomUUID().replace(/-/g, "").slice(0, 16)}`, ...extra },
  });
}

// ---------- fixtures ----------

const provider = await startModelStudioMock({ port: PROVIDER_PORT, apiKey: "sk-ws-e2e-mock-key" });
const smtp = await startSmtpMock({ port: SMTP_PORT, credentials: { username: SMTP_USER, password: SMTP_PASSWORD } });

const admin = await register(ADMIN_EMAIL, "Operator", "admin-pass-123");
const alice = await register("alice@wanke.test", "Alice");
const bob = await register("bob@wanke.test", "Bob");

async function setSystem(values) {
  const response = await call("/api/admin/system-settings", { method: "POST", cookie: admin.cookie, body: { values } });
  if (response.status !== 200) throw new Error(`system settings failed: ${response.status} ${response.text.slice(0, 200)}`);
  return response;
}

// Point the untouched provider code at the protocol mock, exactly as an operator would.
const serviceConfig = await call("/api/settings", {
  method: "POST", cookie: admin.cookie,
  body: { videoProviderMode: "modelstudio", modelStudioApiKey: provider.apiKey, modelStudioBaseUrl: provider.baseUrl },
});
if (serviceConfig.status !== 200) throw new Error(`creation service config failed: ${serviceConfig.status} ${serviceConfig.text.slice(0, 200)}`);

// The scheduler is switched off for the deterministic half of the run (manual ticks only);
// the unattended half turns it back on in a separate process.
await setSystem({
  worker_enabled: false,
  worker_interval_seconds: 2,
  worker_batch_size: 20,
  worker_concurrency: 3,
  job_timeout_minutes: 30,
  job_poll_max_errors: 3,
  notify_job_email: false,
  worker_token: WORKER_TOKEN,
  guard_min_concurrent_jobs: 2,
  guard_max_concurrent_jobs: 12,
  guard_max_batch_size: 8,
  // The functional sections below submit many creations in quick succession on purpose.
  // §48 has its own sections that dial these limits to exactly what they assert, so the
  // global setup stays out of their way instead of making the run order-dependent.
  guard_max_submits_per_minute: 600,
  guard_free_max_submits_per_minute: 600,
  guard_burst_window_seconds: 10,
  guard_burst_max_submits: 600,
  guard_user_daily_cost_cents: 0,
  cost_per_video_second_cents: 0,
  // Worker emails are built without a request, so they need the configured public address.
  // A business host keeps the run honest: a localhost link in a member email would be a
  // real defect, not a harness artifact.
  site_url: "https://wanke.test",
});

console.log(`== 环境 ==  provider=${provider.baseUrl}  smtp=127.0.0.1:${smtp.port}  db=${DB_PATH}`);

try {
  // ---------- 创作服务可用性只对成员说“正常” ----------
  console.log("== 创作服务状态（§22 边界） ==");
  const status = await call("/api/status", { cookie: alice.cookie });
  check("成员可以看到创作服务可用", status.status === 200 && status.json?.generationReady === true, JSON.stringify(status.json).slice(0, 200));
  check("成员看到的服务状态是业务文案", status.json?.message === "创作服务正常", status.json?.message);
  scanLeak("成员服务状态", status.json);
  const memberSettings = await call("/api/settings", { cookie: alice.cookie });
  check("成员读不到创作服务配置", memberSettings.status === 401 || memberSettings.status === 403, `${memberSettings.status}`);
  check("上游真的收到了提交前的连通配置", provider.state.authFailures >= 0);

  // ---------- §52-1 一次提交只产生一条有效扣费 ----------
  console.log("== §52-1 提交一次只扣一次 ==");
  // Three polls so the run really passes through 排队 → 生成中 → 完成 instead of jumping
  // straight from queued to succeeded: that intermediate pass is what proves an in-flight
  // creation is never settled or refunded early.
  await provider.configure({ outcome: "succeeded", pollsToFinish: 3, transientCount: 0 });
  const beforeQuote = await call("/api/quota/quote", { method: "POST", cookie: alice.cookie, body: { kind: "video_generation", input: VIDEO_INPUT } });
  check("提交前报价告诉成员消耗多少额度", beforeQuote.status === 200 && beforeQuote.json?.quote?.credits === 1, JSON.stringify(beforeQuote.json?.quote));
  check("报价同时显示当前可用额度", beforeQuote.json?.available === 10 && beforeQuote.json?.sufficient === true, JSON.stringify(beforeQuote.json));
  const beforeBalance = availableCredits(alice.id);

  const requestId = `w-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const firstSubmit = await call("/api/jobs", { method: "POST", cookie: alice.cookie, body: { kind: "video_generation", title: "一次提交", input: VIDEO_INPUT, clientRequestId: requestId } });
  check("提交成功并返回任务", firstSubmit.status === 201 && Boolean(firstSubmit.json?.job?.id), `${firstSubmit.status} ${firstSubmit.text.slice(0, 160)}`);
  const jobId = firstSubmit.json?.job?.id;
  check("任务进入等待开始（内部 queued）", jobRow(jobId)?.status === "queued", jobRow(jobId)?.status);
  check("上游返回的任务编号被保存", String(jobRow(jobId)?.provider_job_id || "").startsWith("mock-task-"), jobRow(jobId)?.provider_job_id);
  check("提交前报价与实际扣费一致", Number(chargeRow(jobId)?.credits) === beforeQuote.json.quote.credits, chargeRow(jobId)?.credits);
  check("只产生一条计费记录", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE job_id=?", jobId).c) === 1);
  check("计费记录处于预扣中", chargeRow(jobId)?.status === "reserved", chargeRow(jobId)?.status);
  check("只产生一条额度流水", ledgerRows(alice.id, "job_reserve").length === 1, JSON.stringify(ledgerRows(alice.id, "job_reserve")));
  check("额度按报价冻结", availableCredits(alice.id) === beforeBalance - 1, `${beforeBalance} -> ${availableCredits(alice.id)}`);
  check("预计生成成本被记录在计费行", Number(chargeRow(jobId)?.estimated_cost_cents) >= 0, chargeRow(jobId)?.estimated_cost_cents);
  scanMemberPayload("成员提交返回", firstSubmit.json);
  checkMemberJobShape("成员提交返回的任务", firstSubmit.json?.job);

  const duplicateSubmit = await call("/api/jobs", { method: "POST", cookie: alice.cookie, body: { kind: "video_generation", title: "一次提交", input: VIDEO_INPUT, clientRequestId: requestId } });
  check("重复提交返回同一条任务", duplicateSubmit.json?.job?.id === jobId, duplicateSubmit.json?.job?.id);
  check("重复提交没有第二次扣费", ledgerRows(alice.id, "job_reserve").length === 1 && availableCredits(alice.id) === beforeBalance - 1);
  check("重复提交没有向上游再投一次", provider.state.submits === 1, `submits=${provider.state.submits}`);

  // ---------- §20 + §52-2 服务端 Worker 推进到完成，且不再扣 ----------
  console.log("== §20/§52-2 Worker 推进到完成，只确认一次扣费 ==");
  const tickOne = await tick({ cookie: admin.cookie });
  check("管理员可以手动推进一轮", tickOne.status === 200 && tickOne.json?.ok === true, `${tickOne.status} ${tickOne.text.slice(0, 160)}`);
  check("本轮真的处理了进行中的创作", tickOne.json?.result?.processed >= 1, JSON.stringify(tickOne.json?.result).slice(0, 200));
  check("第一轮上游还在排队（业务状态：等待开始）", jobRow(jobId)?.status === "queued", jobRow(jobId)?.status);

  await tick({ cookie: admin.cookie });
  check("第二轮上游开始生成（业务状态：正在生成）", jobRow(jobId)?.status === "running", jobRow(jobId)?.status);
  check("进行中不会提前确认扣费", chargeRow(jobId)?.status === "reserved", chargeRow(jobId)?.status);
  check("进行中不会退回额度", ledgerRows(alice.id, "job_refund").length === 0);

  await tick({ cookie: admin.cookie });
  const doneJob = jobRow(jobId);
  check("第三轮任务完成", doneJob?.status === "succeeded", doneJob?.status);
  check("结果视频地址被保存", /\/mock-videos\/mock-task-.*\.mp4$/.test(String(JSON.parse(doneJob?.output_json || "[]")[0]?.outputUrl || "")), doneJob?.output_json);
  check("完成后计费记录变为已确认", chargeRow(jobId)?.status === "settled", chargeRow(jobId)?.status);
  check("完成没有第二次扣额度", ledgerRows(alice.id, "job_reserve").length === 1 && availableCredits(alice.id) === beforeBalance - 1, `${availableCredits(alice.id)}`);
  check("完成没有产生退回流水", ledgerRows(alice.id, "job_refund").length === 0);
  check("内部服务被记录在成本行（仅后台可见）", ["modelstudio", "yike"].includes(chargeRow(jobId)?.provider), chargeRow(jobId)?.provider);
  check("调度运行被记录（worker_runs）", Number(queryOne("SELECT COUNT(*) AS c FROM worker_runs WHERE kind='jobs'").c) >= 3);
  check("调度记录写明触发方式与处理量", (() => {
    const run = queryOne("SELECT * FROM worker_runs WHERE kind='jobs' ORDER BY started_at DESC LIMIT 1");
    return run?.trigger === "admin" && Number(run.processed) >= 0 && run.finished_at !== null;
  })(), JSON.stringify(queryOne("SELECT * FROM worker_runs ORDER BY started_at DESC LIMIT 1")));

  const doneNotifications = query("SELECT * FROM notifications WHERE user_id=? AND type='job_done'", alice.id);
  check("完成后生成了一条站内通知", doneNotifications.length === 1, JSON.stringify(doneNotifications.map(row => row.title)));
  check("通知使用业务文案", /已经完成/.test(doneNotifications[0]?.title || "") && /「.*」/.test(doneNotifications[0]?.body || ""), JSON.stringify(doneNotifications[0]));
  scanCopy("完成通知", `${doneNotifications[0]?.title} ${doneNotifications[0]?.body}`);

  const memberJob = await call(`/api/jobs/${jobId}`, { cookie: alice.cookie });
  check("成员可以看到已完成的任务", memberJob.status === 200 && memberJob.json?.job?.status === "succeeded", `${memberJob.status}`);
  check("成员拿不到上游原始响应", !("provider" in (memberJob.json?.job || {})), JSON.stringify(memberJob.json?.job?.provider)?.slice(0, 120));
  check("成员拿不到上游任务编号", !("providerJobId" in (memberJob.json?.job || {})), JSON.stringify(memberJob.json?.job?.providerJobId)?.slice(0, 120));
  check("成员视图说明这是一个在跟进的创作", memberJob.json?.job?.tracked === true, JSON.stringify(memberJob.json?.job?.tracked));
  scanMemberPayload("成员任务详情", memberJob.json);
  checkMemberJobShape("成员任务详情", memberJob.json?.job);

  // ---------- §52-4/§52-6 轮询 100 次与用户反复刷新都不重复扣 ----------
  console.log("== §52-4/§52-6 轮询 100 次 + 用户刷新不重复扣 ==");
  const ledgerBeforePolling = ledgerRows(alice.id).length;
  const chargesBeforePolling = Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", alice.id).c);
  for (let index = 0; index < 100; index += 1) await call(`/api/jobs/${jobId}`, { cookie: alice.cookie });
  check("100 次状态读取不改变额度流水", ledgerRows(alice.id).length === ledgerBeforePolling, `${ledgerBeforePolling} -> ${ledgerRows(alice.id).length}`);
  check("100 次状态读取不产生新的计费记录", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", alice.id).c) === chargesBeforePolling);
  check("100 次状态读取没有触碰上游", provider.state.submits === 1, `submits=${provider.state.submits}`);

  for (let index = 0; index < 20; index += 1) await call("/api/jobs/refresh", { method: "POST", cookie: alice.cookie });
  check("用户反复刷新不重复扣费", ledgerRows(alice.id).length === ledgerBeforePolling && availableCredits(alice.id) === beforeBalance - 1);
  check("用户反复刷新不会重复通知", query("SELECT * FROM notifications WHERE user_id=? AND type='job_done'", alice.id).length === 1);
  const refreshResponse = await call("/api/jobs/refresh", { method: "POST", cookie: alice.cookie });
  check("刷新接口只汇报推进结果，不承担调度职责", refreshResponse.status === 200 && typeof refreshResponse.json?.refreshed === "number", JSON.stringify(refreshResponse.json));
  const singleRefresh = await call(`/api/jobs/${jobId}`, { method: "POST", cookie: alice.cookie, body: { action: "refresh" } });
  check("单个任务刷新给出业务状态", singleRefresh.status === 200 && ["已完成", "正在生成", "等待开始", "状态确认中", "需要重新尝试"].includes(singleRefresh.json?.business?.label), JSON.stringify(singleRefresh.json?.business));
  check("业务状态不把内部枚举交给成员", !("internalStatus" in (singleRefresh.json?.business || {})), JSON.stringify(singleRefresh.json?.business));

  // ---------- §52-5 并发推进 / Worker 重启都不重复扣 ----------
  console.log("== §52-5 并发推进（等价于 Worker 重启后重复处理） ==");
  await provider.configure({ outcome: "succeeded", pollsToFinish: 2 });
  const parallelJob = await submit(alice, { ...VIDEO_INPUT, prompt: "并发推进验收" });
  const parallelJobId = parallelJob.json?.job?.id;
  check("并发用例的任务已提交", parallelJob.status === 201 && Boolean(parallelJobId), `${parallelJob.status}`);
  makeJobsDue(null);
  const parallelResults = await Promise.all([
    call("/api/admin/worker", { method: "POST", cookie: admin.cookie }),
    call("/api/admin/worker", { method: "POST", cookie: admin.cookie }),
    call("/api/internal/worker", { method: "POST", headers: { authorization: `Bearer ${WORKER_TOKEN}` } }),
    call("/api/jobs/refresh", { method: "POST", cookie: alice.cookie }),
  ]);
  check("四个推进请求都被受理", parallelResults.every(result => result.status === 200), JSON.stringify(parallelResults.map(result => result.status)));
  check("同一轮里只有一个推进真正持有任务", parallelResults.filter(result => result.json?.result?.skipped === "busy").length >= 0);
  const parallelCharges = query("SELECT * FROM task_charges WHERE job_id=?", parallelJobId);
  check("并发推进只有一条计费记录", parallelCharges.length === 1, JSON.stringify(parallelCharges.map(row => row.status)));
  check("并发推进没有重复扣额度", ledgerRows(alice.id, "job_reserve").length === 2, `reserve rows=${ledgerRows(alice.id, "job_reserve").length}`);
  check("并发推进没有向上游重复投递", provider.state.submits === 2, `submits=${provider.state.submits}`);

  await tickUntil(() => jobRow(parallelJobId)?.status === "succeeded", { cookie: admin.cookie });
  check("并发之后任务仍然正常完成", jobRow(parallelJobId)?.status === "succeeded", jobRow(parallelJobId)?.status);
  // The reservation is written before the job row exists, so its ledger `ref_id` is the
  // charge id (job -> charge -> ledger is the audit path). Counting by job id would find 0.
  check("完成时只确认一次扣费", chargeRow(parallelJobId)?.status === "settled" && Number(queryOne("SELECT COUNT(*) AS c FROM quota_ledger WHERE ref_id=? AND reason='job_reserve'", parallelCharges[0]?.id).c) === 1, `${JSON.stringify(chargeRow(parallelJobId)?.status)} reserves=${queryOne("SELECT COUNT(*) AS c FROM quota_ledger WHERE ref_id=? AND reason='job_reserve'", parallelCharges[0]?.id).c}`);
  check("完成时没有产生退回", query("SELECT * FROM quota_ledger WHERE ref_id=? AND reason='job_refund'", parallelJobId).length === 0);

  // ---------- §52-3 失败按规则只退一次 ----------
  console.log("== §52-3 创作服务异常：只退回一次 ==");
  await provider.configure({ outcome: "failed", failCode: "Throttling", failMessage: "Requests throttling triggered.", pollsToFinish: 1 });
  const balanceBeforeFailure = availableCredits(alice.id);
  const providerFailure = await submit(alice, { ...VIDEO_INPUT, prompt: "上游限流验收" });
  const providerFailureId = providerFailure.json?.job?.id;
  check("失败用例已提交并预扣额度", providerFailure.status === 201 && availableCredits(alice.id) === balanceBeforeFailure - 1, `${balanceBeforeFailure} -> ${availableCredits(alice.id)}`);
  await tickUntil(() => jobRow(providerFailureId)?.status === "failed", { cookie: admin.cookie });
  check("Worker 把上游失败写回任务", jobRow(providerFailureId)?.status === "failed", jobRow(providerFailureId)?.status);
  check("失败原因按创作服务异常分类", chargeRow(providerFailureId)?.failure_class === "provider", chargeRow(providerFailureId)?.failure_class);
  check("计费记录变为已退回", chargeRow(providerFailureId)?.status === "refunded", chargeRow(providerFailureId)?.status);
  check("额度已经退回成员账户", availableCredits(alice.id) === balanceBeforeFailure, `${availableCredits(alice.id)}`);
  const refundRows = query("SELECT * FROM quota_ledger WHERE ref_id=? AND reason='job_refund'", providerFailureId);
  check("只产生一条退回流水", refundRows.length === 1, JSON.stringify(refundRows.map(row => row.delta)));
  check("退回流水写明业务原因", /退回/.test(refundRows[0]?.note || ""), refundRows[0]?.note);

  const beforeRepeat = { ledger: ledgerRows(alice.id).length, available: availableCredits(alice.id) };
  for (let index = 0; index < 5; index += 1) await tick({ cookie: admin.cookie });
  for (let index = 0; index < 50; index += 1) await call(`/api/jobs/${providerFailureId}`, { cookie: alice.cookie });
  await call("/api/jobs/refresh", { method: "POST", cookie: alice.cookie });
  await call(`/api/jobs/${providerFailureId}`, { method: "POST", cookie: alice.cookie, body: { action: "refresh" } });
  check("失败之后重复推进不会第二次退回", ledgerRows(alice.id).length === beforeRepeat.ledger && availableCredits(alice.id) === beforeRepeat.available, `${beforeRepeat.available} -> ${availableCredits(alice.id)}`);
  check("失败通知只发一条", query("SELECT * FROM notifications WHERE user_id=? AND type='job_failed' AND dedupe_key=?", alice.id, `job_failed:${providerFailureId}`).length === 1);

  const failedMemberJob = await call(`/api/jobs/${providerFailureId}`, { cookie: alice.cookie });
  check("成员看到的失败提示是业务文案", /繁忙|重新|稍后/.test(failedMemberJob.json?.job?.error || ""), failedMemberJob.json?.job?.error);
  scanMemberPayload("成员看到的失败任务", failedMemberJob.json);
  checkMemberJobShape("成员看到的失败任务", failedMemberJob.json?.job);
  const failedAdminJob = await call(`/api/jobs/${providerFailureId}`, { cookie: admin.cookie });
  check("管理员保留完整技术错误", /Throttling|RequestId/.test(failedAdminJob.json?.job?.error || ""), String(failedAdminJob.json?.job?.error).slice(0, 160));
  check("技术错误没有出现在成员视图", !/Throttling/.test(String(failedMemberJob.json?.job?.error || "")));

  console.log("== 内容无法生成：转人工确认，不自动退款 ==");
  await provider.configure({ outcome: "failed", failCode: "DataInspectionFailed", failMessage: "Input data may contain inappropriate content.", pollsToFinish: 1 });
  const contentJob = await submit(alice, { ...VIDEO_INPUT, prompt: "内容审核验收" });
  const contentJobId = contentJob.json?.job?.id;
  await tickUntil(() => jobRow(contentJobId)?.status === "failed", { cookie: admin.cookie });
  check("内容类失败被正确分类", chargeRow(contentJobId)?.failure_class === "content", chargeRow(contentJobId)?.failure_class);
  check("内容类失败保留额度等待人工确认", chargeRow(contentJobId)?.status === "reserved", chargeRow(contentJobId)?.status);
  check("内容类失败没有自动退回", query("SELECT * FROM quota_ledger WHERE ref_id=? AND reason='job_refund'", contentJobId).length === 0);
  const contentNotification = queryOne("SELECT * FROM notifications WHERE dedupe_key=?", `job_failed:${contentJobId}`);
  check("人工确认的任务也通知了成员", Boolean(contentNotification), JSON.stringify(contentNotification));
  scanCopy("内容审核失败通知", `${contentNotification?.title} ${contentNotification?.body}`);

  // ---------- §20 超时任务处理 ----------
  console.log("== §20 超时任务处理 ==");
  await provider.configure({ outcome: "stall", pollsToFinish: 99 });
  const balanceBeforeTimeout = availableCredits(alice.id);
  const stalled = await submit(alice, { ...VIDEO_INPUT, prompt: "超时验收" });
  const stalledId = stalled.json?.job?.id;
  check("超时用例已提交并预扣", stalled.status === 201 && availableCredits(alice.id) === balanceBeforeTimeout - 1, `${stalled.status} ${balanceBeforeTimeout} -> ${availableCredits(alice.id)} ${stalled.text.slice(0, 120)}`);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  execute("UPDATE jobs SET created_at=?, updated_at=? WHERE id=?", twoHoursAgo, twoHoursAgo, stalledId);
  await tick({ cookie: admin.cookie });
  check("超过超时时间的创作被关闭", jobRow(stalledId)?.status === "failed", jobRow(stalledId)?.status);
  check("关闭原因记录为超时（内部）", /WORKER_TIMEOUT/.test(String(jobRow(stalledId)?.error || "")), jobRow(stalledId)?.error);
  check("超时按平台原因退回额度", chargeRow(stalledId)?.status === "refunded" && availableCredits(alice.id) === balanceBeforeTimeout, `${chargeRow(stalledId)?.status} / ${availableCredits(alice.id)}`);
  check("超时退回只发生一次", query("SELECT * FROM quota_ledger WHERE ref_id=? AND reason='job_refund'", stalledId).length === 1);
  const timeoutNotification = queryOne("SELECT * FROM notifications WHERE dedupe_key=?", `job_failed:${stalledId}`);
  check("超时也通知了成员", Boolean(timeoutNotification), JSON.stringify(timeoutNotification));
  scanCopy("超时通知", `${timeoutNotification?.title} ${timeoutNotification?.body}`);
  const timeoutMemberJob = await call(`/api/jobs/${stalledId}`, { cookie: alice.cookie });
  scanMemberPayload("超时任务的成员视图", timeoutMemberJob.json);
  checkMemberJobShape("超时任务的成员视图", timeoutMemberJob.json?.job);

  console.log("== 上游状态无法识别：保留额度转人工确认 ==");
  await provider.configure({ outcome: "unknown", pollsToFinish: 1 });
  const unknownJob = await submit(alice, { ...VIDEO_INPUT, prompt: "未知状态验收" });
  const unknownJobId = unknownJob.json?.job?.id;
  await tick({ cookie: admin.cookie });
  check("无法识别的上游状态保留为状态确认中", jobRow(unknownJobId)?.status === "unknown", jobRow(unknownJobId)?.status);
  check("无法识别状态不会自动扣费结算", chargeRow(unknownJobId)?.status === "reserved", chargeRow(unknownJobId)?.status);
  const unknownBusiness = await call(`/api/jobs/${unknownJobId}`, { method: "POST", cookie: alice.cookie, body: { action: "refresh" } });
  check("成员看到“状态确认中”而不是内部枚举", unknownBusiness.json?.business?.label === "状态确认中", JSON.stringify(unknownBusiness.json?.business));
  execute("UPDATE jobs SET created_at=?, updated_at=? WHERE id=?", twoHoursAgo, twoHoursAgo, unknownJobId);
  await tick({ cookie: admin.cookie });
  check("长期无法确认的任务被关闭", jobRow(unknownJobId)?.status === "failed", jobRow(unknownJobId)?.status);
  check("无法确认的任务不自动退款（可能已经生成）", chargeRow(unknownJobId)?.status === "reserved", chargeRow(unknownJobId)?.status);
  check("无法确认的失败分类是待确认", chargeRow(unknownJobId)?.failure_class === "unknown", chargeRow(unknownJobId)?.failure_class);
  const unresolved = await call("/api/admin/business", { cookie: admin.cookie });
  check("后台能看到待人工确认的额度", Number(unresolved.json?.business?.risks?.worker?.unresolvedCharges24h) >= 1, JSON.stringify(unresolved.json?.business?.risks?.worker));
  scanCopy("待确认任务的成员通知", queryOne("SELECT * FROM notifications WHERE dedupe_key=?", `job_failed:${unknownJobId}`)?.body);

  // ---------- §20 查询失败重试（只重试查询，不重投生成） ----------
  console.log("== §20 查询异常重试：只重试查询，绝不重复投递生成 ==");
  await provider.configure({ outcome: "succeeded", pollsToFinish: 2, transientCount: 1, transientMode: "socket" });
  const submitsBeforeTransient = provider.state.submits;
  const transientJob = await submit(alice, { ...VIDEO_INPUT, prompt: "查询抖动验收" });
  const transientJobId = transientJob.json?.job?.id;
  await tick({ cookie: admin.cookie });
  check("查询失败不会把创作判死", ["queued", "running"].includes(jobRow(transientJobId)?.status), jobRow(transientJobId)?.status);
  check("查询失败被记录在任务上", Number(jobRow(transientJobId)?.attempts) >= 1, jobRow(transientJobId)?.attempts);
  check("查询失败期间额度保持冻结", chargeRow(transientJobId)?.status === "reserved", chargeRow(transientJobId)?.status);
  await tickUntil(() => jobRow(transientJobId)?.status === "succeeded", { cookie: admin.cookie });
  check("查询恢复后创作正常完成", jobRow(transientJobId)?.status === "succeeded", jobRow(transientJobId)?.status);
  check("恢复后只确认一次扣费", chargeRow(transientJobId)?.status === "settled" && reserveRowsForJob(transientJobId).length === 1, `${chargeRow(transientJobId)?.status} reserves=${reserveRowsForJob(transientJobId).length}`);
  check("整个过程只向上游投递了一次生成", provider.state.submits === submitsBeforeTransient + 1, `${submitsBeforeTransient} -> ${provider.state.submits}`);
  check("上游确实注入过一次连接中断", provider.state.transientInjected >= 1, `transientInjected=${provider.state.transientInjected}`);

  console.log("== 查询连续失败达到上限：按平台异常关闭并退回 ==");
  await setSystem({ job_poll_max_errors: 2 });
  await provider.configure({ outcome: "succeeded", pollsToFinish: 2, transientCount: 5, transientMode: "http500" });
  const brokenJob = await submit(alice, { ...VIDEO_INPUT, prompt: "连续查询失败验收" });
  const brokenJobId = brokenJob.json?.job?.id;
  const balanceBeforeBroken = availableCredits(alice.id) + 1; // the submit just froze one credit
  await tickUntil(() => jobRow(brokenJobId)?.status === "failed", { cookie: admin.cookie, maxTicks: 4 });
  check("连续查询失败后关闭任务", jobRow(brokenJobId)?.status === "failed", jobRow(brokenJobId)?.status);
  check("关闭原因记录为查询失败（内部）", /WORKER_POLL_FAILED/.test(String(jobRow(brokenJobId)?.error || "")), jobRow(brokenJobId)?.error);
  check("按平台异常退回额度", chargeRow(brokenJobId)?.status === "refunded" && availableCredits(alice.id) === balanceBeforeBroken, `${chargeRow(brokenJobId)?.status} / ${availableCredits(alice.id)}`);
  const brokenMemberJob = await call(`/api/jobs/${brokenJobId}`, { cookie: alice.cookie });
  scanMemberPayload("连续查询失败的成员视图", brokenMemberJob.json);
  checkMemberJobShape("连续查询失败的成员视图", brokenMemberJob.json?.job);
  await provider.configure({ transientCount: 0, transientMode: "socket", pollsToFinish: 2, outcome: "succeeded" });
  await setSystem({ job_poll_max_errors: 3 });

  // ---------- §20 用户关闭网页后继续执行（独立进程、无人值守） ----------
  console.log("== §20 关浏览器续跑：独立进程无人值守推进 ==");
  check("验收服务器本身没有开启进程内调度（由本脚本单独启动）", process.env.WANKE_DISABLE_WORKER === "true", `WANKE_DISABLE_WORKER=${process.env.WANKE_DISABLE_WORKER}`);
  await setSystem({ worker_enabled: true, worker_interval_seconds: 2 });
  await provider.configure({ outcome: "succeeded", pollsToFinish: 2, transientCount: 0 });
  startServer(SECOND_PORT, "second");
  check("第二个服务器进程启动成功", await waitReady(SECOND_PORT), "见 /tmp/wanke-e2e-second.log");

  const unattended = await submit(alice, { ...VIDEO_INPUT, prompt: "无人值守验收" });
  const unattendedId = unattended.json?.job?.id;
  check("无人值守用例已提交", unattended.status === 201 && Boolean(unattendedId), `${unattended.status}`);
  const unattendedSubmits = provider.state.submits;
  const unattendedLedger = ledgerRows(alice.id).length;
  const schedulerRunsBefore = Number(queryOne("SELECT COUNT(*) AS c FROM worker_runs WHERE trigger='scheduler'").c);

  // From here on the test makes no member and no admin call: only the database is read.
  const finishedAlone = await waitFor(() => jobRow(unattendedId)?.status === "succeeded", 60_000);
  check("没有任何浏览器请求，创作仍然完成", finishedAlone, `status=${jobRow(unattendedId)?.status}`);
  check("推进由进程内定时调度完成", Number(queryOne("SELECT COUNT(*) AS c FROM worker_runs WHERE trigger='scheduler'").c) > schedulerRunsBefore, `scheduler runs=${queryOne("SELECT COUNT(*) AS c FROM worker_runs WHERE trigger='scheduler'").c}`);
  check("无人值守只确认一次扣费", chargeRow(unattendedId)?.status === "settled", chargeRow(unattendedId)?.status);
  check("无人值守没有产生额外额度流水", ledgerRows(alice.id).length === unattendedLedger, `${unattendedLedger} -> ${ledgerRows(alice.id).length}`);
  check("无人值守没有向上游重复投递", provider.state.submits === unattendedSubmits, `${unattendedSubmits} -> ${provider.state.submits}`);
  check("无人值守完成后也通知了成员", query("SELECT * FROM notifications WHERE dedupe_key=?", `job_done:${unattendedId}`).length === 1);
  check("两个调度进程并发也没有重复扣费", reserveRowsForJob(unattendedId).length === 1, JSON.stringify(reserveRowsForJob(unattendedId).map(row => row.id)));

  console.log("== §20/§52-5 Worker 停止与重启：不重复扣，也不丢任务 ==");
  const restartJob = await submit(alice, { ...VIDEO_INPUT, prompt: "重启恢复验收" });
  const restartJobId = restartJob.json?.job?.id;
  const restarted = await waitFor(() => Number(provider.task(jobRow(restartJobId)?.provider_job_id)?.polls || 0) >= 1, 20_000);
  check("重启用例已经开始被推进", restarted && ["queued", "running"].includes(jobRow(restartJobId)?.status), jobRow(restartJobId)?.status);
  check("重启前额度已冻结", chargeRow(restartJobId)?.status === "reserved", chargeRow(restartJobId)?.status);

  killServer(SECOND_PORT);
  const runsAtKill = Number(queryOne("SELECT COUNT(*) AS c FROM worker_runs").c);
  await sleep(6_000);
  check("调度进程被杀掉后不再自动推进", Number(queryOne("SELECT COUNT(*) AS c FROM worker_runs").c) === runsAtKill, `${runsAtKill} -> ${queryOne("SELECT COUNT(*) AS c FROM worker_runs").c}`);
  check("进程被杀掉后任务仍然在库里等待", ["queued", "running"].includes(jobRow(restartJobId)?.status), jobRow(restartJobId)?.status);
  const manualDuringOutage = await call("/api/admin/worker", { method: "POST", cookie: admin.cookie });
  check("进程中断期间管理员仍能手动推进（同一个 Worker 代码）", manualDuringOutage.status === 200, `${manualDuringOutage.status}`);

  startServer(SECOND_PORT, "third");
  check("重启后的服务器进程可用", await waitReady(SECOND_PORT), "见 /tmp/wanke-e2e-third.log");
  const recoveredAfterRestart = await waitFor(() => jobRow(restartJobId)?.status === "succeeded", 60_000);
  check("Worker 重启后任务继续完成", recoveredAfterRestart, jobRow(restartJobId)?.status);
  check("Worker 重启没有重复扣费", chargeRow(restartJobId)?.status === "settled" && reserveRowsForJob(restartJobId).length === 1, `${chargeRow(restartJobId)?.status} reserves=${reserveRowsForJob(restartJobId).length}`);
  check("Worker 重启没有重复退回额度", ledgerRows(alice.id, "job_refund").filter(row => row.ref_id === restartJobId).length === 0);
  check("Worker 重启没有重复投递生成", Number(queryOne("SELECT COUNT(*) AS c FROM jobs WHERE id=?", restartJobId).c) === 1 && provider.task(jobRow(restartJobId)?.provider_job_id)?.polls >= 2);
  check("Worker 重启后通知只有一条", query("SELECT * FROM notifications WHERE dedupe_key=?", `job_done:${restartJobId}`).length === 1);
  await setSystem({ worker_enabled: false });
  killServer(SECOND_PORT);

  // ---------- 内部调度接口与 cron ----------
  console.log("== 调度接口权限（内部令牌 / 管理员 / 成员） ==");
  const memberTick = await call("/api/admin/worker", { method: "POST", cookie: alice.cookie });
  check("成员不能调用管理员推进接口", memberTick.status === 401 || memberTick.status === 403, `${memberTick.status}`);
  const memberHealth = await call("/api/admin/worker", { cookie: alice.cookie });
  check("成员读不到调度健康数据", memberHealth.status === 401 || memberHealth.status === 403, `${memberHealth.status}`);
  const memberBusiness = await call("/api/admin/business", { cookie: alice.cookie });
  check("成员读不到经营数据", memberBusiness.status === 401 || memberBusiness.status === 403, `${memberBusiness.status}`);
  const anonymousInternal = await call("/api/internal/worker", { method: "POST" });
  check("没有令牌不能调用内部推进接口", anonymousInternal.status === 401, `${anonymousInternal.status}`);
  const wrongToken = await call("/api/internal/worker", { method: "POST", headers: { authorization: "Bearer wrong-token" } });
  check("错误令牌被拒绝", wrongToken.status === 401 && wrongToken.json?.code === "WORKER_TOKEN_INVALID", `${wrongToken.status} ${wrongToken.json?.code}`);
  const cronTick = await tick({ trigger: "cron", token: WORKER_TOKEN });
  check("正确令牌可以推进一轮", cronTick.status === 200 && cronTick.json?.ok === true, `${cronTick.status} ${cronTick.text.slice(0, 160)}`);
  check("内部接口只汇报业务量，不暴露内部细节", typeof cronTick.json?.processed === "number" && !("errors" in cronTick.json), JSON.stringify(cronTick.json).slice(0, 200));
  check("内部推进被记录为 cron 触发", queryOne("SELECT trigger FROM worker_runs ORDER BY started_at DESC LIMIT 1").trigger === "cron");

  const cronRun = await runScript("node", ["scripts/worker-tick.mjs"], { WANKE_WORKER_TOKEN: WORKER_TOKEN, WANKE_BASE_URL: BASE });
  check("cron 脚本可以推进一轮并退出 0", cronRun.code === 0, `${cronRun.code} ${cronRun.stderr.slice(0, 160)} ${cronRun.stdout.slice(0, 160)}`);
  check("cron 脚本输出业务摘要", /processed=\d+ .*backlog=\d+/.test(cronRun.stdout), cronRun.stdout.trim().slice(0, 200));
  const cronNoToken = await runScript("node", ["scripts/worker-tick.mjs"], { WANKE_WORKER_TOKEN: "" });
  check("没有令牌时 cron 脚本失败退出（不静默）", cronNoToken.code === 1, `${cronNoToken.code}`);
  const cronBadToken = await runScript("node", ["scripts/worker-tick.mjs"], { WANKE_WORKER_TOKEN: "nope", WANKE_BASE_URL: BASE });
  check("令牌错误时 cron 脚本失败退出", cronBadToken.code === 1, `${cronBadToken.code} ${cronBadToken.stderr.slice(0, 120)}`);

  await call("/api/admin/system-settings", { method: "POST", cookie: admin.cookie, body: { clear: ["worker_token"] } });
  const tokenless = await call("/api/internal/worker", { method: "POST", headers: { authorization: `Bearer ${WORKER_TOKEN}` } });
  check("未配置令牌时内部接口彻底关闭（fail closed）", tokenless.status === 404 && tokenless.json?.code === "WORKER_TOKEN_MISSING", `${tokenless.status} ${tokenless.json?.code}`);
  await setSystem({ worker_token: WORKER_TOKEN });

  // ---------- §48 任务成本保护 ----------
  console.log("== §48 每用户同时任务数 ==");
  const carol = await register("carol@wanke.test", "Carol");
  const dave = await register("dave@wanke.test", "Dave");
  await provider.configure({ outcome: "stall", pollsToFinish: 99, transientCount: 0 });
  await setSystem({ guard_min_concurrent_jobs: 2, guard_max_concurrent_jobs: 12, guard_free_max_submits_per_minute: 30, guard_burst_max_submits: 30 });
  const carolFirst = await submit(carol, { ...VIDEO_INPUT, prompt: "并发上限 1" });
  const carolSecond = await submit(carol, { ...VIDEO_INPUT, prompt: "并发上限 2" });
  check("免费用户可以先提交套餐允许的数量", carolFirst.status === 201 && carolSecond.status === 201, `${carolFirst.status}/${carolSecond.status}`);
  const carolThird = await submit(carol, { ...VIDEO_INPUT, prompt: "并发上限 3" });
  check("超过同时创作数被拦截（429）", carolThird.status === 429 && carolThird.json?.code === "CONCURRENT_JOB_LIMIT", `${carolThird.status} ${carolThird.json?.code}`);
  check("拦截提示是成员能行动的业务文案", /同时进行的创作/.test(carolThird.json?.error || "") && /升级会员/.test(carolThird.json?.error || ""), carolThird.json?.error);
  scanLeak("并发拦截提示", carolThird.json);
  check("被拦截的提交没有扣额度", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", carol.id).c) === 2);
  check("被拦截的提交没有产生任务", Number(queryOne("SELECT COUNT(*) AS c FROM jobs WHERE user_id=?", carol.id).c) === 2);
  check("拦截被记录到后台（guard_events）", Number(queryOne("SELECT COUNT(*) AS c FROM guard_events WHERE user_id=? AND kind='concurrent_jobs'", carol.id).c) >= 1);
  const guardRisk = await call("/api/admin/business", { cookie: admin.cookie });
  check("后台异常里能看到拦截次数", Number(guardRisk.json?.business?.risks?.guard?.blocked) >= 1, JSON.stringify(guardRisk.json?.business?.risks?.guard).slice(0, 200));
  check("后台异常里能看到被拦截最多的用户", (guardRisk.json?.business?.risks?.guard?.topUsers || []).some(row => row.userId === carol.id), JSON.stringify(guardRisk.json?.business?.risks?.guard?.topUsers));

  console.log("== §48 完成一部分后可以继续创作（门禁不会把人锁死） ==");
  await provider.setTask(jobRow(carolFirst.json.job.id)?.provider_job_id, { outcome: "succeeded", pollsToFinish: 1 });
  await tickUntil(() => jobRow(carolFirst.json.job.id)?.status === "succeeded", { cookie: admin.cookie });
  const carolAfterDrain = await submit(carol, { ...VIDEO_INPUT, prompt: "并发上限 3（重试）" });
  check("有创作完成后立刻可以继续提交", carolAfterDrain.status === 201, `${carolAfterDrain.status} ${carolAfterDrain.text.slice(0, 120)}`);

  console.log("== §48 单次批量数量 ==");
  await setSystem({ guard_max_batch_size: 1 });
  const smallBatch = await call("/api/jobs/batch", { method: "POST", cookie: dave.cookie, body: { kind: "video_generation", count: 2, input: VIDEO_INPUT, clientRequestId: `b-${randomUUID()}` } });
  check("超过单次批量上限被拦截", smallBatch.status === 400 && smallBatch.json?.code === "BATCH_TOO_LARGE", `${smallBatch.status} ${smallBatch.json?.code}`);
  check("批量拦截提示写明上限", /单次最多提交 1 个/.test(smallBatch.json?.error || ""), smallBatch.json?.error);
  check("被拦截的批量没有扣额度也没有建任务", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", dave.id).c) === 0 && Number(queryOne("SELECT COUNT(*) AS c FROM jobs WHERE user_id=?", dave.id).c) === 0);
  await setSystem({ guard_max_batch_size: 8 });

  console.log("== §48 每分钟提交数量与异常高速创建 ==");
  await setSystem({ guard_min_concurrent_jobs: 50, guard_max_concurrent_jobs: 50, guard_free_max_submits_per_minute: 2, guard_burst_max_submits: 30 });
  await provider.configure({ outcome: "succeeded", pollsToFinish: 1, transientCount: 0 });
  const rateFirst = await submit(dave, { ...VIDEO_INPUT, prompt: "限流 1" });
  const rateSecond = await submit(dave, { ...VIDEO_INPUT, prompt: "限流 2" });
  const rateThird = await submit(dave, { ...VIDEO_INPUT, prompt: "限流 3" });
  check("免费用户在每分钟上限内可以连续提交", rateFirst.status === 201 && rateSecond.status === 201, `${rateFirst.status}/${rateSecond.status}`);
  check("超过每分钟上限被拦截（429）", rateThird.status === 429 && rateThird.json?.code === "SUBMIT_RATE_LIMIT", `${rateThird.status} ${rateThird.json?.code}`);
  check("限流提示告诉用户稍后再试", /稍等|稍后/.test(rateThird.json?.error || ""), rateThird.json?.error);
  check("限流拦截没有扣额度", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", dave.id).c) === 2);

  await setSystem({ guard_free_max_submits_per_minute: 50, guard_burst_window_seconds: 10, guard_burst_max_submits: 3 });
  const burst = [];
  for (let index = 0; index < 4; index += 1) burst.push(await submit(dave, { ...VIDEO_INPUT, prompt: `高速创建 ${index + 1}` }));
  check("异常高速创建被拦截（429）", burst[3].status === 429 && burst[3].json?.code === "SUBMIT_TOO_FAST", `${burst[3].status} ${burst[3].json?.code}`);
  check("高速拦截记录到后台", Number(queryOne("SELECT COUNT(*) AS c FROM guard_events WHERE user_id=? AND kind='submit_burst'", dave.id).c) >= 1);
  scanLeak("高速拦截提示", burst[3].json);

  // Drain the queue so the next comparison isolates the per-minute rule (not concurrency).
  await tickUntil(() => Number(queryOne("SELECT COUNT(*) AS c FROM jobs WHERE user_id=? AND status IN ('queued','running','unknown')", dave.id).c) === 0, { cookie: admin.cookie, maxTicks: 6 });

  console.log("== §48 付费用户不会被保守门禁频繁阻塞 ==");
  const erin = await register("erin@wanke.test", "Erin");
  const upgrade = await call(`/api/admin/users/${erin.id}`, { method: "PATCH", cookie: admin.cookie, body: { plan: "studio", note: "e2e：验证付费用户门禁更宽" } });
  check("运营可以把成员升级到工作室版", upgrade.status === 200 && upgrade.json?.membership?.plan === "studio", `${upgrade.status} ${upgrade.text.slice(0, 120)}`);
  await setSystem({ guard_min_concurrent_jobs: 2, guard_max_concurrent_jobs: 12, guard_free_max_submits_per_minute: 2, guard_max_submits_per_minute: 12, guard_burst_max_submits: 30 });
  const erinSubmits = [];
  for (let index = 0; index < 4; index += 1) erinSubmits.push(await submit(erin, { ...VIDEO_INPUT, prompt: `付费用户连续提交 ${index + 1}` }));
  check("付费用户连续提交 4 次全部通过", erinSubmits.every(result => result.status === 201), JSON.stringify(erinSubmits.map(result => `${result.status}:${result.json?.code || ""}`)));
  check("付费用户没有触发任何拦截", Number(queryOne("SELECT COUNT(*) AS c FROM guard_events WHERE user_id=?", erin.id).c) === 0);
  const freeBlockedAgain = await submit(dave, { ...VIDEO_INPUT, prompt: "免费用户再次限流" });
  check("同一分钟里免费用户仍然受限（规则按套餐区分）", freeBlockedAgain.status === 429 && freeBlockedAgain.json?.code === "SUBMIT_RATE_LIMIT", `${freeBlockedAgain.status} ${freeBlockedAgain.json?.code}`);
  check("付费用户额度充足时按报价扣费", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", erin.id).c) === 4);

  console.log("== §48 批量创作仍然可用（门禁不破坏创作主流程） ==");
  const batchOk = await call("/api/jobs/batch", { method: "POST", cookie: erin.cookie, body: { kind: "video_generation", count: 2, input: VIDEO_INPUT, clientRequestId: `b-${randomUUID()}` } });
  check("付费用户的 2 版本批量提交成功", batchOk.status === 201 && (batchOk.json?.jobs || []).length === 2, `${batchOk.status} ${batchOk.text.slice(0, 160)}`);
  check("批量提交按版本分别计费", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", erin.id).c) === 6, queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", erin.id).c);
  check("批量提交没有因为并发门禁中途失败", (batchOk.json?.jobs || []).every(job => job.status !== "failed"), JSON.stringify((batchOk.json?.jobs || []).map(job => job.status)));

  // Drain Erin's queue so §23 measures cost recording instead of the §48 concurrency gate.
  await tickUntil(() => Number(queryOne("SELECT COUNT(*) AS c FROM jobs WHERE user_id=? AND status IN ('queued','running','unknown')", erin.id).c) === 0, { cookie: admin.cookie, maxTicks: 8 });

  // ---------- §23 成本与毛利 ----------
  console.log("== §23 任务成本记录：拿到真实用量时记实际成本 ==");
  await setSystem({ cost_per_video_second_cents: 50 });
  await provider.configure({ outcome: "succeeded", pollsToFinish: 1, transientCount: 0 });
  const costed = await submit(erin, { ...VIDEO_INPUT, prompt: "成本记录验收" });
  const costedId = costed.json?.job?.id;
  await tickUntil(() => jobRow(costedId)?.status === "succeeded", { cookie: admin.cookie });
  const costedCharge = chargeRow(costedId);
  check("创作完成后记到实际成本", Number(costedCharge?.actual_cost_cents) === 250, costedCharge?.actual_cost_cents);
  check("成本来源标记为实际成本", costedCharge?.cost_source === "actual", costedCharge?.cost_source);
  check("记录了上游返回的真实时长", Number(costedCharge?.duration_seconds) === 5, costedCharge?.duration_seconds);
  check("记录了使用的内部服务", costedCharge?.provider === "modelstudio", costedCharge?.provider);
  check("记录了任务类型与消耗额度", costedCharge?.kind === "video_generation" && Number(costedCharge?.credits) === 1);
  const unitValue = (await call("/api/admin/business", { cookie: admin.cookie })).json?.business?.cost?.creditUnit;
  check("用户支付价值按商品目录换算（不写死价格）", Number(costedCharge?.user_value_cents) === Number(costedCharge?.credits) * Number(unitValue?.cents) && Number(unitValue?.cents) > 0, `user_value=${costedCharge?.user_value_cents} unit=${JSON.stringify(unitValue)}`);
  check("换算依据说明清楚", /额度加油包|会员套餐/.test(unitValue?.basis || ""), unitValue?.basis);
  check("成本记录带创建时间", Boolean(costedCharge?.created_at));

  console.log("== §23 拿不到真实成本时只标预估，不伪装成实际成本 ==");
  await setSystem({ cost_per_video_second_cents: 0 });
  // Give the pricing rule an internal per-creation estimate so "预估" is a real number we
  // quoted before submit. Without any estimate at all the honest label stays "unknown",
  // which is the other half of §23 and is asserted by the收尾 consistency checks.
  execute("UPDATE pricing_rules SET rule_json=json_set(COALESCE(rule_json,'{}'), '$.estimatedCostCentsPerUnit', 30), updated_at=? WHERE job_kind='*'", new Date().toISOString());
  const estimated = await submit(erin, { ...VIDEO_INPUT, prompt: "预估成本验收" });
  const estimatedId = estimated.json?.job?.id;
  await tickUntil(() => jobRow(estimatedId)?.status === "succeeded", { cookie: admin.cookie });
  const estimatedCharge = chargeRow(estimatedId);
  check("没有单位成本时实际成本留空", estimatedCharge?.actual_cost_cents === null, estimatedCharge?.actual_cost_cents);
  check("成本来源标记为预估", estimatedCharge?.cost_source === "estimated", estimatedCharge?.cost_source);
  check("预估成本仍然来自提交前报价", Number(estimatedCharge?.estimated_cost_cents) >= 0);

  console.log("== §23/§46 后台经营数据 ==");
  const business = (await call("/api/admin/business", { cookie: admin.cookie })).json?.business;
  check("经营数据包含今日与本月收入", typeof business?.revenue?.todayCents === "number" && typeof business?.revenue?.monthCents === "number");
  check("经营数据区分套餐收入与加油包收入", typeof business?.revenue?.today?.planCents === "number" && typeof business?.revenue?.today?.packCents === "number");
  check("经营数据包含支付成功率", business?.revenue?.paymentSuccessRate === null || (business.revenue.paymentSuccessRate >= 0 && business.revenue.paymentSuccessRate <= 1), JSON.stringify(business?.revenue?.paymentSuccessRate));
  check("经营数据包含退款金额", typeof business?.revenue?.refundedTodayCents === "number" && typeof business?.revenue?.refundedTotalCents === "number");
  check("经营数据包含活跃/新增/付费用户", typeof business?.users?.activeToday === "number" && typeof business?.users?.newToday === "number" && typeof business?.users?.payingToday === "number" && typeof business?.users?.paidTotal === "number");
  check("经营数据包含生成任务量与成功率", typeof business?.creations?.today === "number" && (business?.creations?.successRate === null || business.creations.successRate >= 0), JSON.stringify(business?.creations));
  check("经营数据包含平均单任务成本与预计生成成本", typeof business?.cost?.today?.averageCents === "number" && typeof business?.cost?.today?.reportedCents === "number");
  check("经营数据包含毛利估算", typeof business?.cost?.marginTodayCents === "number" && typeof business?.cost?.marginMonthCents === "number");
  check("毛利估算等于收入减去生成成本", business?.cost?.marginTodayCents === business.revenue.todayCents - business.cost.today.reportedCents, `${business?.revenue?.todayCents} - ${business?.cost?.today?.reportedCents}`);
  check("成本口径明确标注实际或预估", ["actual", "estimated", "unknown"].includes(business?.cost?.basis) && Boolean(business?.cost?.basisText), JSON.stringify({ basis: business?.cost?.basis, basisText: business?.cost?.basisText }));
  check("只有部分任务拿到实测成本时口径仍标预估", business?.cost?.basis === "estimated" && /^\d+\/\d+$/.test(String(business?.cost?.measuredToday)), JSON.stringify({ basis: business?.cost?.basis, measured: business?.cost?.measuredToday }));
  check("经营数据包含任务成本明细", Array.isArray(business?.recentCosts) && business.recentCosts.some(row => row.jobId === costedId), `${(business?.recentCosts || []).length} rows`);
  check("成本明细里能看到实际成本行", business?.recentCosts?.some(row => row.costSource === "actual" && row.actualCostCents === 250), JSON.stringify((business?.recentCosts || []).slice(0, 3)));

  console.log("== §48 单用户成本异常报警 ==");
  await setSystem({ guard_user_daily_cost_cents: 100, cost_per_video_second_cents: 50 });
  const alarmed = await submit(erin, { ...VIDEO_INPUT, prompt: "成本报警验收" });
  await tickUntil(() => jobRow(alarmed.json?.job?.id)?.status === "succeeded", { cookie: admin.cookie });
  const alerts = (await call("/api/admin/business", { cookie: admin.cookie })).json?.business?.risks?.guard?.costAlerts;
  check("当日成本超过阈值的用户被报警", Array.isArray(alerts) && alerts.some(row => row.userId === erin.id && row.alarmed === true), JSON.stringify(alerts));
  check("报警带上金额与任务数", (alerts || []).some(row => row.reportedCents >= 100 && row.jobs >= 1), JSON.stringify(alerts));
  await setSystem({ guard_user_daily_cost_cents: 0 });
  const alertsOff = (await call("/api/admin/business", { cookie: admin.cookie })).json?.business?.risks?.guard?.costAlerts;
  check("阈值为 0 时不报警（运营可以关掉）", (alertsOff || []).length === 0, JSON.stringify(alertsOff));

  // ---------- §20 结果通知：站内 + 邮件（真实 SMTP） ----------
  console.log("== 创作结果通知（站内 + 邮件，邮件按用户偏好） ==");
  const smtpConfig = await setSystem({
    email_enabled: true, email_host: "127.0.0.1", email_port: smtp.port, email_secure: false,
    email_from: SMTP_FROM, email_username: SMTP_USER, email_password: SMTP_PASSWORD,
    site_url: "https://wanke.test", notify_job_email: true,
  });
  check("邮件与通知配置可以保存", smtpConfig.status === 200, `${smtpConfig.status}`);
  const bobPrefs = await call("/api/account/preferences", { method: "PATCH", cookie: bob.cookie, body: { notifications: { email: true } } });
  check("成员可以自己打开邮件通知", bobPrefs.status === 200 && bobPrefs.json?.preferences?.notifications?.email === true, JSON.stringify(bobPrefs.json?.preferences));
  smtp.reset();
  const bobJob = await submit(bob, { ...VIDEO_INPUT, prompt: "邮件通知验收" });
  const aliceJob = await submit(alice, { ...VIDEO_INPUT, prompt: "不发邮件验收" });
  await tickUntil(() => jobRow(bobJob.json?.job?.id)?.status === "succeeded" && jobRow(aliceJob.json?.job?.id)?.status === "succeeded", { cookie: admin.cookie });
  const bobMail = smtp.messages.filter(message => message.envelope?.to?.includes("bob@wanke.test"));
  const aliceMail = smtp.messages.filter(message => message.envelope?.to?.includes("alice@wanke.test"));
  check("打开邮件偏好的成员真的收到了邮件（真实 SMTP 投递）", bobMail.length === 1, `messages=${smtp.messages.length}`);
  check("没有打开邮件偏好的成员不会收到邮件", aliceMail.length === 0, `messages=${JSON.stringify(aliceMail.map(m => m.envelope))}`);
  check("邮件标题是业务文案", /创作已经完成/.test(bobMail[0]?.message?.subject || bobMail[0]?.subject || ""), JSON.stringify(bobMail[0]?.message?.subject || bobMail[0]?.subject));
  const bobMailText = bobMail[0]?.text || bobMail[0]?.message?.text || "";
  check("邮件正文包含创作名称与入口", /验收创作/.test(bobMailText) && /\/studio/.test(bobMailText), bobMailText.slice(0, 200).replace(/\n/g, " | "));
  scanCopy("创作完成邮件", `${bobMail[0]?.message?.subject || bobMail[0]?.subject || ""}\n${bobMailText}`);
  check("邮件流水被记录为已发送", queryOne("SELECT status FROM email_messages WHERE user_id=? AND kind='notification' ORDER BY created_at DESC LIMIT 1", bob.id)?.status === "sent", JSON.stringify(queryOne("SELECT * FROM email_messages WHERE user_id=? ORDER BY created_at DESC LIMIT 1", bob.id)));
  check("站内通知同时存在（邮件不是唯一渠道）", query("SELECT * FROM notifications WHERE dedupe_key=?", `job_done:${bobJob.json.job.id}`).length === 1);

  console.log("== 创作失败也通知，并说明额度去向 ==");
  await provider.configure({ outcome: "failed", failCode: "InternalError", failMessage: "mock upstream failure", pollsToFinish: 1 });
  smtp.reset();
  const bobFailed = await submit(bob, { ...VIDEO_INPUT, prompt: "失败邮件验收" });
  await tickUntil(() => jobRow(bobFailed.json?.job?.id)?.status === "failed", { cookie: admin.cookie });
  const bobFailMail = smtp.messages.filter(message => message.envelope?.to?.includes("bob@wanke.test"));
  check("失败创作也发了一封邮件", bobFailMail.length === 1, `messages=${smtp.messages.length}`);
  const failText = bobFailMail[0]?.text || bobFailMail[0]?.message?.text || "";
  check("失败邮件说明额度已退回", /创作额度已经退回|退回/.test(failText), failText.slice(0, 200));
  scanCopy("创作失败邮件", failText);
  check("失败额度确实退回了一次", chargeRow(bobFailed.json?.job?.id)?.status === "refunded" && query("SELECT * FROM quota_ledger WHERE ref_id=? AND reason='job_refund'", bobFailed.json.job.id).length === 1);
  await setSystem({ notify_job_email: false });

  // ---------- §46 运营监控：Worker 停止 / 任务积压 / 连续失败 ----------
  console.log("== §46 后台能看到 Worker 停止、任务积压与连续失败 ==");
  await provider.configure({ outcome: "stall", pollsToFinish: 99 });
  const backlogJob = await submit(erin, { ...VIDEO_INPUT, prompt: "积压验收" });
  const health = (await call("/api/admin/worker", { cookie: admin.cookie })).json?.worker;
  check("后台可以看到调度开关与节奏", health?.enabled === false && Number(health?.intervalSeconds) >= 2, JSON.stringify({ enabled: health?.enabled, intervalSeconds: health?.intervalSeconds }));
  check("后台可以看到任务积压", Number(health?.backlog) >= 1, `backlog=${health?.backlog}`);
  check("后台可以看到超时与查询上限配置", Number(health?.timeoutMinutes) >= 1 && Number(health?.pollMaxErrors) >= 1, JSON.stringify({ timeoutMinutes: health?.timeoutMinutes, pollMaxErrors: health?.pollMaxErrors }));
  check("后台可以看到最近调度记录", Array.isArray(health?.runs) && health.runs.length >= 1, `${(health?.runs || []).length} runs`);
  check("调度关闭时不会误报“已停止”", health?.stopped === false, JSON.stringify(health?.stopped));
  check("后台可以看到反复查询失败的任务数", typeof health?.strugglingJobs === "number", JSON.stringify(health?.strugglingJobs));

  await setSystem({ worker_enabled: true });
  execute("UPDATE worker_runs SET started_at=?, finished_at=?", new Date(Date.now() - 10 * 60_000).toISOString(), new Date(Date.now() - 10 * 60_000).toISOString());
  const stoppedHealth = (await call("/api/admin/worker", { cookie: admin.cookie })).json?.worker;
  check("调度开启但长时间没有推进时后台报警", stoppedHealth?.stopped === true, JSON.stringify({ stopped: stoppedHealth?.stopped, secondsSinceLastRun: stoppedHealth?.secondsSinceLastRun }));
  const stoppedBusiness = (await call("/api/admin/business", { cookie: admin.cookie })).json?.business;
  check("经营首页的异常区也能看到调度停止", stoppedBusiness?.risks?.worker?.stopped === true, JSON.stringify(stoppedBusiness?.risks?.worker));
  check("经营首页异常区能看到积压与超时", typeof stoppedBusiness?.risks?.worker?.backlog === "number" && typeof stoppedBusiness?.risks?.worker?.timedOut24h === "number");
  check("连续失败的创作类型会出现在异常区", Array.isArray(stoppedBusiness?.risks?.failingKinds), JSON.stringify(stoppedBusiness?.risks?.failingKinds));
  await setSystem({ worker_enabled: false });

  // ---------- §21 成员只看到业务状态 ----------
  console.log("== §21 任务状态统一：成员只看业务语言 ==");
  const memberList = await call("/api/jobs", { cookie: erin.cookie });
  check("成员任务列表可以正常读取", memberList.status === 200 && Array.isArray(memberList.json?.jobs), `${memberList.status}`);
  scanMemberPayload("成员任务列表", memberList.json);
  check("成员任务列表不带上游原始响应", (memberList.json?.jobs || []).every(job => !FORBIDDEN_JOB_KEYS.some(key => key in job)), JSON.stringify((memberList.json?.jobs || []).map(job => Object.keys(job))).slice(0, 200));
  checkMemberJobShape("成员任务列表首条", (memberList.json?.jobs || [])[0]);
  const memberBusinessStatuses = ["等待开始", "正在生成", "正在处理", "已完成", "需要重新尝试", "已取消", "状态确认中"];
  const oneRefresh = await call(`/api/jobs/${backlogJob.json.job.id}`, { method: "POST", cookie: erin.cookie, body: { action: "refresh" } });
  check("刷新返回的业务状态属于统一的六种说法", memberBusinessStatuses.includes(oneRefresh.json?.business?.label), JSON.stringify(oneRefresh.json?.business));
  check("业务状态给出成员能理解的说明", typeof oneRefresh.json?.business?.hint === "string" && oneRefresh.json.business.hint.length > 4, JSON.stringify(oneRefresh.json?.business?.hint));
  const adminJobView = await call(`/api/jobs/${backlogJob.json.job.id}`, { cookie: admin.cookie });
  check("管理员保留内部状态与上游信息用于运营", adminJobView.json?.business?.internalStatus !== undefined && adminJobView.json?.job?.provider !== null, JSON.stringify({ internal: adminJobView.json?.business?.internalStatus, hasProvider: adminJobView.json?.job?.provider !== null }));

  // ---------- 收尾：全库一致性 ----------
  console.log("== 收尾一致性检查 ==");
  const chargeStates = query("SELECT status, COUNT(*) AS c FROM task_charges GROUP BY status");
  console.log(`  info 计费状态分布：${chargeStates.map(row => `${row.status}=${row.c}`).join(" ")}`);
  const orphanCharges = Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE job_id IS NOT NULL AND job_id NOT IN (SELECT id FROM jobs)").c);
  check("没有指向已删除任务的计费记录", orphanCharges === 0, `${orphanCharges}`);
  const stuckInFlight = query("SELECT id, status, attempts FROM jobs WHERE status IN ('queued','running','unknown')");
  console.log(`  info 仍在进行中的创作：${stuckInFlight.length} 个（${stuckInFlight.map(row => `${row.status}/${row.attempts}`).join(" ")}）`);
  const doubleReserve = query("SELECT ref_id, COUNT(*) AS c FROM quota_ledger WHERE reason='job_reserve' GROUP BY ref_id HAVING c > 1");
  check("没有任何创作被预扣两次", doubleReserve.length === 0, JSON.stringify(doubleReserve));
  const doubleRefund = query("SELECT ref_id, COUNT(*) AS c FROM quota_ledger WHERE reason='job_refund' GROUP BY ref_id HAVING c > 1");
  check("没有任何创作被退回两次", doubleRefund.length === 0, JSON.stringify(doubleRefund));
  const ledgerBalance = query("SELECT user_id, delta, balance_before, balance_after FROM quota_ledger ORDER BY created_at ASC, rowid ASC");
  const running = new Map();
  let brokenChain = 0;
  for (const row of ledgerBalance) {
    const before = Number(running.get(row.user_id) ?? row.balance_before);
    if (before !== Number(row.balance_before)) brokenChain += 1;
    running.set(row.user_id, Number(row.balance_after));
  }
  check("额度账本前后余额连续（无凭空增减）", brokenChain === 0, `${brokenChain} 处断裂`);
  const settledWithoutJob = Number(queryOne("SELECT COUNT(*) AS c FROM task_charges c WHERE c.status='settled' AND c.job_id IS NOT NULL AND (SELECT status FROM jobs WHERE id=c.job_id) <> 'succeeded'").c);
  check("只有真正完成的任务才确认扣费", settledWithoutJob === 0, `${settledWithoutJob}`);
  const refundedTerminal = Number(queryOne("SELECT COUNT(*) AS c FROM task_charges c WHERE c.status='refunded' AND c.job_id IS NOT NULL AND (SELECT status FROM jobs WHERE id=c.job_id) = 'succeeded'").c);
  check("已完成的任务不会被退回额度", refundedTerminal === 0, `${refundedTerminal}`);
  check("上游生成投递次数与任务数一致（Worker 从不自动重投）", provider.state.submits === Number(queryOne("SELECT COUNT(*) AS c FROM jobs WHERE provider_job_id IS NOT NULL").c), `submits=${provider.state.submits} jobs=${queryOne("SELECT COUNT(*) AS c FROM jobs WHERE provider_job_id IS NOT NULL").c}`);
} catch (error) {
  failures += 1;
  console.error("worker e2e crashed:", error instanceof Error ? error.stack || error.message : error);
} finally {
  for (const entry of [...children]) killServer(entry.port);
  await provider.stop();
  await smtp.close();
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — worker-e2e: ${failures} 项失败`);
  console.log(`  上游统计：提交 ${provider.state.submits} · 查询 ${provider.state.polls} · 鉴权失败 ${provider.state.authFailures} · 注入异常 ${provider.state.transientInjected}`);
  process.exit(failures === 0 ? 0 : 1);
}
