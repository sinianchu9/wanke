"use client";

import { useMemo, useState } from "react";
import { Box, Image as ImageIcon, Play, Sparkles, UserRound, WandSparkles } from "lucide-react";
import type { PublicSubjectCard } from "@/components/subject-library";
import type { StoredAsset } from "@/lib/types";

type CreationType = "product_ad" | "person_short" | "image_video";
type Platform = "douyin" | "xiaohongshu" | "youtube" | "landscape";

type Props = {
  assets: StoredAsset[];
  subjects: PublicSubjectCard[];
  onCreated: (projectId: string) => Promise<void> | void;
  onAdvanced: () => void;
};

const templates: Array<{ id: CreationType; label: string; desc: string; icon: any; demo: string }> = [
  { id: "product_ad", label: "产品广告", desc: "选产品，说一个卖点，系统自动拆成广告镜头。", icon: Box, demo: "黑色智能手环，突出循环震动提醒和简洁科技感。" },
  { id: "person_short", label: "人物短视频", desc: "选人物，说要做什么，系统优先保持人物一致。", icon: UserRound, demo: "让这个女孩走进咖啡店，在门口回头看镜头，轻松自然。" },
  { id: "image_video", label: "图片变视频", desc: "选一张图，说怎么动，不需要理解生成参数。", icon: ImageIcon, demo: "让画面有轻微风吹效果，镜头慢慢推近，主体不要变形。" },
];

export default function QuickCreationWizard({ assets, subjects, onCreated, onAdvanced }: Props) {
  const [type, setType] = useState<CreationType>("product_ad");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [platform, setPlatform] = useState<Platform>("douyin");
  const [duration, setDuration] = useState<5 | 10 | 15 | 30>(10);
  const [subjectId, setSubjectId] = useState("");
  const [imageAssetId, setImageAssetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);

  const availableSubjects = useMemo(() => subjects.filter(subject => type === "product_ad" ? subject.subjectType === "product" : subject.subjectType === "person"), [subjects, type]);
  const images = useMemo(() => assets.filter(asset => asset.mediaType === "image"), [assets]);
  const selectedTemplate = templates.find(item => item.id === type)!;
  const referenceReady = type === "image_video" ? Boolean(imageAssetId) : Boolean(subjectId);
  const ready = Boolean(goal.trim()) && referenceReady && !busy;

  function chooseType(next: CreationType) {
    setType(next);
    setSubjectId("");
    setImageAssetId("");
    setError("");
    setResult(null);
  }

  async function create() {
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
          subjectId: type === "image_video" ? null : subjectId,
          imageAssetId: type === "image_video" ? imageAssetId : null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "创建视频失败");
      setResult(body);
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
        <p>不用选模型，也不用理解复杂参数。选一种用途，告诉 Wanke 你想表达什么，系统会自动建立作品、规划镜头并开始生成。</p>
      </div>
      <button className="secondary" onClick={onAdvanced}><WandSparkles size={15}/>高级创作</button>
    </div>

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

      <div className="form-grid two" style={{marginTop:16}}>
        <div className="field">
          <span className="field-label">2. 主体是什么？</span>
          {type === "image_video" ? <select value={imageAssetId} onChange={event => setImageAssetId(event.target.value)}>
            <option value="">选择一张图片</option>
            {images.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
          </select> : <select value={subjectId} onChange={event => setSubjectId(event.target.value)}>
            <option value="">选择{type === "product_ad" ? "产品" : "人物"}</option>
            {availableSubjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>}
          {type !== "image_video" && !availableSubjects.length && <div className="muted mini">还没有保存过可复用的{type === "product_ad" ? "产品" : "人物"}。先到“主体库”添加一次，以后这里可以直接选择。</div>}
          {type === "image_video" && !images.length && <div className="muted mini">素材库还没有图片。先添加一张图片后即可使用这个入口。</div>}
        </div>

        <div className="field">
          <span className="field-label">作品名称<small>可选</small></span>
          <input value={name} onChange={event => setName(event.target.value)} placeholder={type === "product_ad" ? "例如：黑色手环夏季广告" : type === "person_short" ? "例如：咖啡店人物短片" : "例如：产品图动态展示"}/>
        </div>
      </div>

      <div className="field" style={{marginTop:16}}>
        <span className="field-label">3. 你想表达什么？<small>一句话就够</small></span>
        <textarea className="big-text" value={goal} onChange={event => setGoal(event.target.value)} placeholder={selectedTemplate.demo}/>
        <button type="button" className="link-button" onClick={() => setGoal(selectedTemplate.demo)}>填入演示内容</button>
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
        <button className="primary" disabled={!ready} onClick={create}><Play size={15}/>{busy ? "正在建立作品并提交…" : "开始创作"}</button>
        <span className="muted mini">常用设置已经自动处理，需要更细控制时再进入高级创作。</span>
      </div>
      {error && <div className="error-banner" style={{marginTop:12}}>{error}</div>}
      {result && <div className="notice" style={{marginTop:12}}><Sparkles size={16}/><span>已创建「{result.projectName}」：{result.submitted} 个镜头已提交{result.failed ? `，${result.failed} 个提交失败，可在作品里单独处理` : ""}。</span></div>}
    </section>

    <details className="advanced">
      <summary>简单模式替我做了哪些事？</summary>
      <div className="advanced-body">
        <div className="muted mini"><strong>产品广告：</strong>围绕产品自动规划开场、展示、卖点和收尾，并优先保持产品外观稳定。</div>
        <div className="muted mini"><strong>人物短视频：</strong>自动规划亮相、动作、互动和收尾，并优先保持人物身份一致。</div>
        <div className="muted mini"><strong>图片变视频：</strong>以原图为基础规划自然运动，不主动重新设计主体。</div>
        <div className="muted mini"><strong>不会替你乱选：</strong>如果一个镜头后来有多个好版本，生成最终视频前会让你明确选择。</div>
      </div>
    </details>
  </div>;
}
