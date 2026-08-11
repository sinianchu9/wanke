"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Braces, Clapperboard, CopyCheck, Film, FolderKanban, Languages, Library, ListVideo, Mic2, RefreshCw, ScanFace, Settings as SettingsIcon, Sparkles, UserRound, WandSparkles } from "lucide-react";
import CreatorForms from "@/components/forms";
import SimpleVideoGenerator from "@/components/simple-video-generator";
import QuickCreationWizard from "@/components/quick-creation-wizard";
import AssetLibrary from "@/components/asset-library";
import JobCenter from "@/components/job-center";
import ProjectHome from "@/components/project-home";
import SettingsPanel from "@/components/settings-panel";
import SubjectLibrary, { type PublicSubjectCard } from "@/components/subject-library";
import type { ProductionProject } from "@/lib/project-types";
import type { StoredAsset, StoredJob } from "@/lib/types";

type Tab = "quick" | "generate" | "projects" | "remake" | "clone" | "avatar" | "voice" | "storyboard" | "translation" | "assets" | "subjects" | "jobs" | "settings";

const tabs: { id: Tab; label: string; icon: any; desc: string }[] = [
  { id: "quick", label: "快速创作", icon: WandSparkles, desc: "一句话开始做视频" },
  { id: "projects", label: "我的作品", icon: FolderKanban, desc: "看进度、选结果、出成片" },
  { id: "generate", label: "高级创作", icon: Sparkles, desc: "生成方式、Recipe 与参考素材" },
  { id: "remake", label: "高级复刻", icon: Braces, desc: "拆解 → 脚本 → 独立渲染" },
  { id: "clone", label: "快速复刻", icon: CopyCheck, desc: "一键变体，替换人物/商品" },
  { id: "avatar", label: "数字人口播", icon: ScanFace, desc: "讲解 / 固定机位数字人" },
  { id: "voice", label: "旁白成片", icon: Mic2, desc: "素材 + 文案 + 配音包装" },
  { id: "storyboard", label: "故事板", icon: Clapperboard, desc: "长文本拆镜、生成、续跑" },
  { id: "translation", label: "视频翻译", icon: Languages, desc: "字幕 / 语音多语言翻译" },
  { id: "assets", label: "素材库", icon: Library, desc: "统一管理图片、视频和音频" },
  { id: "subjects", label: "主体库", icon: UserRound, desc: "复用人物和产品身份" },
  { id: "jobs", label: "任务中心", icon: ListVideo, desc: "续查、对比、重试与回炉" },
  { id: "settings", label: "设置", icon: SettingsIcon, desc: "API、空间 ID 与视频引擎" },
];

export default function Studio() {
  const [tab, setTab] = useState<Tab>("quick");
  const [jobs, setJobs] = useState<StoredJob[]>([]);
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [subjects, setSubjects] = useState<PublicSubjectCard[]>([]);
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [activeShotId, setActiveShotId] = useState("");
  const [notice, setNotice] = useState<string>("");
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    const [j, a, subjectData, projectData, s] = await Promise.all([
      fetch("/api/jobs", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/assets", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/subjects", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/projects", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/status", { cache: "no-store" }).then(r => r.json()),
    ]);
    setJobs(mergeJobs(j.jobs || [], projectData.jobs || []));
    setAssets(a.assets || []);
    setSubjects(subjectData.subjects || []);
    setProjects(projectData.projects || []);
    setStatus(s);
  }, []);

  useEffect(() => { loadAll().catch(e => setNotice(e.message)); }, [loadAll]);

  useEffect(() => {
    if (!activeShotId) return;
    const exists = projects.some(project => project.shots.some(shot => shot.id === activeShotId));
    if (!exists) setActiveShotId("");
  }, [projects, activeShotId]);

  useEffect(() => {
    const hasActive = jobs.some(j => ["queued", "running"].includes(j.status) && j.providerJobId);
    if (!hasActive) return;
    const timer = window.setInterval(async () => {
      try {
        await fetch("/api/jobs/refresh", { method: "POST" });
        const [jobData, projectData] = await Promise.all([
          fetch("/api/jobs", { cache: "no-store" }).then(r => r.json()),
          fetch("/api/projects", { cache: "no-store" }).then(r => r.json()),
        ]);
        setJobs(mergeJobs(jobData.jobs || [], projectData.jobs || []));
        setProjects(projectData.projects || []);
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

  const activeShot = useMemo(() => {
    for (const project of projects) {
      const shot = project.shots.find(item => item.id === activeShotId);
      if (shot) return { project, shot };
    }
    return null;
  }, [projects, activeShotId]);

  async function submit(kind: string, input: Record<string, unknown>, title?: string, parentJobId?: string) {
    setLoading(true);
    setNotice("");
    try {
      const shotId = tab === "generate" ? (activeShotId || undefined) : undefined;
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, input, title, parentJobId, shotId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "任务提交失败");
      setNotice(shotId && activeShot ? `已提交到「${activeShot.project.name} / ${activeShot.shot.name}」：${data.job.title}` : `已提交：${data.job.title}`);
      await loadAll();
      setTab("jobs");
      return data.job;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice(message);
      throw e;
    } finally { setLoading(false); }
  }

  async function submitBatch(input: Record<string, unknown>, count: number, title?: string) {
    setLoading(true);
    setNotice("");
    try {
      const res = await fetch("/api/jobs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "video_generation", input, count, title, shotId: activeShotId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "批量任务提交失败");
      const summary = data.summary || {};
      const location = activeShot ? `，已归入「${activeShot.project.name} / ${activeShot.shot.name}」` : "";
      setNotice(summary.failed
        ? `已创建 ${summary.total} 个版本：${summary.submitted} 个已提交，${summary.failed} 个失败${location}。`
        : `已创建并提交 ${summary.total} 个独立版本${location}。`
      );
      await loadAll();
      setTab("jobs");
      return data.jobs;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice(message);
      throw e;
    } finally { setLoading(false); }
  }

  function createInShot(shotId: string) {
    setActiveShotId(shotId);
    setNotice("");
    setTab("generate");
  }

  async function quickCreated(_projectId: string) {
    await loadAll();
    setNotice("作品已建立，镜头正在生成。你可以在“我的作品”里直接看进度。");
    setTab("projects");
  }

  const modelStudioConfigured = status?.modelStudio?.configured === true;
  const yikeReady = status?.yike?.configured === true;
  const providerMode = status?.providerMode || "auto";
  const directVideo = modelStudioConfigured && providerMode !== "yike";

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
          <div className="status-row"><span className={`dot ${status?.generationReady ? "ok" : "bad"}`} /><span>{status?.generationReady ? "视频服务可用" : "视频服务需要配置"}</span></div>
          <div className="muted mini">{status?.generationReady ? "可以直接开始创作；模型和线路由由系统处理。" : "在设置中填写 API 信息后即可开始生成。"}</div>
          {activeShot && <div className="mini success-text">当前镜头：{activeShot.project.name} / {activeShot.shot.name}</div>}
          <button className="link-button" onClick={()=>setTab("settings")}>{status?.generationReady ? "高级服务设置" : "去配置视频服务"}</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">AI VIDEO CREATION</div>
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
        {tab === "generate" && activeShot && <div className="notice"><Clapperboard size={16}/><span>当前生成目标：<strong>{activeShot.project.name} / {activeShot.shot.name}</strong>{activeShot.shot.brief ? ` · ${activeShot.shot.brief}` : ""}。新任务和批量版本会自动进入这个 Shot。</span><button className="link-button" onClick={() => setActiveShotId("")}>退出镜头上下文</button></div>}

        <section className="workspace">
          {tab === "quick" && <QuickCreationWizard assets={assets} subjects={subjects} onCreated={quickCreated} onAdvanced={() => setTab("generate")}/>} 
          {tab === "generate" && <SimpleVideoGenerator assets={assets} subjects={subjects} onSubmit={submit} onSubmitBatch={submitBatch} submitting={loading} directAvailable={directVideo} />}
          {tab === "projects" && <ProjectHome projects={projects} jobs={jobs} subjects={subjects} onChanged={loadAll} onCreateInShot={createInShot} />}
          {(["remake", "clone", "avatar", "voice", "storyboard", "translation"] as Tab[]).includes(tab) && (
            <CreatorForms mode={tab as any} assets={assets} jobs={jobs} onSubmit={submit} submitting={loading} />
          )}
          {tab === "assets" && <AssetLibrary assets={assets} onChanged={loadAll} extendedUploadAvailable={yikeReady} />}
          {tab === "subjects" && <SubjectLibrary subjects={subjects} assets={assets} onChanged={loadAll} />}
          {tab === "jobs" && <JobCenter jobs={jobs} modelStudioAvailable={modelStudioConfigured} onChanged={loadAll} onGoAssets={() => setTab("assets")} />}
          {tab === "settings" && <SettingsPanel onChanged={loadAll} />}
        </section>
      </main>
    </div>
  );
}

function mergeJobs(...groups: StoredJob[][]) {
  const map = new Map<string, StoredJob>();
  for (const job of groups.flat()) map.set(job.id, job);
  return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}
