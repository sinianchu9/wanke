// Phase 1 commercial acceptance: catalog, orders, credits ledger, charging idempotency,
// permissions and secret handling. Run against a production server with a throwaway DB:
//   ./scripts/e2e-run.sh scripts/commerce-e2e.mjs
// Payment-channel behaviour (Alipay sign/notify/refund) is covered by scripts/payment-e2e.mjs.
import { randomUUID } from "node:crypto";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@wanke.test";
const DB_PATH = process.env.E2E_DB || "./data/e2e.db";
const SECRET_MARKER = `PLAINTEXT-NEVER-RETURNED-${Date.now()}`;
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
function query(sql, ...params) {
  const db = new Database(DB_PATH, { readonly: true });
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}
function queryOne(sql, ...params) {
  return query(sql, ...params)[0] || null;
}

async function register(email, name, password = "commerce-pass-123") {
  const result = await call("/api/auth/register", { method: "POST", body: { email, name, password, termsAccepted: true } });
  if (result.status !== 201) throw new Error(`register ${email} failed: ${result.status} ${result.text}`);
  return { cookie: result.session, id: result.json.user.id, role: result.json.user.role };
}

const admin = await register(ADMIN_EMAIL, "Operator", "admin-pass-123");
const carol = await register("carol@wanke.test", "Carol");
const dave = await register("dave@wanke.test", "Dave");
const token = () => randomUUID();

console.log("== catalog is the single source of truth ==");
const membership = await call("/api/membership", { cookie: carol.cookie });
const plans = membership.json?.plans || [];
const packs = membership.json?.packs || [];
const pro = plans.find(plan => plan.id === "pro");
check("membership catalog lists the paid plans", plans.some(p => p.id === "free") && Boolean(pro) && plans.some(p => p.id === "studio"), JSON.stringify(plans.map(p => p.id)));
check("quota packs are sellable products", packs.some(p => p.id === "pack_50") && packs.some(p => p.id === "pack_200"), JSON.stringify(packs.map(p => p.id)));
check("prices are integer cents", Number.isInteger(pro?.priceCents) && pro?.priceCents === 9900, JSON.stringify(pro));
check("plan carries credits and validity", pro?.credits === 100 && pro?.validityDays === 30);
check("plan view exposes business language only", pro?.priceText === "¥99" && Boolean(pro?.name) && Boolean(pro?.subtitle), JSON.stringify(pro));
const adminPlans = await call("/api/admin/plans", { cookie: admin.cookie });
const adminPro = (adminPlans.json?.plans || []).find(plan => plan.id === "pro");
check("backoffice and storefront agree on price", adminPro?.priceCents === pro?.priceCents && adminPro?.credits === pro?.credits, `${adminPro?.priceCents} vs ${pro?.priceCents}`);
const landing = await call("/");
check("landing page renders the catalog", landing.text.includes("创作者版") && landing.text.includes("¥99"));
check("member cannot edit the catalog", (await call("/api/admin/plans", { method: "POST", cookie: carol.cookie, body: { id: "pro", kind: "membership", name: " hacked", priceCents: 1, credits: 999999, validityDays: 30 } })).status === 403);

console.log("== order creation is idempotent and snapshot-frozen ==");
const clientToken = token();
const order1 = await call("/api/orders", { method: "POST", cookie: carol.cookie, body: { planId: "pro", clientToken } });
check("order created", order1.status === 201, `${order1.status} ${order1.text}`);
const orderId = order1.json?.order?.id;
check("order number is business-facing", /^WK\d{14}[0-9A-F]{8}$/.test(order1.json?.order?.orderNo || ""), order1.json?.order?.orderNo);
check("order is pending with the catalog price", order1.json?.order?.status === "pending" && order1.json?.order?.payableCents === 9900);
check("order freezes the product snapshot", order1.json?.order?.credits === 100 && order1.json?.order?.validityDays === 30 && order1.json?.order?.productName === "创作者版");
const order1Repeat = await call("/api/orders", { method: "POST", cookie: carol.cookie, body: { planId: "pro", clientToken } });
check("same client token returns the same order", order1Repeat.json?.order?.id === orderId, `${order1Repeat.status} ${order1Repeat.text}`);
const order1Retry = await call("/api/orders", { method: "POST", cookie: carol.cookie, body: { planId: "pro", clientToken: token() } });
check("checkout refresh reuses the pending order", order1Retry.json?.order?.id === orderId, `${order1Retry.json?.order?.id} != ${orderId}`);
check("only one order row exists", Number(queryOne("SELECT COUNT(*) AS c FROM orders WHERE user_id=?", carol.id).c) === 1);

const freeOrder = await call("/api/orders", { method: "POST", cookie: carol.cookie, body: { planId: "free", clientToken: token() } });
check("free tier cannot be bought for ¥0", freeOrder.status === 400 && freeOrder.json?.code === "PLAN_NOT_PURCHASABLE", `${freeOrder.status} ${freeOrder.text}`);
const unknownPlan = await call("/api/orders", { method: "POST", cookie: carol.cookie, body: { planId: "does_not_exist", clientToken: token() } });
check("unknown plan rejected", unknownPlan.status === 404, `${unknownPlan.status}`);
const forgedAmount = await call("/api/orders", { method: "POST", cookie: carol.cookie, body: { planId: "pro", clientToken: token(), payableCents: 1, amountCents: 1 } });
check("client cannot forge the amount", forgedAmount.json?.order?.payableCents === 9900 || forgedAmount.status === 400, JSON.stringify(forgedAmount.json?.order));

console.log("== benefits require a confirmed payment ==");
const beforePay = await call("/api/auth/me", { cookie: carol.cookie });
check("pending order grants nothing", beforePay.json?.membership?.plan === "free" && beforePay.json?.membership?.credits?.planLimit === 10, JSON.stringify(beforePay.json?.membership?.credits));
check("no ledger row for an unpaid order", Number(queryOne("SELECT COUNT(*) AS c FROM quota_ledger WHERE user_id=? AND ref_type='order'", carol.id).c) === 0);
const payStub = await call(`/api/orders/${orderId}/pay`, { method: "POST", cookie: carol.cookie, body: { channel: "page" } });
check("payment without a configured channel is honest", payStub.status === 503 && payStub.json?.code === "PAYMENT_CHANNEL_UNAVAILABLE", `${payStub.status} ${payStub.text}`);
check("member cannot mark an order paid", (await call(`/api/orders/${orderId}`, { method: "PATCH", cookie: carol.cookie, body: { status: "paid" } })).status >= 400);

console.log("== order visibility and lifecycle ==");
const daveReads = await call(`/api/orders/${orderId}`, { cookie: dave.cookie });
check("another member's order is not found", daveReads.status === 404, `${daveReads.status}`);
const daveCancels = await call(`/api/orders/${orderId}`, { method: "POST", cookie: dave.cookie, body: { action: "cancel" } });
check("another member cannot cancel the order", daveCancels.status === 404, `${daveCancels.status}`);
const orderList = await call("/api/orders", { cookie: carol.cookie });
check("order list uses business status", orderList.json?.orders?.[0]?.statusText === "待支付", JSON.stringify(orderList.json?.orders?.[0]));
const orderDetail = await call(`/api/orders/${orderId}`, { cookie: carol.cookie });
check("order detail exposes items and refund state", orderDetail.json?.items?.length === 1 && typeof orderDetail.json?.refundEligibility === "object", orderDetail.text.slice(0, 200));
check("order detail hides other members", !orderDetail.text.includes("dave@wanke.test"));
const adminOrders = await call("/api/admin/orders?status=pending", { cookie: admin.cookie });
check("backoffice order book filters by status", (adminOrders.json?.orders || []).some(row => row.id === orderId) && adminOrders.json?.orders?.every(row => row.status === "pending"));
check("backoffice order book shows the buyer", (adminOrders.json?.orders || []).find(row => row.id === orderId)?.userEmail === "carol@wanke.test");
check("member cannot read the order book", (await call("/api/admin/orders", { cookie: carol.cookie })).status === 403);

console.log("== catalog edits never rewrite a sold order ==");
const reprice = await call("/api/admin/plans", { method: "POST", cookie: admin.cookie, body: { id: "pro", kind: "membership", name: "创作者版", subtitle: "面向持续创作的创作者", priceCents: 12900, credits: 100, validityDays: 30 } });
check("operator can reprice a plan", reprice.status === 200 && reprice.json?.plan?.priceCents === 12900, `${reprice.status} ${reprice.text}`);
const frozenOrder = await call(`/api/orders/${orderId}`, { cookie: carol.cookie });
check("existing order keeps the sold price", frozenOrder.json?.order?.payableCents === 9900, JSON.stringify(frozenOrder.json?.order?.payableCents));
const newPriceOrder = await call("/api/orders", { method: "POST", cookie: carol.cookie, body: { planId: "pro", clientToken: token() } });
check("new order uses the new price", newPriceOrder.json?.order?.payableCents === 12900, JSON.stringify(newPriceOrder.json?.order));
const restore = await call("/api/admin/plans", { method: "POST", cookie: admin.cookie, body: { id: "pro", kind: "membership", name: "创作者版", subtitle: "面向持续创作的创作者", priceCents: 9900, credits: 100, validityDays: 30 } });
check("price restored", restore.json?.plan?.priceCents === 9900);
const canceled = await call(`/api/orders/${newPriceOrder.json.order.id}`, { method: "POST", cookie: carol.cookie, body: { action: "cancel" } });
check("member cancels an unpaid order", canceled.json?.order?.status === "canceled", canceled.text.slice(0, 160));
const payCanceled = await call(`/api/orders/${newPriceOrder.json.order.id}/pay`, { method: "POST", cookie: carol.cookie, body: {} });
check("canceled order cannot be paid", payCanceled.status === 409 && payCanceled.json?.code === "ORDER_NOT_PAYABLE", `${payCanceled.status} ${payCanceled.text}`);
const planAudit = await call("/api/admin/audit-logs", { cookie: admin.cookie });
check("catalog changes are audited", (planAudit.json?.logs || []).some(log => log.action === "plan.upsert"));

console.log("== pre-submit quote ==");
const quote = await call("/api/quota/quote", { method: "POST", cookie: carol.cookie, body: { kind: "video_generation", input: { prompt: "a cat" } } });
check("quote shows the credit cost before submit", quote.status === 200 && quote.json?.quote?.credits === 1, quote.text.slice(0, 200));
check("quote reports the available balance", quote.json?.available === 10 && quote.json?.sufficient === true, JSON.stringify(quote.json));
check("quote is deterministic", (await call("/api/quota/quote", { method: "POST", cookie: carol.cookie, body: { kind: "video_generation", input: { prompt: "a cat" } } })).json?.quote?.credits === quote.json?.quote?.credits);
check("quote rejects unknown creation types", (await call("/api/quota/quote", { method: "POST", cookie: carol.cookie, body: { kind: "not_a_kind" } })).status === 400);

console.log("== one submit = one charge ==");
const clientRequestId = `e2e-${randomUUID()}`;
const submitA = await call("/api/jobs", { method: "POST", cookie: carol.cookie, body: { kind: "video_generation", title: "commerce", input: { prompt: "a dog" }, clientRequestId } });
check("submit answered", submitA.status === 201 || submitA.status === 400, `${submitA.status} ${submitA.text.slice(0, 160)}`);
const jobId = submitA.json?.job?.id;
const submitB = await call("/api/jobs", { method: "POST", cookie: carol.cookie, body: { kind: "video_generation", title: "commerce", input: { prompt: "a dog" }, clientRequestId } });
check("duplicate submit is deduplicated", submitB.json?.deduplicated === true && submitB.json?.job?.id === jobId, submitB.text.slice(0, 200));
const chargeKey = `submit:${carol.id}:${clientRequestId}`;
check("exactly one charge row", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE idempotency_key=?", chargeKey).c) === 1);
check("exactly one reserve ledger row", Number(queryOne("SELECT COUNT(*) AS c FROM quota_ledger WHERE idempotency_key=?", `charge:${chargeKey}`).c) === 1);
check("exactly one job created", Number(queryOne("SELECT COUNT(*) AS c FROM jobs WHERE user_id=?", carol.id).c) === 1);
const afterFailure = await call("/api/auth/me", { cookie: carol.cookie });
check("credits returned after the creation did not start", afterFailure.json?.membership?.credits?.available === 10, JSON.stringify(afterFailure.json?.membership?.credits));
const chargeRow = queryOne("SELECT status, credits FROM task_charges WHERE idempotency_key=?", chargeKey);
check("charge reached a terminal state", ["refunded", "voided"].includes(chargeRow?.status), JSON.stringify(chargeRow));

console.log("== polling never moves credits ==");
const before = (await call("/api/auth/me", { cookie: carol.cookie })).json?.membership?.credits?.available;
for (let i = 0; i < 20; i += 1) await call(`/api/jobs/${jobId}`, { cookie: carol.cookie });
const after = (await call("/api/auth/me", { cookie: carol.cookie })).json?.membership?.credits?.available;
check("20 status reads change nothing", before === after, `${before} -> ${after}`);
check("no extra charge rows from polling", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", carol.id).c) === 1);

console.log("== batch guard refuses before charging ==");
const deduct = await call(`/api/admin/users/${carol.id}`, { method: "PATCH", cookie: admin.cookie, body: { creditDelta: -9, note: "e2e：把额度压到 1 以验证批量门禁" } });
check("operator deducts credits with a reason", deduct.status === 200 && deduct.json?.membership?.credits?.available === 1, JSON.stringify(deduct.json?.membership?.credits));
const chargesBefore = Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", carol.id).c);
const batch = await call("/api/jobs/batch", { method: "POST", cookie: carol.cookie, body: { kind: "video_generation", input: { prompt: "three versions" }, count: 4, clientRequestId: `batch-${randomUUID()}` } });
check("unaffordable batch blocked with 402", batch.status === 402 && batch.json?.code === "QUOTA_EXCEEDED", `${batch.status} ${batch.text.slice(0, 160)}`);
check("batch message states the real need", /4 个创作额度/.test(batch.json?.error || ""), batch.json?.error);
check("blocked batch charged nothing", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", carol.id).c) === chargesBefore);
check("blocked batch created no jobs", Number(queryOne("SELECT COUNT(*) AS c FROM jobs WHERE user_id=?", carol.id).c) === 1);

console.log("== credit ledger is member-readable and business-worded ==");
const grant = await call(`/api/admin/users/${carol.id}`, { method: "PATCH", cookie: admin.cookie, body: { creditDelta: 25, note: "e2e：活动赠送" } });
check("granted credits land in the bonus balance", grant.json?.membership?.credits?.bonus === 25 && grant.json?.membership?.credits?.available === 26, JSON.stringify(grant.json?.membership?.credits));
const ledger = await call("/api/quota/ledger", { cookie: carol.cookie });
check("ledger lists every movement", ledger.json?.total >= 4, JSON.stringify(ledger.json?.total));
check("ledger rows carry before/after balances", ledger.json?.entries?.every(entry => Number.isFinite(entry.balanceAfter) && Number.isFinite(entry.delta)));
check("ledger speaks business language", ledger.json?.entries?.some(entry => entry.reasonText === "管理员补偿") || ledger.json?.entries?.some(entry => /赠送|补偿|调整/.test(entry.reasonText)), JSON.stringify(ledger.json?.entries?.map(e => e.reasonText)));
check("ledger hides internal enums", !/job_reserve|admin_grant|admin_deduct|pack_purchase|plan_grant|migration_baseline/.test(ledger.text), ledger.text.slice(0, 200));
check("ledger keeps the operator's reason", ledger.json?.entries?.some(entry => (entry.note || "").includes("活动赠送")));
const daveLedger = await call("/api/quota/ledger", { cookie: dave.cookie });
check("ledgers are isolated per member", daveLedger.json?.total === 0, JSON.stringify(daveLedger.json?.total));

console.log("== platform configuration and secrets stay server-side ==");
check("member cannot read creation-service settings", (await call("/api/settings", { cookie: carol.cookie })).status === 403);
check("member cannot read system settings", (await call("/api/admin/system-settings", { cookie: carol.cookie })).status === 403);
check("member cannot read creation-service diagnostics", (await call("/api/admin/creation-service", { cookie: carol.cookie })).status === 403);
const diagnostics = await call("/api/admin/creation-service", { cookie: admin.cookie });
check("operator gets creation-service diagnostics", diagnostics.status === 200 && typeof diagnostics.json?.generationReady === "boolean");
const memberStatus = await call("/api/status", { cookie: carol.cookie });
check("member status leaks no infrastructure", !/modelstudio|yike|accessKey|endpoint|region|apiKey/i.test(memberStatus.text), memberStatus.text.slice(0, 200));

const saveSecret = await call("/api/admin/system-settings", { method: "POST", cookie: admin.cookie, body: { values: { alipay_private_key: SECRET_MARKER, alipay_app_id: "2021000000000001", alipay_enabled: true } } });
check("operator saves payment settings", saveSecret.status === 200 && (saveSecret.json?.changed || []).includes("alipay_private_key"), saveSecret.text.slice(0, 200));
const readSettings = await call("/api/admin/system-settings?scope=payment", { cookie: admin.cookie });
check("stored secret is never returned", !readSettings.text.includes(SECRET_MARKER));
const secretField = (readSettings.json?.settings || []).find(item => item.key === "alipay_private_key");
check("secret shows as configured and masked", secretField?.configured === true && secretField?.value === "" && Boolean(secretField?.masked), JSON.stringify(secretField));
// Regression: a stored secret must be readable by the server again (mask is derived from
// the decrypted value). Without this the ciphertext format can silently break every
// credential, including the payment keys and the migrated provider keys.
check("stored secret can be decrypted again", secretField?.masked?.startsWith(SECRET_MARKER.slice(0, 4))
  && !secretField.masked.includes("配置需要重新保存") && !secretField.masked.includes(SECRET_MARKER), secretField?.masked);
check("non-sensitive value is readable", (readSettings.json?.settings || []).find(item => item.key === "alipay_app_id")?.value === "2021000000000001");
const cipherRow = queryOne("SELECT ciphertext FROM secrets WHERE key='alipay_private_key'");
check("secret is encrypted at rest", Boolean(cipherRow?.ciphertext) && !String(cipherRow.ciphertext).includes(SECRET_MARKER));
const blankKeep = await call("/api/admin/system-settings", { method: "POST", cookie: admin.cookie, body: { values: { alipay_private_key: "" } } });
check("blank keeps the stored secret", !(blankKeep.json?.changed || []).includes("alipay_private_key") && queryOne("SELECT ciphertext FROM secrets WHERE key='alipay_private_key'") !== null);
const secretAudit = await call("/api/admin/audit-logs", { cookie: admin.cookie });
check("audit log records the field, not the value", secretAudit.json?.logs?.some(log => log.action === "system_settings.update") && !secretAudit.text.includes(SECRET_MARKER));
const cleared = await call("/api/admin/system-settings", { method: "POST", cookie: admin.cookie, body: { clear: ["alipay_private_key"] } });
check("explicit clear removes the secret", (cleared.json?.changed || []).includes("alipay_private_key") && queryOne("SELECT ciphertext FROM secrets WHERE key='alipay_private_key'") === null);

console.log("== payment channel gate follows the configuration ==");
const gatedPay = await call(`/api/orders/${orderId}/pay`, { method: "POST", cookie: carol.cookie, body: { channel: "page" } });
check("payment start never fakes success", gatedPay.status === 503 && gatedPay.json?.code === "PAYMENT_CHANNEL_UNAVAILABLE", `${gatedPay.status} ${gatedPay.text.slice(0, 160)}`);
await call("/api/admin/system-settings", { method: "POST", cookie: admin.cookie, body: { values: { alipay_enabled: false, alipay_app_id: "" } } });
const offPay = await call(`/api/orders/${orderId}/pay`, { method: "POST", cookie: carol.cookie, body: {} });
check("disabled channel refuses payment", offPay.status === 503 && offPay.json?.code === "PAYMENT_CHANNEL_UNAVAILABLE", `${offPay.status} ${offPay.text}`);
const storefront = await call("/api/orders", { method: "POST", cookie: dave.cookie, body: { planId: "pack_50", clientToken: token() } });
check("quota pack order is created as a pack", storefront.json?.order?.kind === "quota_pack" && storefront.json?.order?.payableCents === 3900, JSON.stringify(storefront.json?.order));
check("storefront reports the channel state", storefront.json?.paymentAvailable === false);

console.log(failures === 0 ? "\nALL COMMERCE CHECKS PASSED" : `\n${failures} COMMERCE CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
