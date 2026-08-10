"use client";

import { useMemo, useState } from "react";
import { Image as ImageIcon, Images, Send, Sparkles, Waypoints } from "lucide-react";
import type { StoredAsset } from "@/lib/types";

type Mode = "text_to_video" | "image_to_video" | "first_last_frame" | "reference_to_video";
type Props = {
  assets: StoredAsset[];
  onSubmit: (kind: string, input: Record<string, unknown>, title?: string, parentJobId?: string) => Promise<any>;
  submitting: boolean;
};

const modeOptions: { id: Mode; label: string; desc: string; icon: any }[] = [
  { id: "text_to_video", label: "描述生成", desc: "只说你想看到什么，系统直接生成视频", icon: Sparkles },
  { id: "image_to_video", label: "让图片动起来", desc: "选择一张图片，自动保持主体并生成动作", icon: ImageIcon },
  { id: "first_last_frame", label: "首尾画面过渡", desc: "给开始和结束画面，自动生成中间过程", icon: Waypoints },
  { id: "reference_to_video", label: "保持人物 / 产品一致", desc: "给人物、产品或场景参考，自动保持一致性", icon: Images },
];

export default function SimpleVideoGenerator({ assets, onSubmit, submitting }: Props) {
  const [mode, setMode] = useState<Mode>("text_to_video");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<"720P" | "1080P">("1080P");
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [firstAssetId, setFirstAssetId] = useState("");
  const [lastAssetId, setLastAssetId] = useState("");
  const [firstUrl, setFirstUrl] = useState("");
  const [lastUrl, setLastUrl] = useState("");
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [referenceUrls, setReferenceUrls] = useState("");

  const imageAssets = useMemo(() => assets.filter(asset => asset.mediaType === "image"), [assets]);
  const referenceAssets = useMemo(() => assets.filter(asset => asset.mediaType === "image" || asset.mediaType === "video"), [assets]);

  function storedMedia(assetId: string) {
    const asset = assets.find(item => item.id === assetId);
    if (!asset) return null;
    return {
      type: asset.mediaType === "video" ? "video" : "image",
      url: asset.sourceUrl,
      mediaId: asset.providerMediaId || "",
    };
  }

  function manualMedia(url: string, forceImage = false) {
    const clean = url.trim();
    if (!clean) return null;
    let type: "image" | "video" = "image";
    if (!forceImage) {
      try {
        const pathname = new URL(clean).pathname.toLowerCase();
        if (pathname.endsWith(".mp4") || pathname.endsWith(".mov")) type = "video";
      } catch { /* schema will return a friendly URL error */ }
    }
    return { type, url: clean, mediaId: "" };
  }

  function buildMedias() {
    if (mode === "text_to_video") return [];
    if (mode === "image_to_video") {
      const media = storedMedia(firstAssetId) || manualMedia(firstUrl, true);
      return media ? [media] : [];
    }
    if (mode === "first_last_frame") {
      const first = storedMedia(firstAssetId) || manualMedia(firstUrl, true);
      const last = storedMedia(lastAssetId) || manualMedia(lastUrl, true);
      return [first, last].filter(Boolean);
    }
    const picked = referenceIds.map(storedMedia).filter(Boolean);
    const manual = referenceUrls.split(/\n/).map(value => manualMedia(value)).filter(Boolean);
    return [...picked, ...manual].slice(0, 5);
  }

  const medias = buildMedias();
  const hasVideoReference = mode === "reference_to_video" && medias.some((media: any) => media?.type === "video");
  const durationOptions = hasVideoReference ? ["5", "10"] : ["5", "10", "15"];
  const effectiveDuration = hasVideoReference && duration > 10 ? 10 : duration;
  const ready = Boolean(prompt.trim()) && (
    mode === "text_to_video" ||
    (mode === "image_to_video" && medias.length === 1) ||
    (mode === "first_last_frame" && medias.length === 2) ||
    (mode === "reference_to_video" && medias.length >= 1)
  );

  function changeMode(next: Mode) {
    setMode(next);
    setReferenceIds([]);
    setReferenceUrls("");
  }

  function toggleReference(id: string) {
    setReferenceIds(current => current.includes(id)
      ? current.filter(item => item !== id)
      : current.length >= 5 ? current : [...current, id]);
  }

  async function run() {
    if (!ready) return;
    await onSubmit("video_generation", {
      title,
      prompt: prompt.trim(),
      jobType: mode,
      medias,
      aspectRatio,
      duration: effectiveDuration,
      resolution,
      model: "happyhorse-1.1",
      n: 1,
    }, title || undefined);
  }

  return <div className="content-stack">
    <div className="hero-card">
      <div>
        <div className="eyebrow">AUTO VIDEO GENERATION</div>
        <h2>告诉我你要什么视频</h2>
        <p>不用选模型，也不用理解技术参数。Wanke 会根据素材和任务自动选择最合适的生成能力。</p>
      </div>
    </div>

    <section className="panel">
      <div className="form-stack">
        <div className="field">
          <span className="field-label">你准备怎么生成？<small>选最接近你手头素材的一项</small></span>
          <div className="asset-chips">
            {modeOptions.map(item => {
              const Icon = item.icon;
              return <button type="button" key={item.id} className={mode === item.id ? "selected" : ""} onClick={() => changeMode(item.id)} title={item.desc}>
                <Icon size={15} /> {item.label}
              </button>;
            })}
          </div>
          <div className="muted mini">{modeOptions.find(item => item.id === mode)?.desc}</div>
        </div>

        <div className="field">
          <span className="field-label">你想看到什么？<small>主体 + 动作 + 环境 + 镜头，大白话就可以</small></span>
          <textarea className="big-text" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="例如：一个穿黑色风衣的男人在东京雨夜街头向镜头走来，路面有霓虹倒影，镜头缓慢后退，电影感，人物动作自然。" />
        </div>

        {mode === "image_to_video" && <ImagePicker label="选择要动起来的图片" assets={imageAssets} assetId={firstAssetId} setAssetId={setFirstAssetId} url={firstUrl} setUrl={setFirstUrl} />}

        {mode === "first_last_frame" && <div className="form-grid two">
          <ImagePicker label="开始画面" assets={imageAssets} assetId={firstAssetId} setAssetId={setFirstAssetId} url={firstUrl} setUrl={setFirstUrl} compact />
          <ImagePicker label="结束画面" assets={imageAssets} assetId={lastAssetId} setAssetId={setLastAssetId} url={lastUrl} setUrl={setLastUrl} compact />
        </div>}

        {mode === "reference_to_video" && <div className="field">
          <span className="field-label">选择参考素材<small>人物、产品、场景都可以；最多 5 个，系统自动判断图片或视频参考</small></span>
          {referenceAssets.length > 0 && <div className="asset-chips">
            {referenceAssets.map(asset => <button type="button" key={asset.id} className={referenceIds.includes(asset.id) ? "selected" : ""} onClick={() => toggleReference(asset.id)}>
              {asset.mediaType === "video" ? "🎬" : "🖼️"} {asset.name}
            </button>)}
          </div>}
          <textarea value={referenceUrls} onChange={event => setReferenceUrls(event.target.value)} placeholder="也可以粘贴公网图片或 MP4/MOV 视频 URL，每行一个" />
          {hasVideoReference && <div className="muted mini">检测到视频参考：系统已自动使用支持视频参考的生成路线，并把最长时长限制为 10 秒。</div>}
        </div>}

        <details className="advanced">
          <summary>画面设置</summary>
          <div className="advanced-body">
            <div className="form-grid four">
              {(mode === "text_to_video" || mode === "reference_to_video") && <SimpleSelect label="画幅" value={aspectRatio} onChange={setAspectRatio} options={["16:9", "9:16", "1:1", "4:3", "3:4"]} />}
              <SimpleSelect label="时长" value={String(effectiveDuration)} onChange={value => setDuration(Number(value))} options={durationOptions} suffix="秒" />
              <SimpleSelect label="清晰度" value={resolution} onChange={value => setResolution(value as "720P" | "1080P")} options={["1080P", "720P"]} />
              <div className="field"><span className="field-label">任务名称<small>可不填</small></span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：新品广告主镜头" /></div>
            </div>
          </div>
        </details>

        <div className="stage-run">
          <button className="primary" disabled={submitting || !ready} onClick={run}>
            <Send size={16} />{submitting ? "正在提交…" : "开始生成"}
          </button>
          {!ready && <span className="muted mini">填写描述并补齐当前模式需要的素材后即可生成</span>}
          {ready && <span className="muted mini">模型、路由和兼容处理由系统自动完成</span>}
        </div>
      </div>
    </section>
  </div>;
}

function ImagePicker({ label, assets, assetId, setAssetId, url, setUrl, compact = false }: {
  label: string;
  assets: StoredAsset[];
  assetId: string;
  setAssetId: (value: string) => void;
  url: string;
  setUrl: (value: string) => void;
  compact?: boolean;
}) {
  return <div className="field">
    <span className="field-label">{label}<small>{compact ? "素材库或公网 URL" : "优先从素材库选，也可以粘贴公网图片 URL"}</small></span>
    <select value={assetId} onChange={event => setAssetId(event.target.value)}>
      <option value="">— 从素材库选择 —</option>
      {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
    </select>
    {!assetId && <input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://...jpg / png / webp" />}
  </div>;
}

function SimpleSelect({ label, value, onChange, options, suffix = "" }: { label: string; value: string; onChange: (value: string) => void; options: string[]; suffix?: string }) {
  return <div className="field">
    <span className="field-label">{label}</span>
    <select value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option} value={option}>{option}{suffix}</option>)}
    </select>
  </div>;
}
