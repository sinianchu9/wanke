"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Braces, Clapperboard, CopyCheck, Film, Languages, Library, ListVideo, Mic2, RefreshCw, ScanFace, Sparkles, WandSparkles } from "lucide-react";
import CreatorForms from "@/components/forms";
import SimpleVideoGenerator from "@/components/simple-video-generator";
import AssetLibrary from "@/components/asset-library";
import JobCenter from "@/components/job-center";
import type { StoredAsset, StoredJob } from "@/lib/types";

type Tab = "generate" | "remake" | "clone" | "avatar" | "voice" | "storyboard" | "translation" | "assets" | "jobs";

const tabs: { id: Tab; label: string; icon: any; desc: string }[] = [
  { id: "generate", label: "AI 视频", icon: Sparkles, desc: "说需求，系统自动选模型" },
  { id: "remake", label: "高级复刻", icon: Braces, desc: "拆解 → 脚本 → 独立渲染" },
  { id: "clone", label: "快速复刻", icon: CopyCheck, desc: "一键变体，替换人物/商品" },
  { id: "avatar", label: "数字人口播", icon: ScanFace, desc: "讲解 / 固定机位数字人" },
  { id: "voice", label: "旁白成片", icon: Mic2, desc: "素材 + 文案 + 配音包装" },
  { id: "storyboard", label: "故事板", icon: Clapperboard, desc: "长文本拆镜、生成、续跑" },
  { id: "translation", label: "视频翻译", icon: Languages, desc: "字幕 / 语音多语言翻译" },
  { id: "assets", label: "素材库", icon: Library, desc: "统一管理图片、视频和音频" },
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

  const directVideo = status?.modelStudio?.configured === true;
  const yikeReady = status?.yike?.configured === true;

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
          <div className="status-row"><span className={`dot ${directVideo || yikeReady ? "ok" : "bad"}`} /><span>{directVideo ? "视频生成：百炼直连已配置" : yikeReady ? "视频生成：兼容模式" : "等待配置视频凭证"}</span></div>
          <div className="muted mini">{status?.regionName || "新加坡"} · 自动模型路由</div>
          {status?.endpoint && <div className="muted mini" title={status.endpoint}>{status.endpoint}</div>}
          {directVideo && <div className="mini muted">可直接选择本地图片；首次生成时自动校验 Key、Workspace 和模型权限</div>}
          {!directVideo && yikeReady && <div className="mini muted">未配置百炼 Key，基础生成自动回退兼容链路</div>}
          {yikeReady && <button className="link-button" onClick={probe} disabled={status?.probing}>{status?.probing ? "检查中…" : "检查扩展工作流"}</button>}
          {yikeReady && status?.connected === true && <div className="mini success-text">复刻 / 故事板等扩展工作流可用</div>}
          {yikeReady && status?.connected === false && <div className="mini error-text">{status.yikeError || status.error || "扩展工作流连接未就绪"}</div>}
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
          {tab === "generate" && <SimpleVideoGenerator assets={assets} onSubmit={submit} submitting={loading} directAvailable={directVideo} />}
          {(["remake", "clone", "avatar", "voice", "storyboard", "translation"] as Tab[]).includes(tab) && (
            <CreatorForms mode={tab as any} assets={assets} jobs={jobs} onSubmit={submit} submitting={loading} />
          )}
          {tab === "assets" && <AssetLibrary assets={assets} onChanged={loadAll} extendedUploadAvailable={yikeReady} />}
          {tab === "jobs" && <JobCenter jobs={jobs} onChanged={loadAll} onGoAssets={() => setTab("assets")} />}
        </section>
      </main>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}
