"use client";

import { useEffect, useMemo, useState } from "react";
import { BookmarkPlus, ChevronDown, CircleHelp, Plus, Send, Trash2 } from "lucide-react";
import type { StoredAsset, StoredJob } from "@/lib/types";

type Mode = "generate" | "remake" | "clone" | "avatar" | "voice" | "storyboard" | "translation";
type Props = { mode: Mode; assets: StoredAsset[]; jobs: StoredJob[]; onSubmit: (kind: string, input: Record<string, unknown>, title?: string, parentJobId?: string) => Promise<any>; submitting: boolean };

const styles = [
  ["RealisticPhotography", "写实摄影"], ["RealisticPhotographyPro", "写实摄影 Pro"], ["RealisticGuzhuang", "写实古装"], ["RealisticXianxia", "写实仙侠"], ["RealisticWesternPro", "西方写实 Pro"],
  ["GuofengAnime", "国风 2D 动漫"], ["GuofengAnime3D", "国风 3D 动漫"], ["AncientRomanceAnime", "古风恋爱动漫"], ["PostApocalypticAnime", "末日动漫"], ["Cartoon3D", "3D 卡通"],
  ["Photorealistic3D", "照片级 3D"], ["SciFiRealism", "科幻写实"], ["Chibi3D", "3D Q版"], ["ShojoManga", "日系少女漫画"], ["NewPeriodAnime", "新世代日漫"],
  ["FairyTale2D", "2D 童话"], ["Wasteland2D", "2D 废土"], ["InkWuxia", "水墨武侠"], ["ShadiaoMeme", "沙雕表情包"], ["Chibi2D", "2D Q版"],
  ["Ghibli", "吉卜力"], ["SciFiComic", "赛博科幻漫画"], ["AmericanSuperhero", "美式超级英雄"], ["RealisticEra", "年代写实"], ["RealisticWasteland", "废土写实"],
];

const voiceOptions = [
  ["sys_ElegantProperMiddleAgedWoman", "优雅端庄中年女"], ["sys_YoungGracefulWoman", "温柔知性女"], ["sys_CalmDeepMale", "沉稳深邃男"], ["sys_SereneIntellect", "沉静知性男"],
  ["sys_MajesticBaritone", "大气男中音"], ["sys_GravellySoulful", "沙哑磁性男"], ["sys_ClassicYoungMan", "经典青年男"], ["sys_WiseYoungMan", "睿智青年男"],
  ["sys_ClassicYoungWoman", "经典青年女"], ["sys_IntellectualYoungWoman", "知性青年女"], ["sys_GentleYoungMan", "温柔青年男"], ["sys_RichBassMale", "浑厚低音男"],
];

export default function CreatorForms(props: Props) {
  if (props.mode === "generate") return <GenerateForm {...props} />;
  if (props.mode === "remake") return <RemakePipelineForm {...props} />;
  if (props.mode === "clone") return <CloneForm {...props} />;
  if (props.mode === "avatar") return <AvatarForm {...props} />;
  if (props.mode === "voice") return <VoiceForm {...props} />;
  if (props.mode === "translation") return <TranslationForm {...props} />;
  return <StoryboardForm {...props} />;
}

function GenerateForm({ assets, onSubmit, submitting }: Props) {
  const initial = { title: "", prompt: "", jobType: "text_to_video", aspectRatio: "16:9", duration: 5, resolution: "720P", model: "wan2.7", n: 1, medias: [] as { type: string; url: string; mediaId?: string }[], expertText: "" };
  const [v, setV] = useDraft("video_generation", initial);
  const need = v.jobType === "image_to_video" ? "1 张图片" : v.jobType === "first_last_frame" ? "首帧 + 尾帧 2 张图片" : v.jobType === "reference_to_video" ? "1–9 个参考素材" : "无需素材";
  return <FormFrame title="AI 视频生成" subtitle="把四种基础生成模式统一在一个工作台；一次可生成 1–4 个版本直接对比。" kind="video_generation" value={v} setValue={setV} onRun={() => onSubmit("video_generation", withExpert(v), v.title)} submitting={submitting}>
    <Field label="任务名称"><input value={v.title} onChange={e => setV({ ...v, title: e.target.value })} placeholder="例如：产品主视觉 · 夜景版" /></Field>
    <Field label="生成模式"><Segment value={v.jobType} onChange={jobType => setV({ ...v, jobType })} options={[["text_to_video","文生视频"],["image_to_video","图生视频"],["first_last_frame","首尾帧"],["reference_to_video","多参考"]]} /></Field>
    <Field label="提示词" hint="描述主体、动作、镜头、环境、光线与节奏；不要把参数塞进提示词。"><textarea className="big-text" value={v.prompt} onChange={e => setV({ ...v, prompt: e.target.value })} placeholder="一位穿黑色风衣的男子在雨夜霓虹街道缓慢走向镜头，低机位跟拍，浅景深，电影感光线……" /></Field>
    {v.jobType !== "text_to_video" && <ReferenceEditor value={v.medias} onChange={medias => setV({ ...v, medias })} assets={assets} hint={need} imageOnly={v.jobType !== "reference_to_video"} />}
    <div className="form-grid four">
      <SelectField label="画幅" value={v.aspectRatio} onChange={aspectRatio => setV({...v,aspectRatio})} options={["16:9","9:16","4:3","3:4","1:1"]} />
      <SelectField label="时长" value={String(v.duration)} onChange={duration => setV({...v,duration:Number(duration)})} options={Array.from({length:12},(_,i)=>String(i+4))} suffix="秒" />
      <SelectField label="清晰度" value={v.resolution} onChange={resolution => setV({...v,resolution})} options={["720P","1080P"]} />
      <SelectField label="版本数" value={String(v.n)} onChange={n => setV({...v,n:Number(n)})} options={["1","2","3","4"]} suffix="个" />
    </div>
    <details className="advanced"><summary><ChevronDown size={16}/>高级参数</summary><div className="advanced-body"><SelectField label="模型" value={v.model} onChange={model=>setV({...v,model})} options={["wan2.7","happyhorse-1.1","happyhorse-1.0"]}/><Expert value={v.expertText} onChange={expertText=>setV({...v,expertText})} example='{"scene":"general"}' /></div></details>
  </FormFrame>;
}

function RemakePipelineForm({ assets, jobs, onSubmit, submitting }: Props) {
  const [a,setA]=useDraft("video_analysis",{title:"",sourceUrl:"",productName:"",brandName:"",sellingPointsText:"",expertText:""});
  const [r,setR]=useDraft("remake_script",{title:"",analysisJobId:"",comprehensionResult:"",remakeType:"faithful-remake",originalProductName:"",productName:"",productDescription:"",productImagesText:"",productKnowledge:"",originalAvatarName:"",newAvatarImagesText:"",voiceoverLanguage:"zh",expertText:""});
  const [v,setV]=useDraft("video_render",{title:"",remakeJobId:"",scriptUrl:"",scriptJson:"",voiceoverLanguage:"zh",resolution:"1080P",aspectRatio:"9:16",ttsVoiceUrl:"",bgmUrl:"",withSubtitles:true,expertText:""});
  const analysisJobs=jobs.filter(j=>j.kind==="video_analysis"&&j.status==="succeeded"&&j.outputs.some(o=>o.outputUrl));
  const remakeJobs=jobs.filter(j=>j.kind==="remake_script"&&j.status==="succeeded"&&j.outputs.some(o=>o.outputUrl));
  const selectedAnalysis=analysisJobs.find(j=>j.id===r.analysisJobId);
  const selectedRemake=remakeJobs.find(j=>j.id===v.remakeJobId);
  const analysisUrl=selectedAnalysis?.outputs.find(o=>o.outputUrl)?.outputUrl||r.comprehensionResult;
  const scriptUrl=selectedRemake?.outputs.find(o=>o.outputUrl)?.outputUrl||v.scriptUrl;
  const videoAssets=assets.filter(x=>x.mediaType==="video");
  const imageAssets=assets.filter(x=>x.mediaType==="image");
  return <div className="content-stack">
    <div className="hero-card pipeline-hero"><div><div className="eyebrow">ADVANCED REMAKE PIPELINE · YIKE 2026-07-07</div><h2>高级复刻生产线</h2><p>把复刻拆成三个可检查、可回退的阶段：先理解原视频，再生成可编辑创意脚本，最后独立渲染。任何一步不满意只回炉该阶段，不必整条重做。</p></div><div className="pipeline-flow"><span>1 视频拆解</span><b>→</b><span>2 脚本复刻</span><b>→</b><span>3 创意渲染</span></div></div>

    <section className="panel pipeline-card"><div className="pipeline-step"><em>01</em><div><h3>视频拆解</h3><p>提取叙事结构、人物/产品与镜头信息，输出结构化 JSON，作为后续复刻的事实底稿。</p></div><StageState jobs={jobs} kind="video_analysis"/></div>
      <div className="form-stack">
        <div className="form-grid two"><Field label="任务名称"><input value={a.title} onChange={e=>setA({...a,title:e.target.value})} placeholder="原视频拆解"/></Field><Field label="原视频"><select value={a.sourceUrl} onChange={e=>setA({...a,sourceUrl:e.target.value})}><option value="">— 从素材库选择 —</option>{videoAssets.map(x=><option key={x.id} value={x.sourceUrl}>{x.name}</option>)}</select><input value={a.sourceUrl} onChange={e=>setA({...a,sourceUrl:e.target.value})} placeholder="或粘贴公网视频 URL"/></Field></div>
        <div className="form-grid two"><Field label="产品名（可选）"><input value={a.productName} onChange={e=>setA({...a,productName:e.target.value})}/></Field><Field label="品牌（可选）"><input value={a.brandName} onChange={e=>setA({...a,brandName:e.target.value})}/></Field></div>
        <Field label="卖点提示（可选）" hint="每行一个；用于帮助理解产品型视频，不会替代视频内容。"><textarea value={a.sellingPointsText} onChange={e=>setA({...a,sellingPointsText:e.target.value})}/></Field>
        <details className="advanced"><summary><ChevronDown size={16}/>专家参数</summary><div className="advanced-body"><Expert value={a.expertText} onChange={expertText=>setA({...a,expertText})} example='{"jobType":"VideoBreakdown"}'/></div></details>
        <div className="stage-run"><button className="primary" disabled={submitting||!a.sourceUrl} onClick={()=>onSubmit("video_analysis",withExpert({...a,sellingPoints:a.sellingPointsText.split(/\n|,|，/).map(x=>x.trim()).filter(Boolean)}),a.title)}><Send size={16}/>提交拆解</button></div>
      </div>
    </section>

    <section className="panel pipeline-card"><div className="pipeline-step"><em>02</em><div><h3>复刻脚本</h3><p>基于拆解结果做 faithful-remake，可有选择地替换产品、人物和语言，输出 creative script JSON。</p></div><StageState jobs={jobs} kind="remake_script"/></div>
      <div className="form-stack">
        <Field label="上游拆解结果" hint="优先选择已经成功的拆解任务；也可手工粘贴结果 JSON URL。"><select value={r.analysisJobId} onChange={e=>setR({...r,analysisJobId:e.target.value,comprehensionResult:""})}><option value="">— 选择已完成的视频拆解 —</option>{analysisJobs.map(j=><option key={j.id} value={j.id}>{j.title}</option>)}</select><input value={r.comprehensionResult} disabled={!!r.analysisJobId} onChange={e=>setR({...r,comprehensionResult:e.target.value})} placeholder={r.analysisJobId?analysisUrl:"或粘贴拆解结果 JSON URL"}/></Field>
        <div className="form-grid two"><Field label="原产品名"><input value={r.originalProductName} onChange={e=>setR({...r,originalProductName:e.target.value})}/></Field><Field label="新产品名"><input value={r.productName} onChange={e=>setR({...r,productName:e.target.value})}/></Field></div>
        <Field label="新产品描述"><textarea value={r.productDescription} onChange={e=>setR({...r,productDescription:e.target.value})} placeholder="只写希望改变的产品事实和卖点。"/></Field>
        <Field label="新产品图片" hint="每行一个公网图片 URL。也可点击下方素材快速加入。"><textarea value={r.productImagesText} onChange={e=>setR({...r,productImagesText:e.target.value})}/><div className="asset-chips">{imageAssets.slice(0,16).map(x=><button type="button" key={x.id} onClick={()=>setR({...r,productImagesText:[r.productImagesText,x.sourceUrl].filter(Boolean).join("\n")})}>🖼️ {x.name}</button>)}</div></Field>
        <Field label="产品知识 / 限制"><textarea value={r.productKnowledge} onChange={e=>setR({...r,productKnowledge:e.target.value})} placeholder="规格、禁用说法、必须保留的信息……"/></Field>
        <div className="form-grid two"><Field label="原人物名（可选）"><input value={r.originalAvatarName} onChange={e=>setR({...r,originalAvatarName:e.target.value})}/></Field><Field label="新人物参考图 URL"><input value={r.newAvatarImagesText} onChange={e=>setR({...r,newAvatarImagesText:e.target.value})} placeholder="多个 URL 用换行分隔"/></Field></div>
        <div className="form-grid two"><Field label="配音语言"><input value={r.voiceoverLanguage} onChange={e=>setR({...r,voiceoverLanguage:e.target.value})}/></Field><Field label="复刻策略"><input value={r.remakeType} onChange={e=>setR({...r,remakeType:e.target.value})}/></Field></div>
        <details className="advanced"><summary><ChevronDown size={16}/>专家参数</summary><div className="advanced-body"><Expert value={r.expertText} onChange={expertText=>setR({...r,expertText})} example='{"remakeParams":{"VoiceoverLanguage":"zh"}}'/></div></details>
        <div className="stage-run"><button className="primary" disabled={submitting||!analysisUrl} onClick={()=>onSubmit("remake_script",withExpert({...r,comprehensionResult:analysisUrl,productImages:lines(r.productImagesText),newAvatarImages:lines(r.newAvatarImagesText)}),r.title,r.analysisJobId||undefined)}><Send size={16}/>生成复刻脚本</button></div>
      </div>
    </section>

    <section className="panel pipeline-card"><div className="pipeline-step"><em>03</em><div><h3>创意渲染</h3><p>脚本与渲染解耦。先确认创意脚本，再选择画幅、分辨率、TTS、BGM 与字幕输出最终视频。</p></div><StageState jobs={jobs} kind="video_render"/></div>
      <div className="form-stack">
        <Field label="复刻脚本" hint="选择上一步结果后，Wanke 服务端会安全读取 JSON 并交给 VideoRender；也可直接粘贴 creative/v1 JSON。"><select value={v.remakeJobId} onChange={e=>setV({...v,remakeJobId:e.target.value,scriptUrl:"",scriptJson:""})}><option value="">— 选择已完成的复刻脚本 —</option>{remakeJobs.map(j=><option key={j.id} value={j.id}>{j.title}</option>)}</select>{!v.remakeJobId&&<><input value={v.scriptUrl} onChange={e=>setV({...v,scriptUrl:e.target.value})} placeholder="脚本 JSON URL"/><textarea className="code-input" value={v.scriptJson} onChange={e=>setV({...v,scriptJson:e.target.value})} placeholder='或直接粘贴 {"schemaVersion":"creative/v1",...}'/></>}</Field>
        <div className="form-grid four"><SelectField label="画幅" value={v.aspectRatio} onChange={aspectRatio=>setV({...v,aspectRatio})} options={["16:9","9:16","4:3","3:4"]}/><SelectField label="清晰度" value={v.resolution} onChange={resolution=>setV({...v,resolution})} options={["720P","1080P"]}/><Field label="语言"><input value={v.voiceoverLanguage} onChange={e=>setV({...v,voiceoverLanguage:e.target.value})}/></Field><Toggle label="字幕" checked={v.withSubtitles} onChange={withSubtitles=>setV({...v,withSubtitles})}/></div>
        <div className="form-grid two"><Field label="TTS 声音 URL（可选）"><input value={v.ttsVoiceUrl} onChange={e=>setV({...v,ttsVoiceUrl:e.target.value})}/></Field><Field label="BGM URL（可选）"><input value={v.bgmUrl} onChange={e=>setV({...v,bgmUrl:e.target.value})}/></Field></div>
        <details className="advanced"><summary><ChevronDown size={16}/>专家参数</summary><div className="advanced-body"><Expert value={v.expertText} onChange={expertText=>setV({...v,expertText})} example='{"settings":{"WithSubtitles":true}}'/></div></details>
        <div className="stage-run"><button className="primary" disabled={submitting||(!scriptUrl&&!v.scriptJson.trim())} onClick={()=>onSubmit("video_render",withExpert({...v,scriptUrl}),v.title,v.remakeJobId||undefined)}><Send size={16}/>开始渲染</button></div>
      </div>
    </section>
  </div>;
}

function TranslationForm({onSubmit,submitting}:Props){
  const initial={title:"",description:"",jobType:"VoiceTranslate",inputVideoOssUri:"",outputOssUri:"",sourceLanguage:"zh",targetLanguage:"en",needDetext:false,needVisualTranslate:false,expertText:""};
  const [v,setV]=useDraft("video_translation",initial);
  return <FormFrame title="视频翻译" subtitle="面向已有 OSS 视频做字幕翻译或语音翻译。当前 2026-07-07 SDK 只公开提交接口，因此 Wanke 会保存 JobId，但不会伪造可查询进度。" kind="video_translation" value={v} setValue={setV} onRun={()=>onSubmit("video_translation",withExpert(v),v.title)} submitting={submitting}>
    <Field label="翻译类型"><Segment value={v.jobType} onChange={jobType=>setV({...v,jobType})} options={[["VoiceTranslate","语音翻译"],["SubtitleTranslate","字幕翻译"]]}/></Field>
    <Field label="输入视频 OSS URI" hint="官方当前要求调用账号下的 OSS 地址，不是普通 https URL。"><input value={v.inputVideoOssUri} onChange={e=>setV({...v,inputVideoOssUri:e.target.value})} placeholder="oss://bucket/path/input.mp4"/></Field>
    <Field label="输出 OSS 目录"><input value={v.outputOssUri} onChange={e=>setV({...v,outputOssUri:e.target.value})} placeholder="oss://bucket/output/"/></Field>
    <div className="form-grid two"><Field label="源语言"><input value={v.sourceLanguage} onChange={e=>setV({...v,sourceLanguage:e.target.value})}/></Field><Field label="目标语言"><input value={v.targetLanguage} onChange={e=>setV({...v,targetLanguage:e.target.value})}/></Field></div>
    <div className="toggle-row"><Toggle label="去除画面文字" checked={v.needDetext} onChange={needDetext=>setV({...v,needDetext})}/><Toggle label="视觉文字翻译" checked={v.needVisualTranslate} onChange={needVisualTranslate=>setV({...v,needVisualTranslate})}/></div>
    <div className="form-grid two"><Field label="任务名称"><input value={v.title} onChange={e=>setV({...v,title:e.target.value})}/></Field><Field label="说明"><input value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field></div>
    <details className="advanced"><summary><ChevronDown size={16}/>专家参数</summary><div className="advanced-body"><Expert value={v.expertText} onChange={expertText=>setV({...v,expertText})} example='{"jobParameters":"{...}"}'/></div></details>
  </FormFrame>;
}

function StageState({jobs,kind}:{jobs:StoredJob[];kind:string}){const latest=jobs.find(j=>j.kind===kind);if(!latest)return <span className="stage-state idle">尚未运行</span>;const labels:any={queued:"排队",running:"处理中",succeeded:"已完成",failed:"失败",unknown:"待确认"};return <span className={`stage-state ${latest.status}`}>{labels[latest.status]} · {new Date(latest.updatedAt).toLocaleTimeString()}</span>}
function lines(value:string){return value.split(/\n|,|，/).map(x=>x.trim()).filter(Boolean)}

function CloneForm({ assets, onSubmit, submitting }: Props) {
  const initial = { title:"", originalMediaId:"", oldProductName:"", productName:"", userMaterialIds:[] as string[], avatarPortrait:"", avatarVoice:"", resolution:"720P", withSubtitles:true, expertText:"" };
  const [v,setV]=useDraft("video_clone",initial);
  return <FormFrame title="视频复刻" subtitle="以已有视频为骨架，只替换需要变化的元素；适合同类内容改写和快速变体。" kind="video_clone" value={v} setValue={setV} onRun={()=>onSubmit("video_clone",withExpert(v),v.title)} submitting={submitting}>
    <Field label="任务名称"><input value={v.title} onChange={e=>setV({...v,title:e.target.value})} placeholder="例如：A 产品替换成 B 产品"/></Field>
    <Field label="原始视频" hint="必须是已注册到万镜一刻的 MediaId。"><AssetSelect assets={assets} type="video" mode="studioMediaId" value={v.originalMediaId} onChange={originalMediaId=>setV({...v,originalMediaId})}/></Field>
    <div className="form-grid two"><Field label="原商品名"><input value={v.oldProductName} onChange={e=>setV({...v,oldProductName:e.target.value})}/></Field><Field label="新商品名"><input value={v.productName} onChange={e=>setV({...v,productName:e.target.value})}/></Field></div>
    <Field label="替换素材" hint="可选择多张图片/视频，Yike 会结合复刻场景使用。"><AssetMulti assets={assets} value={v.userMaterialIds} onChange={userMaterialIds=>setV({...v,userMaterialIds})}/></Field>
    <div className="form-grid two"><Field label="数字人人像 URL"><input value={v.avatarPortrait} onChange={e=>setV({...v,avatarPortrait:e.target.value})} placeholder="可选；公网可访问图片 URL"/></Field><Field label="声音参考 / Voice ID"><input value={v.avatarVoice} onChange={e=>setV({...v,avatarVoice:e.target.value})} placeholder="可选：音频 URL 或声音引用"/></Field></div>
    <div className="form-grid two"><SelectField label="清晰度" value={v.resolution} onChange={resolution=>setV({...v,resolution})} options={["720P","1080P"]}/><Toggle label="生成字幕" checked={v.withSubtitles} onChange={withSubtitles=>setV({...v,withSubtitles})}/></div>
    <details className="advanced"><summary><ChevronDown size={16}/>高级参数</summary><div className="advanced-body"><Expert value={v.expertText} onChange={expertText=>setV({...v,expertText})} example='{"jobParams":{"CustomField":"value"}}'/></div></details>
  </FormFrame>;
}

function AvatarForm({ assets, onSubmit, submitting }: Props) {
  const initial={title:"",sceneType:"creator-talk",textType:2,textContent:"",userMaterialIds:[] as string[],avatarPortrait:"",avatarVoice:"",voiceDuration:60,aspectRatio:"9:16",resolution:"720P",outputLanguages:["CN"],withSubtitles:true,expertText:""};
  const [v,setV]=useDraft("avatar_narrator",initial);
  const fixed=v.sceneType==="avatar-broadcast";
  return <FormFrame title="数字人口播" subtitle="讲解型支持素材穿插；固定口播适合单镜头数字人。两种场景的限制会在表单里提前挡住。" kind="avatar_narrator" value={v} setValue={setV} onRun={()=>onSubmit("avatar_narrator",withExpert(v),v.title)} submitting={submitting}>
    <Field label="场景"><Segment value={v.sceneType} onChange={sceneType=>setV({...v,sceneType,textType:sceneType==="avatar-broadcast"?2:v.textType,userMaterialIds:sceneType==="avatar-broadcast"?[]:v.userMaterialIds})} options={[["creator-talk","知识讲解"],["avatar-broadcast","固定口播"]]}/></Field>
    <Field label="文案类型"><Segment value={String(v.textType)} onChange={x=>setV({...v,textType:Number(x)})} options={fixed?[["2","已写好的口播稿"]]:[["1","原始信息 · 自动改写"],["2","已写好的口播稿"]]}/></Field>
    <Field label="文案" hint="最多 10,000 字符。"><textarea className="big-text" value={v.textContent} onChange={e=>setV({...v,textContent:e.target.value})}/><div className="char-count">{v.textContent.length} / 10000</div></Field>
    <div className="form-grid two"><Field label="数字人人像 URL"><input value={v.avatarPortrait} onChange={e=>setV({...v,avatarPortrait:e.target.value})} placeholder="必填：公网可访问的人像图"/></Field><Field label="声音"><input value={v.avatarVoice} onChange={e=>setV({...v,avatarVoice:e.target.value})} placeholder="内置 Voice ID 或声音克隆参考 URL"/></Field></div>
    {!fixed&&<Field label="画面素材"><AssetMulti assets={assets} value={v.userMaterialIds} onChange={userMaterialIds=>setV({...v,userMaterialIds})}/></Field>}
    <div className="form-grid four"><SelectField label="画幅" value={v.aspectRatio} onChange={aspectRatio=>setV({...v,aspectRatio})} options={["16:9","9:16","4:3","3:4"]}/><SelectField label="清晰度" value={v.resolution} onChange={resolution=>setV({...v,resolution})} options={["720P","1080P"]}/>{v.textType===1?<Field label="目标时长"><input type="number" value={v.voiceDuration} onChange={e=>setV({...v,voiceDuration:Number(e.target.value)})}/></Field>:<div/>}<Toggle label="字幕" checked={v.withSubtitles} onChange={withSubtitles=>setV({...v,withSubtitles})}/></div>
    <LanguageSelect value={v.outputLanguages} onChange={outputLanguages=>setV({...v,outputLanguages})}/>
    <details className="advanced"><summary><ChevronDown size={16}/>高级参数</summary><div className="advanced-body"><Expert value={v.expertText} onChange={expertText=>setV({...v,expertText})} example='{"jobParams":{"OutputLanguages":["CN"]}}'/></div></details>
  </FormFrame>;
}

function VoiceForm({assets,onSubmit,submitting}:Props){
  const initial={title:"",textType:2,textContent:"",userMaterialIds:[] as string[],narrationVoiceId:"sys_ElegantProperMiddleAgedWoman",voiceDuration:60,aspectRatio:"16:9",resolution:"720P",outputLanguages:["CN"],withSubtitles:true,targetAspectRatio:"",heading:"",subHeading:"",date:"",watermarkText:"",enabledAICover:false,ipCharacterMediaId:"",ipCharacterMediaUrl:"",expertText:""};
  const [v,setV]=useDraft("voice_narrator",initial);
  return <FormFrame title="旁白成片" subtitle="把新闻、产品、知识素材自动组织成旁白视频；竖屏包装、标题、水印和 AI 封面集中配置。" kind="voice_narrator" value={v} setValue={setV} onRun={()=>onSubmit("voice_narrator",withExpert(v),v.title)} submitting={submitting}>
    <Field label="文案类型"><Segment value={String(v.textType)} onChange={x=>setV({...v,textType:Number(x)})} options={[["1","原始信息 · 自动改写"],["2","已写好的旁白稿"]]}/></Field>
    <Field label="文案"><textarea className="big-text" value={v.textContent} onChange={e=>setV({...v,textContent:e.target.value})}/><div className="char-count">{v.textContent.length} / 10000</div></Field>
    <Field label="素材"><AssetMulti assets={assets} value={v.userMaterialIds} onChange={userMaterialIds=>setV({...v,userMaterialIds})}/></Field>
    <div className="form-grid four"><SelectField label="旁白声音" value={v.narrationVoiceId} onChange={narrationVoiceId=>setV({...v,narrationVoiceId})} options={voiceOptions as any}/><SelectField label="画幅" value={v.aspectRatio} onChange={aspectRatio=>setV({...v,aspectRatio})} options={["16:9","9:16","4:3","3:4"]}/><SelectField label="清晰度" value={v.resolution} onChange={resolution=>setV({...v,resolution})} options={["720P","1080P"]}/><Toggle label="字幕" checked={v.withSubtitles} onChange={withSubtitles=>setV({...v,withSubtitles})}/></div>
    {v.textType===1&&<Field label="目标旁白时长"><input type="number" value={v.voiceDuration} onChange={e=>setV({...v,voiceDuration:Number(e.target.value)})}/></Field>}
    <LanguageSelect value={v.outputLanguages} onChange={outputLanguages=>setV({...v,outputLanguages})}/>
    <details className="advanced"><summary><ChevronDown size={16}/>竖屏包装与 AI 封面</summary><div className="advanced-body"><div className="form-grid two"><SelectField label="竖屏适配" value={v.targetAspectRatio} onChange={targetAspectRatio=>setV({...v,targetAspectRatio})} options={[["","不启用"],["9:16","9:16"],["3:4","3:4"]] as any}/><Toggle label="AI 生成封面" checked={v.enabledAICover} onChange={enabledAICover=>setV({...v,enabledAICover})}/></div><div className="form-grid two"><Field label="主标题"><input value={v.heading} onChange={e=>setV({...v,heading:e.target.value})}/></Field><Field label="副标题"><input value={v.subHeading} onChange={e=>setV({...v,subHeading:e.target.value})}/></Field><Field label="日期"><input value={v.date} onChange={e=>setV({...v,date:e.target.value})}/></Field><Field label="水印文字"><input value={v.watermarkText} onChange={e=>setV({...v,watermarkText:e.target.value})}/></Field></div><div className="form-grid two"><Field label="封面 IP 素材 MediaId"><input value={v.ipCharacterMediaId} onChange={e=>setV({...v,ipCharacterMediaId:e.target.value})}/></Field><Field label="封面 IP 素材 URL"><input value={v.ipCharacterMediaUrl} onChange={e=>setV({...v,ipCharacterMediaUrl:e.target.value})}/></Field></div><Expert value={v.expertText} onChange={expertText=>setV({...v,expertText})} example='{"jobParams":{"CustomField":"value"}}'/></div></details>
  </FormFrame>;
}

function StoryboardForm({assets,onSubmit,submitting}:Props){
  const initial={fileURL:"",title:"",execMode:"FullPipeline",aspectRatio:"16:9",resolution:"1080P",styleId:"RealisticPhotography",shotPromptMode:"multi",shotPromptLang:"zh-CN",shotSplitMode:"firstPersonNarration",sourceType:"Novel",narrationVoiceId:"sys_YoungGracefulWoman",keepOriginDialogue:true,needCaption:true,skipFailureShot:true,audioEnable:true,videoModel:"wan2.6-r2v-flash",expertText:""};
  const [v,setV]=useDraft("storyboard",initial);
  return <FormFrame title="故事板生产线" subtitle="面向长文本：先拆故事板，再生成镜头并合成。失败镜头保留明细，可在任务中心直接续跑。" kind="storyboard" value={v} setValue={setV} onRun={()=>onSubmit("storyboard",withExpert(v),v.title)} submitting={submitting}>
    <Field label="脚本文件" hint="Yike 当前要求 OSS 上的 .txt 或 .doc。可先在素材库上传。"><AssetSelect assets={assets} type="document" mode="url" value={v.fileURL} onChange={fileURL=>setV({...v,fileURL})}/><input value={v.fileURL} onChange={e=>setV({...v,fileURL:e.target.value})} placeholder="或粘贴脚本 OSS URL"/></Field>
    <div className="form-grid two"><Field label="任务标题"><input value={v.title} onChange={e=>setV({...v,title:e.target.value})} maxLength={128}/></Field><Field label="执行方式"><Segment value={v.execMode} onChange={execMode=>setV({...v,execMode})} options={[["FullPipeline","故事板 + 镜头成片"],["StoryboardOnly","只生成故事板"]]}/></Field></div>
    <div className="form-grid four"><SelectField label="视觉风格" value={v.styleId} onChange={styleId=>setV({...v,styleId})} options={styles as any}/><SelectField label="画幅" value={v.aspectRatio} onChange={aspectRatio=>setV({...v,aspectRatio})} options={["16:9","9:16","4:3","3:4"]}/><SelectField label="清晰度" value={v.resolution} onChange={resolution=>setV({...v,resolution})} options={["720P","1080P","2K","4K"]}/><SelectField label="镜头生成" value={v.shotPromptMode} onChange={shotPromptMode=>setV({...v,shotPromptMode})} options={[["multi","多参考视频生成"],["default","图生视频"]] as any}/></div>
    <div className="form-grid two"><SelectField label="旁白声音" value={v.narrationVoiceId} onChange={narrationVoiceId=>setV({...v,narrationVoiceId})} options={voiceOptions as any}/><Field label="视频模型"><input value={v.videoModel} onChange={e=>setV({...v,videoModel:e.target.value})}/></Field></div>
    <div className="toggle-row"><Toggle label="保留原对话" checked={v.keepOriginDialogue} onChange={keepOriginDialogue=>setV({...v,keepOriginDialogue})}/><Toggle label="生成字幕" checked={v.needCaption} onChange={needCaption=>setV({...v,needCaption})}/><Toggle label="跳过失败镜头继续合成" checked={v.skipFailureShot} onChange={skipFailureShot=>setV({...v,skipFailureShot})}/><Toggle label="启用音频" checked={v.audioEnable} onChange={audioEnable=>setV({...v,audioEnable})}/></div>
    <details className="advanced"><summary><ChevronDown size={16}/>高级参数</summary><div className="advanced-body"><div className="form-grid two"><Field label="镜头提示词语言"><input value={v.shotPromptLang} onChange={e=>setV({...v,shotPromptLang:e.target.value})}/></Field><Field label="拆镜模式"><input value={v.shotSplitMode} disabled/></Field></div><Expert value={v.expertText} onChange={expertText=>setV({...v,expertText})} example='{"modelParams":"{\"AudioEnable\":true}"}' /></div></details>
  </FormFrame>;
}

function FormFrame({title,subtitle,kind,value,setValue,onRun,submitting,children}:any){
  return <div className="creator-layout"><div className="creator-card"><div className="section-head"><div><div className="eyebrow">CREATE</div><h2>{title}</h2><p>{subtitle}</p></div><Recipe kind={kind} value={value} setValue={setValue}/></div><div className="form-stack">{children}</div><div className="runbar"><span className="muted mini">提交后自动进入任务中心；关闭页面也不会丢失本地记录。</span><button className="primary" disabled={submitting} onClick={async()=>{try{await onRun()}catch(e){if(!(e instanceof Error&&e.message.includes("任务"))) alert(e instanceof Error?e.message:String(e))}}}><Send size={17}/>{submitting?"提交中…":"开始生成"}</button></div></div><aside className="tips-card"><CircleHelp size={18}/><h3>工作流建议</h3><p>先用低成本参数验证构图和节奏，再升到更高分辨率。需要多次试验时，把稳定参数保存成“配方”。</p><p>生成结果不满意不要覆盖原任务；任务中心保留父子重试链，方便回看哪些参数有效。</p></aside></div>;
}

function Field({label,hint,children}:any){return <label className="field"><span className="field-label">{label}{hint&&<small>{hint}</small>}</span>{children}</label>}
function SelectField({label,value,onChange,options,suffix}:{label:string;value:string;onChange:(value:string)=>void;options:Array<string|[string,string]>;suffix?:string}){const normalized=options.map(o=>Array.isArray(o)?o:[o,o]);return <Field label={label}><div className="select-wrap"><select value={value} onChange={e=>onChange(e.target.value)}>{normalized.map(([v,l])=><option key={v} value={v}>{l}{suffix?` ${suffix}`:""}</option>)}</select></div></Field>}
function Segment({value,onChange,options}:{value:string|number;onChange:(value:string)=>void;options:Array<[string,string]>}){return <div className="segment">{options.map(([v,l])=><button type="button" key={v} className={String(value)===String(v)?"active":""} onClick={()=>onChange(v)}>{l}</button>)}</div>}
function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(value:boolean)=>void}){return <label className="toggle"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span className="switch"/><b>{label}</b></label>}
function Expert({value,onChange,example}:{value:string;onChange:(value:string)=>void;example:string}){return <Field label="专家 JSON 覆盖" hint="用于实验官方新字段；普通使用保持为空。"><textarea className="code-input" value={value} onChange={e=>onChange(e.target.value)} placeholder={example}/></Field>}
function LanguageSelect({value,onChange}:{value:string[];onChange:(value:string[])=>void}){return <Field label="输出语言"><div className="chip-row">{[["CN","中文"],["EN","英文"],["YUE","粤语"]].map(([id,label])=><button type="button" className={`chip ${value.includes(id)?"selected":""}`} key={id} onClick={()=>onChange(value.includes(id)?(value.length>1?value.filter(x=>x!==id):value):[...value,id])}>{label}</button>)}</div></Field>}

function mediaIdFor(a:StoredAsset, surface:"core"|"studio"="core"){const p:any=a.provider||{};const key=surface==="studio"?"studioMediaId":"coreMediaId";return Object.prototype.hasOwnProperty.call(p,key)?(p[key]||""):a.providerMediaId}
function AssetSelect({assets,type,mode,value,onChange}:{assets:StoredAsset[];type:string;mode:string;value:string;onChange:(value:string)=>void}){const surface=mode==="studioMediaId"?"studio":"core";const wantsId=mode==="studioMediaId"||mode==="coreMediaId";const filtered=assets.filter(a=>a.mediaType===type&&(!wantsId||mediaIdFor(a,surface)));return <select value={value} onChange={e=>onChange(e.target.value)}><option value="">— 从素材库选择 —</option>{filtered.map(a=><option key={a.id} value={wantsId?mediaIdFor(a,surface)!:a.sourceUrl}>{a.name}</option>)}</select>}
function AssetMulti({assets,value,onChange}:{assets:StoredAsset[];value:string[];onChange:(value:string[])=>void}){const available=assets.map(a=>({a,id:mediaIdFor(a,"studio")})).filter(x=>x.id&&["image","video","audio"].includes(x.a.mediaType));return <div className="asset-chips">{available.length?available.map(({a,id})=><button type="button" key={a.id} className={value.includes(id!)?"selected":""} onClick={()=>onChange(value.includes(id!)?value.filter(x=>x!==id):[...value,id!])}>{a.mediaType==='video'?'🎬':a.mediaType==='audio'?'🎵':'🖼️'} {a.name}</button>):<span className="empty-inline">素材库暂无可用于营销工作流的 MediaId</span>}</div>}

function isIbbLandingPage(value:string){
  if(!value)return false;
  try{const url=new URL(value);return url.hostname==="ibb.co"||url.hostname==="www.ibb.co"}catch{return false}
}

function ReferenceEditor({value,onChange,assets,hint,imageOnly}:{value:Array<{type:string;url:string;mediaId?:string}>;onChange:(value:Array<{type:string;url:string;mediaId?:string}>)=>void;assets:StoredAsset[];hint:string;imageOnly:boolean}){
  const max=hint==="1 张图片"?1:hint.includes("2 张图片")?2:9;
  const full=value.length>=max;
  const hasIbbLanding=value.some((m:any)=>m.type==="image"&&isIbbLandingPage(m.url));
  useEffect(()=>{
    if(value.length>max)onChange(value.slice(0,max));
    // onChange is intentionally omitted: callers pass an inline setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[max,value.length]);
  const add=()=>{if(!full)onChange([...value,{type:"image",url:"",mediaId:""}])};
  const addAsset=(id:string)=>{if(full)return;const a=assets.find((x:StoredAsset)=>x.id===id);if(!a)return;const type=imageOnly?"image":(["image","video","audio"].includes(a.mediaType)?a.mediaType:"image");onChange([...value,{type,url:a.sourceUrl,mediaId:mediaIdFor(a,"core")||""}])};
  return <Field label="参考素材" hint={`${hint} · ${Math.min(value.length,max)}/${max}`}><div className="reference-list">{value.map((m:any,i:number)=><div className="reference-row" key={i}><select value={m.type} disabled={imageOnly} onChange={e=>{const n=[...value];n[i]={...n[i],type:e.target.value};onChange(n)}}><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select><input value={m.url} onChange={e=>{const n=[...value];n[i]={...n[i],url:e.target.value};onChange(n)}} placeholder={m.type==="image"?"图片文件直链或素材库 MediaId":"公网可访问 URL"}/><button className="icon-button danger" type="button" onClick={()=>onChange(value.filter((_:any,x:number)=>x!==i))}><Trash2 size={15}/></button></div>)}</div>{hasIbbLanding&&<div className="mini error-text">检测到 ibb.co 图片分享页。Yike 需要图片文件直链，请改用 i.ibb.co/...jpg/png，或先上传到 Wanke 素材库。</div>}<div className="inline-actions"><button type="button" className="secondary" disabled={full} onClick={add}><Plus size={15}/>{full?"已达素材上限":"添加 URL"}</button><select disabled={full} defaultValue="" onChange={e=>{if(e.target.value)addAsset(e.target.value);e.target.value=""}}><option value="">{full?"当前模式已达上限":"从素材库添加…"}</option>{assets.filter((a:StoredAsset)=>a.sourceUrl&&(imageOnly?a.mediaType==="image":["image","video","audio"].includes(a.mediaType))).map((a:StoredAsset)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div></Field>;
}

function Recipe({kind,value,setValue}:any){
  const key=`wanke:recipes:${kind}`;
  const [recipes,setRecipes]=useState<any[]>([]);
  useEffect(()=>{try{setRecipes(JSON.parse(localStorage.getItem(key)||"[]"))}catch{}},[key]);
  const save=()=>{const name=window.prompt("给这套参数起个名字");if(!name)return;const clean={...value};delete clean.expertText;const next=[{name,value:clean,at:new Date().toISOString()},...recipes.filter(r=>r.name!==name)].slice(0,12);localStorage.setItem(key,JSON.stringify(next));setRecipes(next)};
  return <div className="recipe"><button className="secondary" type="button" onClick={save}><BookmarkPlus size={15}/>保存配方</button>{recipes.length>0&&<select defaultValue="" onChange={e=>{const r=recipes.find(x=>x.name===e.target.value);if(r)setValue({...value,...r.value});e.target.value=""}}><option value="">加载配方…</option>{recipes.map(r=><option key={r.name}>{r.name}</option>)}</select>}</div>;
}

function useDraft<T extends object>(kind:string,initial:T):[T,(v:T)=>void]{const key=`wanke:draft:${kind}`;const [value,setValue]=useState<T>(initial);useEffect(()=>{try{const saved=localStorage.getItem(key);if(saved)setValue({...initial,...JSON.parse(saved)})}catch{}// eslint-disable-next-line react-hooks/exhaustive-deps
},[key]);useEffect(()=>{localStorage.setItem(key,JSON.stringify(value))},[key,value]);return [value,setValue]}
function withExpert(v:any){const copy={...v};const text=copy.expertText;delete copy.expertText;delete copy.title;if(text?.trim()){try{copy.expert=JSON.parse(text)}catch{throw new Error("专家 JSON 格式无效")}}return copy}
