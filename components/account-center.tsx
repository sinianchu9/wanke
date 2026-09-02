"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Crown, LoaderCircle } from "lucide-react";

interface Membership {
  plan: string;
  status: string;
  quotaLimitVideos: number;
  quotaUsedVideos: number;
  quotaRemainingVideos: number;
  periodStart: string;
  periodEnd: string;
  planInfo: { id: string; label: string; monthlyVideos: number; priceMonthly: number; tagline: string; features: string[] };
}

interface PlanInfo { id: string; label: string; monthlyVideos: number; priceMonthly: number; tagline: string; features: string[] }

export default function AccountCenter() {
  const [user, setUser] = useState<any>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/membership", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "加载失败");
      setMembership(body.membership);
      setPlans(body.plans || []);
      const me = await fetch("/api/auth/me", { cache: "no-store" }).then(r => r.json());
      setUser(me.user);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function switchPlan(planId: string) {
    const target = plans.find(plan => plan.id === planId);
    if (!target) return;
    const cost = target.priceMonthly > 0 ? `（演示期模拟支付 ¥${target.priceMonthly}/月）` : "（免费）";
    if (!confirm(`切换到「${target.label}」套餐${cost}？\n切换后立即开启新的计费周期，额度重置为每月 ${target.monthlyVideos} 条。`)) return;
    setBusy(planId);
    setNotice("");
    try {
      const response = await fetch("/api/membership/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "切换失败");
      setMembership(body.membership);
      setNotice(`已切换到「${body.membership.planInfo?.label}」，新的额度周期已开始。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  if (loading) return <div className="works-empty"><LoaderCircle className="spin" size={22}/>正在加载会员中心…</div>;

  const usedPercent = membership ? Math.min(100, Math.round((membership.quotaUsedVideos / Math.max(1, membership.quotaLimitVideos)) * 100)) : 0;

  return <div className="account-wrap">
    <div className="account-top">
      <Link href="/studio" className="secondary"><ArrowLeft size={14}/>返回工作台</Link>
      <div>
        <h1>会员中心</h1>
        <p className="muted">{user?.name} · {user?.email}</p>
      </div>
    </div>

    {notice && <div className="notice" style={{ margin: 0 }}>{notice}</div>}

    {membership && <div className="account-grid">
      <section className="panel account-current">
        <div className="panel-head">
          <h2>当前套餐</h2>
          <span className={`plan-badge ${membership.plan}`}>{membership.planInfo.label}</span>
        </div>
        <div className="quota-block">
          <div className="quota-numbers">
            <strong>{membership.quotaUsedVideos}<small> / {membership.quotaLimitVideos} 条已用</small></strong>
            <span>剩余 {membership.quotaRemainingVideos} 条</span>
          </div>
          <div className="quota-bar"><i style={{ width: `${usedPercent}%` }}/></div>
        </div>
        <dl className="kv-list">
          <div><dt>套餐状态</dt><dd>{membership.status === "active" ? "生效中" : membership.status === "suspended" ? "已停用" : "已过期"}</dd></div>
          <div><dt>本周期开始</dt><dd>{new Date(membership.periodStart).toLocaleDateString("zh-CN")}</dd></div>
          <div><dt>本周期结束</dt><dd>{new Date(membership.periodEnd).toLocaleDateString("zh-CN")}（到期自动重置额度）</dd></div>
        </dl>
        <p className="mini muted">额度规则：提交生成任务成功即计 1 条；远端提交失败自动退回；生成中的远端失败不退回（详见服务条款）。</p>
      </section>

      <section className="plan-grid">
        {plans.map(plan => {
          const current = plan.id === membership.plan;
          return <article key={plan.id} className={`plan-card ${current ? "current" : ""}`}>
            <header>
              <h3>{plan.label}{current && <em>当前</em>}</h3>
              <div className="plan-price">{plan.priceMonthly === 0 ? "免费" : <>¥{plan.priceMonthly}<small>/月</small></>}</div>
              <p className="muted">{plan.tagline}</p>
            </header>
            <ul>
              <li><Check size={13}/>每月 {plan.monthlyVideos} 条生成额度</li>
              {plan.features.filter(feature => !feature.startsWith("每月")).map(feature => <li key={feature}><Check size={13}/>{feature}</li>)}
            </ul>
            <button className={current ? "secondary" : "primary"} disabled={current || busy !== ""} onClick={() => switchPlan(plan.id)}>
              {busy === plan.id ? <LoaderCircle className="spin" size={14}/> : null}
              {current ? "使用中" : plan.priceMonthly > 0 ? `升级到 ${plan.label}` : "切换为免费版"}
            </button>
          </article>;
        })}
      </section>
    </div>}

    <p className="mini muted account-footnote"><Crown size={12}/>演示期说明：套餐切换为模拟支付，不产生真实扣费；正式计费渠道（支付宝/微信/Stripe）是下一个里程碑的扩展点。</p>
  </div>;
}
