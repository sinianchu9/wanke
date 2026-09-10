"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, BarChart3, ClipboardList, Coins, FileText, LoaderCircle, Package,
  Receipt, RefreshCw, Server, Settings2, ShieldCheck, Users, Video,
} from "lucide-react";
import SettingsPanel from "@/components/settings-panel";
import { JOB_STATUS_COPY, PAYMENT_STATUS_COPY, REFUND_STATUS_COPY } from "@/lib/copy";
import { JOB_KIND_LABELS } from "@/lib/types";

type Section = "dashboard" | "users" | "plans" | "orders" | "refunds" | "jobs" | "works" | "service" | "settings" | "audit";

const NAV: Array<{ group: string; items: Array<{ id: Section; label: string; icon: typeof Users }> }> = [
  { group: "经营", items: [{ id: "dashboard", label: "经营概览", icon: BarChart3 }] },
  { group: "用户", items: [{ id: "users", label: "用户管理", icon: Users }] },
  { group: "商业", items: [
    { id: "plans", label: "商品与套餐", icon: Package },
    { id: "orders", label: "订单管理", icon: Receipt },
    { id: "refunds", label: "退款与售后", icon: Coins },
  ] },
  { group: "创作", items: [
    { id: "jobs", label: "任务监管", icon: Video },
    { id: "works", label: "作品与素材", icon: FileText },
    { id: "service", label: "创作服务", icon: Server },
  ] },
  { group: "系统", items: [
    { id: "settings", label: "系统设置", icon: Settings2 },
    { id: "audit", label: "操作记录", icon: ClipboardList },
  ] },
];

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function yuan(cents: number) {
  return `¥${(Math.round(cents || 0) / 100).toFixed((cents || 0) % 100 === 0 ? 0 : 2)}`;
}

function percent(rate: number | null | undefined) {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(rate * 100 % 1 === 0 ? 0 : 1)}%`;
}

export default function AdminConsole() {
  const [section, setSection] = useState<Section>("dashboard");
  return <div className="admin-wrap">
    <div className="admin-top">
      <Link href="/studio" className="secondary"><ArrowLeft size={14} />返回工作台</Link>
      <div className="admin-title">
        <ShieldCheck size={18} />
        <h1>Wanke 运营后台</h1>
        <span className="muted">用户 · 商品 · 订单 · 创作服务 · 操作记录</span>
      </div>
    </div>
    <div className="member-layout">
      <nav className="member-nav">
        {NAV.map(group => <div key={group.group} className="admin-nav-group">
          <div className="nav-section-label">{group.group}</div>
          {group.items.map(item => (
            <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
              <item.icon size={15} /><span>{item.label}</span>
            </button>
          ))}
        </div>)}
      </nav>
      <div className="member-body">
        {section === "dashboard" && <Dashboard />}
        {section === "users" && <UsersSection />}
        {section === "plans" && <PlansSection />}
        {section === "orders" && <OrdersSection />}
        {section === "refunds" && <RefundsSection />}
        {section === "jobs" && <JobsSection />}
        {section === "works" && <WorksSection />}
        {section === "service" && <ServiceSection />}
        {section === "settings" && <SystemSettingsSection />}
        {section === "audit" && <AuditSection />}
      </div>
    </div>
  </div>;
}

function useLoad<T>(path: string, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api(path)); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

function Loading() { return <div className="works-empty"><LoaderCircle className="spin" size={20} />加载中…</div>; }
function ErrorNote({ message }: { message: string }) { return <div className="error-banner">{message}</div>; }

function Dashboard() {
  const { data, error, loading, reload } = useLoad<any>("/api/admin/stats", []);
  // §23 经营数据 + §46 运营监控: cost, margin and the risks that must be visible here.
  const { data: businessData, loading: businessLoading } = useLoad<any>("/api/admin/business", []);
  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  const stats = data.stats;
  const business = businessLoading ? null : businessData?.business || null;
  return <div className="admin-panel">
    <div className="admin-panel-head"><h2>经营概览</h2><button className="secondary" onClick={reload}><RefreshCw size={13} />刷新</button></div>
    <div className="kpi-grid">
      <div className="kpi"><strong>{yuan(stats.revenue.todayCents)}</strong><span>今日收入</span>
        <small>本月 {yuan(stats.revenue.monthCents)} · 累计 {yuan(stats.revenue.totalCents)}</small></div>
      <div className="kpi"><strong>{stats.revenue.paidOrdersToday}</strong><span>今日支付订单</span>
        <small>退款 {yuan(stats.revenue.refundedCents)} · 待支付 {stats.revenue.pendingOrders}</small></div>
      <div className="kpi"><strong>{stats.users.total}</strong><span>注册用户</span>
        <small>今日新增 {stats.users.newToday} · 付费 {stats.users.paid} · 今日活跃 {stats.users.activeToday}</small></div>
      <div className="kpi"><strong>{stats.jobs.today}</strong><span>今日创作任务</span>
        <small>进行中 {stats.jobs.running} · 已完成 {stats.jobs.succeeded} · 未完成 {stats.jobs.failed}</small></div>
      <div className="kpi"><strong>{stats.credits.consumedToday}</strong><span>今日消耗创作额度</span>
        <small>预扣中 {stats.credits.reserved} · 已确认 {stats.credits.settled} · 已退回 {stats.credits.refunded}</small></div>
      <div className="kpi"><strong>{stats.support.openTickets + stats.support.pendingRefunds + stats.support.pendingInvoices}</strong><span>待处理事项</span>
        <small>反馈 {stats.support.openTickets} · 退款 {stats.support.pendingRefunds} · 发票 {stats.support.pendingInvoices}</small></div>
      <div className="kpi"><strong>{percent(business?.creations?.successRate)}</strong><span>今日创作成功率</span>
        <small>今日 {business?.creations?.today ?? stats.jobs.today} 个 · 未完成 {business?.creations?.failedToday ?? 0} · 进行中 {business?.creations?.inFlight ?? stats.jobs.running}</small></div>
      <div className="kpi"><strong>{percent(business?.revenue?.paymentSuccessRate)}</strong><span>今日支付成功率</span>
        <small>套餐 {yuan(business?.revenue?.today?.planCents ?? 0)} · 加油包 {yuan(business?.revenue?.today?.packCents ?? 0)}</small></div>
      <div className="kpi"><strong>{yuan(business?.cost?.today?.averageCents ?? 0)}</strong><span>平均单任务成本</span>
        <small>预计生成成本 {yuan(business?.cost?.today?.reportedCents ?? 0)} · {business?.cost?.basisText || "暂无成本数据"}{business?.cost?.basis === "estimated" ? "（未拿到实际成本）" : ""}</small></div>
      <div className="kpi"><strong>{yuan(business?.cost?.marginTodayCents ?? 0)}</strong><span>今日毛利估算</span>
        <small>毛利率 {percent(business?.cost?.marginRateToday)} · 本月 {yuan(business?.cost?.marginMonthCents ?? 0)}</small></div>
    </div>
    <div className="system-grid" style={{ marginTop: 16 }}>
      <section className="panel">
        <h3>异常与风险</h3>
        <dl className="kv-list">
          <div><dt>支付异常订单</dt><dd>{stats.revenue.abnormalOrders > 0 ? <span className="error-text">{stats.revenue.abnormalOrders} 个需要人工确认</span> : "无"}</dd></div>
          <div><dt>未验签支付通知</dt><dd>{stats.revenue.unverifiedNotifications > 0 ? <span className="error-text">{stats.revenue.unverifiedNotifications} 条</span> : "无"}</dd></div>
          <div><dt>邮件发送失败（24 小时）</dt><dd>{stats.email?.failed24h > 0
            ? <span className="error-text">{stats.email.failed24h} 封失败{stats.email.lastFailure?.error ? `：${String(stats.email.lastFailure.error).slice(0, 60)}` : ""}</span>
            : stats.email?.sent24h ? `无（24 小时发出 ${stats.email.sent24h} 封）` : "无"}</dd></div>
          <div><dt>邮件服务</dt><dd>{stats.email?.configured
            ? (stats.email.enabled ? "已开启" : <span className="error-text">已配置但没有开启，验证与找回密码邮件不会送达</span>)
            : <span className="error-text">{stats.email?.enabled ? `未配置完整：缺少 ${(stats.email?.missing || []).join("、")}` : "未配置，验证与找回密码邮件只能留档"}</span>}</dd></div>
          <div><dt>未验证邮箱账号</dt><dd>{stats.users.unverifiedEmails || 0}{stats.email?.stuckQueued > 0 ? <span className="error-text"> · {stats.email.stuckQueued} 封卡在发送中（进程中断）</span> : null}</dd></div>
          <div><dt>暂停使用账号</dt><dd>{stats.users.suspended}</dd></div>
          <div><dt>已注销账号</dt><dd>{stats.users.closed}</dd></div>
          <div><dt>历史遗留任务</dt><dd>{stats.jobs.legacy}（商业化迁移前创建，仅后台可见）</dd></div>
          <div><dt>后台创作调度</dt><dd>{business?.risks?.worker
            ? (business.risks.worker.stopped
              ? <span className="error-text">已停止：最近 {business.risks.worker.secondsSinceLastRun ?? "—"} 秒没有推进任务，用户关闭网页后创作不会继续</span>
              : business.risks.worker.enabled
                ? `运行中（最近一轮 ${business.risks.worker.secondsSinceLastRun ?? "—"} 秒前，每 ${business.risks.worker.lastRunDurationMs ?? 0}ms）`
                : <span className="error-text">已在系统设置里关闭，正式运营必须开启</span>)
            : "加载中…"}</dd></div>
          <div><dt>任务积压</dt><dd>{(business?.risks?.worker?.backlog ?? stats.jobs.running) > 0
            ? <>{business?.risks?.worker?.backlog ?? stats.jobs.running} 个进行中{business?.risks?.worker?.strugglingJobs > 0 ? <span className="error-text"> · {business.risks.worker.strugglingJobs} 个查询反复失败</span> : null}</>
            : "无"}</dd></div>
          <div><dt>超时与待确认</dt><dd>{business?.risks?.worker?.timedOut24h > 0 ? <span className="error-text">24 小时内 {business.risks.worker.timedOut24h} 个创作超时</span> : "无超时"}
            {business?.risks?.worker?.unresolvedCharges24h > 0 ? <span className="error-text"> · {business.risks.worker.unresolvedCharges24h} 笔额度待人工确认</span> : ""}</dd></div>
          <div><dt>连续失败的创作类型</dt><dd>{business?.risks?.failingKinds?.length
            ? <span className="error-text">{business.risks.failingKinds.map((row: any) => `${row.kind}（连续 ${row.consecutiveFailures} 次 / 24 小时 ${row.failed24h} 次）`).join("、")}</span>
            : "无"}</dd></div>
          <div><dt>异常提交拦截（24 小时）</dt><dd>{business?.risks?.guard?.blocked > 0
            ? <>{business.risks.guard.blocked} 次{business.risks.guard.topUsers?.length ? `（最多：${business.risks.guard.topUsers.map((row: any) => `${row.email || row.userId} ${row.blocked} 次`).join("、")}）` : ""}</>
            : "无"}</dd></div>
          <div><dt>磁盘空间</dt><dd>{business?.risks?.storage?.disk
            ? (business.risks.storage.disk.warn
              ? <span className="error-text">剩余 {formatBytes(business.risks.storage.disk.freeBytes)}（{business.risks.storage.disk.freePercent.toFixed(1)}%），低于 {business.risks.storage.disk.warnThresholdPercent}% 报警线，请清理或扩容</span>
              : `剩余 ${formatBytes(business.risks.storage.disk.freeBytes)}（${business.risks.storage.disk.freePercent.toFixed(1)}%）`)
            : "读取中…"}</dd></div>
          <div><dt>存储清理</dt><dd>{business?.risks?.storage?.sweep
            ? (business.risks.storage.sweep.errors?.length
              ? <span className="error-text">最近一次清理有 {business.risks.storage.sweep.errors.length} 个失败：{String(business.risks.storage.sweep.errors[0]).slice(0, 60)}</span>
              : `正常（${new Date(business.risks.storage.sweep.at).toLocaleString("zh-CN")} 清理孤儿 ${business.risks.storage.sweep.orphanFilesRemoved}、失效输入 ${business.risks.storage.sweep.staleInputsRemoved}、失效登记 ${business.risks.storage.sweep.danglingRowsRemoved}）`)
            : "尚未运行（随后台任务按设置间隔自动执行）"}</dd></div>
          <div><dt>自动备份</dt><dd>{business?.risks?.storage?.backup?.last
            ? (business.risks.storage.backup.last.ok
              ? (business.risks.storage.backup.stale
                ? <span className="error-text">上次成功备份已超过 36 小时（{new Date(business.risks.storage.backup.last.at).toLocaleString("zh-CN")}），请检查备份定时任务</span>
                : `正常（${new Date(business.risks.storage.backup.last.at).toLocaleString("zh-CN")}，${formatBytes(business.risks.storage.backup.last.bytes)}）`)
              : <span className="error-text">上次备份失败：{String(business.risks.storage.backup.last.error || "未知原因").slice(0, 60)}</span>)
            : <span className="error-text">还没有运行过自动备份，请按运维文档配置定时任务</span>}</dd></div>
          <div><dt>单用户成本报警</dt><dd>{business?.risks?.guard?.costAlerts?.length
            ? <span className="error-text">{business.risks.guard.costAlerts.map((row: any) => `${row.email || row.userId} ${yuan(row.reportedCents)}（${row.jobs} 个创作）`).join("、")}</span>
            : "无"}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <h3>会员分布</h3>
        <dl className="kv-list">
          {stats.plans.map((row: any) => <div key={row.id}><dt>{row.name}</dt><dd>{row.count} 人</dd></div>)}
          {stats.plans.length === 0 && <div><dt>暂无会员数据</dt><dd>—</dd></div>}
        </dl>
      </section>
      <section className="panel">
        <h3>内容资产</h3>
        <dl className="kv-list">
          <div><dt>作品总数</dt><dd>{stats.works.total}</dd></div>
          <div><dt>素材总数</dt><dd>{stats.assets.total}</dd></div>
          <div><dt>任务总数</dt><dd>{stats.jobs.total}</dd></div>
        </dl>
      </section>
    </div>
  </div>;
}

function UsersSection() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (status) params.set("status", status);
  const { data, error, loading, reload } = useLoad<any>(`/api/admin/users?${params.toString()}`, [query, status]);
  const [busy, setBusy] = useState("");

  function askReason(action: string): string | null {
    const reason = window.prompt(`${action}\n请填写操作原因（会记录在操作记录中）：`);
    if (reason === null) return null;
    return reason.trim().length >= 2 ? reason.trim() : "";
  }

  async function patch(userId: string, payload: Record<string, unknown>, action: string, needsReason = true) {
    let note = "";
    if (needsReason) {
      const reason = askReason(action);
      if (reason === null) return;
      if (!reason) { alert("必须填写操作原因"); return; }
      note = reason;
    }
    setBusy(userId);
    try {
      await api(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, note: note || payload.note }),
      });
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  return <div className="admin-panel">
    <div className="admin-panel-head">
      <h2>用户管理</h2>
      <div className="admin-filters">
        <input placeholder="搜索邮箱 / 昵称" value={query} onChange={event => setQuery(event.target.value)} />
        <select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="disabled">暂停使用</option>
          <option value="closed">已注销</option>
        </select>
        <button className="secondary" onClick={reload}><RefreshCw size={13} />刷新</button>
      </div>
    </div>
    {loading ? <Loading /> : error ? <ErrorNote message={error} /> : (
      <table className="admin-table">
        <thead><tr><th>用户</th><th>会员</th><th>创作额度</th><th>有效期至</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead>
        <tbody>
          {data.users.map((row: any) => <tr key={row.user.id}>
            <td><strong>{row.user.name}</strong><br /><span className="muted mini">{row.user.email}{row.user.role === "admin" ? " · 管理员" : ""}</span></td>
            <td>{row.membership.planName}</td>
            <td><Coins size={12} /> 可用 {row.membership.credits.available}
              <br /><span className="muted mini">本周期 {row.membership.credits.planUsed}/{row.membership.credits.planLimit}{row.membership.credits.bonus ? ` · 加油包 ${row.membership.credits.bonus}` : ""}</span></td>
            <td>{new Date(row.membership.periodEnd).toLocaleDateString("zh-CN")}</td>
            <td><span className={`stage-state ${row.user.status === "active" ? "succeeded" : "failed"}`}>
              {row.user.status === "active" ? "正常" : row.user.status === "closed" ? "已注销" : "暂停使用"}</span></td>
            <td>{new Date(row.user.createdAt).toLocaleDateString("zh-CN")}</td>
            <td className="inline-actions">
              <button className="secondary" disabled={busy === row.user.id}
                onClick={() => patch(row.user.id, { creditDelta: Number(window.prompt(`给 ${row.user.email} 赠送创作额度（正数赠送，负数扣减）：`, "10")) || 0 }, "调整创作额度")}>
                调整额度
              </button>
              <button className="secondary" disabled={busy === row.user.id}
                onClick={() => patch(row.user.id, { extendDays: Number(window.prompt(`为 ${row.user.email} 延长会员天数：`, "30")) || 0 }, "延长会员")}>
                延长会员
              </button>
              {row.user.status === "active"
                ? <button className="secondary" disabled={busy === row.user.id || row.user.role === "admin"}
                    title={row.user.role === "admin" ? "管理员账号不能在列表里暂停，以免系统失去唯一可登录的管理员" : "暂停后该用户立即无法登录"}
                    onClick={() => patch(row.user.id, { status: "disabled" }, "暂停账号")}>暂停</button>
                : <button className="secondary" disabled={busy === row.user.id}
                    onClick={() => patch(row.user.id, { status: "active" }, "恢复账号")}>恢复</button>}
            </td>
          </tr>)}
          {data.users.length === 0 && <tr><td colSpan={7} className="muted">没有匹配的用户</td></tr>}
        </tbody>
      </table>
    )}
    <p className="mini muted">调整套餐请使用「商品与套餐」上架对应套餐，再由用户下单支付；后台直接改套餐属于运营补偿，必须填写原因。</p>
  </div>;
}

function PlansSection() {
  const { data, error, loading, reload } = useLoad<any>("/api/admin/plans", []);
  const [draft, setDraft] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function edit(plan: any) {
    setDraft({
      id: plan.id, kind: plan.kind || "membership", name: plan.name, subtitle: plan.subtitle || "",
      priceYuan: (plan.priceCents / 100).toFixed(2), credits: plan.credits, validityDays: plan.validityDays,
      features: (plan.features || []).join("\n"), maxConcurrentJobs: plan.maxConcurrentJobs || 0,
      maxAssetMb: plan.maxAssetMb || 0, maxWorks: plan.maxWorks || 0, maxResolution: plan.maxResolution || "",
      purchasable: plan.purchasable !== false, public: plan.public !== false, recommended: Boolean(plan.recommended),
      status: plan.status || "active", isNew: false,
    });
    setMessage("");
  }

  function create() {
    setDraft({
      id: "", kind: "membership", name: "", subtitle: "", priceYuan: "0.00", credits: 10, validityDays: 30,
      features: "", maxConcurrentJobs: 2, maxAssetMb: 512, maxWorks: 100, maxResolution: "1080p",
      purchasable: true, public: true, recommended: false, status: "active", isNew: true,
    });
    setMessage("");
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage("");
    try {
      await api("/api/admin/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id.trim(),
          kind: draft.kind,
          name: draft.name.trim(),
          subtitle: draft.subtitle.trim(),
          priceCents: Math.round(Number(draft.priceYuan) * 100),
          credits: Number(draft.credits),
          validityDays: Number(draft.validityDays),
          features: String(draft.features).split("\n").map((item: string) => item.trim()).filter(Boolean),
          maxConcurrentJobs: Number(draft.maxConcurrentJobs),
          maxAssetMb: Number(draft.maxAssetMb),
          maxWorks: Number(draft.maxWorks),
          maxResolution: draft.maxResolution,
          purchasable: draft.purchasable,
          public: draft.public,
          recommended: draft.recommended,
          status: draft.status,
        }),
      });
      setDraft(null);
      setMessage("套餐已保存，官网、会员中心与下单会立即使用新的商品真值。");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecommend(plan: any) {
    setBusy(true);
    try {
      await api("/api/admin/plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: plan.id, recommended: !plan.recommended }),
      });
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return <div className="admin-panel">
    <div className="admin-panel-head">
      <h2>商品与套餐</h2>
      <div className="inline-actions">
        <button className="secondary" onClick={reload}><RefreshCw size={13} />刷新</button>
        <button className="primary" onClick={create}>新建商品</button>
      </div>
    </div>
    {message && <div className="notice" style={{ margin: "0 0 12px" }}>{message}</div>}
    {loading ? <Loading /> : error ? <ErrorNote message={error} /> : (
      <table className="admin-table">
        <thead><tr><th>商品</th><th>类型</th><th>价格</th><th>创作额度</th><th>有效期</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          {data.plans.map((plan: any) => <tr key={plan.id}>
            <td><strong>{plan.name}</strong><br /><span className="muted mini">{plan.id} · {plan.subtitle}</span></td>
            <td>{plan.kind === "quota_pack" ? "额度加油包" : "会员套餐"}</td>
            <td>{plan.priceCents === 0 ? "免费" : yuan(plan.priceCents)}</td>
            <td>{plan.credits}</td>
            <td>{plan.validityDays} 天</td>
            <td>{plan.purchasable ? <span className="stage-state succeeded">已上架</span> : <span className="stage-state queued">不可购买</span>}
              {plan.recommended ? <span className="chip">推荐</span> : null}</td>
            <td className="inline-actions">
              <button className="secondary" onClick={() => edit(plan)}>编辑</button>
              <button className="secondary" disabled={busy} onClick={() => toggleRecommend(plan)}>{plan.recommended ? "取消推荐" : "设为推荐"}</button>
            </td>
          </tr>)}
        </tbody>
      </table>
    )}

    {draft && <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><h2>{draft.isNew ? "新建商品" : `编辑商品 · ${draft.id}`}</h2></div>
      <div className="form-grid two">
        <div className="field"><span className="field-label">商品编号 <small>创建后不可修改</small></span>
          <input value={draft.id} disabled={!draft.isNew} onChange={event => setDraft({ ...draft, id: event.target.value })} placeholder="例如 creator_plus / pack_500" /></div>
        <div className="field"><span className="field-label">商品类型</span>
          <select value={draft.kind} disabled={!draft.isNew} onChange={event => setDraft({ ...draft, kind: event.target.value })}>
            <option value="membership">会员套餐</option><option value="quota_pack">额度加油包</option>
          </select></div>
        <div className="field"><span className="field-label">名称</span>
          <input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="用户看到的名称" /></div>
        <div className="field"><span className="field-label">副标题</span>
          <input value={draft.subtitle} onChange={event => setDraft({ ...draft, subtitle: event.target.value })} placeholder="一句话说明适用人群" /></div>
        <div className="field"><span className="field-label">价格（元）</span>
          <input value={draft.priceYuan} onChange={event => setDraft({ ...draft, priceYuan: event.target.value })} inputMode="decimal" /></div>
        <div className="field"><span className="field-label">创作额度</span>
          <input type="number" min={0} value={draft.credits} onChange={event => setDraft({ ...draft, credits: event.target.value })} /></div>
        <div className="field"><span className="field-label">有效天数</span>
          <input type="number" min={1} value={draft.validityDays} onChange={event => setDraft({ ...draft, validityDays: event.target.value })} /></div>
        <div className="field"><span className="field-label">最高清晰度</span>
          <input value={draft.maxResolution} onChange={event => setDraft({ ...draft, maxResolution: event.target.value })} placeholder="例如 1080p" /></div>
        <div className="field"><span className="field-label">最大同时任务数</span>
          <input type="number" min={0} value={draft.maxConcurrentJobs} onChange={event => setDraft({ ...draft, maxConcurrentJobs: event.target.value })} /></div>
        <div className="field"><span className="field-label">素材容量（MB）</span>
          <input type="number" min={0} value={draft.maxAssetMb} onChange={event => setDraft({ ...draft, maxAssetMb: event.target.value })} /></div>
        <div className="field"><span className="field-label">作品容量</span>
          <input type="number" min={0} value={draft.maxWorks} onChange={event => setDraft({ ...draft, maxWorks: event.target.value })} /></div>
        <div className="field"><span className="field-label">权益说明 <small>每行一条</small></span>
          <textarea rows={4} value={draft.features} onChange={event => setDraft({ ...draft, features: event.target.value })} /></div>
      </div>
      <div className="form-stack" style={{ marginTop: 12 }}>
        {([["purchasable", "允许购买"], ["public", "在官网显示"], ["recommended", "设为推荐"]] as Array<[string, string]>).map(([key, label]) => {
          const isChecked = Boolean(draft[key]);
          return (
            <div className="setting-toggle-row" key={key} style={{ padding: "8px 12px" }}>
              <strong style={{ fontSize: "13px" }}>{label}</strong>
              <div className="setting-toggle-action">
                <span className={`switch-status-label ${isChecked ? "active" : ""}`}>
                  {isChecked ? "已启用" : "已停用"}
                </span>
                <button
                  type="button"
                  className={`switch-button ${isChecked ? "active" : ""}`}
                  role="switch"
                  aria-checked={isChecked}
                  aria-label={label}
                  onClick={() => setDraft({ ...draft, [key]: !draft[key] })}
                >
                  <span className="switch-thumb" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="inline-actions" style={{ marginTop: 12 }}>
        <button className="primary" disabled={busy || !draft.id.trim() || !draft.name.trim()} onClick={save}>
          {busy ? <LoaderCircle className="spin" size={14} /> : null}保存商品
        </button>
        <button className="secondary" onClick={() => setDraft(null)}>取消</button>
      </div>
      <p className="mini muted">已经支付的订单保留下单时的商品快照，之后修改价格或额度不会影响历史订单。</p>
    </section>}
  </div>;
}

function OrdersSection() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (status) params.set("status", status);
  const { data, error, loading, reload } = useLoad<any>(`/api/admin/orders?${params.toString()}`, [query, status]);

  const [orderMessage, setOrderMessage] = useState("");

  async function open(orderId: string) {
    try {
      setOrderMessage("");
      setSelected(await api(`/api/admin/orders/${orderId}`));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return <div className="admin-panel">
    <div className="admin-panel-head">
      <h2>订单管理</h2>
      <div className="admin-filters">
        <input placeholder="搜索订单号 / 用户邮箱" value={query} onChange={event => setQuery(event.target.value)} />
        <select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="pending">待支付</option>
          <option value="paying">支付处理中</option>
          <option value="paid">已支付</option>
          <option value="closed">已关闭</option>
          <option value="canceled">已取消</option>
          <option value="partial_refund">部分退款</option>
          <option value="refunded">已退款</option>
          <option value="abnormal">需要确认</option>
        </select>
        <button className="secondary" onClick={reload}><RefreshCw size={13} />刷新</button>
      </div>
    </div>
    {loading ? <Loading /> : error ? <ErrorNote message={error} /> : (
      <table className="admin-table">
        <thead><tr><th>订单号</th><th>用户</th><th>商品</th><th>金额</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          {data.orders.map((order: any) => <tr key={order.id}>
            <td><strong>{order.orderNo}</strong></td>
            <td>{order.userEmail || order.userId}</td>
            <td>{order.productName}</td>
            <td>{yuan(order.payableCents)}{order.discountCents ? <><br /><span className="muted mini">已抵扣 {yuan(order.discountCents)}</span></> : null}
              {order.refundedCents ? <><br /><span className="muted mini">已退 {yuan(order.refundedCents)}</span></> : null}</td>
            <td><span className={`stage-state ${order.status === "paid" ? "succeeded" : order.status === "abnormal" ? "failed" : "queued"}`}>{order.statusText}</span></td>
            <td>{new Date(order.createdAt).toLocaleString("zh-CN")}</td>
            <td><button className="secondary" onClick={() => open(order.id)}>查看详情</button></td>
          </tr>)}
          {data.orders.length === 0 && <tr><td colSpan={7} className="muted">没有匹配的订单</td></tr>}
        </tbody>
      </table>
    )}
    <p className="mini muted">共 {data?.total ?? 0} 个订单。支付结果以服务器验签后的通知与主动查单为准，后台不提供「直接改成已支付」。</p>

    {selected && <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <h2>订单详情 · {selected.order.orderNo}</h2>
        <button className="secondary" onClick={() => setSelected(null)}>关闭</button>
      </div>
      <dl className="kv-list">
        <div><dt>状态</dt><dd>{selected.statusText}</dd></div>
        <div><dt>商品</dt><dd>{selected.order.snapshot?.name} · {selected.order.snapshot?.credits} 个创作额度 · {selected.order.snapshot?.validityDays} 天</dd></div>
        <div><dt>金额</dt><dd>原价 {yuan(selected.order.amountCents)} · 抵扣 {yuan(selected.order.discountCents)} · 应付 {yuan(selected.order.payableCents)} · 已退 {yuan(selected.order.refundedCents)}</dd></div>
        <div><dt>时间</dt><dd>创建 {new Date(selected.order.createdAt).toLocaleString("zh-CN")} · 支付 {selected.order.paidAt ? new Date(selected.order.paidAt).toLocaleString("zh-CN") : "未支付"} · 过期 {new Date(selected.order.expiresAt).toLocaleString("zh-CN")}</dd></div>
      </dl>
      <h3 style={{ marginTop: 12 }}>支付记录</h3>
      <table className="admin-table">
        <thead><tr><th>交易号</th><th>金额</th><th>状态</th><th>验签</th><th>通知次数</th><th>支付时间</th></tr></thead>
        <tbody>
          {selected.payments.map((payment: any) => <tr key={payment.id}>
            <td>{payment.tradeNo || <span className="muted">尚无交易号</span>}<br /><span className="muted mini">商户订单号 {payment.outTradeNo}</span></td>
            <td>{yuan(payment.amountCents)}</td>
            <td>{PAYMENT_STATUS_COPY[payment.status] || payment.status}{payment.error ? <><br /><span className="error-text mini">{payment.error}</span></> : null}</td>
            <td>{payment.verified ? "已验签" : "未验签"}</td>
            <td>{payment.notifyCount}</td>
            <td>{payment.paidAt ? new Date(payment.paidAt).toLocaleString("zh-CN") : "—"}</td>
          </tr>)}
          {selected.payments.length === 0 && <tr><td colSpan={6} className="muted">没有支付记录</td></tr>}
        </tbody>
      </table>
      <h3 style={{ marginTop: 12 }}>退款记录</h3>
      <table className="admin-table">
        <thead><tr><th>退款单号</th><th>金额</th><th>状态</th><th>原因</th><th>申请时间</th></tr></thead>
        <tbody>
          {selected.refunds.map((refund: any) => <tr key={refund.id}>
            <td>{refund.refundNo}</td><td>{yuan(refund.amountCents)}</td>
            <td>{REFUND_STATUS_COPY[refund.status] || refund.status}{refund.error ? <><br /><span className="error-text mini">{refund.error}</span></> : null}</td>
            <td>{refund.reason}</td><td>{new Date(refund.createdAt).toLocaleString("zh-CN")}</td>
          </tr>)}
          {selected.refunds.length === 0 && <tr><td colSpan={5} className="muted">没有退款记录</td></tr>}
        </tbody>
      </table>
      <OrderDetailActions detail={selected} onChanged={async (next: any) => { setSelected(next); }} onMessage={setOrderMessage} />
      {orderMessage && <div className="notice" style={{ margin: "12px 0 0" }}>{orderMessage}</div>}
      <h3 style={{ marginTop: 12 }}>订单事件</h3>
      <table className="admin-table">
        <thead><tr><th>时间</th><th>事件</th><th>详情</th></tr></thead>
        <tbody>
          {selected.events.map((event: any) => <tr key={event.id}>
            <td>{new Date(event.createdAt).toLocaleString("zh-CN")}</td>
            <td>{event.type}</td>
            <td className="muted mini"><code>{JSON.stringify(event.payload)}</code></td>
          </tr>)}
        </tbody>
      </table>
    </section>}
  </div>;
}

function JobsSection() {
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState("");
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (userId) params.set("userId", userId);
  const { data, error, loading, reload } = useLoad<any>(`/api/admin/jobs?${params.toString()}`, [status, userId]);
  // Internal statuses stay the data contract; the wording comes from the shared business
  // copy layer (§21/§44) instead of a second local mapping.
  const STATUS_LABELS = JOB_STATUS_COPY;
  return <div className="admin-panel">
    <WorkerPanel />
    <TaskCostPanel />
    <div className="admin-panel-head">
      <h2>任务监管</h2>
      <div className="admin-filters">
        <input placeholder="按用户 ID 过滤" value={userId} onChange={event => setUserId(event.target.value)} />
        <select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="queued">等待开始</option>
          <option value="running">正在生成</option>
          <option value="succeeded">已完成</option>
          <option value="failed">未完成</option>
          <option value="unknown">状态确认中</option>
        </select>
        <button className="secondary" onClick={reload}><RefreshCw size={13} />刷新</button>
      </div>
    </div>
    {loading ? <Loading /> : error ? <ErrorNote message={error} /> : (
      <table className="admin-table">
        <thead><tr><th>任务</th><th>创作类型</th><th>业务状态</th><th>所属用户</th><th>创建时间</th><th>高级信息</th></tr></thead>
        <tbody>
          {data.jobs.map((job: any) => <tr key={job.id}>
            <td><strong>{job.title}</strong>{job.errorSummary && <><br /><span className="error-text mini">{job.errorSummary}</span></>}</td>
            <td>{job.kind}</td>
            <td><span className={`stage-state ${job.status}`}>{STATUS_LABELS[job.status as keyof typeof STATUS_LABELS] || job.status}</span></td>
            <td>{job.ownerEmail || <span className="muted">历史/系统数据</span>}</td>
            <td>{new Date(job.createdAt).toLocaleString("zh-CN")}</td>
            <td className="muted mini"><details><summary>展开</summary><code>{job.id} · {job.status}</code></details></td>
          </tr>)}
          {data.jobs.length === 0 && <tr><td colSpan={6} className="muted">没有匹配的任务</td></tr>}
        </tbody>
      </table>
    )}
  </div>;
}

/**
 * 后台创作调度 (§20/§46): proof that creations keep moving with no browser open, plus a
 * manual pass and the last runs. "立即推进一轮" runs the very same worker code the
 * scheduler runs, so an operator action can never diverge from unattended behaviour.
 */
function WorkerPanel() {
  const { data, error, loading, reload } = useLoad<any>("/api/admin/worker", []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function tick() {
    setBusy(true);
    setNote("");
    try {
      const result = await api("/api/admin/worker", { method: "POST" });
      const run = result.result || {};
      setNote(`本轮推进 ${run.processed ?? 0} 个创作：完成 ${run.succeeded ?? 0} · 未完成 ${run.failed ?? 0} · 超时 ${run.timedOut ?? 0} · 确认扣费 ${run.settled ?? 0} · 退回 ${run.refunded ?? 0}（${run.refundedCredits ?? 0} 个创作额度）· 剩余积压 ${run.backlog ?? 0}`);
      await reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }
  const worker = data?.worker;
  return <section className="panel" style={{ marginBottom: 16 }}>
    <div className="admin-panel-head">
      <h3>后台创作调度</h3>
      <div className="admin-filters">
        <button className="secondary" onClick={reload} disabled={loading}><RefreshCw size={13} />刷新</button>
        <button className="primary" onClick={tick} disabled={busy || loading}>{busy ? <LoaderCircle className="spin" size={13} /> : <Server size={13} />}立即推进一轮</button>
      </div>
    </div>
    {loading ? <Loading /> : error ? <ErrorNote message={error} /> : <>
      <dl className="kv-list">
        <div><dt>运行状态</dt><dd>{worker?.stopped
          ? <span className="error-text">已停止：超过 {worker.staleAfterSeconds} 秒没有推进任务，用户关闭网页后创作不会继续</span>
          : worker?.enabled ? `运行中，每 ${worker.intervalSeconds} 秒一轮` : <span className="error-text">已关闭（系统设置 → 后台任务）</span>}</dd></div>
        <div><dt>最近一轮</dt><dd>{worker?.lastRunAt
          ? `${new Date(worker.lastRunAt).toLocaleString("zh-CN")} · ${worker.lastRunTrigger} · ${worker.secondsSinceLastRun} 秒前 · 处理 ${worker.lastRun?.processed ?? 0} 个`
          : "还没有运行记录"}</dd></div>
        <div><dt>进行中创作</dt><dd>{worker?.backlog ?? 0} 个{worker?.strugglingJobs > 0 ? <span className="error-text"> · {worker.strugglingJobs} 个查询反复失败</span> : ""}</dd></div>
        <div><dt>超时与人工确认</dt><dd>24 小时超时 {worker?.timedOut24h ?? 0} 个 · 额度待人工确认 {worker?.unresolvedCharges24h ?? 0} 笔</dd></div>
        <div><dt>超时判定</dt><dd>超过 {worker?.timeoutMinutes ?? "—"} 分钟仍未完成即按失败规则处理；连续 {worker?.pollMaxErrors ?? "—"} 次查询失败判定为异常</dd></div>
        <div><dt>外部调度（cron）</dt><dd>{worker?.cronTokenConfigured
          ? "已配置运维调度令牌，可用 scripts/worker-tick.mjs 定时推进"
          : <span className="error-text">未配置运维调度令牌，内部推进接口已关闭（进程内定时调度仍然可用）</span>}</dd></div>
      </dl>
      {note && <div className="muted mini" style={{ marginTop: 8 }}>{note}</div>}
      {worker?.runs?.length > 0 && <details style={{ marginTop: 8 }}>
        <summary className="muted mini">最近 {worker.runs.length} 轮调度明细</summary>
        <table className="admin-table">
          <thead><tr><th>开始时间</th><th>触发方式</th><th>处理</th><th>完成</th><th>未完成</th><th>超时</th><th>确认扣费</th><th>退回额度</th><th>耗时</th></tr></thead>
          <tbody>
            {worker.runs.map((run: any) => <tr key={run.id}>
              <td>{new Date(run.startedAt).toLocaleString("zh-CN")}</td>
              <td>{({ scheduler: "定时调度", cron: "外部 cron", admin: "管理员", browser: "用户刷新" } as Record<string, string>)[run.trigger] || run.trigger}</td>
              <td>{run.processed}</td><td>{run.succeeded}</td><td>{run.failed}</td>
              <td>{run.detail?.timedOut ?? 0}</td><td>{run.detail?.settled ?? 0}</td><td>{run.detail?.refundedCredits ?? 0}</td>
              <td>{run.detail?.durationMs ?? 0}ms</td>
            </tr>)}
          </tbody>
        </table>
      </details>}
    </>}
  </section>;
}

/** 任务成本记录 (§23): what each creation was worth and what it cost us. */
function TaskCostPanel() {
  const { data, error, loading, reload } = useLoad<any>("/api/admin/business", []);
  const business = data?.business;
  return <section className="panel" style={{ marginBottom: 16 }}>
    <div className="admin-panel-head">
      <h3>经营数据与任务成本（24 小时）</h3>
      <button className="secondary" onClick={reload} disabled={loading}><RefreshCw size={13} />刷新</button>
    </div>
    {loading ? <Loading /> : error ? <ErrorNote message={error} /> : <>
      <dl className="kv-list">
        <div><dt>今日 / 本月收入</dt><dd>{yuan(business?.revenue?.todayCents ?? 0)} / {yuan(business?.revenue?.monthCents ?? 0)}</dd></div>
        <div><dt>套餐 / 加油包收入（今日）</dt><dd>{yuan(business?.revenue?.today?.planCents ?? 0)} / {yuan(business?.revenue?.today?.packCents ?? 0)}</dd></div>
        <div><dt>今日退款</dt><dd>{yuan(business?.revenue?.refundedTodayCents ?? 0)}（累计 {yuan(business?.revenue?.refundedTotalCents ?? 0)}）</dd></div>
        <div><dt>活跃 / 新增 / 付费用户（今日）</dt><dd>{business?.users?.activeToday ?? 0} / {business?.users?.newToday ?? 0} / {business?.users?.payingToday ?? 0}</dd></div>
        <div><dt>生成任务量 / 成功率（今日）</dt><dd>{business?.creations?.today ?? 0} 个 · {percent(business?.creations?.successRate)}</dd></div>
        <div><dt>预计生成成本 / 平均单任务</dt><dd>{yuan(business?.cost?.today?.reportedCents ?? 0)} / {yuan(business?.cost?.today?.averageCents ?? 0)}
          <span className="muted mini">（{business?.cost?.basisText}，实测 {business?.cost?.measuredToday}）</span></dd></div>
        <div><dt>毛利估算（今日 / 本月）</dt><dd>{yuan(business?.cost?.marginTodayCents ?? 0)}（{percent(business?.cost?.marginRateToday)}） / {yuan(business?.cost?.marginMonthCents ?? 0)}</dd></div>
        <div><dt>单个创作额度价值</dt><dd>{business?.cost?.creditUnit?.cents ? `${yuan(business.cost.creditUnit.cents)}（按${business.cost.creditUnit.basis}换算）` : <span className="error-text">目录里还没有可购买的创作额度，无法折算用户支付价值</span>}</dd></div>
      </dl>
      <table className="admin-table" style={{ marginTop: 12 }}>
        <thead><tr><th>创作类型</th><th>用户</th><th>消耗额度</th><th>用户支付价值</th><th>预计成本</th><th>实际成本</th><th>内部服务</th><th>计费状态</th><th>创建时间</th></tr></thead>
        <tbody>
          {(business?.recentCosts || []).map((row: any) => <tr key={row.chargeId}>
            <td>{JOB_KIND_LABELS[row.kind as keyof typeof JOB_KIND_LABELS] || row.kind}</td>
            <td>{row.email || <span className="muted">未知</span>}</td>
            <td>{row.credits}</td>
            <td>{row.userValueCents ? yuan(row.userValueCents) : <span className="muted">未定价</span>}</td>
            <td>{yuan(row.estimatedCostCents)}</td>
            <td>{row.actualCostCents === null
              ? <span className="muted">{row.costSource === "estimated" ? "预估（未拿到实际用量）" : "暂无"}</span>
              : <>{yuan(row.actualCostCents)}{row.durationSeconds ? <span className="muted mini"> · {row.durationSeconds}s</span> : null}</>}</td>
            <td className="muted mini">{row.provider || "—"}</td>
            <td><span className={`stage-state ${row.status}`}>{({ reserved: "预扣中", settled: "已确认", refunded: "已退回", voided: "未扣费" } as Record<string, string>)[row.status] || row.status}</span></td>
            <td className="muted mini">{new Date(row.createdAt).toLocaleString("zh-CN")}</td>
          </tr>)}
          {(business?.recentCosts || []).length === 0 && <tr><td colSpan={9} className="muted">24 小时内没有创作计费记录</td></tr>}
        </tbody>
      </table>
    </>}
  </section>;
}

function WorksSection() {
  const { data, error, loading, reload } = useLoad<any>("/api/admin/works", []);
  const { data: storageData, reload: reloadStorage } = useLoad<any>("/api/admin/storage", []);
  const storage = storageData?.storage || null;
  const [busy, setBusy] = useState("");
  const [sweeping, setSweeping] = useState(false);
  async function sweepNow() {
    setSweeping(true);
    try {
      await api("/api/admin/storage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sweep" }) });
      await reloadStorage();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally { setSweeping(false); }
  }
  async function remove(work: any) {
    const reason = window.prompt(`删除作品「${work.title}」（所属用户 ${work.ownerEmail || "未知"}）\n请填写删除原因：`);
    if (reason === null) return;
    if (reason.trim().length < 2) { alert("必须填写删除原因"); return; }
    setBusy(work.id);
    try {
      await api(`/api/admin/works/${work.id}?reason=${encodeURIComponent(reason.trim())}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally { setBusy(""); }
  }
  return <div className="admin-panel">
    <div className="admin-panel-head"><h2>作品与素材</h2><button className="secondary" onClick={reload}><RefreshCw size={13} />刷新</button></div>
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="admin-panel-head"><h3>存储用量</h3><button className="secondary" disabled={sweeping} onClick={sweepNow}><RefreshCw size={13} />{sweeping ? "清理中…" : "立即清理"}</button></div>
      {storage ? (
        <dl className="kv-list">
          <div><dt>登记文件</dt><dd>{storage.totals.objects} 个 · {formatBytes(storage.totals.bytes)}</dd></div>
          <div><dt>磁盘实际占用</dt><dd>{formatBytes(storage.reconciliation.diskBytes)}{Math.abs(storage.reconciliation.differenceBytes) > 0 ? `（与登记相差 ${formatBytes(Math.abs(storage.reconciliation.differenceBytes))}）` : "（与登记一致）"}</dd></div>
          <div><dt>磁盘剩余</dt><dd>{storage.disk.warn
            ? <span className="error-text">{formatBytes(storage.disk.freeBytes)}（{storage.disk.freePercent.toFixed(1)}%），低于报警线</span>
            : `${formatBytes(storage.disk.freeBytes)}（${storage.disk.freePercent.toFixed(1)}%）`}</dd></div>
          {storage.buckets.map((row: any) => <div key={row.bucket}><dt>{row.bucket === "inputs" ? "本地输入" : "作品与任务文件"}</dt><dd>{row.objects} 个 · {formatBytes(row.bytes)}</dd></div>)}
          {storage.topUsers.filter((row: any) => row.bytes > 0).slice(0, 5).map((row: any) => <div key={row.userId || "unknown"}><dt>{row.email || "未知用户"}</dt><dd>{row.objects} 个 · {formatBytes(row.bytes)}</dd></div>)}
        </dl>
      ) : <Loading />}
    </section>
    {loading ? <Loading /> : error ? <ErrorNote message={error} /> : (
      <table className="admin-table">
        <thead><tr><th>标题</th><th>所属用户</th><th>状态</th><th>存放位置</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          {data.works.map((work: any) => <tr key={work.id}>
            <td><strong>{work.title}</strong></td>
            <td>{work.ownerEmail || <span className="muted">未知</span>}</td>
            <td><span className={`stage-state ${work.status === "active" ? "succeeded" : "queued"}`}>{work.status === "active" ? "正常" : "已归档"}</span></td>
            <td className="muted">{work.archivedFile ? "平台存储" : "生成服务链接"}</td>
            <td>{new Date(work.createdAt).toLocaleString("zh-CN")}</td>
            <td><button className="secondary" disabled={busy === work.id} onClick={() => remove(work)}>删除</button></td>
          </tr>)}
          {data.works.length === 0 && <tr><td colSpan={6} className="muted">暂无作品</td></tr>}
        </tbody>
      </table>
    )}
  </div>;
}

function ServiceSection() {
  return <div className="admin-panel">
    <div className="admin-panel-head"><h2>创作服务</h2><span className="muted mini">仅运营者可见：创作线路、密钥、区域与连通检查</span></div>
    <SettingsPanel onChanged={async () => undefined} />
  </div>;
}

function SystemSettingsSection() {
  const { data, error, loading, reload } = useLoad<any>("/api/admin/system-settings", []);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!data?.settings) return;
    const next: Record<string, string> = {};
    for (const item of data.settings) if (!item.secret) next[item.key] = item.value ?? "";
    setValues(next);
  }, [data]);

  const changedCount = useMemo(() => {
    if (!data?.settings) return 0;
    let count = 0;
    for (const item of data.settings) {
      if (item.secret) continue;
      const initial = item.value ?? "";
      const current = values[item.key] ?? "";
      if (initial !== current) count++;
    }
    return count;
  }, [data, values]);

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const payload: Record<string, string | boolean> = {};
      for (const [key, value] of Object.entries(values)) payload[key] = value;
      const body = await api("/api/admin/system-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: payload }),
      });
      if (body.changed?.length) {
        const labels = body.changed.map((k: string) => {
          const item = (data?.settings || []).find((s: any) => s.key === k);
          return item?.label || k;
        });
        setMessage(`系统设置保存成功，已更新：${labels.join("、")}`);
      } else {
        setMessage("当前配置已是最新，无待保存的改动");
      }
      await reload();
    } catch (err) {
      setMessage(`保存失败：${err instanceof Error ? err.message : String(err)}，请重试`);
    } finally {
      setBusy(false);
    }
  }

  const SCOPE_LABELS: Record<string, string> = { site: "基本设置", payment: "支付设置", storage: "存储", email: "邮件", security: "安全", worker: "后台任务", guard: "创作成本保护", cost: "成本与毛利" };
  // Render every scope the API returns, so a new scope can never be silently invisible.
  const SCOPES_IN_PAYLOAD: string[] = (data?.settings || []).map((item: any) => item.scope);

  return <div className="admin-panel">
    <div className="admin-panel-head">
      <div style={{ display: "flex", alignItems: "center" }}>
        <h2>系统设置</h2>
        {changedCount > 0 && (
          <span className="badge-unsaved">
            {changedCount} 项修改待保存
          </span>
        )}
      </div>
      <div className="inline-actions">
        <button className="secondary" onClick={reload}><RefreshCw size={13} />刷新</button>
        <button className="primary" disabled={busy || loading} onClick={save}>
          {busy ? <LoaderCircle className="spin" size={14} /> : null}
          {changedCount > 0 ? `保存设置 (${changedCount})` : "保存设置"}
        </button>
      </div>
    </div>
    {message && <div className="notice" style={{ margin: "0 0 12px" }}>{message}</div>}
    <PaymentChannelCard />
    {loading ? <Loading /> : error ? <ErrorNote message={error} /> : (
      <div className="system-grid">
        {Object.keys(SCOPE_LABELS).filter(scope => SCOPES_IN_PAYLOAD.includes(scope)).map(scope => [scope, SCOPE_LABELS[scope]] as [string, string]).map(([scope, label]) => {
          const items = (data.settings || []).filter((item: any) => item.scope === scope);
          if (!items.length) return null;
          return <section className="panel" key={scope}>
            <h3>{label}</h3>
            <div className="form-stack" style={{ marginTop: 10 }}>
              {items.map((item: any) => {
                const isBoolean = item.type === "boolean";
                const rawVal = values[item.key] ?? item.value ?? "";
                const isChecked = rawVal === "true" || rawVal === "1" || (rawVal as any) === true;
                const isDirty = !item.secret && (item.value ?? "") !== (values[item.key] ?? item.value ?? "");

                return (
                  <div className="field" key={item.key}>
                    <span className="field-label">{item.label}
                      <small>{item.configured ? (item.secret ? `${item.masked} · 已配置` : "已配置") : "未配置"} · {item.source === "database" ? "后台保存" : item.source === "environment" ? "来自环境变量" : "默认值"}</small>
                    </span>
                    {isBoolean ? (
                      <div className="setting-toggle-row">
                        <div className="setting-toggle-meta">
                          <span className="setting-toggle-help">{item.help}</span>
                          {isDirty && <span className="setting-toggle-dirty-tag">待保存</span>}
                        </div>
                        <div className="setting-toggle-action">
                          <span className={`switch-status-label ${isChecked ? "active" : ""}`}>
                            {isChecked ? "已启用" : "已停用"}
                          </span>
                          <button
                            type="button"
                            className={`switch-button ${isChecked ? "active" : ""}`}
                            role="switch"
                            aria-checked={isChecked}
                            aria-label={item.label}
                            onClick={() => setValues(state => ({ ...state, [item.key]: isChecked ? "false" : "true" }))}
                          >
                            <span className="switch-thumb" />
                          </button>
                        </div>
                      </div>
                    ) : item.type === "select" ? (
                      <select value={values[item.key] ?? ""} onChange={event => setValues(state => ({ ...state, [item.key]: event.target.value }))}>
                        {item.options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    ) : item.secret ? (
                      <input type="password" autoComplete="new-password" placeholder={item.configured ? "留空保持现有配置" : item.help}
                        onChange={event => setValues(state => ({ ...state, [item.key]: event.target.value }))} />
                    ) : item.type === "textarea" ? (
                      <textarea rows={5} value={values[item.key] ?? ""} placeholder={item.help}
                        onChange={event => setValues(state => ({ ...state, [item.key]: event.target.value }))} />
                    ) : (
                      <input value={values[item.key] ?? ""} placeholder={item.help}
                        onChange={event => setValues(state => ({ ...state, [item.key]: event.target.value }))} />
                    )}
                    {isBoolean ? (
                      item.technicalKey && item.technicalKey !== item.key ? (
                        <span className="muted mini">技术字段 {item.technicalKey}</span>
                      ) : null
                    ) : (
                      <span className="muted mini">{item.help}{item.technicalKey && item.technicalKey !== item.key ? ` · 技术字段 ${item.technicalKey}` : ""}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>;
        })}
      </div>
    )}
    <p className="mini muted">密钥类配置保存后只会在服务器解密使用，界面只显示掩码；留空表示保持现有配置。</p>
  </div>;
}

function OrderDetailActions({ detail, onChanged, onMessage }: {
  detail: any;
  onChanged: (detail: any) => void;
  onMessage: (message: string) => void;
}) {
  const [busy, setBusy] = useState("");
  const order = detail.order;
  const eligibility = detail.refundEligibility || { eligible: false, amountCents: 0, reason: "" };

  async function run(label: string, task: () => Promise<any>) {
    setBusy(label);
    onMessage("");
    try {
      await task();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function sync() {
    await run("sync", async () => {
      const body = await api(`/api/admin/orders/${order.id}/sync`, { method: "POST" });
      onMessage(`主动查询结果：${body.note || "支付宝没有返回新的交易状态"}（当前订单状态：${body.order.statusText}）`);
      if (body.detail) onChanged(body.detail);
    });
  }

  async function refund() {
    const reason = window.prompt(`为订单 ${order.orderNo} 发起退款（最多可退 ${yuan(eligibility.amountCents)}）\n请填写退款原因：`, "");
    if (reason === null) return;
    if (reason.trim().length < 2) { onMessage("请填写退款原因"); return; }
    const amountInput = window.prompt("退款金额（元），留空表示全额退款：", "");
    if (amountInput === null) return;
    const amountCents = amountInput.trim() ? Math.round(Number(amountInput.trim()) * 100) : undefined;
    if (amountCents !== undefined && (!Number.isFinite(amountCents) || amountCents <= 0)) {
      onMessage("退款金额不正确");
      return;
    }
    await run("refund", async () => {
      const body = await api("/api/admin/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, reason: reason.trim(), amountCents, execute: true }),
      });
      onMessage(`退款 ${body.refund.refundNo}：${body.refund.statusText}${body.refund.error ? ` · ${body.refund.error}` : ""}`);
      onChanged(await api(`/api/admin/orders/${order.id}`));
    });
  }

  const payable = ["pending", "paying", "abnormal"].includes(order.status);
  return <div className="inline-actions" style={{ marginTop: 14 }}>
    {payable && <button className="secondary" disabled={busy === "sync"} onClick={sync}>
      {busy === "sync" ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}主动查询支付结果
    </button>}
    {eligibility.eligible && <button className="secondary" disabled={busy === "refund"} onClick={refund}>
      {busy === "refund" ? <LoaderCircle className="spin" size={13} /> : null}发起退款（原路退回）
    </button>}
    {!payable && !eligibility.eligible && <span className="muted mini">{eligibility.reason || "当前订单没有可执行的支付或退款操作。"}</span>}
  </div>;
}

function RefundsSection() {
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const { data, error, loading, reload } = useLoad<any>(`/api/admin/refunds?${params.toString()}`, [status]);

  async function act(refund: any, action: "approve" | "reject" | "execute") {
    let reason: string | undefined;
    if (action === "reject") {
      const input = window.prompt(`驳回退款 ${refund.refundNo}，请填写会展示给用户的原因：`, "");
      if (input === null) return;
      if (input.trim().length < 2) { setMessage("请填写驳回原因"); return; }
      reason = input.trim();
    }
    if (action === "execute" && !window.confirm(`确认对 ${refund.refundNo} 原路退款 ${yuan(refund.amountCents)}？`)) return;
    setBusy(refund.id);
    setMessage("");
    try {
      const body = await api(`/api/admin/refunds/${refund.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      setMessage(`退款 ${body.refund.refundNo}：${body.refund.statusText}${body.refund.error ? ` · ${body.refund.error}` : ""}`);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  return <div className="admin-panel">
    <div className="admin-panel-head">
      <h2>退款与售后</h2>
      <div className="admin-filters">
        <select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="requested">用户申请待处理</option>
          <option value="approved">已通过待退款</option>
          <option value="processing">退款处理中</option>
          <option value="succeeded">退款已完成</option>
          <option value="failed">退款未成功</option>
          <option value="rejected">已驳回</option>
        </select>
        <button className="secondary" onClick={reload}><RefreshCw size={13} />刷新</button>
      </div>
    </div>
    {message && <div className="notice" style={{ margin: "0 0 12px" }}>{message}</div>}
    {loading ? <Loading /> : error ? <ErrorNote message={error} /> : (
      <table className="admin-table">
        <thead><tr><th>退款单号</th><th>订单 / 用户</th><th>金额</th><th>回收额度</th><th>原因</th><th>状态</th><th>来源</th><th>时间</th><th>操作</th></tr></thead>
        <tbody>
          {data.refunds.map((refund: any) => <tr key={refund.id}>
            <td><strong>{refund.refundNo}</strong><br /><span className="muted mini">退款请求号 {refund.outRequestNo.slice(0, 8)}…</span></td>
            <td>{refund.orderNo}<br /><span className="muted mini">{refund.userEmail}</span></td>
            <td>{yuan(refund.amountCents)}</td>
            <td>{refund.creditsReclaimed}</td>
            <td className="muted mini">{refund.reason}</td>
            <td><span className={`stage-state ${refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "rejected" ? "failed" : "queued"}`}>{refund.statusText}</span>
              {refund.error ? <><br /><span className="error-text mini">{refund.error}</span></> : null}</td>
            <td>{refund.requestedBy}</td>
            <td>{new Date(refund.createdAt).toLocaleString("zh-CN")}
              {refund.completedAt ? <><br /><span className="muted mini">完成 {new Date(refund.completedAt).toLocaleString("zh-CN")}</span></> : null}</td>
            <td className="inline-actions" style={{ marginTop: 0, flexDirection: "column", alignItems: "stretch" }}>
              {refund.status === "requested" && <>
                <button className="secondary" disabled={busy === refund.id} onClick={() => act(refund, "approve")}>通过</button>
                <button className="secondary" disabled={busy === refund.id} onClick={() => act(refund, "reject")}>驳回</button>
              </>}
              {(refund.status === "approved" || refund.status === "failed") && (
                <button className="primary" disabled={busy === refund.id} onClick={() => act(refund, "execute")}>
                  {busy === refund.id ? <LoaderCircle className="spin" size={13} /> : null}
                  {refund.status === "failed" ? "重试退款" : "执行退款"}
                </button>
              )}
              {["processing", "succeeded", "rejected"].includes(refund.status) && <span className="muted mini">无需操作</span>}
            </td>
          </tr>)}
          {data.refunds.length === 0 && <tr><td colSpan={9} className="muted">没有退款记录</td></tr>}
        </tbody>
      </table>
    )}
    <p className="mini muted">退款金额不会超过订单实付金额，同一笔订单不会重复退款；「重试退款」使用同一个退款请求号，支付宝会去重。退款结果未知时必须先到支付宝商家后台核对，不要盲目重试。</p>
  </div>;
}

function PaymentChannelCard() {
  const [data, setData] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api("/api/admin/payment-test")); } catch (err) { setMessage(err instanceof Error ? err.message : String(err)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function test() {
    setBusy(true);
    setMessage("");
    try {
      const body = await api("/api/admin/payment-test", { method: "POST" });
      setData({ channel: body.channel });
      setMessage(`${body.result.ok ? "测试通过" : "测试未通过"}：${body.result.message}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const channel = data?.channel;
  return <section className="panel" style={{ marginBottom: 16 }}>
    <div className="panel-head">
      <h3>支付通道状态</h3>
      <button className="secondary" disabled={busy} onClick={test}>
        {busy ? <LoaderCircle className="spin" size={13} /> : <ShieldCheck size={13} />}支付测试
      </button>
    </div>
    {message && <div className="notice" style={{ margin: "10px 0 0" }}>{message}</div>}
    {channel ? <>
      <dl className="kv-list" style={{ marginTop: 10 }}>
        <div><dt>通道状态</dt><dd>{channel.available
          ? <span className="success-text">已开通（{channel.envText}）</span>
          : <span className="error-text">{channel.enabled ? `配置不完整：缺少${channel.missing.join("、")}` : "未启用"}</span>}</dd></div>
        <div><dt>签名方式</dt><dd>{channel.keyMode} · {channel.signType}（暂不支持证书模式）</dd></div>
        <div><dt>网关地址</dt><dd className="mini">{channel.gatewayUrl}</dd></div>
        <div><dt>收款主体</dt><dd>{channel.sellerId || <span className="error-text">未填写，到账通知无法核对收款方</span>}</dd></div>
        <div><dt>最近一次测试</dt><dd>{channel.lastTest?.testedAt
          ? `${new Date(channel.lastTest.testedAt).toLocaleString("zh-CN")} · ${channel.lastTest.ok ? "通过" : "未通过"}${channel.lastTest.message ? `：${channel.lastTest.message}` : ""}`
          : "还没有测试过"}</dd></div>
      </dl>
      <p className="mini muted">支付测试只向支付宝查询一个不存在的订单号，用于验证应用编号、私钥和网关是否被接受，不会产生任何真实收款。</p>
    </> : <p className="mini muted">正在读取支付通道状态…</p>}
  </section>;
}

function AuditSection() {
  const { data, error, loading, reload } = useLoad<any>("/api/admin/audit-logs", []);
  const ACTION_LABELS: Record<string, string> = {
    "membership.update": "调整会员套餐",
    "membership.extend": "延长会员有效期",
    "credits.grant": "赠送创作额度",
    "credits.deduct": "扣减创作额度",
    "user.disable": "暂停账号",
    "user.enable": "恢复账号",
    "user.close": "注销账号",
    "work.delete": "删除作品",
    "settings.update": "更新创作服务配置",
    "system_settings.update": "更新系统设置",
    "order.refund": "订单退款",
    "order.sync": "主动查询支付结果",
    "refund.request": "发起退款",
    "refund.approve": "通过退款",
    "refund.reject": "驳回退款",
    "refund.execute": "执行退款",
    "payment.test": "支付连接测试",
    "plan.upsert": "保存商品",
    "plan.recommend": "调整推荐商品",
  };
  return <div className="admin-panel">
    <div className="admin-panel-head"><h2>操作记录</h2><button className="secondary" onClick={reload}><RefreshCw size={13} />刷新</button></div>
    {loading ? <Loading /> : error ? <ErrorNote message={error} /> : (
      <table className="admin-table">
        <thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th><th>详情</th></tr></thead>
        <tbody>
          {data.logs.map((log: any) => <tr key={log.id}>
            <td>{new Date(log.createdAt).toLocaleString("zh-CN")}</td>
            <td>{log.adminEmail || log.adminUserId}</td>
            <td>{ACTION_LABELS[log.action] || log.action}</td>
            <td>{log.targetId.slice(0, 16)}</td>
            <td className="muted mini"><details><summary>展开</summary><code>{JSON.stringify(log.meta)}</code></details></td>
          </tr>)}
          {data.logs.length === 0 && <tr><td colSpan={5} className="muted">暂无操作记录</td></tr>}
        </tbody>
      </table>
    )}
    <p className="mini muted">操作记录只保存业务字段，不会保存任何密钥内容。</p>
  </div>;
}
