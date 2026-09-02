"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, BookmarkPlus, Film, LoaderCircle, Pencil, PlayCircle, Trash2 } from "lucide-react";

interface Work {
  id: string;
  title: string;
  description: string;
  videoUrl: string | null;
  archivedFile: string | null;
  status: "active" | "archived";
  createdAt: string;
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
    if (!confirm(`删除作品「${work.title}」？删除后不可恢复（源任务与本地归档文件不受影响）。`)) return;
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

  function rename(work: Work) {
    const title = prompt("作品标题", work.title);
    if (title && title.trim() && title !== work.title) patch(work, { title: title.trim() }, "作品已重命名");
  }

  const playUrl = (work: Work) => work.archivedFile
    ? `/api/archive/${encodeURIComponent(work.archivedFile)}`
    : work.videoUrl || "";

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
              <span>{new Date(work.createdAt).toLocaleString("zh-CN")}{work.status === "archived" ? " · 已归档" : ""}{work.archivedFile ? " · 本机保存" : ""}</span>
            </div>
            <div className="result-actions">
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
