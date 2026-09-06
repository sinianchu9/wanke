import Link from "next/link";
import type { Metadata } from "next";
import {
  Braces,
  Check,
  Clapperboard,
  CopyCheck,
  Languages,
  Mic2,
  ScanFace,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { getPageUser } from "@/lib/auth";
import { catalogPlans } from "@/lib/membership";
import { getSetting } from "@/lib/system-settings";

export const metadata: Metadata = {
  title: "Wanke · AI 视频生产平台",
  description: "面向创作者与小团队的商业级 AI 视频 SaaS：描述生成、图生视频、人物一致、复刻、数字人口播、故事板与多语言翻译，一站完成。",
};

export const dynamic = "force-dynamic";

const capabilities = [
  { icon: Sparkles, name: "描述生成视频", desc: "一句话生成完整视频，Recipe 与批量版本支持精细创作。" },
  { icon: WandSparkles, name: "快速向导", desc: "分步选择素材与目标，自动规划镜头并批量提交生成。" },
  { icon: Braces, name: "高级复刻", desc: "把原视频拆解、改写和渲染，串成可检查、可回退的流程。" },
  { icon: CopyCheck, name: "快速复刻", desc: "以已有视频为骨架，一键替换人物、产品或素材。" },
  { icon: ScanFace, name: "数字人口播", desc: "知识讲解与固定机位口播，统一人物、声音与画面。" },
  { icon: Mic2, name: "旁白成片", desc: "文案 + 素材 + 配音组合成完整旁白视频。" },
  { icon: Clapperboard, name: "故事板", desc: "长文本自动拆镜、生成镜头并合成完整成片。" },
  { icon: Languages, name: "视频翻译", desc: "字幕、语音与画面文字的多语言处理。" },
];

const roles = [
  { name: "访客", desc: "浏览产品能力与套餐说明，注册后立即开始创作。" },
  { name: "会员", desc: "按套餐使用全部生成能力，管理任务、素材与作品库。" },
  { name: "运营者", desc: "在管理后台管理会员、订单、创作服务与用户反馈。" },
];

export default async function LandingPage() {
  const user = await getPageUser();
  const plans = catalogPlans({ kind: "membership" });
  const recommendedId = plans.find(plan => plan.recommended)?.id || plans[0]?.id;
  const siteName = getSetting("site_name") || "Wanke";
  const contactEmail = getSetting("contact_email").trim();

  return <div className="landing">
    <header className="landing-nav">
      <Link href="/" className="brand">
        <span className="brand-mark"><Clapperboard size={19}/></span>
        <div><strong>Wanke</strong><span>AI VIDEO PLATFORM</span></div>
      </Link>
      <nav>
        <a href="#capabilities">产品能力</a>
        <a href="#pricing">价格</a>
        <a href="#roles">角色与权限</a>
      </nav>
      <div className="landing-cta">
        {user
          ? <Link href="/studio" className="primary">进入工作台</Link>
          : <>
              <Link href="/login" className="secondary">登录</Link>
              <Link href="/register" className="primary">免费注册</Link>
            </>}
      </div>
    </header>

    <section className="landing-hero">
      <p className="eyebrow">{siteName} · 商业级 AI 视频创作平台</p>
      <h1>把创意变成成片，<br/>一个工作台完成全部 AI 视频生产</h1>
      <p className="landing-sub">Wanke 面向创作者与小团队，覆盖描述生成、图生视频、人物一致、复刻、数字人口播、故事板与多语言翻译。创作进度随时可查，作品、素材与项目统一保存。</p>
      <div className="landing-cta center">
        {user
          ? <Link href="/studio" className="primary big">继续创作 · {user.name}</Link>
          : <>
              <Link href="/register" className="primary big">免费开始创作</Link>
              <Link href="#pricing" className="secondary big">查看套餐</Link>
            </>}
      </div>
      <div className="landing-proof">
        <span><Check size={13}/>创作内容仅自己可见</span>
        <span><Check size={13}/>生成未完成不会误扣创作额度</span>
        <span><Check size={13}/>作品、素材和任务统一保存</span>
        <span><Check size={13}/>关闭网页，创作继续完成</span>
      </div>
    </section>

    <section className="landing-section" id="capabilities">
      <h2>八条创作工作流，覆盖完整视频生产</h2>
      <p className="muted">同一套任务中心与素材体系驱动，结果自动进入你的作品库。</p>
      <div className="capability-grid">
        {capabilities.map(capability => <article key={capability.name} className="capability-card">
          <capability.icon size={18}/>
          <h3>{capability.name}</h3>
          <p>{capability.desc}</p>
        </article>)}
      </div>
    </section>

    <section className="landing-section" id="pricing">
      <h2>选择适合你的创作节奏</h2>
      <p className="muted">创作额度按次消耗，提交前会明确显示本次预计消耗；创作未完成会自动退回。</p>
      <div className="plan-grid landing-plans">
        {plans.map(plan => <article key={plan.id} className={`plan-card ${plan.id === recommendedId ? "featured" : ""}`}>
          <header>
            <h3>{plan.name}{plan.recommended ? <em>推荐</em> : null}</h3>
            <div className="plan-price">{plan.priceCents === 0 ? "免费" : <>{plan.priceText}<small>/ {plan.validityDays} 天</small></>}</div>
            <p className="muted">{plan.subtitle}</p>
          </header>
          <ul>
            <li><Check size={13}/>{plan.credits} 个创作额度</li>
            {plan.features.filter(feature => !feature.includes("创作额度")).map(feature => <li key={feature}><Check size={13}/>{feature}</li>)}
          </ul>
          {user
            ? <Link href="/account" className={plan.id === recommendedId ? "primary" : "secondary"}>管理我的会员</Link>
            : <Link href="/register" className={plan.id === recommendedId ? "primary" : "secondary"}>选择{plan.name}</Link>}
        </article>)}
      </div>
    </section>

    <section className="landing-section" id="roles">
      <h2>角色与权限</h2>
      <div className="role-grid">
        {roles.map(role => <article key={role.name} className="role-card"><h3>{role.name}</h3><p>{role.desc}</p></article>)}
      </div>
    </section>

    <footer className="landing-footer">
      <span>{siteName} · AI 视频创作平台</span>
      <span className="muted landing-legal">
        <Link href="/legal/terms">用户协议</Link>
        <Link href="/legal/privacy">隐私政策</Link>
        {contactEmail ? <span>客服 {contactEmail}</span> : null}
      </span>
    </footer>
  </div>;
}
