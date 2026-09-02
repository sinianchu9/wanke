"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";

type Tab = "dashboard" | "users" | "jobs" | "works" | "audit" | "system";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "dashboard", label: "仪表盘" },
  { id: "users", label: "用户与套餐" },
  { id: "jobs", label: "任务监管" },
  { id: "works", label: "作品监管" },
  { id: "audit", label: "审计日志" },
  { id: "system", label: "系统" },
];

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

export default function AdminConsole() {
  const [tab, setTab] = useState<Tab>("dashboard");
  return <div className="admin-wrap">
    <div className="admin-top">
      <Link href="/studio" className="secondary"><ArrowLeft size={14}/>返回工作台</Link>
      <div className="admin-title"><ShieldCheck size={18}/><h1>Wanke 运营后台</h1><span className="muted">用户 · 套餐 · 任务 · 作品 · 审计</span></div>
    </div>
    <nav className="admin-tabs">
      {TABS.map(item => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </nav>
    {tab === "dashboard" && <Dashboard/>}
    {tab === "users" && <UsersTab/>}
    {tab === "jobs" && <JobsTab/>}
    {tab === "works" && <WorksTab/>}
    {tab === "audit" && <AuditTab/>}
    {tab === "system" && <SystemTab/>}
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

function Loading() { return <div className="works-empty"><LoaderCircle className="spin" size={20}/>加载中…</div>; }
function ErrorNote({ message }: { message: string }) { return <div className="error-text">{message}</div>; }

function Dashboard() {
  const { data, error, loading, reload } = useLoad<any>("/api/admin/stats", []);
  if (loading) return <Loading/>;
  if (error) return <ErrorNote message={error}/>;
  const stats = data.stats;
  return <div className="admin-panel">
    <div className="admin-panel-head"><h2>运营概览</h2><button className="secondary" onClick={reload}><RefreshCw size={13}/>刷新</button></div>
    <div className="kpi-grid">
      <div className="kpi"><strong>{stats.users.total}</strong><span>注册用户</span><small>今日新增 {stats.users.newToday} · 管理员 {stats.users.admins}</small></div>
      <div className="kpi"><strong>{stats.plans.pro + stats.plans.studio}</strong><span>付费套餐</span><small>Pro {stats.plans.pro} · Studio {stats.plans.studio} · 免费 {stats.plans.free}</small></div>
      <div className="kpi"><strong>{stats.jobs.total}</strong><span>生成任务</span><small>进行中 {stats.jobs.running} · 成功 {stats.jobs.succeeded} · 失败 {stats.jobs.failed}</small></div>
      <div className="kpi"><strong>{stats.jobs.today}</strong><span>今日任务</span><small>历史遗留 {stats.jobs.legacy}（迁移前数据）</small></div>
      <div className="kpi"><strong>{stats.works.total}</strong><span>作品总数</span><small>素材 {stats.assets.total}</small></div>
    </div>
  </div>;
}

function UsersTab() {
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (plan) params.set("plan", plan);
  if (status) params.set("status", status);
  const { data, error, loading, reload } = useLoad<any>(`/api/admin/users?${params.toString()}`, [query, plan, status]);
  const [busy, setBusy] = useState("");

  async function patch(userId: string, payload: Record<string, unknown>, confirmText: string) {
    if (!confirm(confirmText)) return;
    setBusy(userId);
    try {
      await api(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally { setBusy(""); }
  }

  return <div className="admin-panel">
    <div className="admin-panel-head">
      <h2>用户与套餐</h2>
      <div className="admin-filters">
        <input placeholder="搜索邮箱 / 昵称" value={query} onChange={event => setQuery(event.target.value)}/>
        <select value={plan} onChange={event => setPlan(event.target.value)}>
          <option value="">全部套餐</option><option value="free">free</option><option value="pro">pro</option><option value="studio">studio</option>
        </select>
        <select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">全部状态</option><option value="active">active</option><option value="disabled">disabled</option>
        </select>
      </div>
    </div>
    {loading ? <Loading/> : error ? <ErrorNote message={error}/> : (
      <table className="admin-table">
        <thead><tr><th>用户</th><th>套餐</th><th>本周期用量</th><th>账号状态</th><th>注册时间</th><th>操作</th></tr></thead>
        <tbody>
          {data.users.map((row: any) => <tr key={row.user.id}>
            <td><strong>{row.user.name}</strong><br/><span className="muted">{row.user.email}{row.user.role === "admin" ? " · 管理员" : ""}</span></td>
            <td>
              <select value={row.membership.plan} disabled={busy === row.user.id}
                onChange={event => patch(row.user.id, { plan: event.target.value }, `将 ${row.user.email} 的套餐调整为 ${event.target.value}？（新周期立即生效，额度重置）`)}>
                <option value="free">free</option><option value="pro">pro</option><option value="studio">studio</option>
              </select>
            </td>
            <td>{row.membership.quotaUsedVideos} / {row.membership.quotaLimitVideos}
              <button className="link-button" disabled={busy === row.user.id}
                onClick={() => patch(row.user.id, { quotaUsed: 0 }, `清零 ${row.user.email} 本周期已用额度？`)}>清零</button>
            </td>
            <td><span className={`stage-state ${row.user.status === "active" ? "succeeded" : "failed"}`}>{row.user.status}</span></td>
            <td>{new Date(row.user.createdAt).toLocaleDateString("zh-CN")}</td>
            <td>
              {row.user.status === "active"
                ? <button className="secondary" disabled={busy === row.user.id || row.user.role === "admin"} onClick={() => patch(row.user.id, { status: "disabled" }, `停用账号 ${row.user.email}？停用后该用户立即无法登录，会话全部失效。`)}>停用</button>
                : <button className="secondary" disabled={busy === row.user.id} onClick={() => patch(row.user.id, { status: "active" }, `恢复账号 ${row.user.email}？`)}>启用</button>}
            </td>
          </tr>)}
          {data.users.length === 0 && <tr><td colSpan={6} className="muted">没有匹配的用户</td></tr>}
        </tbody>
      </table>
    )}
  </div>;
}

function JobsTab() {
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState("");
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (userId) params.set("userId", userId);
  const { data, error, loading, reload } = useLoad<any>(`/api/admin/jobs?${params.toString()}`, [status, userId]);
  return <div className="admin-panel">
    <div className="admin-panel-head">
      <h2>全站任务</h2>
      <div className="admin-filters">
        <input placeholder="按用户 ID 过滤" value={userId} onChange={event => setUserId(event.target.value)}/>
        <select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">全部状态</option><option value="queued">queued</option><option value="running">running</option><option value="succeeded">succeeded</option><option value="failed">failed</option><option value="unknown">unknown</option>
        </select>
        <button className="secondary" onClick={reload}><RefreshCw size={13}/>刷新</button>
      </div>
    </div>
    {loading ? <Loading/> : error ? <ErrorNote message={error}/> : (
      <table className="admin-table">
        <thead><tr><th>任务</th><th>类型</th><th>状态</th><th>所属用户</th><th>创建时间</th></tr></thead>
        <tbody>
          {data.jobs.map((job: any) => <tr key={job.id}>
            <td><strong>{job.title}</strong>{job.errorSummary && <><br/><span className="error-text">{job.errorSummary}</span></>}</td>
            <td>{job.kind}</td>
            <td><span className={`stage-state ${job.status}`}>{job.status}</span></td>
            <td>{job.ownerEmail || <span className="muted">（历史/系统数据）</span>}</td>
            <td>{new Date(job.createdAt).toLocaleString("zh-CN")}</td>
          </tr>)}
          {data.jobs.length === 0 && <tr><td colSpan={5} className="muted">没有匹配的任务</td></tr>}
        </tbody>
      </table>
    )}
  </div>;
}

function WorksTab() {
  const { data, error, loading, reload } = useLoad<any>("/api/admin/works", []);
  const [busy, setBusy] = useState("");
  async function remove(work: any) {
    if (!confirm(`删除作品「${work.title}」（所属用户 ${work.ownerEmail || "未知"}）？该操作会写入审计日志。`)) return;
    setBusy(work.id);
    try { await api(`/api/admin/works/${work.id}`, { method: "DELETE" }); await reload(); }
    catch (err) { alert(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(""); }
  }
  return <div className="admin-panel">
    <div className="admin-panel-head"><h2>全站作品</h2><button className="secondary" onClick={reload}><RefreshCw size={13}/>刷新</button></div>
    {loading ? <Loading/> : error ? <ErrorNote message={error}/> : (
      <table className="admin-table">
        <thead><tr><th>标题</th><th>所属用户</th><th>状态</th><th>来源</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          {data.works.map((work: any) => <tr key={work.id}>
            <td><strong>{work.title}</strong></td>
            <td>{work.ownerEmail || <span className="muted">未知</span>}</td>
            <td><span className={`stage-state ${work.status === "active" ? "succeeded" : "queued"}`}>{work.status}</span></td>
            <td className="muted">{work.archivedFile ? "本机归档" : "云端链接"}</td>
            <td>{new Date(work.createdAt).toLocaleString("zh-CN")}</td>
            <td><button className="secondary" disabled={busy === work.id} onClick={() => remove(work)}>删除</button></td>
          </tr>)}
          {data.works.length === 0 && <tr><td colSpan={6} className="muted">暂无作品</td></tr>}
        </tbody>
      </table>
    )}
  </div>;
}

function AuditTab() {
  const { data, error, loading, reload } = useLoad<any>("/api/admin/audit-logs", []);
  const ACTION_LABELS: Record<string, string> = {
    "membership.update": "调整套餐/额度",
    "user.disable": "停用用户",
    "user.enable": "启用用户",
    "work.delete": "删除作品",
    "settings.update": "更新系统配置",
  };
  return <div className="admin-panel">
    <div className="admin-panel-head"><h2>审计日志</h2><button className="secondary" onClick={reload}><RefreshCw size={13}/>刷新</button></div>
    {loading ? <Loading/> : error ? <ErrorNote message={error}/> : (
      <table className="admin-table">
        <thead><tr><th>时间</th><th>管理员</th><th>动作</th><th>对象</th><th>详情</th></tr></thead>
        <tbody>
          {data.logs.map((log: any) => <tr key={log.id}>
            <td>{new Date(log.createdAt).toLocaleString("zh-CN")}</td>
            <td>{log.adminEmail || log.adminUserId}</td>
            <td>{ACTION_LABELS[log.action] || log.action}</td>
            <td>{log.targetType} · {log.targetId.slice(0, 12)}</td>
            <td className="muted"><code>{JSON.stringify(log.meta)}</code></td>
          </tr>)}
          {data.logs.length === 0 && <tr><td colSpan={5} className="muted">暂无审计记录</td></tr>}
        </tbody>
      </table>
    )}
  </div>;
}

function SystemTab() {
  const { data, error, loading } = useLoad<any>("/api/admin/system", []);
  return <div className="admin-panel">
    <div className="admin-panel-head"><h2>系统状态</h2></div>
    {loading ? <Loading/> : error ? <ErrorNote message={error}/> : (
      <div className="system-grid">
        <section className="panel">
          <h3>Provider 能力</h3>
          <dl className="kv-list">
            <div><dt>百炼 Model Studio</dt><dd>{data.providers.modelStudio.configured ? "已配置" : "未配置"}{data.providers.modelStudio.maskedApiKey ? ` · Key ${data.providers.modelStudio.maskedApiKey}` : ""}</dd></div>
            <div><dt>万镜一刻 Yike</dt><dd>{data.providers.yike.configured ? "已配置" : "未配置"}</dd></div>
            <div><dt>视频 Provider 策略</dt><dd>{String(data.settings.videoProviderMode || "auto")}</dd></div>
          </dl>
        </section>
        <section className="panel">
          <h3>运行时</h3>
          <dl className="kv-list">
            <div><dt>Node.js</dt><dd>{data.runtime.node}</dd></div>
            <div><dt>数据库路径</dt><dd><code>{data.runtime.dbPath}</code></dd></div>
            <div><dt>归档目录</dt><dd><code>{data.runtime.outputDir}</code></dd></div>
            <div><dt>ADMIN_EMAIL</dt><dd>{data.runtime.adminEmailConfigured ? "已配置" : "未配置（无种子管理员）"}</dd></div>
          </dl>
        </section>
        <section className="panel">
          <h3>套餐常量（只读）</h3>
          <dl className="kv-list">
            {data.plans.map((plan: any) => <div key={plan.id}><dt>{plan.id}</dt><dd>{plan.monthlyVideos} 条/月 · ¥{plan.priceMonthly}/月</dd></div>)}
          </dl>
        </section>
      </div>
    )}
  </div>;
}
