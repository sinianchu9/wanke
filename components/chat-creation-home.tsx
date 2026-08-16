"use client";

import { useMemo, useState } from "react";
import {
  Box,
  ChevronDown,
  GitBranch,
  Image as ImageIcon,
  Library,
  Plus,
  Send,
  Settings2,
  Sparkles,
  UserRound,
  WandSparkles,
} from "lucide-react";
import type { PublicSubjectCard } from "@/components/subject-library";
import type { StoredAsset } from "@/lib/types";
import styles from "@/components/studio-shell.module.css";

type CreationType = "product_ad" | "person_short" | "image_video";
type Platform = "douyin" | "xiaohongshu" | "youtube" | "landscape";
type ProviderMode = "auto" | "modelstudio" | "yike";

type Props = {
  assets: StoredAsset[];
  subjects: PublicSubjectCard[];
  generationReady: boolean | null;
  defaultProviderMode: ProviderMode;
  onCreated: (projectId: string) => Promise<void> | void;
  onOpenAdvanced: () => void;
  onOpenQuick: () => void;
  onOpenAssets: () => void;
  onOpenSubjects: () => void;
  onOpenSettings: () => void;
  onOpenTool: (tool: "remake" | "clone" | "avatar" | "voice" | "storyboard" | "translation") => void;
};

const creationTypes: Array<{ id: CreationType; label: string; hint: string; icon: typeof Box }> = [
  { id: "product_ad", label: "产品广告", hint: "产品 + 卖点", icon: Box },
  { id: "person_short", label: "人物短片", hint: "人物 + 动作", icon: UserRound },
  { id: "image_video", label: "图片动起来", hint: "图片 + 运动描述", icon: ImageIcon },
];

const promptExamples: Record<CreationType, string> = {
  product_ad: "例如：为这款智能手环做一条 10 秒竖屏广告，突出循环震动提醒，画面简洁、有科技感。",
  person_short: "例如：让这个女孩走进咖啡店，在门口回头看镜头，动作自然，镜头轻微跟随。",
  image_video: "例如：主体保持不变，加入轻微风吹效果，镜头缓慢推近，整体自然真实。",
};

const providerLabels: Record<ProviderMode, string> = {
  auto: "自动路由",
  modelstudio: "强制百炼",
  yike: "强制万镜",
};

const toolShortcuts = [
  { id: "remake" as const, label: "高级复刻" },
  { id: "clone" as const, label: "快速复刻" },
  { id: "avatar" as const, label: "数字人口播" },
  { id: "voice" as const, label: "旁白成片" },
  { id: "storyboard" as const, label: "故事板" },
  { id: "translation" as const, label: "视频翻译" },
];

export default function ChatCreationHome({
  assets,
  subjects,
  generationReady,
  defaultProviderMode,
  onCreated,
  onOpenAdvanced,
  onOpenQuick,
  onOpenAssets,
  onOpenSubjects,
  onOpenSettings,
  onOpenTool,
}: Props) {
  const [type, setType] = useState<CreationType>("product_ad");
  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState<Platform>("douyin");
  const [duration, setDuration] = useState<5 | 10 | 15 | 30>(10);
  const [providerMode, setProviderMode] = useState<ProviderMode>(defaultProviderMode);
  const [subjectId, setSubjectId] = useState("");
  const [imageAssetId, setImageAssetId] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const images = useMemo(() => assets.filter(asset => asset.mediaType === "image"), [assets]);
  const compatibleSubjects = useMemo(
    () => subjects.filter(subject => type === "product_ad" ? subject.subjectType === "product" : subject.subjectType === "person"),
    [subjects, type],
  );
  const selectedSubject = subjects.find(subject => subject.id === subjectId) || null;
  const selectedImage = images.find(asset => asset.id === imageAssetId) || null;
  const hasReference = type === "image_video"
    ? Boolean(imageAssetId || referenceUrl.trim())
    : Boolean(subjectId || imageAssetId || referenceUrl.trim());
  const ready = generationReady === true && Boolean(prompt.trim()) && hasReference && !busy;

  function chooseType(next: CreationType) {
    setType(next);
    setSubjectId("");
    setImageAssetId("");
    setReferenceUrl("");
    setError("");
  }

  function chooseSubject(id: string) {
    setSubjectId(id);
    setImageAssetId("");
    setReferenceUrl("");
    setPlusOpen(false);
    setError("");
  }

  function chooseImage(id: string) {
    setImageAssetId(id);
    setSubjectId("");
    setReferenceUrl("");
    setPlusOpen(false);
    setError("");
  }

  function clearReference() {
    setSubjectId("");
    setImageAssetId("");
    setReferenceUrl("");
  }

  async function create() {
    if (busy) return;
    if (generationReady !== true) {
      setError(generationReady === null ? "正在检查视频服务，请稍后再试。" : "视频服务还没有配置完成，请先完成设置。");
      return;
    }
    if (!prompt.trim()) {
      setError("先用一句话描述你想生成的视频。");
      return;
    }
    if (!hasReference) {
      setError(type === "image_video" ? "点击 + 添加一张图片或图片链接。" : "点击 + 添加一个主体，或提供一张参考图片。");
      setPlusOpen(true);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/projects/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          name: "",
          goal: prompt.trim(),
          platform,
          totalDuration: duration,
          providerMode,
          subjectId: type === "image_video" ? null : (subjectId || null),
          imageAssetId: imageAssetId || null,
          referenceUrl: referenceUrl.trim(),
          localInputRef: "",
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "创建视频失败");
      setPrompt("");
      clearReference();
      await onCreated(body.projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function closePopovers() {
    setPlusOpen(false);
    setOptionsOpen(false);
    setProviderOpen(false);
  }

  return (
    <div className={styles.homeStage}>
      <div className={styles.homeIntro}>
        <div className={styles.homeMark}><Sparkles size={22} /></div>
        <h1>今天想做什么视频？</h1>
        <p>描述结果，不必先理解模型、任务类型和参数。Wanke 会把你的描述整理成作品并进入生成流程。</p>
      </div>

      <div className={styles.modeRow}>
        {creationTypes.map(item => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={`${styles.modeChip} ${type === item.id ? styles.modeChipActive : ""}`} onClick={() => chooseType(item.id)}>
              <Icon size={15} />
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          );
        })}
      </div>

      <div className={styles.composerCard}>
        {(selectedSubject || selectedImage || referenceUrl.trim()) && (
          <div className={styles.referenceRow}>
            <span className={styles.referenceToken}>
              {selectedSubject ? <UserRound size={14} /> : <ImageIcon size={14} />}
              {selectedSubject?.name || selectedImage?.name || "图片链接"}
              <button onClick={clearReference} aria-label="移除参考">×</button>
            </span>
          </div>
        )}

        <textarea
          className={styles.composerInput}
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              create();
            }
          }}
          placeholder={promptExamples[type]}
          rows={4}
        />

        <div className={styles.composerToolbar}>
          <div className={styles.composerToolsLeft}>
            <div className={styles.popoverAnchor}>
              <button className={styles.roundButton} onClick={() => { const next = !plusOpen; closePopovers(); setPlusOpen(next); }} aria-label="添加参考素材">
                <Plus size={19} />
              </button>
              {plusOpen && (
                <div className={`${styles.popover} ${styles.referencePopover}`}>
                  <div className={styles.popoverTitle}>添加参考</div>
                  {type !== "image_video" && (
                    <>
                      <div className={styles.popoverLabel}>{type === "product_ad" ? "产品主体" : "人物主体"}</div>
                      {compatibleSubjects.length ? (
                        <div className={styles.referenceList}>
                          {compatibleSubjects.slice(0, 6).map(subject => (
                            <button key={subject.id} onClick={() => chooseSubject(subject.id)}><UserRound size={15} /><span>{subject.name}</span></button>
                          ))}
                        </div>
                      ) : <div className={styles.popoverEmpty}>还没有可用主体</div>}
                      <button className={styles.popoverLink} onClick={onOpenSubjects}><UserRound size={15} />打开主体库</button>
                    </>
                  )}
                  <div className={styles.popoverLabel}>图片素材</div>
                  {images.length ? (
                    <div className={styles.referenceList}>
                      {images.slice(0, 6).map(asset => (
                        <button key={asset.id} onClick={() => chooseImage(asset.id)}><ImageIcon size={15} /><span>{asset.name}</span></button>
                      ))}
                    </div>
                  ) : <div className={styles.popoverEmpty}>素材库还没有图片</div>}
                  <button className={styles.popoverLink} onClick={onOpenAssets}><Library size={15} />打开素材库 / 上传素材</button>
                  <div className={styles.popoverLabel}>图片直链</div>
                  <input
                    className={styles.urlInput}
                    value={referenceUrl}
                    onChange={event => { setReferenceUrl(event.target.value); setSubjectId(""); setImageAssetId(""); }}
                    placeholder="https://...jpg / png / webp"
                  />
                  {referenceUrl.trim() && <button className={styles.popoverPrimary} onClick={() => setPlusOpen(false)}>使用这个链接</button>}
                </div>
              )}
            </div>

            <div className={styles.popoverAnchor}>
              <button className={styles.optionButton} onClick={() => { const next = !optionsOpen; closePopovers(); setOptionsOpen(next); }}>
                <Settings2 size={15} />
                {platform === "landscape" ? "横屏" : platform === "youtube" ? "YouTube" : platform === "xiaohongshu" ? "小红书" : "抖音"} · {duration} 秒
                <ChevronDown size={14} />
              </button>
              {optionsOpen && (
                <div className={`${styles.popover} ${styles.optionsPopover}`}>
                  <div className={styles.popoverTitle}>输出偏好</div>
                  <div className={styles.popoverLabel}>平台 / 画幅</div>
                  <div className={styles.choiceGrid}>
                    {([["douyin", "抖音竖屏"], ["xiaohongshu", "小红书"], ["youtube", "YouTube"], ["landscape", "横屏"]] as Array<[Platform, string]>).map(([id, label]) => (
                      <button key={id} className={platform === id ? styles.choiceActive : ""} onClick={() => setPlatform(id)}>{label}</button>
                    ))}
                  </div>
                  <div className={styles.popoverLabel}>总时长</div>
                  <div className={styles.choiceGrid}>
                    {([5, 10, 15, 30] as const).map(value => (
                      <button key={value} className={duration === value ? styles.choiceActive : ""} onClick={() => setDuration(value)}>{value} 秒</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={styles.composerToolsRight}>
            <div className={styles.popoverAnchor}>
              <button className={styles.providerButton} onClick={() => { const next = !providerOpen; closePopovers(); setProviderOpen(next); }}>
                <GitBranch size={15} />
                <span>{providerLabels[providerMode]}</span>
                <ChevronDown size={14} />
              </button>
              {providerOpen && (
                <div className={`${styles.popover} ${styles.providerPopover}`}>
                  <div className={styles.popoverTitle}>本次生成线路</div>
                  <button className={`${styles.providerChoice} ${providerMode === "auto" ? styles.providerChoiceActive : ""}`} onClick={() => { setProviderMode("auto"); setProviderOpen(false); }}>
                    <b>自动路由</b><small>优先百炼，不适配时按现有规则回退万镜一刻</small>
                  </button>
                  <button className={`${styles.providerChoice} ${providerMode === "modelstudio" ? styles.providerChoiceActive : ""}`} onClick={() => { setProviderMode("modelstudio"); setProviderOpen(false); }}>
                    <b>强制百炼</b><small>只走百炼；不满足条件时直接提示，不静默回退</small>
                  </button>
                  <button className={`${styles.providerChoice} ${providerMode === "yike" ? styles.providerChoiceActive : ""}`} onClick={() => { setProviderMode("yike"); setProviderOpen(false); }}>
                    <b>强制万镜一刻</b><small>本次基础视频固定使用万镜一刻兼容链路</small>
                  </button>
                  <div className={styles.popoverFootnote}>只影响本次创作，不修改全局默认设置。</div>
                </div>
              )}
            </div>
            <button className={styles.sendButton} disabled={busy} onClick={create} title={ready ? "开始创作" : "完善描述与参考后开始"}>
              {busy ? <span className={styles.sendBusy}>···</span> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      {error && <div className={styles.composerError}>{error}</div>}
      {generationReady === false && (
        <button className={styles.serviceWarning} onClick={onOpenSettings}>视频服务未配置，点击完成一次设置后即可直接创作。</button>
      )}
      <div className={styles.composerHint}>Enter 开始创作 · Shift + Enter 换行</div>

      <div className={styles.homeDivider}><span>更多创作方式</span></div>
      <div className={styles.homeActions}>
        <button onClick={onOpenQuick}><WandSparkles size={16} /><span><b>快速向导</b><small>分步选择素材和目标</small></span></button>
        <button onClick={onOpenAdvanced}><Settings2 size={16} /><span><b>高级创作</b><small>Recipe、模型与批量版本</small></span></button>
        {toolShortcuts.map(item => (
          <button key={item.id} onClick={() => onOpenTool(item.id)}><Sparkles size={16} /><span><b>{item.label}</b><small>打开专业工作流</small></span></button>
        ))}
      </div>
    </div>
  );
}
