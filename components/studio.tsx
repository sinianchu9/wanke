"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  CopyCheck,
  Film,
  FolderKanban,
  Languages,
  Library,
  ListVideo,
  Menu,
  Mic2,
  PanelLeftClose,
  Plus,
  RefreshCw,
  ScanFace,
  Settings as SettingsIcon,
  Sparkles,
  UserRound,
  WandSparkles,
} from "lucide-react";
import CreatorForms from "@/components/forms";
import SimpleVideoGenerator from "@/components/simple-video-generator";
import QuickCreationWizard from "@/components/quick-creation-wizard";
import ChatCreationHome from "@/components/chat-creation-home";
import AssetLibrary from "@/components/asset-library";
import JobCenter from "@/components/job-center";
import ProjectHome from "@/components/project-home";
import SettingsPanel from "@/components/settings-panel";
import SubjectLibrary, { type PublicSubjectCard } from "@/components/subject-library";
import type { ProductionProject } from "@/lib/project-types";
import type { StoredAsset, StoredJob } from "@/lib/types";
import styles from "@/components/studio-shell.module.css";

type Tab = "home" | "quick" | "generate" | "projects" | "remake" | "clone" | "avatar" | "voice" | "storyboard" | "translation" | "assets" | "subjects" | "jobs" | "settings";
type ProviderMode = "auto" | "modelstudio" | "yike";

const primaryNav = [
  { id: "projects" as const, label: "我的作品", icon: FolderKanban },
  { id: "jobs" as const, label: "任务中心", icon: ListVideo },
  { id: "assets" as const, label: "素材库", icon: Library },
  { id: "subjects" as const, label: "主体库", icon: UserRound },
];

const creationTools = [
  { id: "quick" as const, label: "快速向导", desc: "分步开始创作", icon: WandSparkles },
  { id: "generate" as const, label: "高级创作", desc: "Recipe / 批量版本", icon: Sparkles },
  { id: "remake" as const, label: "高级复刻", desc: "拆解与独立渲染", icon: Braces },
  { id: "clone" as const, label: "快速复刻", desc: "一键替换人物 / 产品", icon: CopyCheck },
  { id: "avatar" as const, label: "数字人口播", desc: "讲解与固定机位", icon: ScanFace },
  { id: "voice" as const, label: "旁白成片", desc: "素材 + 文案 + 配音", icon: Mic2 },
  { id: "storyboard" as const, label: "故事板", desc: "长文本拆镜", icon: Clapperboard },
  { id: "translation" as const, label: "视频翻译", desc: "字幕 / 语音多语言", icon: Languages },
];

const labels: Record<Tab, string> = {
  home: "新建创作",
  quick: "快速向导",
  generate: "高级创作",
  projects: "我的作品",
  remake: "高级复刻",
  clone: "快速复刻",
  avatar: "数字人口播",
  voice: "旁白成片",
  storyboard: "故事板",
  translation: "视频翻译",
  assets: "素材库",
  subjects: "主体库",
  jobs: "任务中心",
  settings: "设置",
};

export default function Studio() {
  const [tab, setTab] = useState<Tab>("home");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
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

  useEffect(() => {
    loadAll().catch(e => setNotice(e instanceof Error ? e.message : String(e)));
  }, [loadAll]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 720px)").matches) setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (!activeShotId) return;
    const exists = projects.some(project => project.shots.some(shot => shot.id === activeShotId));
    if (!exists) setActiveShotId("");
  }, [projects, activeShotId]);

  useEffect(() => {
    const hasActive = jobs.some(j => ["queued", "running", "unknown"].includes(j.status) && j.providerJobId && j.details?.pollable !== false);
    if (!hasActive) return;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await fetch("/api/jobs/refresh", { method: "POST" });
        const [jobData, projectData] = await Promise.all([
          fetch("/api/jobs", { cache: "no-store" }).then(r => r.json()),
          fetch("/api/projects", { cache: "no-store" }).then(r => r.json()),
        ]);
        setJobs(mergeJobs(jobData.jobs || [], projectData.jobs || []));
        setProjects(projectData.projects || []);
      } catch {
        // Keep the UI usable while the network or provider recovers.
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(tick, 6000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  const stats = useMemo(() => ({
    active: jobs.filter(j => ["queued", "running", "unknown"].includes(j.status) && j.details?.pollable !== false).length,
    success: jobs.filter(j => j.status === "succeeded").length,
    assets: assets.length,
  }), [jobs, assets]);

  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8),
    [projects],
  );

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
    } finally {
      setLoading(false);
    }
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
    } finally {
      setLoading(false);
    }
  }

  function navigate(next: Tab) {
    setTab(next);
    setNotice("");
    if (window.matchMedia("(max-width: 720px)").matches) setSidebarOpen(false);
  }

  function createInShot(shotId: string) {
    setActiveShotId(shotId);
    setNotice("");
    setTab("generate");
  }

  async function quickCreated(_projectId: string) {
    await loadAll();
    setNotice("作品已建立，镜头正在生成。可以在“我的作品”里直接看进度。");
    setTab("projects");
  }

  const modelStudioConfigured = status?.modelStudio?.configured === true;
  const yikeReady = status?.yike?.configured === true;
  const providerMode = (status?.providerMode || "auto") as ProviderMode;
  const directVideo = modelStudioConfigured && providerMode !== "yike";
  const generationReady = status === null ? null : status?.generationReady === true;

  return (
    <div className={styles.shell}>
      {sidebarOpen && <button className={styles.mobileOverlay} aria-label="关闭侧栏" onClick={() => setSidebarOpen(false)} />}

      <aside className={`${styles.sidebar} ${sidebarOpen ? "" : styles.sidebarClosed}`}>
        <div className={styles.sidebarHeader}>
          <button className={styles.brandButton} onClick={() => navigate("home")}>
            <span className={styles.brandMark}><Film size={17} /></span>
            <span className={styles.brandText}><strong>Wanke</strong><small>AI Video Studio</small></span>
          </button>
        </div>

        <button className={styles.newButton} onClick={() => navigate("home")}><Plus size={16} />新建创作</button>

        <div className={styles.sidebarScroll}>
          <div className={styles.navGroup}>
            {primaryNav.map(item => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={`${styles.navItem} ${tab === item.id ? styles.navItemActive : ""}`} onClick={() => navigate(item.id)}>
                  <Icon size={16} /><span>{item.label}</span>
                  {item.id === "jobs" && stats.active > 0 && <em className={styles.navBadge}>{stats.active}</em>}
                </button>
              );
            })}
          </div>

          <div className={styles.navGroup}>
            <button className={styles.groupToggle} onClick={() => setToolsOpen(value => !value)}>
              <span>创作工具</span>{toolsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {toolsOpen && creationTools.map(item => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={`${styles.navItem} ${tab === item.id ? styles.navItemActive : ""}`} onClick={() => navigate(item.id)} title={item.desc}>
                  <Icon size={15} /><span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.navGroup}>
            <button className={styles.groupToggle} onClick={() => setRecentOpen(value => !value)}>
              <span>最近作品</span>{recentOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {recentOpen && (recentProjects.length ? recentProjects.map(project => (
              <button key={project.id} className={styles.recentItem} onClick={() => navigate("projects")} title={project.name}>
                <Clapperboard size={13} /><span>{project.name}</span>
              </button>
            )) : <div className={styles.groupLabel}>还没有作品</div>)}
          </div>
        </div>

        <div className={styles.sidebarFooter}>
          <button className={styles.serviceButton} onClick={() => navigate("settings")}>
            <span className={`${styles.statusDot} ${generationReady === true ? styles.statusDotReady : generationReady === false ? styles.statusDotBad : ""}`} />
            <span className={styles.serviceButtonText}>
              <strong>{generationReady === null ? "正在检查视频服务" : generationReady ? "视频服务可用" : "需要配置视频服务"}</strong>
              <small>{providerMode === "auto" ? "默认：自动路由" : providerMode === "modelstudio" ? "默认：强制百炼" : "默认：强制万镜一刻"}</small>
            </span>
            <SettingsIcon size={14} />
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.iconButton} title={sidebarOpen ? "收起侧栏" : "展开侧栏"} onClick={() => setSidebarOpen(value => !value)}>
            {sidebarOpen ? <PanelLeftClose size={18} /> : <Menu size={18} />}
          </button>
          <div className={styles.topbarTitle}><span>{labels[tab]}</span></div>
          <div className={styles.topbarSpacer} />
          <div className={styles.topbarStats}>
            <span className={styles.statPill}><b>{stats.active}</b>处理中</span>
            <span className={styles.statPill}><b>{stats.success}</b>已完成</span>
            <span className={styles.statPill}><b>{stats.assets}</b>素材</span>
          </div>
          <button className={styles.iconButton} title="刷新" onClick={() => loadAll()}><RefreshCw size={16} /></button>
          <button className={styles.iconButton} title="设置" onClick={() => navigate("settings")}><SettingsIcon size={16} /></button>
        </header>

        {notice && <div className={styles.notice}><WandSparkles size={15} />{notice}</div>}
        {tab === "generate" && activeShot && (
          <div className={styles.notice}>
            <Clapperboard size={15} />
            <span>当前目标：<strong>{activeShot.project.name} / {activeShot.shot.name}</strong>{activeShot.shot.brief ? ` · ${activeShot.shot.brief}` : ""}</span>
            <button className="link-button" onClick={() => setActiveShotId("")}>退出镜头上下文</button>
          </div>
        )}

        <section className={`${styles.content} ${tab === "home" ? styles.homeContent : ""}`}>
          {tab === "home" ? (
            <ChatCreationHome
              assets={assets}
              subjects={subjects}
              generationReady={generationReady}
              defaultProviderMode={providerMode}
              modelStudioAvailable={modelStudioConfigured}
              yikeAvailable={yikeReady}
              onAssetsChanged={loadAll}
              onCreated={quickCreated}
              onOpenAdvanced={() => navigate("generate")}
              onOpenQuick={() => navigate("quick")}
              onOpenAssets={() => navigate("assets")}
              onOpenSubjects={() => navigate("subjects")}
              onOpenSettings={() => navigate("settings")}
              onOpenTool={tool => navigate(tool)}
            />
          ) : (
            <div className={styles.contentInner}>
              {tab === "quick" && <QuickCreationWizard assets={assets} subjects={subjects} onCreated={quickCreated} onAdvanced={() => navigate("generate")} onSettings={() => navigate("settings")} onAssetsChanged={loadAll} generationReady={generationReady} directAvailable={directVideo} extendedUploadAvailable={yikeReady} />}
              {tab === "generate" && <SimpleVideoGenerator assets={assets} subjects={subjects} onSubmit={submit} onSubmitBatch={submitBatch} submitting={loading} directAvailable={directVideo} />}
              {tab === "projects" && <ProjectHome projects={projects} jobs={jobs} subjects={subjects} onChanged={loadAll} onCreateInShot={createInShot} />}
              {(["remake", "clone", "avatar", "voice", "storyboard", "translation"] as Tab[]).includes(tab) && (
                <CreatorForms mode={tab as any} assets={assets} jobs={jobs} onSubmit={submit} submitting={loading} />
              )}
              {tab === "assets" && <AssetLibrary assets={assets} onChanged={loadAll} extendedUploadAvailable={yikeReady} />}
              {tab === "subjects" && <SubjectLibrary subjects={subjects} assets={assets} onChanged={loadAll} />}
              {tab === "jobs" && <JobCenter jobs={jobs} modelStudioAvailable={modelStudioConfigured} onChanged={loadAll} onGoAssets={() => navigate("assets")} />}
              {tab === "settings" && <SettingsPanel onChanged={loadAll} />}
            </div>
          )}
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
