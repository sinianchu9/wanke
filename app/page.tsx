import Link from "next/link";
import type { Metadata } from "next";
import {
  Sparkles,
  Image as ImageIcon,
  UserCheck,
  ShieldCheck,
  ScanFace,
  Mic2,
  Wand2,
  Clapperboard,
  Languages,
  FolderKanban,
  Check,
  Search,
  ChevronDown,
  ArrowRight,
  Play,
  Layers,
  Sparkle,
  Film,
  Video,
  Music,
  Sliders,
  Users,
  Settings,
  Clock,
  Compass,
} from "lucide-react";
import { getPageUser } from "@/lib/auth";
import { catalogPlans } from "@/lib/membership";
import { getSetting } from "@/lib/system-settings";

export const metadata: Metadata = {
  title: "好秀，AI视频一键秀出来",
  description: "好秀 · 商业级 AI 视频创作平台。好秀，AI视频一键秀出来！把创意变成成片，一个工作台完成全部 AI 视频生产。",
};

export const dynamic = "force-dynamic";

// 10 大核心创作场景能力
const capabilities = [
  {
    icon: Sparkles,
    name: "描述生成视频",
    desc: "用自然语言，生成高质量视频\n支持多种风格与场景",
    color: "blue",
  },
  {
    icon: ImageIcon,
    name: "图生视频",
    desc: "让图片动起来\n赋予静态画面的生命",
    color: "purple",
  },
  {
    icon: UserCheck,
    name: "人物一致",
    desc: "保持角色一致性\n多场景、多镜头自然衔接",
    color: "amber",
  },
  {
    icon: ShieldCheck,
    name: "高级复刻",
    desc: "复刻风格、声音与画面\n快速打造专属视频模型",
    color: "navy",
  },
  {
    icon: ScanFace,
    name: "数字人口播",
    desc: "逼真数字人，轻松生成口播视频\n支持多语言与多场景",
    color: "emerald",
  },
  {
    icon: Mic2,
    name: "旁白成片",
    desc: "输入旁白，自动匹配画面和字幕",
    color: "cyan",
  },
  {
    icon: Wand2,
    name: "快速向导",
    desc: "新手也能快速上手\n三步生成精彩视频",
    color: "violet",
  },
  {
    icon: Clapperboard,
    name: "故事板",
    desc: "用分镜讲好你的故事\n让创作更可控",
    color: "gold",
  },
  {
    icon: Languages,
    name: "视频翻译",
    desc: "一键翻译，连接全球观众\n支持多语言字幕与配音",
    color: "teal",
  },
  {
    icon: FolderKanban,
    name: "作品/素材/任务管理",
    desc: "统一管理，团队高效协作\n让创作井井有条",
    color: "indigo",
  },
];

const roles = [
  { name: "个人创作者", desc: "从灵感到分镜，一站式生成高品质视频，个人也能打造专业大片。" },
  { name: "电商与品牌", desc: "批量制作产品宣传片、数字人带货口播与多语言出海视频，大幅降低制作成本。" },
  { name: "内容团队与机构", desc: "统一管理任务、人物模型与素材资产，支持多人协作与标准化视频工业化交付。" },
];

export default async function LandingPage() {
  const user = await getPageUser();
  const plans = catalogPlans({ kind: "membership" });
  const recommendedId = plans.find((plan) => plan.recommended)?.id || plans[0]?.id;
  const siteName = getSetting("site_name")?.replace(/wanke/gi, "好秀") || "好秀";
  const contactEmail = getSetting("contact_email")?.trim();

  return (
    <div className="landing-root">
      {/* 宇宙深空、地球大气光晕与繁星背景 */}
      <div className="cosmic-bg" aria-hidden="true">
        <div className="stars-layer" />
        <div className="earth-arc-glow" />
        <div className="cosmic-nebula nebula-blue" />
        <div className="cosmic-nebula nebula-purple" />
        <div className="terrain-mask" />
      </div>

      {/* 顶部高定导航栏 */}
      <header className="cosmic-nav">
        <div className="cosmic-shell nav-inner">
          <Link href="/" className="brand-badge">
            {/* 金色流线型品牌 Logo */}
            <span className="brand-logo-wrap">
              <svg className="brand-gold-logo" viewBox="0 0 36 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M3 8C4.5 16 7.5 24 10.5 24C13.5 24 15.5 12 18 12C20.5 12 22.5 24 25.5 24C28.5 24 31.5 16 33 8"
                  stroke="url(#goldGrad)"
                  strokeWidth="4.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <defs>
                  <linearGradient id="goldGrad" x1="3" y1="8" x2="33" y2="24" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#FFE8A3" />
                    <stop offset="0.5" stopColor="#F5B942" />
                    <stop offset="1" stopColor="#E08B14" />
                  </linearGradient>
                </defs>
              </svg>
            </span>
            <div className="brand-name-group">
              <span className="brand-title">好秀</span>
              <span className="brand-subtitle">AI VIDEO PLATFORM</span>
            </div>
          </Link>

          <nav className="nav-menu">
            <a href="#capabilities" className="nav-item has-arrow">
              产品能力 <ChevronDown size={14} className="arrow-down" />
            </a>
            <a href="#solutions" className="nav-item">解决方案</a>
            <a href="#pricing" className="nav-item">价格</a>
            <a href="#roles" className="nav-item">角色与权限</a>
            <a href="#help" className="nav-item">帮助中心</a>
            <a href="#community" className="nav-item">社区</a>
          </nav>

          <div className="nav-actions">
            <button className="search-btn" title="搜索" aria-label="搜索">
              <Search size={16} />
            </button>
            {user ? (
              <Link href="/studio" className="btn-primary-gold">
                进入工作台
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn-ghost-dark">
                  登录
                </Link>
                <Link href="/register" className="btn-primary-gold">
                  免费注册
                </Link>
              </>
            )}
            <div className="lang-selector">
              <span>中文</span>
              <ChevronDown size={13} />
            </div>
          </div>
        </div>
      </header>

      {/* Hero 核心区域 */}
      <section className="cosmic-hero">
        <div className="cosmic-shell hero-container">
          {/* Hero 左侧：文案、核心主张、CTA 及核心指标 */}
          <div className="hero-content">
            <div className="hero-pill-tag">
              <span className="pill-dot" />
              <span>AI 让每一个好创意，都被看见</span>
            </div>

            <h1 className="hero-headline">
              把创意变成成片，
              <br />
              <span className="hero-headline-sub">一个工作台完成全部 AI 视频生产</span>
            </h1>

            <div className="hero-subline">
              <p className="hero-brand-line">
                <strong>好秀</strong> · 商业级 AI 视频创作平台
              </p>
              <p className="hero-intro-line">
                好秀，AI视频一键秀出来！从灵感到成片，覆盖创作全流程，让个人与团队都能轻松制作专业级视频。
              </p>
            </div>

            <div className="hero-buttons">
              {user ? (
                <Link href="/studio" className="btn-cta-gold">
                  <span>继续创作 · {user.name}</span>
                  <ArrowRight size={17} />
                </Link>
              ) : (
                <Link href="/register" className="btn-cta-gold">
                  <span>免费开始创作</span>
                  <ArrowRight size={17} />
                </Link>
              )}
              <a href="#pricing" className="btn-cta-dark">
                查看套餐
              </a>
            </div>

            {/* 电影胶片流光装饰与情怀标识 */}
            <div className="hero-slogan-wrap">
              <div className="film-strip-deco">
                <div className="film-holes top" />
                <div className="film-frames">
                  <span className="film-frame f1" />
                  <span className="film-frame f2" />
                  <span className="film-frame f3" />
                  <span className="film-frame f4" />
                </div>
                <div className="film-holes bottom" />
              </div>
              <div className="hero-vertical-tag">
                <span>GOOD</span>
                <span>IDEAS</span>
                <span>TRAVEL</span>
                <span>FURTHER</span>
              </div>
            </div>

            {/* 4 大核心数据指标条 */}
            <div className="hero-metrics-row">
              <div className="metric-item">
                <div className="metric-num">100万+</div>
                <div className="metric-label">创作者的选择</div>
              </div>
              <div className="metric-item">
                <div className="metric-num">5000万+</div>
                <div className="metric-label">AI 生成视频</div>
              </div>
              <div className="metric-item">
                <div className="metric-num">99%</div>
                <div className="metric-label">用户满意度</div>
              </div>
              <div className="metric-item">
                <div className="metric-num">全球 100+</div>
                <div className="metric-label">国家和地区</div>
              </div>
            </div>
          </div>

          {/* Hero 右侧：3D 悬浮智能生产工作台 Mockup */}
          <div className="hero-visual-area">
            {/* 太空悬浮提示与播放器微标 */}
            <div className="floating-cosmic-element">
              <div className="floating-capsule">
                <span className="capsule-ai">AI</span>
                <span>MORE CREATIVE WORLD</span>
              </div>
              <div className="floating-play-ring">
                <Play size={18} fill="currentColor" />
              </div>
              <div className="floating-vert-caption">
                <span>AI VIDEO CREATIVE</span>
                <span>FOR A BETTER TOMORROW</span>
              </div>
            </div>

            {/* 3D 浮空控制台视窗 */}
            <div className="studio-stage-mock">
              {/* 视窗顶栏 */}
              <div className="mock-header">
                <div className="mock-brand">
                  <svg className="mock-logo" viewBox="0 0 24 18" fill="none">
                    <path
                      d="M2 5C3 11 5 16 7 16C9 16 10.5 8 12 8C13.5 8 15 16 17 16C19 16 21 11 22 5"
                      stroke="url(#goldGradSm)"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                    />
                    <defs>
                      <linearGradient id="goldGradSm" x1="2" y1="5" x2="22" y2="16" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#FFE8A3" />
                        <stop offset="1" stopColor="#E08B14" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <span>好秀</span>
                </div>
                <div className="mock-search-bar">
                  <Search size={12} className="mock-search-icon" />
                  <span>搜索你想要的视频场景...</span>
                </div>
                <div className="mock-user-badge">
                  <div className="mock-avatar" />
                  <div className="mock-user-info">
                    <span className="mock-user-name">创作不设限</span>
                    <span className="mock-user-sub">Good ideas, More videos.</span>
                  </div>
                </div>
              </div>

              {/* 视窗主体：左侧边栏 + 中部工作区 */}
              <div className="mock-body-layout">
                {/* 模拟侧边栏 */}
                <aside className="mock-sidebar">
                  <div className="mock-nav-item active">
                    <Sparkles size={13} />
                    <span>创作工作台</span>
                  </div>
                  <div className="mock-nav-item">
                    <Film size={13} />
                    <span>我的作品</span>
                  </div>
                  <div className="mock-divider" />
                  <div className="mock-nav-item">
                    <Layers size={13} />
                    <span>任务中心</span>
                  </div>
                  <div className="mock-nav-item">
                    <Users size={13} />
                    <span>团队协作</span>
                  </div>
                  <div className="mock-nav-item">
                    <UserCheck size={13} />
                    <span>模型与复刻</span>
                  </div>
                  <div className="mock-nav-item">
                    <Languages size={13} />
                    <span>视频翻译</span>
                  </div>
                  <div className="mock-nav-item">
                    <Settings size={13} />
                    <span>账户设置</span>
                  </div>
                </aside>

                {/* 模拟中心创作大面板 */}
                <main className="mock-main-content">
                  {/* Banner 头部发光创作海报 */}
                  <div className="mock-hero-banner">
                    <div className="mock-banner-text">
                      <h3>用 AI，讲好你的故事</h3>
                      <p>从一个想法，生成一支精彩的视频</p>
                    </div>
                    <div className="mock-banner-art">
                      <div className="mock-art-poster">
                        <span>IDEAS INTO VIDEOS</span>
                      </div>
                    </div>
                  </div>

                  {/* 智能 Prompt 输入框与快捷胶囊 */}
                  <div className="mock-prompt-box">
                    <div className="mock-input-row">
                      <Search size={14} className="prompt-icon" />
                      <span className="prompt-placeholder">描述你想要的视频场景...</span>
                      <button className="btn-mock-generate">
                        <Sparkle size={13} />
                        <span>生成视频</span>
                      </button>
                    </div>
                    <div className="mock-quick-tabs">
                      <span className="qtab active">
                        <Sparkles size={11} />
                        描述生成视频
                      </span>
                      <span className="qtab">
                        <ImageIcon size={11} />
                        图生视频
                      </span>
                      <span className="qtab">
                        <ScanFace size={11} />
                        数字人口播
                      </span>
                      <span className="qtab">
                        <Languages size={11} />
                        视频翻译
                      </span>
                      <span className="qtab more">··· 更多工具</span>
                    </div>
                  </div>

                  {/* 下方分栏：我的任务 + 我的作品 + 素材库 */}
                  <div className="mock-lower-grid">
                    {/* 左侧：我的任务队列 */}
                    <div className="mock-task-panel">
                      <div className="mock-panel-title">
                        <span>我的任务</span>
                      </div>
                      <div className="mock-task-list">
                        <div className="mock-task-card">
                          <div className="task-thumb t1" />
                          <div className="task-meta">
                            <div className="task-row">
                              <span className="task-name">产品宣传片_夏季版</span>
                              <span className="task-status blue">生成中 72%</span>
                            </div>
                            <div className="task-progress-bar">
                              <div className="bar-fill w-72" />
                            </div>
                            <div className="task-eta">预计 3 分钟</div>
                          </div>
                        </div>

                        <div className="mock-task-card">
                          <div className="task-thumb t2" />
                          <div className="task-meta">
                            <div className="task-row">
                              <span className="task-name">品牌故事短片</span>
                              <span className="task-status amber">排队中 30%</span>
                            </div>
                            <div className="task-progress-bar">
                              <div className="bar-fill w-30" />
                            </div>
                            <div className="task-eta">预计 12 分钟</div>
                          </div>
                        </div>

                        <div className="mock-task-card">
                          <div className="task-thumb t3" />
                          <div className="task-meta">
                            <div className="task-row">
                              <span className="task-name">数字人口播_产品介绍</span>
                              <span className="task-time">今天 10:24</span>
                            </div>
                          </div>
                        </div>

                        <div className="mock-task-card">
                          <div className="task-thumb t4" />
                          <div className="task-meta">
                            <div className="task-row">
                              <span className="task-name">英文视频翻译</span>
                              <span className="task-status cyan">处理中 50%</span>
                            </div>
                            <div className="task-progress-bar">
                              <div className="bar-fill w-50" />
                            </div>
                            <div className="task-eta">预计 8 分钟</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 右侧：我的作品 & 素材库 */}
                    <div className="mock-gallery-panel">
                      {/* 我的作品 */}
                      <div className="gallery-section">
                        <div className="mock-panel-title">
                          <span>我的作品</span>
                          <span className="view-more">查看更多 &gt;</span>
                        </div>
                        <div className="works-thumbnails">
                          <div className="work-thumb w1">
                            <div className="thumb-info">
                              <span className="w-title">品牌宣传片</span>
                              <span className="w-duration">00:48</span>
                            </div>
                          </div>
                          <div className="work-thumb w2">
                            <div className="thumb-info">
                              <span className="w-title">产品介绍</span>
                              <span className="w-duration">01:12</span>
                            </div>
                          </div>
                          <div className="work-thumb w3">
                            <div className="thumb-info">
                              <span className="w-title">城市影像</span>
                              <span className="w-duration">00:35</span>
                            </div>
                          </div>
                          <div className="work-thumb w4">
                            <div className="thumb-info">
                              <span className="w-title">创意短片</span>
                              <span className="w-duration">00:20</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 素材库 */}
                      <div className="gallery-section">
                        <div className="mock-panel-title">
                          <span>素材库</span>
                          <span className="view-more">查看更多 &gt;</span>
                        </div>
                        <div className="assets-thumbnails">
                          <div className="asset-thumb a1">
                            <div className="thumb-info">
                              <span className="a-title">视频</span>
                              <span className="a-count">128</span>
                            </div>
                          </div>
                          <div className="asset-thumb a2">
                            <div className="thumb-info">
                              <span className="a-title">图片</span>
                              <span className="a-count">935</span>
                            </div>
                          </div>
                          <div className="asset-thumb a3">
                            <div className="thumb-info">
                              <span className="a-title">音频</span>
                              <span className="a-count">320</span>
                            </div>
                          </div>
                          <div className="asset-thumb a4">
                            <div className="thumb-info">
                              <span className="a-title">模板</span>
                              <span className="a-count">86</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </main>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 10 大核心创作能力矩阵 */}
      <section className="cosmic-section" id="capabilities">
        <div className="cosmic-shell">
          <div className="section-head-bar">
            <div>
              <div className="section-eyebrow">
                <span className="blue-dot" />
                <span>强大的 AI 视频能力，覆盖创作全场景</span>
              </div>
              <h2 className="section-title">从灵感到大片，创作如此简单</h2>
              <p className="section-subtitle">
                好秀为创作者和小团队，提供一站式 AI 视频生产能力，让创意更快落地。
              </p>
            </div>
            <Link href={user ? "/studio" : "/register"} className="btn-explore-all">
              <span>探索全部能力</span>
              <ArrowRight size={15} />
            </Link>
          </div>

          <div className="capability-matrix">
            {capabilities.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.name} className={`cap-card cap-${item.color}`}>
                  <div className="cap-card-inner">
                    <div className="cap-top-row">
                      <div className="cap-icon-box">
                        <Icon size={22} />
                      </div>
                      <ArrowRight size={16} className="cap-arrow" />
                    </div>
                    <h3 className="cap-name">{item.name}</h3>
                    <p className="cap-desc">{item.desc}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* 解决方案与应用场景 */}
      <section className="cosmic-section" id="solutions">
        <div className="cosmic-shell">
          <div className="section-center-head">
            <div className="section-eyebrow">
              <span className="blue-dot" />
              <span>赋能千行百业的 AI 视频工业化能力</span>
            </div>
            <h2 className="section-title">全场景解决方案，让视频生产力倍增</h2>
            <p className="section-subtitle">
              无论您是独立创作者、出海品牌还是规模化制作团队，好秀均能提供开箱即用的工作流。
            </p>
          </div>

          <div className="solutions-grid">
            <div className="solution-card">
              <div className="sol-badge">出海与跨境电商</div>
              <h3>全球化多语言视频获客</h3>
              <p>一键消除语言隔阂，视频多语言精准配音、嘴型同步与本地化字幕，助力商品迅速打入全球海外市场。</p>
            </div>
            <div className="solution-card featured">
              <div className="sol-badge gold">企业与品牌宣传</div>
              <h3>商业级品牌大片与数字人营销</h3>
              <p>影视级画质渲染与专业分镜故事板，结合超拟真数字人智能口播，大幅度缩短宣传片制作交付周期。</p>
            </div>
            <div className="solution-card">
              <div className="sol-badge">自媒体与知识博主</div>
              <h3>高频高质内容矩阵生产</h3>
              <p>文本、旁白一键成片，角色与画面保持长效一致，让单人创作者也能保持日更高产的内容节奏。</p>
            </div>
          </div>
        </div>
      </section>

      {/* 会员套餐与价格 */}
      <section className="cosmic-section" id="pricing">
        <div className="cosmic-shell">
          <div className="section-center-head">
            <div className="section-eyebrow">
              <span className="blue-dot" />
              <span>透明计费 · 灵活创作</span>
            </div>
            <h2 className="section-title">选择适合你的创作节奏</h2>
            <p className="section-subtitle">
              创作额度按次消耗，提交前明确显示预计消耗；生成未成功会自动退回额度，创作有保障。
            </p>
          </div>

          <div className="cosmic-plans-grid">
            {plans.map((plan) => {
              const isRecommended = plan.id === recommendedId;
              return (
                <article key={plan.id} className={`cosmic-plan-card ${isRecommended ? "featured" : ""}`}>
                  {isRecommended && <div className="featured-ribbon">推荐之选</div>}
                  <header className="plan-header">
                    <h3 className="plan-title">{plan.name}</h3>
                    <div className="plan-price-wrap">
                      {plan.priceCents === 0 ? (
                        <span className="price-val">免费</span>
                      ) : (
                        <>
                          <span className="price-val">{plan.priceText}</span>
                          <span className="price-cycle">/ {plan.validityDays} 天</span>
                        </>
                      )}
                    </div>
                    <p className="plan-subtitle">{plan.subtitle}</p>
                  </header>

                  <div className="plan-divider" />

                  <ul className="plan-feature-list">
                    <li className="feature-item highlight">
                      <Check size={14} className="feature-check" />
                      <span>{plan.credits} 个创作额度</span>
                    </li>
                    {plan.features
                      .filter((f) => !f.includes("创作额度"))
                      .map((feat) => (
                        <li key={feat} className="feature-item">
                          <Check size={14} className="feature-check" />
                          <span>{feat}</span>
                        </li>
                      ))}
                  </ul>

                  <div className="plan-cta-box">
                    {user ? (
                      <Link
                        href="/account"
                        className={isRecommended ? "btn-plan-gold" : "btn-plan-ghost"}
                      >
                        管理我的会员
                      </Link>
                    ) : (
                      <Link
                        href="/register"
                        className={isRecommended ? "btn-plan-gold" : "btn-plan-ghost"}
                      >
                        选择 {plan.name}
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* 角色与权限 */}
      <section className="cosmic-section" id="roles">
        <div className="cosmic-shell">
          <div className="section-center-head">
            <h2 className="section-title">角色与权限</h2>
            <p className="section-subtitle">专为创作者、团队与运营打造的分层协同架构。</p>
          </div>
          <div className="cosmic-roles-grid">
            {roles.map((role) => (
              <article key={role.name} className="cosmic-role-card">
                <h3 className="role-title">{role.name}</h3>
                <p className="role-desc">{role.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 底部 Footer */}
      <footer className="cosmic-footer">
        <div className="cosmic-shell footer-inner">
          <div className="footer-brand-side">
            <div className="footer-brand">
              <span className="brand-logo-sm">
                <svg viewBox="0 0 36 28" fill="none" width="22" height="18">
                  <path
                    d="M3 8C4.5 16 7.5 24 10.5 24C13.5 24 15.5 12 18 12C20.5 12 22.5 24 25.5 24C28.5 24 31.5 16 33 8"
                    stroke="url(#goldGradFt)"
                    strokeWidth="4.2"
                    strokeLinecap="round"
                  />
                  <defs>
                    <linearGradient id="goldGradFt" x1="3" y1="8" x2="33" y2="24" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#FFE8A3" />
                      <stop offset="1" stopColor="#E08B14" />
                    </linearGradient>
                  </defs>
                </svg>
              </span>
              <strong>好秀</strong>
              <span>· AI 视频创作平台</span>
            </div>
            <p className="footer-slogan">好秀，AI视频一键秀出来！让每一个好创意，都被看见。</p>
          </div>

          <div className="footer-links-side">
            <div className="footer-col">
              <h4>产品能力</h4>
              <a href="#capabilities">描述生成视频</a>
              <a href="#capabilities">图生视频</a>
              <a href="#capabilities">数字人口播</a>
              <a href="#capabilities">视频翻译</a>
            </div>
            <div className="footer-col">
              <h4>支持与服务</h4>
              <a href="#pricing">会员方案</a>
              <a href="#roles">权限说明</a>
              {contactEmail ? <span>客服：{contactEmail}</span> : <span>客服支持随时在线</span>}
            </div>
            <div className="footer-col">
              <h4>法律合规</h4>
              <Link href="/legal/terms">用户协议</Link>
              <Link href="/legal/privacy">隐私政策</Link>
            </div>
          </div>
        </div>

        <div className="cosmic-shell footer-bottom">
          <span>&copy; {new Date().getFullYear()} 好秀 (HaoXiu AI). All rights reserved.</span>
          <span className="footer-tagline">GOOD IDEAS TRAVEL FURTHER</span>
        </div>
      </footer>
    </div>
  );
}

