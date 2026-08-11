"use client";

import { useMemo, useState } from "react";
import { Box, Image as ImageIcon, Play, Sparkles, UserRound, WandSparkles } from "lucide-react";
import type { PublicSubjectCard } from "@/components/subject-library";
import type { StoredAsset } from "@/lib/types";

type CreationType = "product_ad" | "person_short" | "image_video";
type Platform = "douyin" | "xiaohongshu" | "youtube" | "landscape";
type LocalInput = { ref: string; name: string; size: number };

type Props = {
  assets: StoredAsset[];
  subjects: PublicSubjectCard[];
  onCreated: (projectId: string) => Promise<void> | void;
  onAdvanced: () => void;
  onSettings: () => void;
  generationReady: boolean | null;
  directAvailable: boolean;
};

const templates: Array<{ id: CreationType; label: string; desc: string; icon: any; demo: string }> = [
  { id: "product_ad", label: "产品广告", desc: "给一个产品和一个卖点，系统自动拆成广告镜头。", icon: Box, demo: "黑色智能手环，突出循环震动提醒和简洁科技感。" },
  { id: "person_short", label: "人物短视频", desc: "给一个人物和一句动作要求，系统优先保持人物一致。", icon: UserRound, demo: "让这个女孩走进咖啡店，在门口回头看镜头，轻松自然。" },
  { id: "image_video", label: "图片变视频", desc: "给一张图，说怎么动，不需要理解生成参数。", icon: ImageIcon, demo: "让画面有轻微风吹效果，镜头慢慢推近，主体不要变形。" },
];

export default function QuickCreationWizard({ assets, subjects, onCreated, onAdvanced, onSettings, generationReady, directAvailable }: Props) {
  const [type, setType] = useState<CreationType>("product_ad");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [platform, setPlatform] = useState<Platform>("douyin");
  const [duration, setDuration] = useState<5 | 10 | 15 | 30>(10);
  const [subjectId, setSubjectId] = useState("");
  const [imageAssetId, setImageAssetId] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [localInput, setLocalInput] = useState<LocalInput | null>(null);
  const [localUploading, setLocalUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);

  const availableSubjects = useMemo(() => subjects.filter(subject => type === "product_ad" ? subject.subjectType === "product" : subject.subjectType === "person"), [subjects, type]);
  const images = useMemo(() => assets.filter(asset => asset.mediaType === "image"), [assets]);
  const selectedTemplate = templates.find(item => item.id === type)!;
  const directReferenceReady = Boolean(localInput || imageAssetId || referenceUrl.trim());
  const referenceReady = type === "image_video" ? directReferenceReady : Boolean(subjectId) || directReferenceReady;
  const ready = generationReady === true && Boolean(goal.trim()) && referenceReady && !busy && !localUploading;

  function clearLocal() {
    if (localInput) discardLocalImage(localInput.ref);
    setLocalInput(null);
  }

  function chooseType(next: CreationType) {
    clearLocal();
    setType(next);
    setSubjectId("");
    setImageAssetId("");
    setReferenceUrl("");
    setError("");
    setResult(null);
  }

  function chooseSubject(value: string) {
    if (value) {
      clearLocal();
      setImageAssetId("");
      setReferenceUrl("");
    }
    setSubjectId(value);
  }

  function chooseAsset(value: string) {
    if (value) {
      clearLocal();
      setSubjectId("");
      setReferenceUrl("");
    }
    setImageAssetId(value);
  }

  function changeReferenceUrl(value: string) {
    if (value.trim()) {
      clearLocal();
      setSubjectId("");
      setImageAssetId("");
    }
    setReferenceUrl(value);
  }

  async function chooseLocal(file: File | undefined) {
    if (!file || !directAvailable) return;
    setLocalUploading(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/video-inputs", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "图片准备失败");
      if (localInput) discardLocalImage(localInput.ref);
      setLocalInput(body.input as LocalInput);
      setSubjectId(""); setImageAssetId(""); setReferenceUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLocalUploading(false); }
  }

  async function create() {
    if (generationReady !== true) {
      setError(generationReady === null ? "正在检查视频服务状态，请稍后再点击开始创作。" : "视频服务还没有配置好。完成一次设置后，就可以从这里直接开始做视频。");
      return;
    }
    if (!ready) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/projects/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          name: name.trim(),
          goal: goal.trim(),
          platform,
          totalDuration: duration,
          subjectId: type === "image_video" ? null : (subjectId || null),
          imageAssetId: imageAssetId || null,
          referenceUrl: referenceUrl.trim(),
          localInputRef: localInput?.ref || "",
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "创建视频失败");
      setResult(body);
      if (localInput) discardLocalImage(localInput.ref);
      setLocalInput(null);
      await onCreated(body.projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return <div className="content-stack">
    <div className="hero-card">
      <div>
        <div className="eyebrow">SIMPLE CREATION</div>
        <h2>一句话开始做视频</h2>
        <p>不用先整理素材库，也不用选模型。给 Wanke 一个主体或一张图片，再说一句想表达什么，系统会自动建立作品、规划镜头并开始生成。</p>
      </div>
      <button className="secondary" onClick={onAdvanced}><WandSparkles size={15}/>高级创作</button>
    </div>

    {generationReady === null && <div className="notice"><span>正在检查视频服务状态…</span></div>}
    {generationReady === false && <div className="error-banner warning">
      <span>第一次使用只差一步：先配置一个视频生成服务。配置完成后，这个页面就是日常创作入口。</span>
      <button className="secondary" onClick={onSettings}>去配置</button>
    </div>}

    <section className="panel">
      <div className="field">
        <span className="field-label">1. 你想做什么？</span>
        <div className="asset-chips">
          {templates.map(item => {
            const Icon = item.icon;
            return <button type="button" key={item.id} className={type === item.id ? "selected" : ""} onClick={() => chooseType(item.id)}><Icon size={15}/>{item.label}</button>;
          })}
        </div>
        <div className="muted mini">{selectedTemplate.desc}</div>
      </div>

      <div className="field" style={{marginTop:16}}>
        <span className="field-label">2. 主体是什么？<small>{type === "image_video" ? "给一张图片即可" : "可选常用主体，也可本次直接给一张图片"}</small></span>

        {type !== "image_video" && availableSubjects.length > 0 && <div style={{marginBottom:10}}>
          <select value={subjectId} onChange={event => chooseSubject(event.target.value)}>
            <option value="">— 选择保存过的{type === "product_ad" ? "产品" : "人物"}（可选）—</option>
            {availableSubjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
          <div className="muted mini">保存过的主体适合反复创作；第一次使用不需要先建立主体卡。</div>
        </div>}

        {!subjectId && <div className="panel" style={{marginTop:8}}>
          <div className="muted mini"><strong>本次直接使用一张图片</strong></div>
          <div className="form-grid two" style={{marginTop:8}}>
            <div className="field">
              <span className="field-label">从已有图片选择</span>
              <select value={imageAssetId} onChange={event => chooseAsset(event.target.value)}>
                <option value="">— 可选 —</option>
                {images.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="field-label">或粘贴图片直链</span>
              <input value={referenceUrl} onChange={event => changeReferenceUrl(event.target.value)} placeholder="https://...jpg / png / webp"/>
            </div>
          </div>

          {directAvailable && <div className="field" style={{marginTop:10}}>
            <span className="field-label">或直接选择电脑里的图片<small>JPG / PNG / WEBP，10MB 内</small></span>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={localUploading} onChange={event => { chooseLocal(event.target.files?.[0]); event.currentTarget.value = ""; }}/>
            {localUploading && <div className="muted mini">正在准备图片…</div>}
            {localInput && <div className="asset-chips"><button type="button" className="selected" onClick={clearLocal}>🖼️ {localInput.name} ×</button></div>}
          </div>}

          {!directAvailable && <div className="muted mini" style={{marginTop:8}}>当前视频服务不能直接读取电脑里的图片；可以从已有图片选择，或粘贴一条公网图片直链。</div>}
          {!images.length && !directAvailable && <div className="muted mini">素材库为空也不影响开始，只要粘贴一张公网图片直链即可。</div>}
        </div>}
      </div>

      <div className="form-grid two" style={{marginTop:16}}>
        <div className="field">
          <span className="field-label">作品名称<small>可选</small></span>
          <input value={name} onChange={event => setName(event.target.value)} placeholder={type === "product_ad" ? "例如：黑色手环夏季广告" : type === "person_short" ? "例如：咖啡店人物短片" : "例如：产品图动态展示"}/>
        </div>
        <div className="field">
          <span className="field-label">3. 你想表达什么？<small>一句话就够</small></span>
          <textarea value={goal} onChange={event => setGoal(event.target.value)} placeholder={selectedTemplate.demo}/>
          <button type="button" className="link-button" onClick={() => setGoal(selectedTemplate.demo)}>填入演示内容</button>
        </div>
      </div>

      <div className="form-grid two" style={{marginTop:16}}>
        <div className="field">
          <span className="field-label">4. 发到哪里？</span>
          <select value={platform} onChange={event => setPlatform(event.target.value as Platform)}>
            <option value="douyin">抖音 / 竖屏</option>
            <option value="xiaohongshu">小红书 / 竖屏</option>
            <option value="youtube">YouTube / 横屏</option>
            <option value="landscape">横屏通用</option>
          </select>
        </div>
        <div className="field">
          <span className="field-label">5. 大约多长？</span>
          <div className="asset-chips">{([5,10,15,30] as const).map(value => <button type="button" className={duration === value ? "selected" : ""} key={value} onClick={() => setDuration(value)}>{value} 秒</button>)}</div>
        </div>
      </div>

      <div className="notice" style={{marginTop:16}}><Sparkles size={16}/><span>系统会自动创建 {duration <= 5 ? 1 : duration <= 10 ? 2 : duration <= 15 ? 3 : 4} 个镜头并提交生成。每个镜头独立执行，一个失败不会拖垮其他镜头。</span></div>

      <div className="inline-actions" style={{marginTop:16}}>
        <button className="primary" disabled={!ready} onClick={create}><Play size={15}/>{busy ? "正在建立作品并提交…" : localUploading ? "正在准备图片…" : generationReady === null ? "正在检查服务…" : "开始创作"}</button>
        <span className="muted mini">常用设置已经自动处理，需要更细控制时再进入高级创作。</span>
      </div>
      {!referenceReady && <div className="muted mini" style={{marginTop:8}}>先选择一个主体，或直接提供一张图片。</div>}
      {error && <div className="error-banner" style={{marginTop:12}}>{error}</div>}
      {result && <div className="notice" style={{marginTop:12}}><Sparkles size={16}/><span>已创建「{result.projectName}」：{result.submitted} 个镜头已提交{result.failed ? `，${result.failed} 个提交失败，可以在“我的作品”里直接重试` : ""}。</span></div>}
    </section>

    <details className="advanced">
      <summary>简单模式替我做了哪些事？</summary>
      <div className="advanced-body">
        <div className="muted mini"><strong>产品广告：</strong>围绕产品自动规划开场、展示、卖点和收尾，并优先保持产品外观稳定。</div>
        <div className="muted mini"><strong>人物短视频：</strong>自动规划亮相、动作、互动和收尾，并优先保持人物身份一致。</div>
        <div className="muted mini"><strong>图片变视频：</strong>以原图为基础规划自然运动，不主动重新设计主体。</div>
        <div className="muted mini"><strong>主体库不是前置条件：</strong>保存过的主体用于长期复用；第一次做视频可以直接提供一张图片。</div>
        <div className="muted mini"><strong>不会替你乱选：</strong>如果一个镜头后来有多个好版本，最终成片前会让你明确选择。</div>
      </div>
    </details>
  </div>;
}

function discardLocalImage(ref: string) {
  fetch(`/api/video-inputs?ref=${encodeURIComponent(ref)}`, { method: "DELETE" }).catch(() => undefined);
}
