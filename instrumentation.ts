/**
 * Server boot hook (§20 任务运行必须脱离浏览器).
 *
 * This is what makes creations survive a closed browser: when the Node server starts, it
 * starts the unattended job worker loop. The loop re-reads its own configuration on every
 * pass, so an operator can retune the cadence or pause it from 管理后台 → 系统设置 without
 * a redeploy, and the timer is unref'd so it can never hold the process open.
 *
 * Deployments that prefer an external scheduler (cron / systemd timer) can turn the
 * in-process loop off with WANKE_DISABLE_WORKER=true and call `scripts/worker-tick.mjs`
 * instead; both paths run exactly the same worker code.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (String(process.env.WANKE_DISABLE_WORKER || "").toLowerCase() === "true") return;
  try {
    const { startJobWorkerLoop, workerConfig } = await import("@/lib/worker");
    const started = startJobWorkerLoop();
    const config = workerConfig();
    console.log(`[worker] 创作任务后台调度${started.started ? "已启动" : "已在运行"}：${config.enabled ? `每 ${config.intervalSeconds} 秒一轮` : "当前在系统设置里处于关闭状态"}`);
  } catch (error) {
    // Never block server boot on the scheduler; the admin backoffice still reports it as stopped.
    console.error("[worker] 后台调度启动失败：", error instanceof Error ? error.message : String(error));
  }
}
