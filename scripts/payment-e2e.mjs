// Phase 2 payment acceptance (§51 支付宝专项测试).
//
//   ./scripts/e2e-run.sh scripts/payment-e2e.mjs
//
// A local protocol mock (scripts/alipay-mock.mjs) plays the Alipay gateway: it verifies
// our request signatures with the merchant public key and signs every response and every
// asynchronous notification with its own key. So signing, verification, amount matching,
// payee matching, replay defence, expiry, active query and refunds are all really
// exercised end to end — the product code never sees a simulated success.
import { randomUUID } from "node:crypto";
import { generateKeyPair, startAlipayMock } from "./alipay-mock.mjs";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@wanke.test";
const DB_PATH = process.env.E2E_DB || "./data/e2e.db";
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT || 3110);
const TECHNICAL_PATTERN = /Provider|Endpoint|RequestId|MediaId|\bJSON\b|\bToken\b|\bsign\b|RSA|gateway|biz_content|alipay_trade|SQLITE|ACQ\./i;
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`); }
}

async function call(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let json = null;
  let text = "";
  try { text = await response.text(); json = JSON.parse(text); } catch { /* html page */ }
  const setCookie = response.headers.get("set-cookie");
  return { status: response.status, json, text, session: setCookie ? setCookie.split(";")[0] : null };
}

const Database = (await import("better-sqlite3")).default;
function withDb(fn) {
  const db = new Database(DB_PATH, { timeout: 15000 });
  try { return fn(db); } finally { db.close(); }
}
function query(sql, ...params) { return withDb(db => db.prepare(sql).all(...params)); }
function queryOne(sql, ...params) { return query(sql, ...params)[0] || null; }
function execute(sql, ...params) { return withDb(db => db.prepare(sql).run(...params)); }

async function register(email, name, password = "payment-pass-123") {
  const result = await call("/api/auth/register", { method: "POST", body: { email, name, password } });
  if (result.status !== 201) throw new Error(`register ${email} failed: ${result.status} ${result.text}`);
  return { cookie: result.session, id: result.json.user.id, email };
}

// ---------- fixtures ----------

const merchant = generateKeyPair();
const alipay = generateKeyPair();
const decoy = generateKeyPair();
const NOTIFY_URL = `${BASE}/api/payments/alipay/notify`;
const mock = await startAlipayMock({
  port: MOCK_PORT,
  merchantPublicKey: merchant.publicPem,
  alipayPrivateKey: alipay.privatePem,
  defaultNotifyUrl: NOTIFY_URL,
});

const admin = await register(ADMIN_EMAIL, "Operator", "admin-pass-123");
const alice = await register("alice@wanke.test", "Alice");
const bob = await register("bob@wanke.test", "Bob");
const carol = await register("carol@wanke.test", "Carol");

const ALIPAY_SETTINGS = {
  alipay_enabled: "true",
  alipay_env: "production",
  alipay_gateway_url: mock.gatewayUrl,
  alipay_app_id: mock.appId,
  alipay_notify_url: NOTIFY_URL,
  alipay_return_url: `${BASE}/payment/result`,
  alipay_private_key: merchant.privatePem,
  alipay_public_key: alipay.publicPem,
  alipay_seller_id: mock.sellerId,
  order_ttl_minutes: "30",
};

async function configure(overrides = {}) {
  const response = await call("/api/admin/system-settings", {
    method: "POST", cookie: admin.cookie, body: { values: { ...ALIPAY_SETTINGS, ...overrides } },
  });
  if (response.status !== 200) throw new Error(`configure payment failed: ${response.status} ${response.text}`);
  return response;
}

async function createOrder(user, planId = "pro", extra = {}) {
  const response = await call("/api/orders", {
    method: "POST", cookie: user.cookie,
    body: { planId, clientToken: randomUUID().replace(/-/g, ""), device: "pc", ...extra },
  });
  return response;
}

async function startPay(user, order, channel = "page") {
  return call(`/api/orders/${order.id}/pay`, { method: "POST", cookie: user.cookie, body: { channel } });
}

/**
 * Act like the browser: open the cashier URL. The mock verifies our signature there and
 * learns the notification address, exactly as the real gateway would.
 */
async function openCashier(payUrl) {
  const response = await fetch(payUrl, { redirect: "manual", cache: "no-store" });
  return { status: response.status, text: await response.text() };
}

/** Start a payment and open the cashier, the way a member would. */
async function pay(user, order, channel = "page") {
  const started = await startPay(user, order, channel);
  if (started.status === 200 && started.json?.payUrl) await openCashier(started.json.payUrl);
  return started;
}

async function payStatus(user, orderNo) {
  return call(`/api/orders/${encodeURIComponent(orderNo)}/pay-status`, { cookie: user.cookie });
}

async function membershipOf(user) {
  const response = await call("/api/membership", { cookie: user.cookie });
  return response.json?.membership || null;
}

function orderRow(orderNo) { return queryOne("SELECT * FROM orders WHERE order_no=?", orderNo); }
function paymentRows(orderNo) { return query("SELECT * FROM payments WHERE out_trade_no=?", orderNo); }
function notificationRows(orderNo) { return query("SELECT * FROM payment_notifications WHERE out_trade_no=?", orderNo); }
function grantRows(orderId) { return query("SELECT * FROM quota_ledger WHERE idempotency_key=?", `order:${orderId}`); }
function reclaimRows(refundId) { return query("SELECT * FROM quota_ledger WHERE idempotency_key=?", `refund:${refundId}`); }
function notifyRows(orderId) { return query("SELECT * FROM notifications WHERE dedupe_key=?", `order:${orderId}`); }

/** Simulate the passage of time: an expired order must behave like an expired order. */
function backdate(orderNo, minutes = 10) {
  execute("UPDATE orders SET expires_at=? WHERE order_no=?",
    new Date(Date.now() - minutes * 60_000).toISOString(), orderNo);
}

console.log("== 支付通道配置与连通性 ==");
await configure();
const channelState = await call("/api/admin/payment-test", { cookie: admin.cookie });
check("operator sees the payment channel state", channelState.status === 200 && channelState.json?.channel?.available === true, channelState.text.slice(0, 200));
check("channel state hides key material", !channelState.text.includes(merchant.privatePem) && !channelState.text.includes(alipay.publicPem));
check("channel state names the supported key mode", channelState.json?.channel?.keyMode === "公钥模式" && channelState.json?.channel?.signType === "RSA2");
const memberChannel = await call("/api/admin/payment-test", { cookie: alice.cookie });
check("member cannot read or test the payment channel", memberChannel.status === 403, `${memberChannel.status}`);

const testOk = await call("/api/admin/payment-test", { method: "POST", cookie: admin.cookie });
check("free connection test passes against the gateway", testOk.status === 200 && testOk.json?.result?.ok === true, testOk.text.slice(0, 300));
check("connection test proves the signature was accepted", testOk.json?.result?.detail?.subCode === "ACQ.TRADE_NOT_EXIST", JSON.stringify(testOk.json?.result?.detail));
check("connection test result is persisted", queryOne("SELECT value FROM settings WHERE key='alipay_last_test_at'") !== null
  && queryOne("SELECT value FROM settings WHERE key='alipay_last_test_result'")?.value === "success");

await configure({ alipay_private_key: decoy.privatePem });
const testBadKey = await call("/api/admin/payment-test", { method: "POST", cookie: admin.cookie });
check("a wrong private key fails the connection test", testBadKey.json?.result?.ok === false, JSON.stringify(testBadKey.json?.result?.message));
check("the failure explains what to fix", (testBadKey.json?.result?.message || "").includes("私钥"), testBadKey.json?.result?.message);
check("failed connection test never enables the channel silently", queryOne("SELECT value FROM settings WHERE key='alipay_last_test_result'")?.value === "failed");
await configure();

console.log("\n== §51.1 / §51.7 下单与收银台不会堆积订单 ==");
const aliceOrder = (await createOrder(alice, "pro")).json.order;
check("order is created as pending", aliceOrder.status === "pending" && aliceOrder.payableCents === 9900, JSON.stringify(aliceOrder));
const pay1 = await pay(alice, aliceOrder);
check("payment start returns a cashier URL", pay1.status === 200 && typeof pay1.json?.payUrl === "string" && pay1.json.payUrl.startsWith(mock.gatewayUrl), pay1.text.slice(0, 200));
const payUrl = new URL(pay1.json.payUrl);
check("cashier uses 电脑网站支付", payUrl.searchParams.get("method") === "alipay.trade.page.pay");
check("cashier carries the order amount in yuan", payUrl.searchParams.get("biz_content")?.includes('"total_amount":"99.00"'), payUrl.searchParams.get("biz_content"));
check("cashier carries the product code", payUrl.searchParams.get("biz_content")?.includes("FAST_INSTANT_TRADE_PAY"));
check("cashier carries the notification address", payUrl.searchParams.get("notify_url") === NOTIFY_URL);
check("cashier carries the return address", (payUrl.searchParams.get("return_url") || "").startsWith(`${BASE}/payment/result`));
check("cashier carries the order validity window", payUrl.searchParams.get("biz_content")?.includes('"timeout_express":"30m"'));
check("cashier request is signed with RSA2", payUrl.searchParams.get("sign_type") === "RSA2" && Boolean(payUrl.searchParams.get("sign")));
const gatewayLog = (await mock.state()).gateway.at(-1);
check("gateway accepted our signature", gatewayLog?.signatureValid === true, JSON.stringify(gatewayLog));
check("order moved to 支付处理中", orderRow(aliceOrder.orderNo)?.status === "paying");

const wapPay = await startPay(alice, aliceOrder, "wap");
await openCashier(wapPay.json.payUrl);
const wapUrl = new URL(wapPay.json.payUrl);
check("mobile checkout switches to 手机网站支付", wapUrl.searchParams.get("method") === "alipay.trade.wap.pay"
  && wapUrl.searchParams.get("biz_content")?.includes("QUICK_WAP_WAY"));

for (let index = 0; index < 4; index += 1) await startPay(alice, aliceOrder);
check("refreshing the cashier never duplicates the order", query("SELECT * FROM orders WHERE user_id=? AND plan_id='pro'", alice.id).length === 1);
check("refreshing the cashier keeps exactly one payment record", paymentRows(aliceOrder.orderNo).length === 1, JSON.stringify(paymentRows(aliceOrder.orderNo).map(row => row.id)));
const repeatOrder = await createOrder(alice, "pro");
check("re-ordering the same product reuses the pending order", repeatOrder.json.order.id === aliceOrder.id, JSON.stringify(repeatOrder.json.order));
check("no benefit exists before payment", grantRows(aliceOrder.id).length === 0 && (await membershipOf(alice)).plan === "free");

console.log("\n== §51.2 同一通知发送 10 次只发一次权益 ==");
const paid = await mock.pay({ out_trade_no: aliceOrder.orderNo, notify: false });
check("mock trade is paid", paid.ok === true);
const tenNotifications = await mock.notify({ out_trade_no: aliceOrder.orderNo, trade_status: "TRADE_SUCCESS", times: 10 });
check("all ten notifications were answered with success", tenNotifications.replies.every(item => item.reply === "success"), JSON.stringify(tenNotifications.replies.map(item => item.reply)));
const paidRow = orderRow(aliceOrder.orderNo);
check("order is paid exactly once", paidRow?.status === "paid" && Boolean(paidRow?.paid_at), JSON.stringify(paidRow?.status));
check("one payment row, verified, counted ten times", paymentRows(aliceOrder.orderNo).length === 1
  && paymentRows(aliceOrder.orderNo)[0].status === "success"
  && paymentRows(aliceOrder.orderNo)[0].verified === 1
  && paymentRows(aliceOrder.orderNo)[0].notify_count === 10, JSON.stringify(paymentRows(aliceOrder.orderNo)[0]));
check("membership granted once", grantRows(aliceOrder.id).length === 1, JSON.stringify(grantRows(aliceOrder.id).map(row => row.delta)));
const aliceMembership = await membershipOf(alice);
check("member really holds the purchased plan", aliceMembership.plan === "pro" && aliceMembership.credits.planLimit === 100, JSON.stringify(aliceMembership?.credits));
check("one member notification for the purchase", notifyRows(aliceOrder.id).length === 1, JSON.stringify(notifyRows(aliceOrder.id).length));
check("all ten notifications are stored as evidence", notificationRows(aliceOrder.orderNo).length === 10
  && notificationRows(aliceOrder.orderNo).every(row => row.verified === 1 && row.accepted === 1));

console.log("\n== §51.3 支付金额与订单金额不同拒绝发放 ==");
const bobOrder = (await createOrder(bob, "pro")).json.order;
await pay(bob, bobOrder);
const wrongAmount = await mock.notify({ out_trade_no: bobOrder.orderNo, trade_status: "TRADE_SUCCESS", total_amount: "1.00" });
check("mismatched notification is answered without granting", wrongAmount.replies[0].reply === "success", JSON.stringify(wrongAmount.replies[0]));
check("mismatched order is flagged for a human", orderRow(bobOrder.orderNo)?.status === "abnormal", orderRow(bobOrder.orderNo)?.status);
check("mismatched payment is flagged", paymentRows(bobOrder.orderNo)[0]?.status === "abnormal");
check("mismatch grants nothing", grantRows(bobOrder.id).length === 0 && (await membershipOf(bob)).plan === "free");
check("mismatch is recorded with the reason", notificationRows(bobOrder.orderNo).some(row => row.accepted === 0 && (row.error || "").includes("金额不符")));
const wrongSeller = await mock.notify({ out_trade_no: bobOrder.orderNo, trade_status: "TRADE_SUCCESS", seller_id: "2088000000000009" });
check("wrong payee is refused too", wrongSeller.replies[0].reply === "success" && grantRows(bobOrder.id).length === 0
  && notificationRows(bobOrder.orderNo).some(row => (row.error || "").includes("收款主体不符")));

console.log("\n== §51.4 假通知不能通过验签 ==");
const carolOrder = (await createOrder(carol, "pro")).json.order;
await pay(carol, carolOrder);
await mock.config({ forged_sign_key: merchant.privatePem });
const forged = await mock.notify({ out_trade_no: carolOrder.orderNo, trade_status: "TRADE_SUCCESS" });
check("a notification signed by the wrong key is rejected", forged.replies[0].reply === "failure", JSON.stringify(forged.replies[0]));
check("forged notification grants nothing", orderRow(carolOrder.orderNo)?.status === "paying" && grantRows(carolOrder.id).length === 0);
check("forged notification is stored as unverified", notificationRows(carolOrder.orderNo).some(row => row.verified === 0 && row.accepted === 0));
await mock.config({ forged_sign_key: null });
const unsigned = await mock.notify({ out_trade_no: carolOrder.orderNo, trade_status: "TRADE_SUCCESS", drop_sign: true });
check("an unsigned notification is rejected", unsigned.replies[0].reply === "failure" && grantRows(carolOrder.id).length === 0);
const wrongApp = await mock.notify({ out_trade_no: carolOrder.orderNo, trade_status: "TRADE_SUCCESS", app_id: "2099000000000002" });
check("a notification for another app id is rejected", wrongApp.replies[0].reply === "failure"
  && notificationRows(carolOrder.orderNo).some(row => (row.error || "").includes("应用编号不匹配")));
const unknownNotify = await mock.notify({ out_trade_no: "WK19990101000000DEADBEEF", trade_status: "TRADE_SUCCESS", total_amount: "99.00" });
check("an unknown order number is recorded, not retried forever", unknownNotify.replies[0].reply === "success"
  && query("SELECT * FROM payment_notifications WHERE out_trade_no='WK19990101000000DEADBEEF'").some(row => row.accepted === 0 && (row.error || "").includes("不存在")));
const emptyNotify = await call("/api/payments/alipay/notify", { method: "POST" });
check("an empty caller is answered with failure", emptyNotify.status === 200 && emptyNotify.text.trim() === "failure", emptyNotify.text.slice(0, 80));

console.log("\n== §51.5 付款后立刻关闭网页仍然到账 ==");
const bobSecond = (await createOrder(bob, "pack_50")).json.order;
const bobPay = await pay(bob, bobSecond);
check("quota pack checkout is signed too", bobPay.status === 200 && new URL(bobPay.json.payUrl).searchParams.get("biz_content")?.includes('"total_amount":"39.00"'));
const closedBrowser = await mock.pay({ out_trade_no: bobSecond.orderNo });
check("the notification alone settled the order", closedBrowser.notification?.reply === "success", JSON.stringify(closedBrowser.notification));
check("quota pack arrived without any browser round trip", orderRow(bobSecond.orderNo)?.status === "paid" && grantRows(bobSecond.id).length === 1);
const bobMembership = await membershipOf(bob);
check("quota pack added bonus credits only", bobMembership.plan === "free" && bobMembership.credits.bonus === 50, JSON.stringify(bobMembership?.credits));

console.log("\n== §51.6 回调延迟时主动查询最终到账 ==");
const carolPaid = (await createOrder(carol, "pro")).json.order;
await pay(carol, carolPaid);
await mock.pay({ out_trade_no: carolPaid.orderNo, notify: false });
const earlyStatus = await payStatus(carol, carolPaid.orderNo);
check("status check asks the provider", earlyStatus.json?.providerAsked === true, JSON.stringify(earlyStatus.json));
check("delayed payment is settled by the active query", earlyStatus.json?.status === "paid" && earlyStatus.json?.settled === true);
check("result copy says the benefit arrived", earlyStatus.json?.headline === "支付成功，权益已经到账", earlyStatus.json?.headline);
check("active query granted the benefit exactly once", grantRows(carolPaid.id).length === 1 && (await membershipOf(carol)).plan === "pro");
const lateNotifications = await mock.notify({ out_trade_no: carolPaid.orderNo, trade_status: "TRADE_SUCCESS", times: 2 });
check("the late notification is accepted as a duplicate", lateNotifications.replies.every(item => item.reply === "success"));
check("the late notification does not grant twice", grantRows(carolPaid.id).length === 1 && notifyRows(carolPaid.id).length === 1);
check("the late notification is still counted", paymentRows(carolPaid.orderNo)[0]?.notify_count === 2, JSON.stringify(paymentRows(carolPaid.orderNo)[0]?.notify_count));
const throttled = await Promise.all([payStatus(carol, carolPaid.orderNo), payStatus(carol, carolPaid.orderNo)]);
check("a settled order answers from the database", throttled.every(item => item.json?.status === "paid" && item.json?.providerAsked === false));

console.log("\n== §51.8 订单过期不能继续发放 ==");
const expiredOrder = (await createOrder(alice, "pack_200")).json.order;
backdate(expiredOrder.orderNo);
const expiredPay = await startPay(alice, expiredOrder);
check("an expired order cannot be paid again", expiredPay.status === 409 && expiredPay.json?.code === "ORDER_EXPIRED", `${expiredPay.status} ${expiredPay.text.slice(0, 120)}`);
check("the expired order is closed", orderRow(expiredOrder.orderNo)?.status === "closed");
const expiredPaid = (await createOrder(alice, "pack_50")).json.order;
await pay(alice, expiredPaid);
backdate(expiredPaid.orderNo, 12);
const lateMoney = await mock.notify({ out_trade_no: expiredPaid.orderNo, trade_status: "TRADE_SUCCESS", total_amount: "39.00" });
check("money arriving for an expired order is recorded for a human", lateMoney.replies[0].reply === "success"
  && orderRow(expiredPaid.orderNo)?.status === "abnormal", orderRow(expiredPaid.orderNo)?.status);
check("an expired order never grants benefits", grantRows(expiredPaid.id).length === 0);
const expiredStatus = await payStatus(alice, expiredPaid.orderNo);
check("the member is told to contact support, never to pay again", expiredStatus.json?.headline === "支付结果需要人工确认"
  && !/重新付款|支付失败/.test(expiredStatus.json?.hint || ""), JSON.stringify(expiredStatus.json));

console.log("\n== §51.9 退款两次不能多退 ==");
const refundableOrder = orderRow(aliceOrder.orderNo);
const userRefund = await call(`/api/orders/${refundableOrder.id}/refund`, {
  method: "POST", cookie: alice.cookie, body: { reason: "买错了套餐，申请退款" },
});
check("member can request a refund", userRefund.status === 201 && userRefund.json?.refund?.statusText === "已提交，等待处理", userRefund.text.slice(0, 200));
const refundId = userRefund.json.refund.refundNo;
const duplicateRequest = await call(`/api/orders/${refundableOrder.id}/refund`, {
  method: "POST", cookie: alice.cookie, body: { reason: "再申请一次" },
});
check("a second request reuses the in-flight refund", duplicateRequest.status === 200 && duplicateRequest.json?.refund?.refundNo === refundId, duplicateRequest.text.slice(0, 160));
check("the money has not moved before approval", orderRow(aliceOrder.orderNo)?.status === "paid" && orderRow(aliceOrder.orderNo)?.refunded_cents === 0);
const memberSeesRefunds = await call("/api/admin/refunds", { cookie: alice.cookie });
check("members cannot open the refund backoffice", memberSeesRefunds.status === 403);
const refundList = await call("/api/admin/refunds?status=requested", { cookie: admin.cookie });
check("operator sees the pending refund request", refundList.json?.refunds?.some(item => item.refundNo === refundId), refundList.text.slice(0, 200));
const approved = await call(`/api/admin/refunds/${queryOne("SELECT id FROM refunds WHERE refund_no=?", refundId).id}`, {
  method: "POST", cookie: admin.cookie, body: { action: "approve" },
});
check("operator approves the refund", approved.json?.refund?.status === "approved", approved.text.slice(0, 160));
const executed = await call(`/api/admin/refunds/${queryOne("SELECT id FROM refunds WHERE refund_no=?", refundId).id}`, {
  method: "POST", cookie: admin.cookie, body: { action: "execute" },
});
check("refund is released through Alipay", executed.json?.refund?.status === "succeeded", executed.text.slice(0, 300));
const refundedRow = orderRow(aliceOrder.orderNo);
check("order is fully refunded", refundedRow?.status === "refunded" && refundedRow?.refunded_cents === 9900, JSON.stringify({ status: refundedRow?.status, refunded: refundedRow?.refunded_cents }));
const refundRow = queryOne("SELECT * FROM refunds WHERE refund_no=?", refundId);
check("benefits are reclaimed exactly once", reclaimRows(refundRow.id).length === 1, JSON.stringify(reclaimRows(refundRow.id).map(row => row.reason)));
check("membership is back to the free tier", (await membershipOf(alice)).plan === "free");
const refundAgain = await call(`/api/orders/${refundableOrder.id}/refund`, {
  method: "POST", cookie: alice.cookie, body: { reason: "还想再退一次" },
});
check("a refunded order cannot be refunded again", refundAgain.status === 409 && refundAgain.json?.code === "ALREADY_REFUNDED", `${refundAgain.status} ${refundAgain.text.slice(0, 120)}`);
const adminRefundAgain = await call("/api/admin/refunds", {
  method: "POST", cookie: admin.cookie, body: { orderId: refundableOrder.id, reason: "运营再退一次" },
});
check("the operator cannot over-refund either", adminRefundAgain.status === 409, `${adminRefundAgain.status} ${adminRefundAgain.text.slice(0, 120)}`);
const executeTwice = await call(`/api/admin/refunds/${refundRow.id}`, { method: "POST", cookie: admin.cookie, body: { action: "execute" } });
check("executing a finished refund changes nothing", executeTwice.json?.refund?.status === "succeeded" && orderRow(aliceOrder.orderNo)?.refunded_cents === 9900);
const mockTradeState = (await mock.state()).trades.find(trade => trade.out_trade_no === aliceOrder.orderNo);
check("Alipay saw exactly one fund movement", (mockTradeState?.refunds || []).length === 1, JSON.stringify(mockTradeState?.refunds));

console.log("\n== 退款结果未知时不自动重复提交 ==");
const unknownOrder = (await createOrder(bob, "pro")).json.order;
await pay(bob, unknownOrder);
await mock.pay({ out_trade_no: unknownOrder.orderNo, notify: false });
await payStatus(bob, unknownOrder.orderNo);
check("the second order is paid before refunding", orderRow(unknownOrder.orderNo)?.status === "paid", orderRow(unknownOrder.orderNo)?.status);
await mock.config({ refund_mode: "no_fund_change" });
const unknownRefund = await call("/api/admin/refunds", {
  method: "POST", cookie: admin.cookie, body: { orderId: unknownOrder.id, reason: "用户申请退款，测试未知结果" },
});
check("an unconfirmed refund is not reported as successful", unknownRefund.json?.refund?.status === "failed", unknownRefund.text.slice(0, 300));
check("the operator is told the result is unknown", (unknownRefund.json?.refund?.error || "").includes("退款结果未知"), unknownRefund.json?.refund?.error);
check("the order is not marked refunded while the result is unknown", orderRow(unknownOrder.orderNo)?.status === "paid" && orderRow(unknownOrder.orderNo)?.refunded_cents === 0);
check("the member keeps the benefit until the refund is confirmed", (await membershipOf(bob)).plan === "pro");
await mock.config({ refund_mode: "normal" });
const retriedRefund = await call(`/api/admin/refunds/${unknownRefund.json.refund.id}`, {
  method: "POST", cookie: admin.cookie, body: { action: "execute" },
});
check("an operator can retry after checking with Alipay", retriedRefund.json?.refund?.status === "succeeded", retriedRefund.text.slice(0, 300));
check("the retry uses the same provider request number", queryOne("SELECT out_request_no FROM refunds WHERE id=?", unknownRefund.json.refund.id)?.out_request_no
  === unknownRefund.json.refund.outRequestNo);
check("the retry still refunds only once", orderRow(unknownOrder.orderNo)?.refunded_cents === 9900 && reclaimRows(unknownRefund.json.refund.id).length === 1);

await mock.config({ refund_mode: "no_fund_change_confirmed" });
const confirmedOrder = (await createOrder(carol, "pack_50")).json.order;
await pay(carol, confirmedOrder);
await mock.pay({ out_trade_no: confirmedOrder.orderNo, notify: false });
await payStatus(carol, confirmedOrder.orderNo);
const confirmedRefund = await call("/api/admin/refunds", {
  method: "POST", cookie: admin.cookie, body: { orderId: confirmedOrder.id, reason: "重复请求确认路径" },
});
check("a repeated provider request is confirmed by refund query", confirmedRefund.json?.refund?.status === "succeeded", confirmedRefund.text.slice(0, 300));
check("the confirmed refund settles the order", orderRow(confirmedOrder.orderNo)?.status === "refunded");
await mock.config({ refund_mode: "normal" });

console.log("\n== §51.10 不能通过前端参数把订单改成已支付 ==");
const carolUnpaid = (await createOrder(carol, "pro")).json.order;
const adminForce = await call(`/api/admin/orders/${carolUnpaid.id}`, { method: "POST", cookie: admin.cookie, body: { status: "paid" } });
check("the order backoffice has no write endpoint", adminForce.status === 405, `${adminForce.status}`);
check("the order is still unpaid", orderRow(carolUnpaid.orderNo)?.status === "pending");
const memberForce = await call(`/api/orders/${carolUnpaid.id}`, { method: "POST", cookie: carol.cookie, body: { action: "mark_paid" } });
check("members cannot mark an order paid", memberForce.status === 400 && memberForce.json?.code === "UNSUPPORTED_ACTION", memberForce.text.slice(0, 140));
const statusWrite = await call(`/api/orders/${carolUnpaid.orderNo}/pay-status`, { method: "POST", cookie: carol.cookie, body: { status: "paid" } });
check("the status endpoint is read-only", statusWrite.status === 405, `${statusWrite.status}`);
const forgedCreate = await createOrder(carol, "pro", { status: "paid", payableCents: 0, refundedCents: 9900 });
check("forged order fields are ignored", forgedCreate.status === 201
  && orderRow(forgedCreate.json.order.orderNo)?.status !== "paid"
  && orderRow(forgedCreate.json.order.orderNo)?.payable_cents === 9900, JSON.stringify(orderRow(forgedCreate.json.order.orderNo)));
const freeOrder = await createOrder(carol, "free");
check("the free tier cannot be bought for zero", freeOrder.status === 400 && freeOrder.json?.code === "PLAN_NOT_PURCHASABLE", freeOrder.text.slice(0, 140));
const syncUnpaid = await call(`/api/admin/orders/${carolUnpaid.id}/sync`, { method: "POST", cookie: admin.cookie });
check("an operator query cannot invent a payment", syncUnpaid.json?.order?.status === "pending"
  && (syncUnpaid.json?.note || "").includes("还没有收到"), syncUnpaid.text.slice(0, 200));
check("the operator query is audited", (await call("/api/admin/audit-logs", { cookie: admin.cookie })).json?.logs?.some(log => log.action === "order.sync"));
const memberSync = await call(`/api/admin/orders/${carolUnpaid.id}/sync`, { method: "POST", cookie: carol.cookie });
check("members cannot trigger operator queries", memberSync.status === 403);

console.log("\n== 交易关闭与支付结果页 ==");
const closedOrder = (await createOrder(bob, "pack_50")).json.order;
await pay(bob, closedOrder);
await mock.trade({ out_trade_no: closedOrder.orderNo, total_amount: "39.00", trade_status: "WAIT_BUYER_PAY" });
const closedNotify = await mock.notify({ out_trade_no: closedOrder.orderNo, trade_status: "TRADE_CLOSED", total_amount: "39.00" });
check("a closed trade closes the unpaid order", closedNotify.replies[0].reply === "success" && orderRow(closedOrder.orderNo)?.status === "closed", orderRow(closedOrder.orderNo)?.status);
check("a closed order cannot be reopened", (await startPay(bob, closedOrder)).status === 409);
const waitingNotify = await mock.notify({
  out_trade_no: carolUnpaid.orderNo, trade_status: "WAIT_BUYER_PAY",
});
check("a waiting-buyer notification grants nothing", waitingNotify.replies[0].reply === "success"
  && orderRow(carolUnpaid.orderNo)?.status === "pending" && grantRows(carolUnpaid.id).length === 0);

const anonymousResult = await call(`/payment/result?orderNo=${carolPaid.orderNo}`);
check("the result page asks for a session first", [302, 307].includes(anonymousResult.status), `${anonymousResult.status}`);
const memberResult = await call(`/payment/result?orderNo=${carolPaid.orderNo}`, { cookie: carol.cookie });
check("the result page renders for the member", memberResult.status === 200 && memberResult.text.includes("支付结果"));
check("the result page never claims a payment failed", !memberResult.text.includes("支付失败"));
check("the result page leaks no protocol detail", !TECHNICAL_PATTERN.test(memberResult.text.replace(/\/_next\/[^"]+/g, "")), (memberResult.text.match(TECHNICAL_PATTERN) || [])[0]);
const inFlightStatus = await payStatus(carol, carolUnpaid.orderNo);
check("an in-flight order is described as confirming", inFlightStatus.json?.headline === "正在确认支付结果……" && inFlightStatus.json?.settled === false, JSON.stringify(inFlightStatus.json));
check("member-facing payment copy stays business language", !TECHNICAL_PATTERN.test([inFlightStatus.json?.headline, inFlightStatus.json?.hint, inFlightStatus.json?.statusText, inFlightStatus.json?.note].join(" ")),
  JSON.stringify(inFlightStatus.json));

console.log("\n== 财务视图 ==");
const stats = await call("/api/admin/stats", { cookie: admin.cookie });
check("revenue reflects the settled payments", stats.json?.stats?.revenue?.totalCents > 0, JSON.stringify(stats.json?.stats?.revenue));
check("abnormal orders are surfaced to the operator", stats.json?.stats?.revenue?.abnormalOrders >= 2, JSON.stringify(stats.json?.stats?.revenue));
check("unverified notifications are surfaced", stats.json?.stats?.revenue?.unverifiedNotifications >= 2, JSON.stringify(stats.json?.stats?.revenue));
const financeOrders = await call("/api/admin/orders?status=refunded", { cookie: admin.cookie });
check("refunded orders are queryable in the backoffice", financeOrders.json?.orders?.length >= 2, JSON.stringify(financeOrders.json?.total));

await mock.close();
console.log(failures === 0 ? "\nALL PAYMENT CHECKS PASSED" : `\n${failures} PAYMENT CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
