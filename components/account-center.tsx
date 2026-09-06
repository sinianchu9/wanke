"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Coins, Crown, LoaderCircle, Receipt, Settings2 } from "lucide-react";
import UserSettingsPanel from "@/components/user-settings-panel";

type Section = "membership" | "credits" | "orders" | "settings";

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Crown }> = [
  { id: "membership", label: "我的会员", icon: Crown },
  { id: "credits", label: "额度明细", icon: Coins },
  { id: "orders", label: "我的订单", icon: Receipt },
  { id: "settings", label: "账号设置", icon: Settings2 },
];

type Membership = {
  plan: string;
  planName: string;
  statusText: string;
  credits: { planLimit: number; planUsed: number; planRemaining: number; bonus: number; available: number };
  periodStart: string;
  periodEnd: string;
  daysUntilRenewal: number;
  planInfo: { id: string; name: string; subtitle: string; priceCents: number; priceText: string; credits: number; validityDays: number; features: string[]; recommended: boolean };
};

type CatalogPlan = { id: string; kind: string; name: string; subtitle: string; priceCents: number; priceText: string; credits: number; validityDays: number; features: string[]; recommended: boolean; purchasable: boolean };

type LedgerEntry = { id: string; delta: number; balanceAfter: number; reasonText: string; note: string; createdAt: string };

type OrderRow = {
  id: string; orderNo: string; productName: string; amountCents: number; credits: number;
  status: string; statusText: string; statusHint: string; payable: boolean; payableCents: number;
  refundedCents: number; refundable: boolean; createdAt: string; paidAt: string | null; expiresAt: string;
};

async function call(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "加载失败");
  return body;
}

function yuan(cents: number) {
  return `¥${(Math.round(cents) / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export default function AccountCenter() {
  const [section, setSection] = useState<Section>("membership");
  const [user, setUser] = useState<any>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [packs, setPacks] = useState<CatalogPlan[]>([]);
  const [paymentAvailable, setPaymentAvailable] = useState(false);
  const [ledger, setLedger] = useState<{ total: number; entries: LedgerEntry[] }>({ total: 0, entries: [] });
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [membershipBody, meBody, ledgerBody, orderBody, profileBody] = await Promise.all([
      call("/api/membership"),
      call("/api/auth/me"),
      call("/api/quota/ledger?limit=50"),
      call("/api/orders"),
      call("/api/account/profile"),
    ]);
    setMembership(membershipBody.membership);
    setPlans(membershipBody.plans || []);
    setPacks(membershipBody.packs || []);
    setUser(meBody.user);
    setLedger({ total: ledgerBody.total || 0, entries: ledgerBody.entries || [] });
    setOrders(orderBody.orders || []);
    setPaymentAvailable(Boolean(profileBody.site?.paymentEnabled));
  }, []);

  useEffect(() => {
    load()
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [load]);

  /**
   * Hand the browser to the Alipay cashier. Nothing about the membership changes here:
   * the server settles the order from the verified notification or its own query.
   */
  async function startPay(orderId: string): Promise<boolean> {
    const channel = typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches ? "wap" : "page";
    const body = await call(`/api/orders/${orderId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    if (body.payUrl) {
      window.location.href = body.payUrl;
      return true;
    }
    setNotice(body.notice || "支付页面已经准备好，请继续完成支付。");
    return false;
  }

  async function checkout(plan: CatalogPlan) {
    setBusy(plan.id);
    setNotice("");
    setError("");
    try {
      const clientToken = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now()}${Math.random().toString(36).slice(2)}`;
      const body = await call("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, clientToken, device: window.matchMedia("(max-width: 720px)").matches ? "wap" : "pc" }),
      });
      setPaymentAvailable(Boolean(body.paymentAvailable));
      const order = body.order;
      if (order.status === "paid") {
        await load();
        setSection("membership");
        setNotice(`「${order.productName}」已经生效，权益已到账。`);
        return;
      }
      if (body.paymentAvailable && order.payableCents > 0 && await startPay(order.id)) return;
      const orderBody = await call("/api/orders");
      setOrders(orderBody.orders || []);
      setSection("orders");
      setNotice(body.paymentAvailable
        ? `订单 ${order.orderNo} 已创建，请在有效期内完成支付。`
        : `订单 ${order.orderNo} 已创建。支付通道开通后可以在「我的订单」继续支付。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function pay(order: OrderRow) {
    setBusy(order.id);
    setNotice("");
    setError("");
    try {
      await startPay(order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function requestRefund(order: OrderRow) {
    const reason = window.prompt(`申请退款（订单 ${order.orderNo}）\n请简单说明原因，我们会在审核后原路退回：`, "");
    if (reason === null) return;
    if (reason.trim().length < 2) {
      setError("请填写退款原因（至少 2 个字）");
      return;
    }
    setBusy(order.id);
    setNotice("");
    setError("");
    try {
      const body = await call(`/api/orders/${order.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await load();
      setNotice(body.notice || "退款申请已经提交，我们会尽快处理。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function cancel(order: OrderRow) {
    if (!confirm(`取消订单 ${order.orderNo}？`)) return;
    setBusy(order.id);
    try {
      await call(`/api/orders/${order.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const orderBody = await call("/api/orders");
      setOrders(orderBody.orders || []);
      setNotice("订单已取消。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  if (loading) return <div className="works-empty"><LoaderCircle className="spin" size={22} />正在加载会员中心…</div>;

  const usedPercent = membership
    ? Math.min(100, Math.round((membership.credits.planUsed / Math.max(1, membership.credits.planLimit)) * 100))
    : 0;

  return <div className="account-wrap">
    <div className="account-top">
      <Link href="/studio" className="secondary"><ArrowLeft size={14} />返回工作台</Link>
      <div>
        <h1>会员中心</h1>
        <p className="muted">{user?.name} · {user?.email}</p>
      </div>
    </div>

    {notice && <div className="notice" style={{ margin: 0 }}>{notice}</div>}
    {error && <div className="error-banner">{error}</div>}

    <div className="member-layout">
      <nav className="member-nav">
        {SECTIONS.map(item => (
          <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
            <item.icon size={15} /><span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="member-body">
        {section === "membership" && membership && <>
          <section className="panel account-current">
            <div className="panel-head">
              <h2>当前会员</h2>
              <span className={`plan-badge ${membership.plan}`}>{membership.planName}</span>
            </div>
            <div className="quota-block">
              <div className="quota-numbers">
                <strong>{membership.credits.available}<small> 个创作额度可用</small></strong>
                <span>本周期已用 {membership.credits.planUsed} / {membership.credits.planLimit}{membership.credits.bonus > 0 ? ` · 加油包余额 ${membership.credits.bonus}` : ""}</span>
              </div>
              <div className="quota-bar"><i style={{ width: `${usedPercent}%` }} /></div>
            </div>
            <dl className="kv-list">
              <div><dt>会员状态</dt><dd>{membership.statusText}</dd></div>
              <div><dt>有效期至</dt><dd>{new Date(membership.periodEnd).toLocaleDateString("zh-CN")}（还有 {membership.daysUntilRenewal} 天）</dd></div>
              <div><dt>本周期开始</dt><dd>{new Date(membership.periodStart).toLocaleDateString("zh-CN")}</dd></div>
            </dl>
            <p className="mini muted">创作额度按创作类型消耗，提交前会显示本次预计消耗；创作未完成时额度会按规则退回。</p>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>会员套餐</h2>{!paymentAvailable && <span className="muted mini">支付通道开通后即可在线购买</span>}</div>
            <div className="plan-grid">
              {plans.map(plan => {
                const current = plan.id === membership.plan;
                return <article key={plan.id} className={`plan-card ${current ? "current" : ""} ${plan.recommended ? "featured" : ""}`}>
                  <header>
                    <h3>{plan.name}{current ? <em>当前</em> : plan.recommended ? <em>推荐</em> : null}</h3>
                    <div className="plan-price">{plan.priceCents === 0 ? "免费" : <>{plan.priceText}<small> / {plan.validityDays} 天</small></>}</div>
                    <p className="muted">{plan.subtitle}</p>
                  </header>
                  <ul>
                    <li><Check size={13} />{plan.credits} 个创作额度</li>
                    {plan.features.filter(feature => !feature.includes("创作额度")).map(feature => <li key={feature}><Check size={13} />{feature}</li>)}
                  </ul>
                  {plan.priceCents === 0
                    ? <button className="secondary" disabled>当前已包含</button>
                    : <button className={current ? "secondary" : "primary"} disabled={!plan.purchasable || busy !== ""} onClick={() => checkout(plan)}>
                        {busy === plan.id ? <LoaderCircle className="spin" size={14} /> : null}
                        {current ? "续费" : "立即开通"}
                      </button>}
                </article>;
              })}
            </div>
          </section>

          {packs.length > 0 && <section className="panel">
            <div className="panel-head"><h2>创作额度加油包</h2><span className="muted mini">额度用完时按需补充，不改变会员有效期</span></div>
            <div className="plan-grid">
              {packs.map(pack => <article key={pack.id} className={`plan-card ${pack.recommended ? "featured" : ""}`}>
                <header>
                  <h3>{pack.name}</h3>
                  <div className="plan-price">{pack.priceText}</div>
                  <p className="muted">{pack.subtitle}</p>
                </header>
                <ul>{pack.features.map(feature => <li key={feature}><Check size={13} />{feature}</li>)}</ul>
                <button className="primary" disabled={!pack.purchasable || busy !== ""} onClick={() => checkout(pack)}>
                  {busy === pack.id ? <LoaderCircle className="spin" size={14} /> : null}立即购买
                </button>
              </article>)}
            </div>
          </section>}
        </>}

        {section === "credits" && <section className="panel">
          <div className="panel-head"><h2>额度明细</h2><span className="muted mini">共 {ledger.total} 条记录</span></div>
          <table className="admin-table">
            <thead><tr><th>时间</th><th>事项</th><th>变动</th><th>变动后余额</th></tr></thead>
            <tbody>
              {ledger.entries.map(entry => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString("zh-CN")}</td>
                  <td><strong>{entry.reasonText}</strong>{entry.note ? <><br /><span className="muted mini">{entry.note}</span></> : null}</td>
                  <td className={entry.delta > 0 ? "success-text" : entry.delta < 0 ? "error-text" : "muted"}>
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                  </td>
                  <td>{entry.balanceAfter}</td>
                </tr>
              ))}
              {ledger.entries.length === 0 && <tr><td colSpan={4} className="muted">还没有额度变动记录</td></tr>}
            </tbody>
          </table>
        </section>}

        {section === "orders" && <section className="panel">
          <div className="panel-head"><h2>我的订单</h2></div>
          <table className="admin-table">
            <thead><tr><th>订单号</th><th>商品</th><th>金额</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>
              {orders.map(order => (
                <tr key={order.id}>
                  <td><strong>{order.orderNo}</strong></td>
                  <td>{order.productName}<br /><span className="muted mini">{order.credits} 个创作额度</span></td>
                  <td>{yuan(order.amountCents)}</td>
                  <td><span className={`stage-state ${order.status === "paid" ? "succeeded" : order.status === "pending" || order.status === "paying" ? "queued" : "failed"}`}>{order.statusText}</span>
                    <br /><span className="muted mini">{order.statusHint}</span></td>
                  <td>{new Date(order.createdAt).toLocaleString("zh-CN")}{order.paidAt ? <><br /><span className="muted mini">支付于 {new Date(order.paidAt).toLocaleString("zh-CN")}</span></> : null}</td>
                  <td className="inline-actions">
                    {order.payable && (order.status === "pending" || order.status === "paying") && <>
                      <button className="primary" disabled={busy === order.id} onClick={() => pay(order)}>
                        {busy === order.id ? <LoaderCircle className="spin" size={14} /> : null}继续支付
                      </button>
                      <Link className="secondary" href={`/payment/result?orderNo=${encodeURIComponent(order.orderNo)}`}>支付结果</Link>
                      <button className="secondary" disabled={busy === order.id} onClick={() => cancel(order)}>取消订单</button>
                    </>}
                    {order.refundable && order.refundedCents < order.payableCents && (
                      <button className="secondary" disabled={busy === order.id} onClick={() => requestRefund(order)}>
                        {busy === order.id ? <LoaderCircle className="spin" size={14} /> : null}申请退款
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={6} className="muted">还没有订单</td></tr>}
            </tbody>
          </table>
        </section>}

        {section === "settings" && <UserSettingsPanel onChanged={load} />}
      </div>
    </div>

    <p className="mini muted account-footnote"><Crown size={12} />会员权益以服务器确认的支付结果为准；订单、额度和作品记录都会长期保留，可随时在这里查询。</p>
  </div>;
}
