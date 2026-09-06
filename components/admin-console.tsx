"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, BarChart3, ClipboardList, Coins, FileText, LoaderCircle, Package,
  Receipt, RefreshCw, Server, Settings2, ShieldCheck, Users, Video,
} from "lucide-react";
import SettingsPanel from "@/components/settings-panel";

type Section = "dashboard" | "users" | "plans" | "orders" | "jobs" | "works" | "service" | "settings" | "audit";

const NAV: Array<{ group: string; items: Array<{ id: Section; label: string; icon: typeof Users }> }> = [
  { group: "经营", items: [{ id: "dashboard", label: "经营概览", icon: BarChart3 }] },
  { group: "用户", items: [{ id: "users", label: "用户管理", icon: Users }] },
  { group: "商业", items: [
    { id: "plans", label: "商品与套餐", icon: Package },
    { id: "orders", label: "订单管理", icon: Receipt },
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

function yuan(cents: number) {
  return `¥${(Math.round(cents || 0) / 100).toFixed((cents || 0) % 100 === 0 ? 0 : 2)}`;
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
  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  const stats = data.stats;
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
    </div>
    <div className="system-grid" style={{ marginTop: 16 }}>
      <section className="panel">
        <h3>异常与风险</h3>
        <dl className="kv-list">
          <div><dt>支付异常订单</dt><dd>{stats.revenue.abnormalOrders > 0 ? <span className="error-text">{stats.revenue.abnormalOrders} 个需要人工确认</span> : "无"}</dd></div>
          <div><dt>未验签支付通知</dt><dd>{stats.revenue.unverifiedNotifications > 0 ? <span className="error-text">{stats.revenue.unverifiedNotifications} 条</span> : "无"}</dd></div>
          <div><dt>暂停使用账号</dt><dd>{stats.users.suspended}</dd></div>
          <div><dt>已注销账号</dt><dd>{stats.users.closed}</dd></div>
          <div><dt>历史遗留任务</dt><dd>{stats.jobs.legacy}（商业化迁移前创建，仅后台可见）</dd></div>
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
        {([["purchasable", "允许购买"], ["public", "在官网显示"], ["recommended", "设为推荐"]] as Array<[string, string]>).map(([key, label]) => (
          <div className="toggle-row" key={key}>
            <strong>{label}</strong>
            <button type="button" className={`toggle ${draft[key] ? "active" : ""}`} role="switch" aria-checked={Boolean(draft[key])} aria-label={label}
              onClick={() => setDraft({ ...draft, [key]: !draft[key] })} />
          </div>
        ))}
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

  async function open(orderId: string) {
    try {
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
            <td>{payment.status}</td>
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
            <td>{refund.refundNo}</td><td>{yuan(refund.amountCents)}</td><td>{refund.status}</td>
            <td>{refund.reason}</td><td>{new Date(refund.createdAt).toLocaleString("zh-CN")}</td>
          </tr>)}
          {selected.refunds.length === 0 && <tr><td colSpan={5} className="muted">没有退款记录</td></tr>}
        </tbody>
      </table>
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
  const STATUS_LABELS: Record<string, string> = { queued: "等待开始", running: "正在生成", succeeded: "已完成", failed: "未完成", unknown: "状态确认中" };
  return <div className="admin-panel">
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
            <td><span className={`stage-state ${job.status}`}>{STATUS_LABELS[job.status] || job.status}</span></td>
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

function WorksSection() {
  const { data, error, loading, reload } = useLoad<any>("/api/admin/works", []);
  const [busy, setBusy] = useState("");
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
    for (const item of data.settings) if (!item.secret) next[item.key] = item.value;
    setValues(next);
  }, [data]);

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
      setMessage(body.changed?.length ? `已更新：${body.changed.join("、")}` : "没有需要保存的变化");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const SCOPE_LABELS: Record<string, string> = { site: "基本设置", payment: "支付设置", storage: "存储", email: "邮件", security: "安全", worker: "后台任务" };

  return <div className="admin-panel">
    <div className="admin-panel-head">
      <h2>系统设置</h2>
      <div className="inline-actions">
        <button className="secondary" onClick={reload}><RefreshCw size={13} />刷新</button>
        <button className="primary" disabled={busy || loading} onClick={save}>{busy ? <LoaderCircle className="spin" size={14} /> : null}保存设置</button>
      </div>
    </div>
    {message && <div className="notice" style={{ margin: "0 0 12px" }}>{message}</div>}
    {loading ? <Loading /> : error ? <ErrorNote message={error} /> : (
      <div className="system-grid">
        {Object.entries(SCOPE_LABELS).map(([scope, label]) => {
          const items = (data.settings || []).filter((item: any) => item.scope === scope);
          if (!items.length) return null;
          return <section className="panel" key={scope}>
            <h3>{label}</h3>
            <div className="form-stack" style={{ marginTop: 10 }}>
              {items.map((item: any) => (
                <div className="field" key={item.key}>
                  <span className="field-label">{item.label}
                    <small>{item.configured ? (item.secret ? `${item.masked} · 已配置` : "已配置") : "未配置"} · {item.source === "database" ? "后台保存" : item.source === "environment" ? "来自环境变量" : "默认值"}</small>
                  </span>
                  {item.type === "boolean" ? (
                    <div className="toggle-row">
                      <span className="muted mini">{item.help}</span>
                      <button type="button" className={`toggle ${values[item.key] === "true" ? "active" : ""}`} role="switch"
                        aria-checked={values[item.key] === "true"} aria-label={item.label}
                        onClick={() => setValues(state => ({ ...state, [item.key]: state[item.key] === "true" ? "false" : "true" }))} />
                    </div>
                  ) : item.type === "select" ? (
                    <select value={values[item.key] ?? ""} onChange={event => setValues(state => ({ ...state, [item.key]: event.target.value }))}>
                      {item.options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : item.secret ? (
                    <input type="password" autoComplete="new-password" placeholder={item.configured ? "留空保持现有配置" : item.help}
                      onChange={event => setValues(state => ({ ...state, [item.key]: event.target.value }))} />
                  ) : (
                    <input value={values[item.key] ?? ""} placeholder={item.help}
                      onChange={event => setValues(state => ({ ...state, [item.key]: event.target.value }))} />
                  )}
                  <span className="muted mini">{item.help}{item.technicalKey && item.technicalKey !== item.key ? ` · 技术字段 ${item.technicalKey}` : ""}</span>
                </div>
              ))}
            </div>
          </section>;
        })}
      </div>
    )}
    <p className="mini muted">密钥类配置保存后只会在服务器解密使用，界面只显示掩码；留空表示保持现有配置。</p>
  </div>;
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
