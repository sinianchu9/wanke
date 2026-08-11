"use client";

import { useCallback, useEffect, useState } from "react";
import { Blend, Save } from "lucide-react";

type Settings = {
  projectId: string;
  transitionType: "cut" | "fade";
  duration: number;
};

export default function ProjectTransitionSettings({ projectId }: { projectId: string }) {
  const [settings, setSettings] = useState<Settings>({ projectId, transitionType: "cut", duration: 0.5 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/transitions?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "读取转场设置失败");
    setSettings({ projectId, transitionType: body.settings?.transitionType === "fade" ? "fade" : "cut", duration: Number(body.settings?.duration || 0.5) });
  }, [projectId]);

  useEffect(() => {
    setError(""); setNotice(""); setSettings({ projectId, transitionType: "cut", duration: 0.5 });
    load().catch(error => setError(error instanceof Error ? error.message : String(error)));
  }, [load, projectId]);

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/projects/transitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存转场设置失败");
      setSettings({ projectId, ...body.settings });
      setNotice(settings.transitionType === "fade" ? `已保存 ${settings.duration}s 淡化转场；下一次成片生效。` : "已保存直接切换；下一次成片不会额外渲染转场。" );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return <section className="panel" style={{marginBottom:18}}>
    <div className="panel-title"><Blend size={17}/><div><h3>Shot 转场</h3><p>统一控制相邻 Shot 的连接方式；第一阶段只提供稳定的直接切换和淡化。</p></div></div>
    <div className="form-grid two" style={{marginTop:12}}>
      <div className="field">
        <span className="field-label">转场方式</span>
        <select value={settings.transitionType} onChange={event => setSettings(current => ({ ...current, transitionType: event.target.value === "fade" ? "fade" : "cut" }))}>
          <option value="cut">直接切换 · 不额外渲染</option>
          <option value="fade">淡化 · 画面和原声交叉过渡</option>
        </select>
      </div>
      <div className="field">
        <span className="field-label">淡化时长<small>{settings.duration.toFixed(1)} 秒</small></span>
        <input type="range" min={0.2} max={1.5} step={0.1} value={settings.duration} disabled={settings.transitionType !== "fade"} onChange={event => setSettings(current => ({ ...current, duration: Number(event.target.value) }))}/>
      </div>
    </div>
    <div className="inline-actions" style={{marginTop:10}}><button className="secondary" disabled={busy} onClick={save}><Save size={15}/>{busy ? "保存中…" : "保存转场设置"}</button></div>
    {notice && <div className="notice" style={{marginTop:10}}>{notice}</div>}
    {error && <div className="error-banner" style={{marginTop:10}}>{error}</div>}

    <div className="muted mini" style={{marginTop:10}}>{settings.transitionType === "cut"
      ? "直接切换继续使用已经统一规格的片段做 concat copy，不会为了“转场”再次编码视频。"
      : "淡化需要真正渲染画面，因此会比直接切换多一次视频编码；音频同步使用 acrossfade，避免画面柔和但声音硬切。"}</div>

    <details className="advanced" style={{marginTop:10}}>
      <summary>第一版为什么不做几十种转场？</summary>
      <div className="advanced-body">
        <div className="muted mini"><strong>目标：</strong>先验证 Project 时间线、画面重叠、音频重叠、BGM 和字幕时间轴能形成一个可靠闭环。</div>
        <div className="muted mini"><strong>约束：</strong>淡化时长必须短于每个 Shot；如果某个镜头过短，成片会明确拒绝并提示缩短时长或改回直接切换。</div>
        <div className="muted mini"><strong>后续：</strong>只有全局淡化稳定后，再考虑每个边界单独选转场、转场预览或更多 xfade 类型。</div>
      </div>
    </details>
  </section>;
}
