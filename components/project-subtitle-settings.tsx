"use client";

import { useCallback, useEffect, useState } from "react";
import { Captions, Save } from "lucide-react";

type Settings = {
  projectId: string;
  enabled: boolean;
  content: string;
  language: string;
  title: string;
};

const EMPTY: Settings = { projectId: "", enabled: false, content: "", language: "zho", title: "字幕" };

export default function ProjectSubtitleSettings({ projectId }: { projectId: string }) {
  const [settings, setSettings] = useState<Settings>({ ...EMPTY, projectId });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/subtitles?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "读取字幕设置失败");
    setSettings({ ...EMPTY, ...(body.settings || {}), projectId });
  }, [projectId]);

  useEffect(() => {
    setSettings({ ...EMPTY, projectId }); setError(""); setNotice("");
    load().catch(error => setError(error instanceof Error ? error.message : String(error)));
  }, [load, projectId]);

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/projects/subtitles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存字幕设置失败");
      setSettings({ ...EMPTY, ...body.settings, projectId });
      setNotice(settings.enabled ? "字幕轨已保存；下一次生成成片时会封装进 MP4。" : "字幕轨设置已保存为关闭。历史成片不会被修改。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  function fillExample() {
    setSettings(current => ({
      ...current,
      enabled: true,
      content: "1\n00:00:00,500 --> 00:00:02,500\n这里填写第一句字幕\n\n2\n00:00:03,000 --> 00:00:05,500\n这里填写第二句字幕\n",
    }));
  }

  return <section className="panel" style={{marginBottom:18}}>
    <div className="panel-head">
      <div className="panel-title"><Captions size={17}/><div><h3>项目字幕轨</h3><p>使用标准 SRT 时间轴；成片时封装为 MP4 可选择字幕轨，不依赖服务器字体或 libass。</p></div></div>
      <label className="chip selected" style={{display:"flex",alignItems:"center",gap:6}}><input type="checkbox" checked={settings.enabled} onChange={event => setSettings(current => ({ ...current, enabled: event.target.checked }))}/>启用字幕</label>
    </div>

    <div className="form-grid two" style={{marginTop:12}}>
      <div className="field">
        <span className="field-label">字幕语言</span>
        <select value={settings.language} onChange={event => setSettings(current => ({ ...current, language: event.target.value }))}>
          <option value="zho">中文</option>
          <option value="eng">English</option>
          <option value="jpn">日本語</option>
          <option value="kor">한국어</option>
          <option value="spa">Español</option>
          <option value="fra">Français</option>
        </select>
      </div>
      <div className="field">
        <span className="field-label">字幕轨名称</span>
        <input value={settings.title} maxLength={60} onChange={event => setSettings(current => ({ ...current, title: event.target.value }))} placeholder="例如：简体中文"/>
      </div>
    </div>

    <div className="field" style={{marginTop:12}}>
      <span className="field-label">SRT 字幕内容<small>最多 1000 条 / 100000 字符</small></span>
      <textarea style={{minHeight:220,fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace"}} value={settings.content} onChange={event => setSettings(current => ({ ...current, content: event.target.value }))} placeholder={"1\n00:00:01,000 --> 00:00:03,000\n第一句字幕\n\n2\n00:00:03,500 --> 00:00:06,000\n第二句字幕"}/>
    </div>

    <div className="inline-actions" style={{marginTop:10}}>
      <button className="secondary" disabled={busy} onClick={save}><Save size={15}/>{busy ? "保存中…" : "保存字幕设置"}</button>
      {!settings.content.trim() && <button className="link-button" disabled={busy} onClick={fillExample}>填入 SRT 示例</button>}
    </div>
    {notice && <div className="notice" style={{marginTop:10}}>{notice}</div>}
    {error && <div className="error-banner" style={{marginTop:10}}>{error}</div>}

    <details className="advanced" style={{marginTop:10}}>
      <summary>为什么先做可选择字幕轨？</summary>
      <div className="advanced-body">
        <div className="muted mini"><strong>稳定：</strong>使用 MP4 `mov_text` 字幕，不需要服务器字体，也不要求 FFmpeg 编译 `libass`。</div>
        <div className="muted mini"><strong>可逆：</strong>字幕不会永久烧进画面，播放器支持时可以开关；以后做烧录字幕时仍可复用同一份 SRT。</div>
        <div className="muted mini"><strong>边界：</strong>这一阶段不做字体、字号、描边、逐字高亮或自动语音识别。那些属于后续字幕渲染层。</div>
      </div>
    </details>
  </section>;
}
