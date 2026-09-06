"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Braces,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  CopyCheck,
  Crown,
  Film,
  FolderKanban,
  Languages,
  Library,
  ListVideo,
  LoaderCircle,
  LogOut,
  MailCheck,
  Menu,
  Mic2,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  RefreshCw,
  ScanFace,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import CreatorForms from "@/components/forms";
import SimpleVideoGenerator from "@/components/simple-video-generator";
import QuickCreationWizard from "@/components/quick-creation-wizard";
import ChatCreationHome from "@/components/chat-creation-home";
import AssetLibrary from "@/components/asset-library";
import JobCenter from "@/components/job-center";
import WorksLibrary from "@/components/works-library";
import ProjectHome from "@/components/project-home";
import UserSettingsPanel from "@/components/user-settings-panel";
import SubjectLibrary, { type PublicSubjectCard } from "@/components/subject-library";
import type { ProductionProject } from "@/lib/project-types";
import type { StoredAsset, StoredJob } from "@/lib/types";
import styles from "@/components/studio-shell.module.css";
import workflowStyles from "@/components/workflow-surface.module.css";

type Tab = "home" | "quick" | "generate" | "projects" | "works" | "remake" | "clone" | "avatar" | "voice" | "storyboard" | "translation" | "assets" | "subjects" | "jobs" | "settings";
type WorkflowTab = "quick" | "generate" | "remake" | "clone" | "avatar" | "voice" | "storyboard" | "translation";
type ProviderMode = "auto" | "modelstudio" | "yike";

/** Client request id makes a submit exactly-once: a retry returns the same creation. */
function newClientRequestId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
    : Math.random().toString(36).slice(2, 18);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function creditNote(quote: { credits?: number } | undefined) {
  const credits = Number(quote?.credits || 0);
  return credits > 0 ? `（本次消耗 ${credits} 个创作额度）` : "";
}
type QuickCreateResult = { submitted?: number; failed?: number; projectName?: string };

const CHAT_DRAFT_KEY = "wanke:chat-creation-draft:v1";

const primaryNav = [
  { id: "projects" as const, label: "项目空间", icon: FolderKanban },
  { id: "works" as const, label: "我的作品", icon: Film },
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
  projects: "项目空间",
  works: "我的作品",
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

const workflowMeta: Record<WorkflowTab, { description: string }> = {
  quick: { description: "分步选择素材和目标，适合第一次使用或希望按步骤完成创作。" },
  generate: { description: "集中控制生成方式、Recipe、参考素材与批量版本，适合精细创作。" },
  remake: { description: "把原视频拆解、改写和渲染串成可检查、可回退的专业复刻流程。" },
  clone: { description: "以已有视频为骨架，快速替换产品、人物或素材，生成同结构新版本。" },
  avatar: { description: "创建知识讲解或固定机位数字人口播，统一配置人物、声音与画面素材。" },
  voice: { description: "将文案、素材和配音组合为完整旁白视频，并处理标题、字幕和封面。" },
  storyboard: { description: "面向长文本拆解故事板、生成镜头并合成，适合更长、更结构化的视频任务。" },
  translation: { description: "完成视频字幕、语音和画面文字的多语言处理，并保留原视频结构。" },
};

function isWorkflowTab(tab: Tab): tab is WorkflowTab {
  return ["quick", "generate", "remake", "clone", "avatar", "voice", "storyboard", "translation"].includes(tab);
}

export default function Studio() {
  const [tab, setTab] = useState<Tab>("home");
  const [previousTab, setPreviousTab] = useState<Tab>("home");
  const [homeSession, setHomeSession] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [activeJobsOpen, setActiveJobsOpen] = useState(true);
  const [focusedProjectId, setFocusedProjectId] = useState("");
  const [focusedJobId, setFocusedJobId] = useState("");
  const [jobs, setJobs] = useState<StoredJob[]>([]);
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [subjects, setSubjects] = useState<PublicSubjectCard[]>([]);
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [activeShotId, setActiveShotId] = useState("");
  const [notice, setNotice] = useState<string>("");
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const loadAll = useCallback(async () => {
    const [j, a, subjectData, projectData, s, meData] = await Promise.all([
      fetch("/api/jobs", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/assets", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/subjects", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/projects", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/status", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/auth/me", { cache: "no-store" }).then(r => r.json()),
    ]);
    if (!meData.user) {
      window.location.href = "/login?next=/studio";
      return;
    }
    setJobs(mergeJobs(j.jobs || [], projectData.jobs || []));
    setAssets(a.assets || []);
    setSubjects(subjectData.subjects || []);
    setProjects(projectData.projects || []);
    setStatus(s);
    setMe(meData);
  }, []);

  const saveAsWork = useCallback(async (job: StoredJob, outputIndex: number) => {
    try {
      const response = await fetch("/api/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, outputIndex }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存失败");
      setNotice(`已保存到「我的作品」：${body.work?.title || job.title}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
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

  const sidebarActiveJobs = useMemo(
    () => jobs.filter(job => ["queued", "running", "unknown"].includes(job.status) && job.details?.pollable !== false).slice(0, 5),
    [jobs],
  );

  const focusedJobs = useMemo(() => {
    if (!focusedJobId || !jobs.some(job => job.id === focusedJobId)) return jobs;
    const selected = jobs.find(job => job.id === focusedJobId)!;
    return [selected, ...jobs.filter(job => job.id !== focusedJobId)];
  }, [jobs, focusedJobId]);

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
        body: JSON.stringify({ kind, input, title, parentJobId, shotId, clientRequestId: newClientRequestId("job") }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "任务提交失败");
      setNotice(shotId && activeShot
        ? `已提交到「${activeShot.project.name} / ${activeShot.shot.name}」：${data.job.title}${creditNote(data.quote)}`
        : `已提交：${data.job.title}${creditNote(data.quote)}`);
      await loadAll();
      setFocusedJobId(data.job.id || "");
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
        body: JSON.stringify({ kind: "video_generation", input, count, title, shotId: activeShotId || undefined, clientRequestId: newClientRequestId("batch") }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "批量任务提交失败");
      const summary = data.summary || {};
      const location = activeShot ? `，已归入「${activeShot.project.name} / ${activeShot.shot.name}」` : "";
      setNotice(summary.failed
        ? `已创建 ${summary.total} 个版本：${summary.submitted} 个已提交，${summary.failed} 个未完成${location}${creditNote(data.quote)}。`
        : `已创建并提交 ${summary.total} 个独立版本${location}${creditNote(data.quote)}。`
      );
      await loadAll();
      setFocusedJobId(data.jobs?.[0]?.id || "");
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

  function closeSidebarOnMobile() {
    if (window.matchMedia("(max-width: 720px)").matches) setSidebarOpen(false);
  }

  function navigate(next: Tab, remember = true) {
    if (next !== tab && remember) setPreviousTab(tab);
    if (next !== "projects") setFocusedProjectId("");
    if (next !== "jobs") setFocusedJobId("");
    setTab(next);
    setNotice("");
    closeSidebarOnMobile();
  }

  function goBack() {
    const target = previousTab === tab ? "home" : previousTab;
    navigate(target, false);
    setPreviousTab("home");
  }

  function newCreation() {
    window.sessionStorage.removeItem(CHAT_DRAFT_KEY);
    setFocusedProjectId("");
    setFocusedJobId("");
    setActiveShotId("");
    setNotice("");
    setHomeSession(value => value + 1);
    setPreviousTab("home");
    setTab("home");
    closeSidebarOnMobile();
  }

  function openProject(projectId: string) {
    setFocusedProjectId(projectId);
    setFocusedJobId("");
    navigate("projects");
  }

  function openJob(jobId: string) {
    setFocusedJobId(jobId);
    setFocusedProjectId("");
    navigate("jobs");
  }

  function createInShot(shotId: string) {
    setActiveShotId(shotId);
    navigate("generate");
  }

  async function quickCreated(projectId: string, result?: QuickCreateResult) {
    await loadAll();
    setFocusedProjectId(projectId);
    const submitted = Number(result?.submitted || 0);
    const failed = Number(result?.failed || 0);
    if (result && failed > 0 && submitted === 0) {
      setNotice(`作品已建立，但 ${failed} 个镜头都没有成功提交。已定位到作品，请查看具体原因并逐镜头重试。`);
    } else if (result && failed > 0) {
      setNotice(`作品已建立：${submitted} 个镜头已提交，${failed} 个需要处理。可以在当前作品里直接查看和重试。`);
    } else {
      setNotice("作品已建立，镜头正在生成。可以在“我的作品”里直接看进度。");
    }
    setTab("projects");
  }

  // Members only ever learn whether a capability is available; the platform decides
  // which upstream service runs it (see /api/status and 管理后台 → 创作服务).
  const directVideo = status?.capabilities?.directVideo === true;
  const extendedReady = status?.capabilities?.extendedUpload === true;
  const generationReady = status === null ? null : status?.generationReady === true;
  const chatGenerationReady = status === null ? null : status?.available === true;
  const serviceMessage = status?.message || "";
  const providerMode: ProviderMode = "auto";
  const activeWorkflow = isWorkflowTab(tab) ? tab : null;

  useEffect(() => {
    if (!activeWorkflow) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") navigate("home");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeWorkflow]);

  function renderWorkflow(workflow: WorkflowTab) {
    if (workflow === "quick") {
      return <QuickCreationWizard assets={assets} subjects={subjects} onCreated={quickCreated} onAdvanced={() => navigate("generate")} onSettings={() => navigate("settings")} onAssetsChanged={loadAll} generationReady={generationReady} directAvailable={directVideo} extendedUploadAvailable={extendedReady} />;
    }
    if (workflow === "generate") {
      return <SimpleVideoGenerator assets={assets} subjects={subjects} onSubmit={submit} onSubmitBatch={submitBatch} submitting={loading} directAvailable={directVideo} />;
    }
    return <CreatorForms mode={workflow} assets={assets} jobs={jobs} onSubmit={submit} submitting={loading} />;
  }

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

        <button className={styles.newButton} onClick={newCreation}><Plus size={16} />新建创作</button>

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

          {sidebarActiveJobs.length > 0 && <div className={styles.navGroup}>
            <button className={styles.groupToggle} onClick={() => setActiveJobsOpen(value => !value)}>
              <span>正在生成</span>{activeJobsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {activeJobsOpen && sidebarActiveJobs.map(job => (
              <button key={job.id} className={styles.recentItem} onClick={() => openJob(job.id)} title={job.title}>
                <LoaderCircle className={styles.spin} size={13} /><span>{job.title}</span>
              </button>
            ))}
          </div>}

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
              <button key={project.id} className={styles.recentItem} onClick={() => openProject(project.id)} title={project.name}>
                <Clapperboard size={13} /><span>{project.name}</span>
              </button>
            )) : <div className={styles.groupLabel}>还没有作品</div>)}
          </div>
        </div>

        <div className={styles.sidebarFooter}>
          {userMenuOpen && <button className={styles.userMenuScrim} aria-label="关闭菜单" onClick={() => setUserMenuOpen(false)} />}
          <div className={styles.userMenuWrap}>
            {me?.user && userMenuOpen && (
              <div className={styles.userMenuPopover}>
                <div className={styles.userMenuItem} aria-live="polite">
                  <span className={`${styles.statusDot} ${generationReady === true ? styles.statusDotReady : generationReady === false ? styles.statusDotBad : ""}`} />
                  <span>{generationReady === null ? "正在确认创作服务" : generationReady ? "创作服务正常" : "创作服务暂时不可用"}</span>
                  <small>{generationReady === false ? (serviceMessage || "请稍后再试，或联系客服") : "可以随时提交新的创作"}</small>
                </div>
                <div className={styles.userMenuDivider} />
                <Link className={styles.userMenuItem} href="/account">
                  <Crown size={15} /><span>会员中心</span>
                </Link>
                <button className={styles.userMenuItem} onClick={() => { setUserMenuOpen(false); navigate("settings"); }}>
                  <SettingsIcon size={15} /><span>设置</span>
                </button>
                {me.user.role === "admin" && (
                  <Link className={styles.userMenuItem} href="/admin">
                    <ShieldCheck size={15} /><span>管理后台</span>
                  </Link>
                )}
                <div className={styles.userMenuDivider} />
                <button className={`${styles.userMenuItem} ${styles.userMenuItemDanger}`} onClick={logout}>
                  <LogOut size={15} /><span>退出登录</span>
                </button>
              </div>
            )}
            <button className={styles.userMenuButton} onClick={() => setUserMenuOpen(value => !value)}>
              <span className={styles.userMenuAvatar}>{(me?.user?.name || me?.user?.email || "?").slice(0, 1).toUpperCase()}</span>
              <span className={styles.userMenuMeta}>
                <strong>{me?.user?.name || "未登录"}</strong>
                <small>{me?.membership?.planName || "免费版"}{me?.user?.role === "admin" ? " · 管理员" : ""}</small>
              </span>
              <MoreHorizontal size={16} className={styles.userMenuDots} />
            </button>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.iconButton} title={sidebarOpen ? "收起侧栏" : "展开侧栏"} onClick={() => setSidebarOpen(value => !value)}>
            {sidebarOpen ? <PanelLeftClose size={18} /> : <Menu size={18} />}
          </button>
          {tab !== "home" && !activeWorkflow && (
            <button className={styles.topbarBackButton} onClick={goBack} title="返回上一页">
              <ArrowLeft size={15} /><span>返回</span>
            </button>
          )}
          <div className={styles.topbarTitle}><span>{labels[tab]}</span></div>
          <div className={styles.topbarSpacer} />
          <div className={styles.topbarStats}>
            {me?.membership && (
              <Link href="/account" className={styles.statPill} title={`${me.membership.planName || ""} · 剩余 ${me.membership.credits?.available ?? 0} 个创作额度 · 点击进入会员中心`}>
                <b>{me.membership.credits?.available ?? 0}</b>创作额度
              </Link>
            )}
            <span className={styles.statPill}><b>{stats.active}</b>处理中</span>
            <span className={styles.statPill}><b>{stats.success}</b>已完成</span>
            <span className={styles.statPill}><b>{stats.assets}</b>素材</span>
          </div>
          <button className={styles.iconButton} title="刷新" onClick={() => loadAll()}><RefreshCw size={16} /></button>
          <button className={styles.iconButton} title="设置" onClick={() => navigate("settings")}><SettingsIcon size={16} /></button>
        </header>

        {notice && <div className={styles.notice}><WandSparkles size={15} />{notice}</div>}
        {me?.account?.blocked && (
          <div className={styles.noticeWarning}>
            <MailCheck size={15} />
            <span>{me.account.message}。<Link href="/account?section=settings">去验证邮箱</Link>{me.account.hint ? `（${me.account.hint}）` : ""}</span>
          </div>
        )}
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
              key={homeSession}
              assets={assets}
              subjects={subjects}
              generationReady={chatGenerationReady}
              defaultProviderMode={providerMode}
              modelStudioAvailable={directVideo}
              yikeAvailable={extendedReady}
              onAssetsChanged={loadAll}
              onCreated={quickCreated}
              onOpenAdvanced={() => navigate("generate")}
              onOpenQuick={() => navigate("quick")}
              onOpenAssets={() => navigate("assets")}
              onOpenSubjects={() => navigate("subjects")}
              onOpenSettings={() => navigate("settings")}
              onOpenTool={tool => navigate(tool)}
            />
          ) : activeWorkflow ? (
            <div className={workflowStyles.viewport}>
              <div className={workflowStyles.navBar}>
                <button className={workflowStyles.backButton} onClick={goBack} title="返回上一页">
                  <ArrowLeft size={15} /><span>返回上一页</span>
                </button>
                <span className={workflowStyles.navDivider} />
                <div className={workflowStyles.navText}>
                  <strong>{labels[activeWorkflow]}</strong>
                  <small>{workflowMeta[activeWorkflow].description}</small>
                </div>
                <span className={workflowStyles.navSpacer} />
                <button className={workflowStyles.closeButton} onClick={() => navigate("home")} aria-label="关闭当前工作流" title="关闭（Esc）">
                  <X size={16} />
                </button>
              </div>
              <div className={workflowStyles.surface} data-workflow={activeWorkflow}>
                {renderWorkflow(activeWorkflow)}
              </div>
            </div>
          ) : (
            <div className={styles.contentInner}>
              {tab === "projects" && <ProjectHome projects={projects} jobs={jobs} subjects={subjects} onChanged={loadAll} onCreateInShot={createInShot} focusProjectId={focusedProjectId} />}
              {tab === "works" && <WorksLibrary onNotice={setNotice} />}
              {tab === "assets" && <AssetLibrary assets={assets} onChanged={loadAll} extendedUploadAvailable={extendedReady} />}
              {tab === "subjects" && <SubjectLibrary subjects={subjects} assets={assets} onChanged={loadAll} />}
              {tab === "jobs" && <JobCenter key={focusedJobId || "job-center"} jobs={focusedJobs} modelStudioAvailable={directVideo} onChanged={loadAll} onGoAssets={() => navigate("assets")} onSaveWork={saveAsWork} />}
              {tab === "settings" && <UserSettingsPanel onChanged={loadAll} />}
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
