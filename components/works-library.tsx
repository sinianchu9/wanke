"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, BookmarkPlus, Download, Film, FolderOpen, LoaderCircle, Pencil, PlayCircle, RefreshCcw, Sparkles, Trash2 } from "lucide-react";

interface WorkSource {
  jobId: string;
  jobTitle: string;
  projectId: string | null;
  projectName: string | null;
}

interface Work {
  id: string;
  title: string;
  description: string;
  videoUrl: string | null;
  archivedFile: string | null;
  status: "active" | "archived";
  createdAt: string;
  sizeBytes: number;
  durationSeconds: number | null;
  format: string | null;
  source: WorkSource | null;
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "大小未知";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) return "时长未知";
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
}

export default function WorksLibrary({ onNotice }: { onNotice?: (message: string) => void }) {
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/works?includeArchived=${showArchived ? "1" : "0"}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "加载失败");
      setWorks(body.works || []);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [showArchived, onNotice]);

  useEffect(() => { load(); }, [load]);

  async function patch(work: Work, payload: Record<string, unknown>, message: string) {
    setBusy(work.id);
    try {
      const response = await fetch(`/api/works/${work.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "操作失败");
      onNotice?.(message);
      await load();
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function remove(work: Work) {
    if (!confirm(`删除作品「${work.title}」？删除后不可恢复（来源任务不受影响）。`)) return;
    setBusy(work.id);
    try {
      const response = await fetch(`/api/works/${work.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "删除失败");
      onNotice?.("作品已删除");
      await load();
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function jobAction(work: Work, action: string, payload: Record<string, unknown>, message: string) {
    if (!work.source) return;
    setBusy(work.id);
    try {
      const response = await fetch(`/api/jobs/${work.source.jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "操作失败");
      onNotice?.(message);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  function rename(work: Work) {
    const title = prompt("作品标题", work.title);
    if (title && title.trim() && title !== work.title) patch(work, { title: title.trim() }, "作品已重命名");
  }

  function regenerate(work: Work) {
    if (!work.source) return;
    if (!confirm(`以「${work.title}」的创作要求再生成一个版本？这会按当前规则使用创作额度。`)) return;
    jobAction(work, "similar", {}, "已提交新版本，生成完成后会出现在任务中心");
  }

  function continueCreation(work: Work) {
    if (!work.source) return;
    const promptText = prompt("继续创作：填写新的创作要求", "");
    if (!promptText || !promptText.trim()) return;
    jobAction(work, "continue", { prompt: promptText.trim(), outputIndex: 0 }, "已提交继续创作，生成完成后会出现在任务中心");
  }

  const playUrl = (work: Work) => work.archivedFile
    ? `/api/archive/${encodeURIComponent(work.archivedFile)}`
    : work.videoUrl || "";
  const downloadUrl = (work: Work) => work.archivedFile
    ? `/api/archive/${encodeURIComponent(work.archivedFile)}?download=1`
    : "";

  if (loading) {
    return <div className="works-empty"><LoaderCircle className="spin" size={22}/>正在加载作品库…</div>;
  }

  return <div className="works-wrap">
    <div className="works-toolbar">
      <span className="mini">{works.length} 部作品{showArchived ? "（含已归档）" : ""} · 成功任务可一键保存为作品，长期保留</span>
      <button className="secondary" onClick={() => setShowArchived(value => !value)}>
        <Archive size={14}/>{showArchived ? "只看活跃作品" : "查看已归档"}
      </button>
    </div>
    {works.length === 0 ? (
      <div className="works-empty">
        <BookmarkPlus size={26}/>
        <div>
          <strong>还没有作品</strong>
          <span>在任务中心打开一个生成成功的视频结果，点击“保存到作品”即可收藏到这里。</span>
        </div>
      </div>
    ) : (
      <div className="works-grid">
        {works.map(work => <article key={work.id} className={`work-card ${work.status === "archived" ? "archived" : ""}`}>
          {playUrl(work)
            ? <video src={playUrl(work)} controls preload="metadata"/>
            : <div className="no-preview"><Film size={20}/><span>暂无可播放来源</span></div>}
          <div className="work-meta">
            <div>
              <strong><PlayCircle size={13}/> {work.title}</strong>
              <span>
                {new Date(work.createdAt).toLocaleString("zh-CN")}
                {" · "}{formatDuration(work.durationSeconds)}
                {" · "}{formatBytes(work.sizeBytes)}
                {work.format ? ` · ${work.format}` : ""}
                {work.status === "archived" ? " · 已归档" : ""}
                {work.archivedFile ? " · 本机保存" : ""}
              </span>
              {work.source && (
                <span className="mini">
                  来源任务「{work.source.jobTitle || "未命名任务"}」
                  {work.source.projectName ? ` · 项目「${work.source.projectName}」` : ""}
                </span>
              )}
            </div>
            <div className="result-actions">
              {downloadUrl(work) && (
                <a className="icon-button" title="下载作品" href={downloadUrl(work)} download>
                  <Download size={14}/>
                </a>
              )}
              {work.source && (
                <a className="icon-button" title={work.source.projectName ? `查看来源项目「${work.source.projectName}」` : "查看来源任务"} href="/studio">
                  <FolderOpen size={14}/>
                </a>
              )}
              {work.source && work.status !== "archived" && (
                <button className="icon-button" disabled={busy === work.id} title="继续创作" onClick={() => continueCreation(work)}>
                  <Sparkles size={14}/>
                </button>
              )}
              {work.source && work.status !== "archived" && (
                <button className="icon-button" disabled={busy === work.id} title="再生成一个版本" onClick={() => regenerate(work)}>
                  <RefreshCcw size={14}/>
                </button>
              )}
              <button className="icon-button" disabled={busy === work.id} title="重命名" onClick={() => rename(work)}><Pencil size={14}/></button>
              <button className="icon-button" disabled={busy === work.id} title={work.status === "archived" ? "恢复作品" : "归档作品"} onClick={() => patch(work, { status: work.status === "archived" ? "active" : "archived" }, work.status === "archived" ? "作品已恢复" : "作品已归档")}>
                <Archive size={14}/>
              </button>
              <button className="icon-button danger" disabled={busy === work.id} title="删除作品" onClick={() => remove(work)}><Trash2 size={14}/></button>
            </div>
          </div>
        </article>)}
      </div>
    )}
  </div>;
}
