"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  ChevronDown,
  GitBranch,
  Image as ImageIcon,
  Library,
  LoaderCircle,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Upload,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import type { PublicSubjectCard } from "@/components/subject-library";
import type { StoredAsset } from "@/lib/types";
import { fetchModelPricing, calculateCredits, getModelUnitRate, type ModelPricing } from "@/lib/pricing-client";
import styles from "@/components/studio-shell.module.css";

type CreationType = "text_video" | "product_ad" | "person_short" | "image_video";
type Platform = "douyin" | "xiaohongshu" | "youtube" | "landscape" | "square";
type ProviderMode = "auto" | "modelstudio" | "yike";
type LocalInput = { ref: string; name: string; size: number };
type QuickCreateResult = {
  projectId: string;
  projectName?: string;
  submitted?: number;
  failed?: number;
  providerMode?: ProviderMode;
};
type ModelOption = "auto" | "wan3.0" | "happyhorse-1.1";

export type ImageRef = {
  key: string;
  kind: "local" | "asset" | "url";
  name: string;
  localInput?: LocalInput;
  assetId?: string;
  url?: string;
};

type DraftState = {
  restored: boolean;
  type: CreationType;
  prompt: string;
  platform: Platform;
  duration: number;
  providerMode: ProviderMode;
  preferredModel: ModelOption;
  subjectId: string;
  imageRefs: ImageRef[];
  imageAssetId?: string;
  referenceUrl?: string;
  localInput?: LocalInput | null;
};

type Props = {
  assets: StoredAsset[];
  subjects: PublicSubjectCard[];
  generationReady: boolean | null;
  defaultProviderMode: ProviderMode;
  modelStudioAvailable: boolean;
  yikeAvailable: boolean;
  onAssetsChanged: () => Promise<void> | void;
  onCreated: (projectId: string, result?: QuickCreateResult) => Promise<void> | void;
  onOpenAdvanced: () => void;
  onOpenQuick: () => void;
  onOpenAssets: () => void;
  onOpenSubjects: () => void;
  onOpenSettings: () => void;
  onOpenTool: (tool: "remake" | "clone" | "avatar" | "voice" | "storyboard" | "translation") => void;
};

const CHAT_DRAFT_KEY = "wanke:chat-creation-draft:v1";

const creationTypes: Array<{ id: CreationType; label: string; hint: string; icon: typeof Box }> = [
  { id: "text_video", label: "文字生视频", hint: "只写描述，无需素材", icon: Sparkles },
  { id: "product_ad", label: "产品广告", hint: "产品 + 卖点", icon: Box },
  { id: "person_short", label: "人物短片", hint: "人物 + 动作", icon: UserRound },
  { id: "image_video", label: "图片动起来", hint: "图片 + 运动描述", icon: ImageIcon },
];

const promptExamples: Record<CreationType, string> = {
  text_video: "例如：东京雨夜，一辆黑色跑车穿过霓虹街道，低机位跟拍，电影感光影，镜头自然推进。",
  product_ad: "例如：为这款智能手环做一条广告，突出循环震动提醒，画面简洁、有科技感。",
  person_short: "例如：让这个女孩走进咖啡店，在门口回头看镜头，动作自然，镜头轻微跟随。",
  image_video: "例如：主体保持不变，加入轻微风吹效果，镜头缓慢推近，整体自然真实。",
};

const toolShortcuts = [
  { id: "remake" as const, label: "高级复刻", desc: "拆解脚本与独立渲染" },
  { id: "clone" as const, label: "快速复刻", desc: "同结构替换人像与产品" },
  { id: "avatar" as const, label: "数字人口播", desc: "真人驱动与讲解成片" },
  { id: "voice" as const, label: "旁白成片", desc: "素材自动拼接与解说" },
  { id: "storyboard" as const, label: "故事板", desc: "小说长文拆镜与合成" },
  { id: "translation" as const, label: "视频翻译", desc: "语音克隆翻译与字幕" },
];

export default function ChatCreationHome({
  assets,
  subjects,
  generationReady,
  defaultProviderMode,
  modelStudioAvailable,
  yikeAvailable,
  onAssetsChanged,
  onCreated,
  onOpenAdvanced,
  onOpenQuick,
  onOpenAssets,
  onOpenSubjects,
  onOpenSettings,
  onOpenTool,
}: Props) {
  const [draftSeed] = useState(() => readDraft(defaultProviderMode));
  const [type, setType] = useState<CreationType>(draftSeed.type);
  const [prompt, setPrompt] = useState(draftSeed.prompt);
  const [platform, setPlatform] = useState<Platform>(draftSeed.platform);
  const [duration, setDuration] = useState<number>(draftSeed.duration);
  const [preferredModel, setPreferredModel] = useState<ModelOption>(draftSeed.preferredModel || "auto");
  // Members never pick an upstream service; the platform routes each creation.
  const [providerMode] = useState<ProviderMode>("auto");
  const [subjectId, setSubjectId] = useState(draftSeed.subjectId);
  const [imageRefs, setImageRefs] = useState<ImageRef[]>(draftSeed.imageRefs || []);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [localUploading, setLocalUploading] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pricing, setPricing] = useState<ModelPricing | null>(null);
  const popoverOpen = plusOpen || optionsOpen;

  useEffect(() => {
    fetchModelPricing().then(setPricing).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!popoverOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPlusOpen(false);
      setOptionsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [popoverOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const draft: DraftState = {
      restored: true,
      type,
      prompt,
      platform,
      duration,
      preferredModel,
      providerMode,
      subjectId,
      imageRefs,
    };
    const meaningful = Boolean(
      prompt.trim() || subjectId || imageRefs.length > 0 ||
      type !== "text_video" || platform !== "douyin" || duration !== 5 || preferredModel !== "auto" || providerMode !== defaultProviderMode,
    );
    if (meaningful) window.sessionStorage.setItem(CHAT_DRAFT_KEY, JSON.stringify(draft));
    else window.sessionStorage.removeItem(CHAT_DRAFT_KEY);
  }, [type, prompt, platform, duration, preferredModel, providerMode, subjectId, imageRefs, defaultProviderMode]);

  useEffect(() => {
    if (subjectId && subjects.length > 0 && !subjects.some(subject => subject.id === subjectId)) setSubjectId("");
  }, [subjects, subjectId]);

  useEffect(() => {
    if (imageRefs.length > 0 && assets.length > 0) {
      setImageRefs(prev => prev.filter(ref => ref.kind !== "asset" || !ref.assetId || assets.some(a => a.id === ref.assetId)));
    }
  }, [assets, imageRefs.length]);

  const images = useMemo(() => assets.filter(asset => asset.mediaType === "image"), [assets]);
  const compatibleSubjects = useMemo(
    () => subjects.filter(subject => type === "product_ad" ? subject.subjectType === "product" : subject.subjectType === "person"),
    [subjects, type],
  );
  const selectedSubject = subjects.find(subject => subject.id === subjectId) || null;
  const maxDirectImages = (type === "person_short" || type === "product_ad") ? 2 : 1;
  const hasReference = type === "text_video"
    ? true
    : Boolean(subjectId || imageRefs.length > 0);
  const providerReady = providerMode === "modelstudio"
    ? modelStudioAvailable
    : providerMode === "yike"
      ? yikeAvailable
      : modelStudioAvailable || yikeAvailable;
  const interactionLocked = busy || localUploading;
  const ready = generationReady === true && providerReady && Boolean(prompt.trim()) && hasReference && !interactionLocked;
  const canChooseComputerImage = providerMode === "modelstudio"
    ? modelStudioAvailable
    : providerMode === "yike"
      ? yikeAvailable
      : modelStudioAvailable || yikeAvailable;
  const effectiveModel = preferredModel === "auto" ? (duration > 15 || duration < 3 ? "wan3.0" : "happyhorse-1.1") : preferredModel;
  const estimatedCredits = calculateCredits(pricing, effectiveModel, duration, "1080P");
  const unitRate = getModelUnitRate(pricing, effectiveModel);

  function clearAllLocalInputs() {
    for (const item of imageRefs) {
      if (item.kind === "local" && item.localInput?.ref) {
        discardLocalImage(item.localInput.ref);
      }
    }
  }

  function chooseType(next: CreationType) {
    if (interactionLocked) return;
    closePopovers();
    clearAllLocalInputs();
    setType(next);
    setSubjectId("");
    setImageRefs([]);
    setReferenceUrl("");
    setError("");
  }

  function chooseSubject(id: string) {
    if (interactionLocked) return;
    clearAllLocalInputs();
    setSubjectId(id);
    setImageRefs([]);
    setReferenceUrl("");
    setPlusOpen(false);
    setError("");
  }

  function clearSubject() {
    setSubjectId("");
    setError("");
  }

  function removeImageRef(key: string) {
    if (interactionLocked) return;
    const target = imageRefs.find(r => r.key === key);
    if (target?.kind === "local" && target.localInput?.ref) {
      discardLocalImage(target.localInput.ref);
    }
    setImageRefs(prev => prev.filter(r => r.key !== key));
    setError("");
  }

  function chooseImage(asset: StoredAsset) {
    if (interactionLocked) return;
    if (imageRefs.some(r => r.kind === "asset" && r.assetId === asset.id)) {
      setError(`“${asset.name}”已经在参考列表中。`);
      return;
    }
    setSubjectId("");
    setError("");
    const newRef: ImageRef = {
      key: `asset-${asset.id}-${Date.now()}`,
      kind: "asset",
      name: asset.name,
      assetId: asset.id,
    };
    if (imageRefs.length >= maxDirectImages) {
      if (maxDirectImages === 1) {
        clearAllLocalInputs();
        setImageRefs([newRef]);
      } else {
        setError(`当前模式最多支持 ${maxDirectImages} 张参考图片，请先点击 × 移除不需要的图片。`);
        return;
      }
    } else {
      setImageRefs(prev => [...prev, newRef]);
    }
    setPlusOpen(false);
  }

  function addUrlReference() {
    if (interactionLocked) return;
    const url = referenceUrl.trim();
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("必须是 HTTP/HTTPS 公网地址");
    } catch {
      setError("图片链接无效，请使用可公开访问的 HTTP/HTTPS 图片直链。");
      return;
    }
    setSubjectId("");
    setError("");
    const fileName = url.split("/").pop()?.split("?")[0] || "图片链接";
    const newRef: ImageRef = {
      key: `url-${Date.now()}`,
      kind: "url",
      name: fileName.length > 20 ? `${fileName.slice(0, 18)}…` : fileName,
      url,
    };
    if (imageRefs.length >= maxDirectImages) {
      if (maxDirectImages === 1) {
        clearAllLocalInputs();
        setImageRefs([newRef]);
      } else {
        setError(`当前模式最多支持 ${maxDirectImages} 张参考图片，请先点击 × 移除不需要的图片。`);
        return;
      }
    } else {
      setImageRefs(prev => [...prev, newRef]);
    }
    setReferenceUrl("");
    setPlusOpen(false);
  }

  function clearReference() {
    clearAllLocalInputs();
    setSubjectId("");
    setImageRefs([]);
    setReferenceUrl("");
    setError("");
  }

  async function chooseLocal(file: File | undefined) {
    if (!file || interactionLocked) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("请选择 JPG、PNG 或 WEBP 图片。");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("图片不能超过 10 MB。");
      return;
    }

    if (!modelStudioAvailable && !yikeAvailable) {
      setError("当前创作服务暂时不可用，请稍后再试。");
      return;
    }

    if (imageRefs.length >= maxDirectImages && maxDirectImages > 1) {
      setError(`当前模式最多支持 ${maxDirectImages} 张参考图片，请先点击 × 移除不需要的图片。`);
      return;
    }

    setLocalUploading(true);
    setError("");
    try {
      const useDirectInput = providerMode !== "yike" && modelStudioAvailable;
      if (useDirectInput) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/video-inputs", { method: "POST", body: form });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "图片准备失败");
        const newRef: ImageRef = {
          key: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: "local",
          name: file.name,
          localInput: body.input as LocalInput,
        };
        setSubjectId("");
        if (maxDirectImages === 1) {
          clearAllLocalInputs();
          setImageRefs([newRef]);
        } else {
          setImageRefs(prev => [...prev, newRef]);
        }
        setPlusOpen(false);
        return;
      }

      const asset = await uploadImageToExtendedLibrary(file);
      const newRef: ImageRef = {
        key: `asset-${asset.id}-${Date.now()}`,
        kind: "asset",
        name: file.name,
        assetId: asset.id,
      };
      setSubjectId("");
      if (maxDirectImages === 1) {
        clearAllLocalInputs();
        setImageRefs([newRef]);
      } else {
        setImageRefs(prev => [...prev, newRef]);
      }
      setPlusOpen(false);
      await onAssetsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocalUploading(false);
    }
  }

  async function uploadImageToExtendedLibrary(file: File) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const credentialResponse = await fetch("/api/assets/upload-credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileExt: ext }),
    });
    const credential = await credentialResponse.json();
    if (!credentialResponse.ok) throw new Error(credential.error || "图片上传准备失败");

    const address = decodeJson(credential.uploadAddress);
    const auth = decodeJson(credential.uploadAuth);
    if (!address.Bucket || !address.FileName || !address.Endpoint || !auth.AccessKeyId || !auth.AccessKeySecret || !auth.SecurityToken) {
      throw new Error("图片上传凭证不完整，请检查视频服务设置。");
    }

    const { default: OSS } = await import("ali-oss");
    const client = new OSS({
      endpoint: address.Endpoint,
      bucket: address.Bucket,
      accessKeyId: auth.AccessKeyId,
      accessKeySecret: auth.AccessKeySecret,
      stsToken: auth.SecurityToken,
      secure: true,
    });
    await client.multipartUpload(address.FileName, file, {
      parallel: 3,
      partSize: Math.max(1024 * 1024, Math.min(5 * 1024 * 1024, Math.ceil(file.size / 50))),
    });

    const registerResponse = await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, sourceUrl: credential.fileURL, mediaType: "image" }),
    });
    const registered = await registerResponse.json();
    if (!registerResponse.ok || !registered.asset?.id) throw new Error(registered.error || "图片保存失败");
    return registered.asset as StoredAsset;
  }

  function providerError() {
    if (!modelStudioAvailable && !yikeAvailable) return "当前创作服务暂时不可用，请稍后再试。";
    return "";
  }

  async function create() {
    if (interactionLocked) return;
    if (generationReady !== true) {
      setError(generationReady === null ? "正在确认创作服务，请稍后再试。" : "当前创作服务暂时不可用，请稍后再试。");
      return;
    }
    const routeError = providerError();
    if (routeError) {
      setError(routeError);
      return;
    }
    if (!prompt.trim()) {
      setError("先用一句话描述你想生成的视频。");
      return;
    }
    if (!hasReference) {
      setError(type === "image_video" ? "点击 + 添加一张图片或图片链接。" : "点击 + 添加一个主体，或提供 1~2 张参考图片。");
      setPlusOpen(true);
      return;
    }

    const localInputRefs = imageRefs.filter(i => i.kind === "local" && i.localInput).map(i => i.localInput!.ref);
    const imageAssetIds = imageRefs.filter(i => i.kind === "asset" && i.assetId).map(i => i.assetId!);
    const referenceUrls = imageRefs.filter(i => i.kind === "url" && i.url).map(i => i.url!);

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
          preferredModel,
          providerMode,
          subjectId: type === "text_video" || type === "image_video" ? null : (subjectId || null),
          imageAssetId: imageAssetIds[0] || null,
          imageAssetIds,
          referenceUrl: referenceUrls[0] || "",
          referenceUrls,
          localInputRef: localInputRefs[0] || "",
          localInputRefs,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "创建视频失败");
      window.sessionStorage.removeItem(CHAT_DRAFT_KEY);
      setPrompt("");
      clearReference();
      await onCreated(body.projectId, body as QuickCreateResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function closePopovers() {
    setPlusOpen(false);
    setOptionsOpen(false);
  }

  return (
    <div className={styles.homeStage}>
      <div className={styles.homeIntro}>
        <div className={styles.homeMark}><Sparkles size={22} /></div>
        <h1>今天想做什么视频？</h1>
        <p>描述结果，不必先理解模型和任务参数。可以直接用文字生成视频，也可以添加主体或参考图片；Wanke 会自动建立作品、规划镜头并提交生成。</p>
      </div>

      <div className={styles.modeRow}>
        {creationTypes.map(item => {
          const Icon = item.icon;
          return (
            <button disabled={interactionLocked} key={item.id} className={`${styles.modeChip} ${type === item.id ? styles.modeChipActive : ""}`} onClick={() => chooseType(item.id)}>
              <Icon size={15} />
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          );
        })}
      </div>

      <div
        className={styles.composerCard}
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault();
          if (type === "text_video") {
            setError("纯文字生成不需要素材，直接描述你想生成的画面即可。");
            return;
          }
          chooseLocal(event.dataTransfer.files?.[0]);
        }}
      >
        {selectedSubject && (
          <div className={styles.referenceRow}>
            <span className={styles.referenceToken}>
              <UserRound size={14} />
              <span>{selectedSubject.name}</span>
              <button disabled={interactionLocked} onClick={clearSubject} aria-label="移除主体">×</button>
            </span>
          </div>
        )}
        {!selectedSubject && imageRefs.length > 0 && (
          <div className={styles.referenceRow}>
            {imageRefs.map((item, index) => (
              <span key={item.key} className={styles.referenceToken}>
                <ImageIcon size={14} />
                <span>{imageRefs.length > 1 ? `参考图 ${index + 1}: ${item.name}` : item.name}</span>
                <button disabled={interactionLocked} onClick={() => removeImageRef(item.key)} aria-label="移除参考">×</button>
              </span>
            ))}
            {imageRefs.length < maxDirectImages && !interactionLocked && (
              <button
                type="button"
                className={styles.addMoreToken}
                onClick={() => { closePopovers(); setPlusOpen(true); }}
                title="继续添加参考图片"
              >
                <Plus size={12} />
                <span>添加第 2 张 (可选)</span>
              </button>
            )}
          </div>
        )}

        <textarea
          className={styles.composerInput}
          value={prompt}
          disabled={interactionLocked}
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

        {popoverOpen && <button className={styles.popoverBackdrop} aria-label="关闭当前选项" onClick={closePopovers} />}

        <div className={styles.composerToolbar}>
          <div className={styles.composerToolsLeft}>
            {type !== "text_video" && <div className={styles.popoverAnchor}>
              <button disabled={interactionLocked} className={styles.roundButton} onClick={() => { const next = !plusOpen; closePopovers(); setPlusOpen(next); }} aria-label="添加参考素材">
                {localUploading ? <LoaderCircle className={styles.spin} size={18} /> : <Plus size={19} />}
              </button>
              {plusOpen && (
                <div className={`${styles.popover} ${styles.referencePopover}`}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>
                      添加参考 {maxDirectImages > 1 ? `(已添加 ${imageRefs.length}/${maxDirectImages})` : ""}
                    </div>
                    <button className={styles.popoverClose} onClick={closePopovers} aria-label="关闭添加参考"><X size={15} /></button>
                  </div>

                  {imageRefs.length >= maxDirectImages && maxDirectImages > 1 && (
                    <div className={styles.popoverEmpty} style={{ color: "#4338ca", background: "rgba(99, 102, 241, 0.08)", padding: "6px 8px", borderRadius: "6px", marginBottom: "8px", fontSize: "11px" }}>
                      已添加 2 张参考图（已达上限）。可直接描述并开始创作，或点击上方 × 移除后更换。
                    </div>
                  )}

                  <div className={styles.popoverLabel}>本机图片</div>
                  {canChooseComputerImage ? (
                    <label className={styles.filePicker}>
                      <Upload size={15} />
                      <span><b>从电脑选择图片</b><small>JPG / PNG / WEBP，10 MB 内</small></span>
                      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={interactionLocked} onChange={event => { chooseLocal(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                    </label>
                  ) : (
                    <div className={styles.popoverLink} aria-disabled="true"><Settings2 size={15} />当前创作服务暂不支持本机图片，请稍后再试</div>
                  )}

                  {(type === "product_ad" || type === "person_short") && (
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

                  <div className={styles.popoverLabel}>素材库图片</div>
                  {images.length ? (
                    <div className={styles.referenceList}>
                      {images.slice(0, 6).map(asset => {
                        const added = imageRefs.some(r => r.kind === "asset" && r.assetId === asset.id);
                        return (
                          <button key={asset.id} onClick={() => chooseImage(asset)} style={added ? { opacity: 0.6 } : undefined}>
                            <ImageIcon size={15} />
                            <span>{asset.name}{added ? " (已添加)" : ""}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : <div className={styles.popoverEmpty}>素材库还没有图片</div>}
                  <button className={styles.popoverLink} onClick={onOpenAssets}><Library size={15} />打开素材库</button>

                  <div className={styles.popoverLabel}>图片直链</div>
                  <input
                    className={styles.urlInput}
                    value={referenceUrl}
                    onChange={event => setReferenceUrl(event.target.value)}
                    placeholder="https://...jpg / png / webp"
                  />
                  {referenceUrl.trim() && <button className={styles.popoverPrimary} onClick={addUrlReference}>使用这个链接</button>}
                </div>
              )}
            </div>}

            <div className={styles.popoverAnchor}>
              <button disabled={interactionLocked} className={styles.optionButton} onClick={() => { const next = !optionsOpen; closePopovers(); setOptionsOpen(next); }}>
                <Settings2 size={15} />
                {platform === "landscape" ? "通用横屏 (16:9)" : platform === "youtube" ? "YouTube (16:9)" : platform === "xiaohongshu" ? "小红书 (3:4)" : platform === "square" ? "方形 (1:1)" : "抖音竖屏 (9:16)"} · {duration} 秒 ({estimatedCredits}积分) · {preferredModel === "wan3.0" ? "Wan 3.0" : preferredModel === "happyhorse-1.1" ? "HappyHorse" : "智能模型"}
                <ChevronDown size={14} />
              </button>
              {optionsOpen && (
                <div className={`${styles.popover} ${styles.optionsPopover}`}>
                  <div className={styles.popoverHeader}>
                    <div className={styles.popoverTitle}>输出偏好</div>
                    <button className={styles.popoverClose} onClick={closePopovers} aria-label="关闭输出偏好"><X size={15} /></button>
                  </div>
                  <div className={styles.popoverLabel}>AI 视频模型</div>
                  <div className={styles.choiceGrid} style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                    {([
                      ["auto", "智能推荐", "根据时长协同"],
                      ["wan3.0", "Wan 3.0", "单镜头2–30s"],
                      ["happyhorse-1.1", "HappyHorse", "运镜质感/分段"],
                    ] as const).map(([id, label, hint]) => (
                      <button
                        key={id}
                        type="button"
                        className={preferredModel === id ? styles.choiceActive : ""}
                        onClick={() => setPreferredModel(id as ModelOption)}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "44px", padding: "4px" }}
                      >
                        <span style={{ fontWeight: 650, fontSize: "12px" }}>{label}</span>
                        <span style={{ fontSize: "9px", opacity: 0.75 }}>{hint}</span>
                      </button>
                    ))}
                  </div>
                  <div className={styles.popoverLabel} style={{ marginTop: "10px" }}>平台 / 画幅</div>
                  <div className={styles.choiceGrid}>
                    {([
                      ["douyin", "抖音竖屏", "9:16"],
                      ["xiaohongshu", "小红书", "3:4"],
                      ["square", "方形/朋友圈", "1:1"],
                      ["youtube", "YouTube", "16:9"],
                      ["landscape", "通用横屏", "16:9"],
                    ] as const).map(([id, label, ratio]) => (
                      <button
                        key={id}
                        className={platform === id ? styles.choiceActive : ""}
                        onClick={() => setPlatform(id as Platform)}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "44px", padding: "4px" }}
                      >
                        <span style={{ fontWeight: 650 }}>{label}</span>
                        <span style={{ fontSize: "9px", opacity: 0.75 }}>{ratio}</span>
                      </button>
                    ))}
                  </div>
                  <div className={styles.popoverLabel} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                    <span>总时长（滑动调节）</span>
                    <span style={{ color: "#4338CA", fontWeight: 750, fontSize: "12px" }}>{duration} 秒</span>
                  </div>
                  <div className={styles.sliderBox}>
                    <input
                      type="range"
                      min={2}
                      max={30}
                      step={1}
                      value={duration}
                      onChange={e => setDuration(Number(e.target.value))}
                      className={styles.rangeSlider}
                      aria-label="生成视频总时长滑动条"
                    />
                    <div className={styles.sliderTicks}>
                      <span>2s</span>
                      <span>5s</span>
                      <span>10s</span>
                      <span>15s</span>
                      <span>20s</span>
                      <span>25s</span>
                      <span>30s</span>
                    </div>
                    <div className={styles.sliderTip}>
                      {preferredModel === "wan3.0" ? (
                        <span style={{ color: "#b45309" }}>
                          ⚡ <strong>Wan 3.0 原生直出</strong>：单镜头完整支持 2–30 秒超长原生生成
                        </span>
                      ) : preferredModel === "happyhorse-1.1" ? (
                        duration <= 15 ? (
                          <span style={{ color: "#4338ca" }}>
                            ✨ <strong>HappyHorse 1.1 质感模型</strong>：3–15 秒高动态自然运镜，单镜头直出
                          </span>
                        ) : (
                          <span style={{ color: "#b45309" }}>
                            🎬 <strong>HappyHorse 1.1 多镜头分段</strong>：总时长超过 15 秒（上限15s），自动智能多镜头切分并淡入淡出转场，确保平稳成片（不能单镜头直出）
                          </span>
                        )
                      ) : duration > 15 || duration < 3 ? (
                        <span style={{ color: "#b45309" }}>
                          ⚡ <strong>Wan 3.0 超长通道</strong>：已启用单次 2–30 秒原生生成大模型
                        </span>
                      ) : (
                        <span style={{ color: "#4338ca" }}>
                          ✨ <strong>智能自适应双通道</strong>：HappyHorse 1.1 / Wan 3.0 质感协同调度
                        </span>
                      )}
                    </div>
                    <div style={{ marginTop: "10px", padding: "6px 10px", background: "rgba(99, 102, 241, 0.08)", borderRadius: "6px", border: "1px solid rgba(99, 102, 241, 0.2)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
                      <span>预计消耗：<strong style={{ color: "#4338CA" }}>{estimatedCredits} 积分</strong></span>
                      <span style={{ color: "#64748B" }}>{unitRate} 积分/秒 · 按模型以秒计费</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={styles.composerToolsRight}>
            <button
              className={styles.sendButton}
              disabled={interactionLocked}
              onClick={create}
              title={ready ? "开始创作" : type === "text_video" ? "先写下你想要的视频内容" : "补充描述与参考素材后开始"}
            >
              {busy ? <LoaderCircle className={styles.spin} size={17} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      {error && <div className={styles.composerError}>{error}</div>}
      {generationReady === false && (
        <button className={styles.serviceWarning} onClick={onOpenSettings}>视频服务未配置，点击完成一次设置后即可直接创作。</button>
      )}
      <div className={styles.composerHint}>{type === "text_video" ? "纯文字生成：无需素材，直接描述主体、环境、动作和镜头 · Enter 开始创作" : "Enter 开始创作 · Shift + Enter 换行 · 图片也可以直接拖进输入框"}</div>

      <div className={styles.homeDivider}><span>更多创作方式</span></div>
      <div className={styles.homeActions}>
        <button onClick={onOpenQuick}><WandSparkles size={16} /><span><b>快速向导</b><small>分步选择素材和目标</small></span></button>
        <button onClick={onOpenAdvanced}><Settings2 size={16} /><span><b>高级创作</b><small>Recipe、模型与批量版本</small></span></button>
        {toolShortcuts.map(item => (
          <button key={item.id} onClick={() => onOpenTool(item.id)}><Sparkles size={16} /><span><b>{item.label}</b><small>{item.desc}</small></span></button>
        ))}
      </div>
    </div>
  );
}

function readDraft(defaultProviderMode: ProviderMode): DraftState {
  const fallback: DraftState = {
    restored: false,
    type: "text_video",
    prompt: "",
    platform: "douyin",
    duration: 5,
    preferredModel: "auto",
    providerMode: defaultProviderMode,
    subjectId: "",
    imageRefs: [],
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(CHAT_DRAFT_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Partial<DraftState>;
    const type = value.type === "text_video" || value.type === "product_ad" || value.type === "person_short" || value.type === "image_video" ? value.type : fallback.type;
    const platform = value.platform === "douyin" || value.platform === "xiaohongshu" || value.platform === "youtube" || value.platform === "landscape" || value.platform === "square" ? value.platform : fallback.platform;
    const duration = typeof value.duration === "number" && value.duration >= 2 && value.duration <= 30 ? Math.round(value.duration) : fallback.duration;
    const preferredModel: ModelOption = value.preferredModel === "wan3.0" || value.preferredModel === "happyhorse-1.1" ? value.preferredModel : "auto";
    const providerMode = value.providerMode === "auto" || value.providerMode === "modelstudio" || value.providerMode === "yike" ? value.providerMode : defaultProviderMode;
    
    let imageRefs: ImageRef[] = [];
    if (Array.isArray(value.imageRefs)) {
      imageRefs = value.imageRefs.filter(item => item && typeof item.name === "string");
    } else {
      if (value.localInput && typeof value.localInput.ref === "string" && value.localInput.ref.startsWith("wanke-input://")) {
        imageRefs.push({
          key: "local-" + Date.now(),
          kind: "local",
          name: value.localInput.name || "本地图片",
          localInput: value.localInput,
        });
      } else if (value.imageAssetId) {
        imageRefs.push({
          key: "asset-" + value.imageAssetId,
          kind: "asset",
          name: "素材图片",
          assetId: value.imageAssetId,
        });
      } else if (value.referenceUrl && value.referenceUrl.trim()) {
        imageRefs.push({
          key: "url-" + Date.now(),
          kind: "url",
          name: "图片链接",
          url: value.referenceUrl.trim(),
        });
      }
    }

    return {
      restored: true,
      type,
      prompt: String(value.prompt || ""),
      platform,
      duration,
      preferredModel,
      providerMode,
      subjectId: String(value.subjectId || ""),
      imageRefs,
    };
  } catch {
    window.sessionStorage.removeItem(CHAT_DRAFT_KEY);
    return fallback;
  }
}

function discardLocalImage(ref: string) {
  fetch(`/api/video-inputs?ref=${encodeURIComponent(ref)}`, { method: "DELETE" }).catch(() => undefined);
}

function decodeJson(value: string) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
