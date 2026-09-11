"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, LoaderCircle, Receipt, Sparkles } from "lucide-react";

type PayStatus = {
  orderNo: string;
  productName: string;
  credits: number;
  amountCents: number;
  status: string;
  statusText: string;
  headline: string;
  hint: string;
  tone: "success" | "progress" | "neutral" | "attention";
  settled: boolean;
  providerAsked: boolean;
  note: string;
  paidAt: string | null;
  expiresAt: string;
  isLoggedIn?: boolean;
};

const POLL_MS = 3000;
const MAX_POLLS = 80;

function yuan(cents: number) {
  return `¥${(Math.round(cents || 0) / 100).toFixed((cents || 0) % 100 === 0 ? 0 : 2)}`;
}

/**
 * Payment result page (§10.3).
 *
 * Displays only what the server has confirmed. While the order is still in flight it
 * polls `pay-status`, which in turn asks Alipay directly; the copy never claims a
 * payment failed and never invites a second payment for the same order.
 */
export default function PaymentResult({ orderNo, isLoggedIn = true }: { orderNo: string; isLoggedIn?: boolean }) {
  const [data, setData] = useState<PayStatus | null>(null);
  const [error, setError] = useState("");
  const [polls, setPolls] = useState(0);

  const fetchStatus = useCallback(async (): Promise<PayStatus | null> => {
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderNo)}/pay-status`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "暂时无法获取支付结果");
      setData(body as PayStatus);
      setError("");
      return body as PayStatus;
    } catch (err) {
      // A transient read failure is never shown as a failed payment.
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [orderNo]);

  useEffect(() => {
    if (!orderNo) return undefined;
    let cancelled = false;
    let attempts = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };
    const tick = async () => {
      attempts += 1;
      if (!cancelled) setPolls(attempts);
      const body = await fetchStatus();
      if (cancelled) return;
      if (body?.settled || attempts >= MAX_POLLS) stop();
    };

    void tick();
    interval = setInterval(() => { void tick(); }, POLL_MS);
    return () => { cancelled = true; stop(); };
  }, [orderNo, fetchStatus]);

  const tone = data?.tone || "progress";
  const stageClass = tone === "success" ? "succeeded" : tone === "attention" ? "failed" : tone === "progress" ? "running" : "queued";

  return <div className="account-wrap payment-result-wrap">
    <div className="panel">
      <div className="panel-head">
        <h2>支付结果</h2>
        <span className="muted mini">权益以服务器确认的支付结果为准</span>
      </div>

      {!orderNo ? <div className="works-empty"><div>
        <strong>没有指定订单</strong>
        <span className="muted mini">请从「我的订单」进入支付结果页面。</span>
      </div></div>
        : !data ? <div className="works-empty"><LoaderCircle className="spin" size={20} />正在获取支付结果…</div>
        : <>
          <div className={`payment-headline tone-${tone}`}>
            {tone === "success" ? <CheckCircle2 size={26} />
              : tone === "attention" ? <CircleAlert size={26} />
              : <LoaderCircle size={26} className="spin" />}
            <div>
              <h3>{data.headline}</h3>
              <p className="muted">{data.hint}</p>
            </div>
          </div>

          <dl className="payment-facts">
            <div><dt>订单号</dt><dd>{data.orderNo}</dd></div>
            <div><dt>商品</dt><dd>{data.productName}{data.credits ? <span className="muted mini"> · {data.credits} 个创作额度</span> : null}</dd></div>
            <div><dt>金额</dt><dd>{yuan(data.amountCents)}</dd></div>
            <div><dt>订单状态</dt><dd><span className={`stage-state ${stageClass}`}>{data.statusText}</span></dd></div>
            {data.paidAt ? <div><dt>支付时间</dt><dd>{new Date(data.paidAt).toLocaleString("zh-CN")}</dd></div> : null}
          </dl>

          {error ? <div className="error-banner warning payment-note">{error}</div> : null}
          {!data.settled && polls >= MAX_POLLS ? <div className="error-banner warning payment-note">
            等待时间较长，支付结果可能还在确认中。请稍后在「我的订单」查看，或联系客服，不要重复付款。
          </div> : null}

          <div className="inline-actions">
            {(data?.isLoggedIn ?? isLoggedIn) ? (
              <>
                {tone === "success" ? <Link className="primary" href="/studio"><Sparkles size={14} />开始创作</Link> : null}
                <Link className={tone === "success" ? "secondary" : "primary"} href="/account"><Receipt size={14} />查看我的订单</Link>
              </>
            ) : (
              <>
                <Link className="primary" href={`/login?next=${encodeURIComponent(`/payment/result?orderNo=${encodeURIComponent(orderNo)}`)}`}><Sparkles size={14} />登录下单账号查看权益</Link>
                <Link className="secondary" href="/studio">进入好秀创作中心</Link>
              </>
            )}
            {!data.settled ? <button className="secondary" onClick={() => { void fetchStatus(); }}>刷新结果</button> : null}
          </div>
        </>}
    </div>
    <p className="mini muted account-footnote">付款后即使立刻关闭页面，权益也会随着支付结果确认自动到账，不需要重复付款。</p>
  </div>;
}
