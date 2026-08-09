"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Braces, Clapperboard, CopyCheck, Film, Languages, Library, ListVideo, Mic2, RefreshCw, ScanFace, Sparkles, WandSparkles } from "lucide-react";
import CreatorForms from "@/components/forms";
import AssetLibrary from "@/components/asset-library";
import JobCenter from "@/components/job-center";
import type { StoredAsset, StoredJob } from "@/lib/types";

type Tab = "generate" | "remake" | "clone" | "avatar" | "voice" | "storyboard" | "translation" | "assets" | "jobs";

const tabs: { id: Tab; label: string; icon: any; desc: string }[] = [
  { id: "generate", label: "AI 视频", icon: Sparkles, desc: "文生 / 图生 / 首尾帧 / 多参考" },
  { id: "remake", label: "高级复刻", icon: Braces, desc: "拆解 → 脚本 → 独立渲染" },
  { id: "clone", label: "快速复刻", icon: CopyCheck, desc: "一键变体，替换人物/商品" },
  { id: "avatar", label: "数字人口播", icon: ScanFace, desc: "讲解 / 固定机位数字人" },
  { id: "voice", label: "旁白成片", icon: Mic2, desc: "素材 + 文案 + 配音包装" },
  { id: "storyboard", label: "故事板", icon: Clapperboard, desc: "长文本拆镜、生成、续跑" },
  { id: "translation", label: "视频翻译", icon: Languages, desc: "字幕 / 语音多语言翻译" },
  { id: "assets", label: "素材库", icon: Library, desc: "OSS 直传与 MediaId 管理" },
  { id: "jobs", label: "任务中心", icon: ListVideo, desc: "续查、对比、重试与回炉" },
];

export default function Studio() {
  const [tab, setTab] = useState<Tab>("generate");
  const [jobs, setJobs] = useState<StoredJob[]>([]);
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [notice, setNotice] = useState<string>("");
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    const [j, a, s] = await Promise.all([
      fetch("/api/jobs", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/assets", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/status", { cache: "no-store" }).then(r => r.json()),
    ]);
    setJobs(j.jobs || []);
    setAssets(a.assets || []);
    setStatus(s);
  }, []);

  useEffect(() => { loadAll().catch(e => setNotice(e.message)); }, [loadAll]);

  useEffect(() => {
    const hasActive = jobs.some(j => ["queued", "running"].includes(j.status) && j.providerJobId);
    if (!hasActive) return;
    const timer = window.setInterval(async () => {
      try {
        await fetch("/api/jobs/refresh", { method: "POST" });
        const data = await fetch("/api/jobs", { cache: "no-store" }).then(r => r.json());
        setJobs(data.jobs || []);
      } catch { /* keep UI usable while network recovers */ }
    }, 6000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  const stats = useMemo(() => ({
    active: jobs.filter(j => ["queued", "running"].includes(j.status)).length,
    success: jobs.filter(j => j.status === "succeeded").length,
    failed: jobs.filter(j => j.status === "failed").length,
    assets: assets.length,
  }), [jobs, assets]);

  async function submit(kind: string, input: Record<string, unknown>, title?: string, parentJobId?: string) {
    setLoading(true);
    setNotice("");
    try {
      const res = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, input, title, parentJobId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "任务提交失败");
      setNotice(`已提交：${data.job.title}`);
      await loadAll();
      setTab("jobs");
      return data.job;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice(message);
      throw e;
    } finally { setLoading(false); }
  }

  async function probe() {
    setStatus((s: any) => ({ ...(s || {}), probing: true }));
    const s = await fetch("/api/status?probe=1", { cache: "no-store" }).then(r => r.json());
    setStatus(s);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Film size={22} /></div>
          <div><strong>Wanke</strong><span>Video Studio</span></div>
        </div>
        <div className="nav-section-label">视频工作台</div>
        <nav className="nav-list">
          {tabs.map(item => {
            const Icon = item.icon;
            return <button key={item.id} className={`nav-item ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id)}>
              <Icon size={18} /><span><b>{item.label}</b><small>{item.desc}</small></span>
              {item.id === "jobs" && stats.active > 0 && <em>{stats.active}</em>}
            </button>;
          })}
        </nav>
        <div className="side-status">
          <div className="status-row"><span className={`dot ${status?.configured ? "ok" : "bad"}`} /><span>{status?.configured ? "Yike 凭证已配置" : "等待配置 Yike 凭证"}</span></div>
          <div className="muted mini">{status?.regionId || "cn-shanghai"}</div>
          <button className="link-button" onClick={probe}>测试连接</button>
          {status?.connected === true && <><div className="mini success-text">核心 API 2026-07-07 正常</div>{status?.studio?.ok===false&&<div className="mini error-text">营销/故事板接口异常：{status.studio.error}</div>}</>}
          {status?.connected === false && <div className="mini error-text">{status.error}</div>}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">PERSONAL AI VIDEO WORKSTATION</div>
            <h1>{tabs.find(t => t.id === tab)?.label}</h1>
          </div>
          <div className="top-stats">
            <Stat value={stats.active} label="处理中" />
            <Stat value={stats.success} label="已完成" />
            <Stat value={stats.assets} label="素材" />
            <button className="icon-button" title="刷新" onClick={() => loadAll()}><RefreshCw size={17} /></button>
          </div>
        </header>

        {notice && <div className="notice"><WandSparkles size={16} />{notice}</div>}

        <section className="workspace">
          {(["generate", "remake", "clone", "avatar", "voice", "storyboard", "translation"] as Tab[]).includes(tab) && (
            <CreatorForms mode={tab as any} assets={assets} jobs={jobs} onSubmit={submit} submitting={loading} />
          )}
          {tab === "assets" && <AssetLibrary assets={assets} onChanged={loadAll} />}
          {tab === "jobs" && <JobCenter jobs={jobs} onChanged={loadAll} onGoAssets={() => setTab("assets")} />}
        </section>
      </main>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}
