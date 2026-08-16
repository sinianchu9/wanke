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
} from "lucide-react";
import type { PublicSubjectCard } from "@/components/subject-library";
import type { StoredAsset } from "@/lib/types";
import styles from "@/components/studio-shell.module.css";

type CreationType = "product_ad" | "person_short" | "image_video";
type Platform = "douyin" | "xiaohongshu" | "youtube" | "landscape";
type ProviderMode = "auto" | "modelstudio" | "yike";
type LocalInput = { ref: string; name: string; size: number };
type QuickCreateResult = {
  projectId: string;
  projectName?: string;
  submitted?: number;
  failed?: number;
  providerMode?: ProviderMode;
};
type DraftState = {
  restored: boolean;
  type: CreationType;
  prompt: string;
  platform: Platform;
  duration: 5 | 10 | 15 | 30;
  providerMode: ProviderMode;
  subjectId: string;
  imageAssetId: string;
  referenceUrl: string;
  localInput: LocalInput | null;
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
  yike: "强制万镜一刻",
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
  const [duration, setDuration] = useState<5 | 10 | 15 | 30>(draftSeed.duration);
  const [providerMode, setProviderMode] = useState<ProviderMode>(draftSeed.providerMode);
  const [providerTouched, setProviderTouched] = useState(draftSeed.restored);
  const [subjectId, setSubjectId] = useState(draftSeed.subjectId);
  const [imageAssetId, setImageAssetId] = useState(draftSeed.imageAssetId);
  const [referenceUrl, setReferenceUrl] = useState(draftSeed.referenceUrl);
  const [localInput, setLocalInput] = useState<LocalInput | null>(draftSeed.localInput);
  const [localUploading, setLocalUploading] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!providerTouched && !draftSeed.restored) setProviderMode(defaultProviderMode);
  }, [defaultProviderMode, draftSeed.restored, providerTouched]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const draft = {
      type,
      prompt,
      platform,
      duration,
      providerMode,
      subjectId,
      imageAssetId,
      referenceUrl,
      localInput,
    };
    const meaningful = Boolean(
      prompt.trim() || subjectId || imageAssetId || referenceUrl.trim() || localInput ||
      type !== "product_ad" || platform !== "douyin" || duration !== 10 || providerMode !== defaultProviderMode,
    );
    if (meaningful) window.sessionStorage.setItem(CHAT_DRAFT_KEY, JSON.stringify(draft));
    else window.sessionStorage.removeItem(CHAT_DRAFT_KEY);
  }, [type, prompt, platform, duration, providerMode, subjectId, imageAssetId, referenceUrl, localInput, defaultProviderMode]);

  useEffect(() => {
    if (subjectId && subjects.length > 0 && !subjects.some(subject => subject.id === subjectId)) setSubjectId("");
  }, [subjects, subjectId]);

  useEffect(() => {
    if (imageAssetId && assets.length > 0 && !assets.some(asset => asset.id === imageAssetId)) setImageAssetId("");
  }, [assets, imageAssetId]);

  const images = useMemo(() => assets.filter(asset => asset.mediaType === "image"), [assets]);
  const compatibleSubjects = useMemo(
    () => subjects.filter(subject => type === "product_ad" ? subject.subjectType === "product" : subject.subjectType === "person"),
    [subjects, type],
  );
  const selectedSubject = subjects.find(subject => subject.id === subjectId) || null;
  const selectedImage = images.find(asset => asset.id === imageAssetId) || null;
  const hasReference = type === "image_video"
    ? Boolean(localInput || imageAssetId || referenceUrl.trim())
    : Boolean(subjectId || localInput || imageAssetId || referenceUrl.trim());
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
  const referenceLabel = selectedSubject?.name || selectedImage?.name || localInput?.name || (referenceUrl.trim() ? "图片链接" : imageAssetId ? "已上传图片" : "");

  function clearLocal() {
    if (localInput) discardLocalImage(localInput.ref);
    setLocalInput(null);
  }

  function chooseType(next: CreationType) {
    if (interactionLocked) return;
    clearLocal();
    setType(next);
    setSubjectId("");
    setImageAssetId("");
    setReferenceUrl("");
    setError("");
  }

  function chooseSubject(id: string) {
    if (interactionLocked) return;
    clearLocal();
    setSubjectId(id);
    setImageAssetId("");
    setReferenceUrl("");
    setPlusOpen(false);
    setError("");
  }

  function chooseImage(id: string) {
    if (interactionLocked) return;
    clearLocal();
    setImageAssetId(id);
    setSubjectId("");
    setReferenceUrl("");
    setPlusOpen(false);
    setError("");
  }

  function changeReferenceUrl(value: string) {
    if (interactionLocked) return;
    if (value.trim()) {
      clearLocal();
      setSubjectId("");
      setImageAssetId("");
    }
    setReferenceUrl(value);
  }

  function clearReference() {
    clearLocal();
    setSubjectId("");
    setImageAssetId("");
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

    if (providerMode === "modelstudio" && !modelStudioAvailable) {
      setError("本次已强制百炼，但百炼还没有配置。请先到设置完成配置。");
      return;
    }
    if (providerMode === "yike" && !yikeAvailable) {
      setError("本次已强制万镜一刻，但万镜一刻还没有配置。请先到设置完成配置。");
      return;
    }
    if (providerMode === "auto" && !modelStudioAvailable && !yikeAvailable) {
      setError("还没有可用的视频服务，请先完成一次设置。");
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
        clearLocal();
        setLocalInput(body.input as LocalInput);
        setSubjectId("");
        setImageAssetId("");
        setReferenceUrl("");
        setPlusOpen(false);
        return;
      }

      const asset = await uploadImageToExtendedLibrary(file);
      clearLocal();
      setSubjectId("");
      setReferenceUrl("");
      setImageAssetId(asset.id);
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
    if (providerMode === "modelstudio" && !modelStudioAvailable) return "本次已强制百炼，但百炼还没有配置。请先到设置完成配置。";
    if (providerMode === "yike" && !yikeAvailable) return "本次已强制万镜一刻，但万镜一刻还没有配置。请先到设置完成配置。";
    if (providerMode === "auto" && !modelStudioAvailable && !yikeAvailable) return "还没有可用的视频服务，请先完成一次设置。";
    return "";
  }

  async function create() {
    if (interactionLocked) return;
    if (generationReady !== true) {
      setError(generationReady === null ? "正在检查视频服务，请稍后再试。" : "视频服务还没有配置完成，请先完成设置。");
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
          localInputRef: localInput?.ref || "",
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
    setProviderOpen(false);
  }

  function selectProvider(next: ProviderMode) {
    if (interactionLocked) return;
    setProviderTouched(true);
    setProviderMode(next);
    setProviderOpen(false);
    setError("");
    if (localInput && next === "yike") {
      clearLocal();
      setError("万镜一刻不能直接读取临时本机图片；请重新点击 + 选择本机图片，系统会自动上传到素材库后使用。");
    }
  }

  return (
    <div className={styles.homeStage}>
      <div className={styles.homeIntro}>
        <div className={styles.homeMark}><Sparkles size={22} /></div>
        <h1>今天想做什么视频？</h1>
        <p>描述结果，不必先理解模型和任务参数。添加主体或参考图片，Wanke 会自动建立作品、规划镜头并提交生成。</p>
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
          chooseLocal(event.dataTransfer.files?.[0]);
        }}
      >
        {referenceLabel && (
          <div className={styles.referenceRow}>
            <span className={styles.referenceToken}>
              {selectedSubject ? <UserRound size={14} /> : <ImageIcon size={14} />}
              {referenceLabel}
              <button disabled={interactionLocked} onClick={clearReference} aria-label="移除参考">×</button>
            </span>
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

        <div className={styles.composerToolbar}>
          <div className={styles.composerToolsLeft}>
            <div className={styles.popoverAnchor}>
              <button disabled={interactionLocked} className={styles.roundButton} onClick={() => { const next = !plusOpen; closePopovers(); setPlusOpen(next); }} aria-label="添加参考素材">
                {localUploading ? <LoaderCircle className={styles.spin} size={18} /> : <Plus size={19} />}
              </button>
              {plusOpen && (
                <div className={`${styles.popover} ${styles.referencePopover}`}>
                  <div className={styles.popoverTitle}>添加参考</div>

                  <div className={styles.popoverLabel}>本机图片</div>
                  {canChooseComputerImage ? (
                    <label className={styles.filePicker}>
                      <Upload size={15} />
                      <span><b>从电脑选择图片</b><small>JPG / PNG / WEBP，10 MB 内</small></span>
                      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={interactionLocked} onChange={event => { chooseLocal(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                    </label>
                  ) : (
                    <button className={styles.popoverLink} onClick={onOpenSettings}><Settings2 size={15} />当前线路未配置，先去设置</button>
                  )}

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

                  <div className={styles.popoverLabel}>素材库图片</div>
                  {images.length ? (
                    <div className={styles.referenceList}>
                      {images.slice(0, 6).map(asset => (
                        <button key={asset.id} onClick={() => chooseImage(asset.id)}><ImageIcon size={15} /><span>{asset.name}</span></button>
                      ))}
                    </div>
                  ) : <div className={styles.popoverEmpty}>素材库还没有图片</div>}
                  <button className={styles.popoverLink} onClick={onOpenAssets}><Library size={15} />打开素材库</button>

                  <div className={styles.popoverLabel}>图片直链</div>
                  <input
                    className={styles.urlInput}
                    value={referenceUrl}
                    onChange={event => changeReferenceUrl(event.target.value)}
                    placeholder="https://...jpg / png / webp"
                  />
                  {referenceUrl.trim() && <button className={styles.popoverPrimary} onClick={() => setPlusOpen(false)}>使用这个链接</button>}
                </div>
              )}
            </div>

            <div className={styles.popoverAnchor}>
              <button disabled={interactionLocked} className={styles.optionButton} onClick={() => { const next = !optionsOpen; closePopovers(); setOptionsOpen(next); }}>
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
              <button disabled={interactionLocked} className={styles.providerButton} onClick={() => { const next = !providerOpen; closePopovers(); setProviderOpen(next); }}>
                <GitBranch size={15} />
                <span>{providerLabels[providerMode]}</span>
                <ChevronDown size={14} />
              </button>
              {providerOpen && (
                <div className={`${styles.popover} ${styles.providerPopover}`}>
                  <div className={styles.popoverTitle}>本次生成线路</div>
                  <button className={`${styles.providerChoice} ${providerMode === "auto" ? styles.providerChoiceActive : ""}`} onClick={() => selectProvider("auto")}>
                    <b>自动路由</b><small>优先百炼；不适配时按兼容规则使用万镜一刻 · {modelStudioAvailable || yikeAvailable ? "可用" : "未配置"}</small>
                  </button>
                  <button className={`${styles.providerChoice} ${providerMode === "modelstudio" ? styles.providerChoiceActive : ""}`} onClick={() => selectProvider("modelstudio")}>
                    <b>强制百炼</b><small>只走百炼，不静默回退 · {modelStudioAvailable ? "已配置" : "未配置"}</small>
                  </button>
                  <button className={`${styles.providerChoice} ${providerMode === "yike" ? styles.providerChoiceActive : ""}`} onClick={() => selectProvider("yike")}>
                    <b>强制万镜一刻</b><small>本次基础视频固定走万镜一刻 · {yikeAvailable ? "已配置" : "未配置"}</small>
                  </button>
                  <div className={styles.popoverFootnote}>只影响本次创作，不修改设置页中的全局默认线路。</div>
                </div>
              )}
            </div>
            <button className={styles.sendButton} disabled={interactionLocked} onClick={create} title={ready ? "开始创作" : "完善描述、参考和线路后开始"}>
              {busy ? <LoaderCircle className={styles.spin} size={17} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      {error && <div className={styles.composerError}>{error}</div>}
      {generationReady === false && (
        <button className={styles.serviceWarning} onClick={onOpenSettings}>视频服务未配置，点击完成一次设置后即可直接创作。</button>
      )}
      <div className={styles.composerHint}>Enter 开始创作 · Shift + Enter 换行 · 图片也可以直接拖进输入框</div>

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

function readDraft(defaultProviderMode: ProviderMode): DraftState {
  const fallback: DraftState = {
    restored: false,
    type: "product_ad",
    prompt: "",
    platform: "douyin",
    duration: 10,
    providerMode: defaultProviderMode,
    subjectId: "",
    imageAssetId: "",
    referenceUrl: "",
    localInput: null,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(CHAT_DRAFT_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Partial<DraftState>;
    const type = value.type === "product_ad" || value.type === "person_short" || value.type === "image_video" ? value.type : fallback.type;
    const platform = value.platform === "douyin" || value.platform === "xiaohongshu" || value.platform === "youtube" || value.platform === "landscape" ? value.platform : fallback.platform;
    const duration = value.duration === 5 || value.duration === 10 || value.duration === 15 || value.duration === 30 ? value.duration : fallback.duration;
    const providerMode = value.providerMode === "auto" || value.providerMode === "modelstudio" || value.providerMode === "yike" ? value.providerMode : defaultProviderMode;
    const localInput = value.localInput && typeof value.localInput.ref === "string" && value.localInput.ref.startsWith("wanke-input://")
      ? { ref: value.localInput.ref, name: String(value.localInput.name || "本地图片"), size: Number(value.localInput.size || 0) }
      : null;
    return {
      restored: true,
      type,
      prompt: String(value.prompt || ""),
      platform,
      duration,
      providerMode,
      subjectId: String(value.subjectId || ""),
      imageAssetId: String(value.imageAssetId || ""),
      referenceUrl: String(value.referenceUrl || ""),
      localInput,
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
