// Phase 4 operations entry point (§20 任务运行必须脱离浏览器).
//
//   node scripts/worker-tick.mjs                 # one worker pass against WANKE_BASE_URL
//   WANKE_WORKER_TOKEN=... node scripts/worker-tick.mjs
//
// For deployments that drive the worker from cron / systemd instead of the in-process
// loop. It calls the same server worker over the token-protected internal endpoint, so
// cron and the built-in scheduler are the same code path and the same exactly-once rules.
//
//   */1 * * * * cd /opt/wanke && WANKE_WORKER_TOKEN=$(cat /etc/wanke/worker-token) node scripts/worker-tick.mjs >> /var/log/wanke-worker.log 2>&1
//
// Exit codes: 0 = pass completed (even with zero work), 1 = refused or failed, so a
// supervisor can alarm on a worker that stopped advancing creations.

const BASE = (process.env.WANKE_BASE_URL || process.env.E2E_BASE || "http://127.0.0.1:3000").replace(/\/+$/, "");
const TOKEN = process.env.WANKE_WORKER_TOKEN || "";
const TIMEOUT_MS = Number(process.env.WANKE_WORKER_TIMEOUT_MS || 120000);

if (!TOKEN) {
  console.error("worker-tick: 需要 WANKE_WORKER_TOKEN（与后台「系统设置 → 后台任务 → 运维调度令牌」一致）");
  process.exit(1);
}

try {
  const response = await fetch(`${BASE}/api/internal/worker`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok) {
    console.error(`worker-tick: 调度失败 HTTP ${response.status} ${body?.code || ""} ${body?.error || text.slice(0, 200)}`);
    process.exit(1);
  }
  const summary = body
    ? `processed=${body.processed} succeeded=${body.succeeded} failed=${body.failed} timedOut=${body.timedOut} settled=${body.settled} refunded=${body.refunded} backlog=${body.backlog}${body.skipped ? ` skipped=${body.skipped}` : ""} ${body.durationMs}ms`
    : text.slice(0, 200);
  console.log(`worker-tick: ${summary}`);
  process.exit(0);
} catch (error) {
  console.error(`worker-tick: 无法连接 ${BASE}/api/internal/worker — ${error?.message || error}`);
  process.exit(1);
}
