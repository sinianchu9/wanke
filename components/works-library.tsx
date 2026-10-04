"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, BookmarkPlus, Download, Film, FolderOpen, LoaderCircle, Pencil, PlayCircle, RefreshCcw, Sparkles, Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/confirm-dialog";

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
  const [deleteTarget, setDeleteTarget] = useState<Work | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/works?includeArchived=${showArchived ? "1" : "0"}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "加载作品列表失败");
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
      if (!response.ok) throw new Error(body.error || "操作未能完成，请稍后重试");
      onNotice?.(message);
      await load();
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      const response = await fetch(`/api/works/${deleteTarget.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "删除作品失败，请稍后重试");
      onNotice?.(`作品「${deleteTarget.title}」已删除`);
      setDeleteTarget(null);
      await load();
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function jobAction(work: Work, action: string, payload: Record<string, unknown>, message: string) {
    if (!work.source?.jobId) return;
    setBusy(work.id);
    try {
      const response = await fetch(`/api/jobs/${work.source.jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "操作未能提交，请稍后重试");
      onNotice?.(message);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  function rename(work: Work) {
    const title = prompt("请输入新的作品标题", work.title);
    if (title && title.trim() && title.trim() !== work.title) {
      patch(work, { title: title.trim() }, `作品标题已更新为「${title.trim()}」`);
    }
  }

  function regenerate(work: Work) {
    if (!work.source?.jobId) return;
    if (!confirm(`以「${work.title}」的创作参数再生成一个类似版本？这会按规则扣减相应额度。`)) return;
    jobAction(work, "similar", {}, `已提交「${work.title}」的新版本生成，完成后会出现在任务中心`);
  }

  function continueCreation(work: Work) {
    if (!work.source?.jobId) return;
    const promptText = prompt("继续创作：填写新的镜头或剧情要求", "");
    if (!promptText || !promptText.trim()) return;
    jobAction(work, "continue", { prompt: promptText.trim(), outputIndex: 0 }, `已提交继续创作任务，生成完成后会出现在任务中心`);
  }

  const playUrl = (work: Work) => work.archivedFile
    ? `/api/archive/${encodeURIComponent(work.archivedFile)}`
    : work.videoUrl || "";

  const downloadUrl = (work: Work) => {
    if (work.source?.jobId) {
      return `/api/jobs/${work.source.jobId}/download?index=0`;
    }
    if (work.archivedFile) {
      return `/api/archive/${encodeURIComponent(work.archivedFile)}?download=1`;
    }
    return work.videoUrl || "";
  };

  if (loading) {
    return <div className="works-empty"><LoaderCircle className="spin" size={22}/>正在加载作品库…</div>;
  }

  return (
    <div className="works-wrap">
      <div className="works-toolbar">
        <span className="mini">{works.length} 部作品{showArchived ? "（含已归档）" : ""} · 成功生成的视频与成片可在此长期收藏与管理</span>
        <button className="secondary" onClick={() => setShowArchived(value => !value)}>
          <Archive size={14}/>{showArchived ? "只看活跃作品" : "查看已归档"}
        </button>
      </div>

      {works.length === 0 ? (
        <div className="works-empty">
          <BookmarkPlus size={28}/>
          <div>
            <strong>作品库还没有作品</strong>
            <span>在任务中心生成成功后，点击「保存到作品」；或在作品项目生成成片后点击「保存到作品」，即可长期收藏在此。</span>
          </div>
        </div>
      ) : (
        <div className="works-grid">
          {works.map(work => (
            <article key={work.id} className={`work-card ${work.status === "archived" ? "archived" : ""}`}>
              <div className="work-card-media">
                {playUrl(work) ? (
                  <video src={playUrl(work)} controls preload="metadata"/>
                ) : (
                  <div className="no-preview"><Film size={20}/><span>暂无可播放来源</span></div>
                )}
              </div>

              <div className="work-meta">
                <div className="work-meta-main">
                  <strong>
                    <PlayCircle size={14}/> {work.title}
                    {((work.title + " " + (work.source?.jobTitle || "")).toLowerCase().includes("happyhorse")) && (
                      <span className="badge-model badge-model-happyhorse" style={{ marginLeft: 6 }}>HappyHorse 1.1</span>
                    )}
                    {((work.title + " " + (work.source?.jobTitle || "")).toLowerCase().includes("wan")) && (
                      <span className="badge-model badge-model-wan" style={{ marginLeft: 6 }}>Wan 3.0</span>
                    )}
                  </strong>
                  <div className="work-meta-info">
                    <span>{new Date(work.createdAt).toLocaleString("zh-CN")}</span>
                    <span>·</span>
                    <span>{formatDuration(work.durationSeconds)}</span>
                    <span>·</span>
                    <span>{formatBytes(work.sizeBytes)}</span>
                    {work.format && <><span>·</span><span>{work.format}</span></>}
                    {work.status === "archived" && <span style={{ color: "#d97706", fontWeight: 600 }}>· 已归档</span>}
                    {work.archivedFile && <span>· 本地存储</span>}
                  </div>
                  {work.source && (
                    <div className="work-meta-source">
                      {work.source.projectName ? `项目「${work.source.projectName}」` : `来源「${work.source.jobTitle || "未命名任务"}」`}
                    </div>
                  )}
                </div>

                <div className="work-primary-actions">
                  {downloadUrl(work) && (
                    <a className="btn-download-action mini" title="下载作品文件到手机/电脑" href={downloadUrl(work)} download>
                      <Download size={13}/>
                      <span>下载作品</span>
                    </a>
                  )}
                  {work.source?.jobId && work.status !== "archived" && (
                    <button className="btn-save-work-action mini" disabled={busy === work.id} title="以该作品为基础继续创作" onClick={() => continueCreation(work)}>
                      <Sparkles size={13}/>
                      <span>继续创作</span>
                    </button>
                  )}
                </div>

                <div className="work-actions-row">
                  <div className="work-actions-left">
                    {work.source?.jobId && work.status !== "archived" && (
                      <button className="btn-action-subtle mini" disabled={busy === work.id} title="按原要求再生成一个新版本" onClick={() => regenerate(work)}>
                        <RefreshCcw size={13}/>
                        <span>再生成</span>
                      </button>
                    )}
                    <button className="btn-action-subtle mini" disabled={busy === work.id} title="修改作品标题" onClick={() => rename(work)}>
                      <Pencil size={13}/>
                      <span>重命名</span>
                    </button>
                    <button
                      className="btn-action-subtle mini"
                      disabled={busy === work.id}
                      title={work.status === "archived" ? "恢复至活跃作品" : "归档保存"}
                      onClick={() => patch(work, { status: work.status === "archived" ? "active" : "archived" }, work.status === "archived" ? `作品「${work.title}」已恢复` : `作品「${work.title}」已归档`)}
                    >
                      <Archive size={13}/>
                      <span>{work.status === "archived" ? "移出归档" : "归档"}</span>
                    </button>
                    {work.source?.projectName && (
                      <a className="btn-action-subtle mini" title={`查看来源项目「${work.source.projectName}」`} href="/studio">
                        <FolderOpen size={13}/>
                        <span>查看项目</span>
                      </a>
                    )}
                  </div>
                  <button
                    className="btn-action-danger mini"
                    disabled={busy === work.id}
                    title="删除此作品"
                    onClick={() => setDeleteTarget(work)}
                  >
                    <Trash2 size={13}/>
                    <span>删除作品</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="删除作品"
        message={`确定删除作品「${deleteTarget?.title}」？`}
        detail="删除后，作品记录和本地存储文件将被移除，且无法恢复（原始生成任务与项目记录不受影响）。"
        confirmText="确认删除"
        cancelText="取消"
        isDanger={true}
        busy={deleteBusy}
        onConfirm={handleDeleteConfirm}
        onCancel={() => { if (!deleteBusy) setDeleteTarget(null); }}
      />
    </div>
  );
}
