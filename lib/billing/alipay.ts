import "server-only";
import { createSign, createVerify, randomBytes } from "node:crypto";
import { getBooleanSetting, getSetting, setSetting } from "@/lib/system-settings";

/**
 * Alipay protocol layer (公钥模式 / RSA2), implemented on `node:crypto` only.
 *
 * Contract notes, checked against the open platform docs:
 * - Request signature: drop `sign` and empty values (`sign_type` DOES take part),
 *   ASCII-sort the rest, join as `k=v&…`, sign with SHA256withRSA (RSA2), base64 it.
 * - Asynchronous notification signature: the same rule but additionally dropping
 *   `sign_type` (officially `verifyV1`; `sign_type` is only kept for 生活号通知,
 *   which is the `verifyV2` fallback below).
 * - Synchronous response signature: it covers the raw JSON of the `<method>_response`
 *   node exactly as it appears in the body, so that substring is extracted before
 *   verification instead of re-serialising the parsed object.
 * - Money travels as a yuan string with two decimals; internally everything is cents.
 *
 * Nothing in here decides business state. It only produces signed requests and
 * verified facts, which `orders.ts` / `refunds.ts` turn into guarded transitions.
 */

export const ALIPAY_GATEWAY = {
  production: "https://openapi.alipay.com/gateway.do",
  sandbox: "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
} as const;

export type AlipayEnv = "production" | "sandbox";
export type AlipayChannel = "page" | "wap";

export const TRADE_SUCCESS_STATUSES = ["TRADE_SUCCESS", "TRADE_FINISHED"] as const;
export type AlipayTradeStatus = (typeof TRADE_SUCCESS_STATUSES)[number] | "WAIT_BUYER_PAY" | "TRADE_CLOSED";

export interface AlipayConfig {
  enabled: boolean;
  env: AlipayEnv;
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  gatewayUrl: string;
  notifyUrl: string;
  returnUrl: string;
  sellerId: string;
}

/** Alipay accepts a bare base64 key from the console; normalise it to PEM. */
function normalizeKey(raw: string, kind: "PRIVATE" | "PUBLIC"): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("-----BEGIN")) return value.replace(/\r\n/g, "\n").trim();
  const body = value.replace(/\\n/g, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) return "";
  const label = kind === "PRIVATE" ? "PRIVATE KEY" : "PUBLIC KEY";
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export function alipayConfig(): AlipayConfig {
  const env: AlipayEnv = getSetting("alipay_env") === "production" ? "production" : "sandbox";
  const override = getSetting("alipay_gateway_url");
  return {
    enabled: getBooleanSetting("alipay_enabled"),
    env,
    appId: getSetting("alipay_app_id"),
    privateKey: normalizeKey(getSetting("alipay_private_key"), "PRIVATE"),
    alipayPublicKey: normalizeKey(getSetting("alipay_public_key"), "PUBLIC"),
    gatewayUrl: override || ALIPAY_GATEWAY[env],
    notifyUrl: getSetting("alipay_notify_url"),
    returnUrl: getSetting("alipay_return_url"),
    sellerId: getSetting("alipay_seller_id"),
  };
}

/** What is still missing before real money can move, in operator language. */
export function alipayReadiness(config: AlipayConfig = alipayConfig()) {
  const missing: string[] = [];
  if (!config.appId) missing.push("应用编号");
  if (!config.privateKey) missing.push("应用私钥");
  if (!config.alipayPublicKey) missing.push("支付宝公钥");
  return { ready: missing.length === 0, missing, config };
}

export function alipayAvailable(config: AlipayConfig = alipayConfig()): boolean {
  return config.enabled && alipayReadiness(config).ready;
}

// ---------- signing primitives ----------

/**
 * Build the string to sign. Empty values never take part; `sign` never takes part.
 * `sign_type` takes part in outgoing requests and is only dropped when verifying an
 * asynchronous notification (`excludeSignType`, i.e. the official `verifyV1`).
 */
export function canonicalize(params: Record<string, unknown>, options: { excludeSignType?: boolean } = {}): string {
  return Object.keys(params)
    .filter(key => key !== "sign" && !(options.excludeSignType && key === "sign_type"))
    .filter(key => {
      const value = params[key];
      return value !== undefined && value !== null && String(value) !== "";
    })
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join("&");
}

function rsaSign(content: string, privateKeyPem: string): string {
  return createSign("RSA-SHA256").update(content, "utf8").sign(privateKeyPem, "base64");
}

function rsaVerify(content: string, signature: string, publicKeyPem: string): boolean {
  try {
    return createVerify("RSA-SHA256").update(content, "utf8").verify(publicKeyPem, signature, "base64");
  } catch {
    return false;
  }
}

/** Verify an inbound notification. `v1` drops sign_type, `v2` keeps it (生活号). */
export function verifyNotifySignature(params: Record<string, string>, config: AlipayConfig = alipayConfig()): {
  verified: boolean;
  mode: "v1" | "v2" | "none";
  reason: string;
} {
  const signature = String(params.sign || "").trim();
  if (!signature) return { verified: false, mode: "none", reason: "通知缺少签名" };
  if (!config.alipayPublicKey) return { verified: false, mode: "none", reason: "未配置支付宝公钥，无法验签" };
  const signType = String(params.sign_type || "").toUpperCase();
  if (signType && signType !== "RSA2") return { verified: false, mode: "none", reason: `不支持的签名类型 ${signType}` };
  if (rsaVerify(canonicalize(params, { excludeSignType: true }), signature, config.alipayPublicKey)) {
    return { verified: true, mode: "v1", reason: "" };
  }
  if (rsaVerify(canonicalize(params), signature, config.alipayPublicKey)) {
    return { verified: true, mode: "v2", reason: "" };
  }
  return { verified: false, mode: "none", reason: "签名校验没有通过" };
}

// ---------- value helpers ----------

export function centsToYuan(cents: number): string {
  return (Math.round(Number(cents) || 0) / 100).toFixed(2);
}

/** Strict yuan→cents conversion. Returns null for anything that is not plain money. */
export function yuanToCents(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

/** Gateway timestamps are Beijing time regardless of the host timezone. */
export function alipayTimestamp(date: Date = new Date()): string {
  const beijing = new Date(date.getTime() + (8 * 60 + date.getTimezoneOffset()) * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${beijing.getFullYear()}-${pad(beijing.getMonth() + 1)}-${pad(beijing.getDate())} `
    + `${pad(beijing.getHours())}:${pad(beijing.getMinutes())}:${pad(beijing.getSeconds())}`;
}

export function beijingToIso(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return null;
  const parsed = Date.parse(`${text.replace(" ", "T")}+08:00`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

// ---------- request building ----------

export interface SignedRequestInput {
  method: string;
  bizContent: Record<string, unknown>;
  notifyUrl?: string;
  returnUrl?: string;
  timestamp?: string;
}

export function buildSignedParams(input: SignedRequestInput, config: AlipayConfig = alipayConfig()): Record<string, string> {
  if (!config.appId || !config.privateKey) throw new Error("支付宝配置不完整，无法发起请求");
  const params: Record<string, string> = {
    app_id: config.appId,
    method: input.method,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: input.timestamp || alipayTimestamp(),
    version: "1.0",
    biz_content: JSON.stringify(input.bizContent),
  };
  if (input.notifyUrl) params.notify_url = input.notifyUrl;
  if (input.returnUrl) params.return_url = input.returnUrl;
  params.sign = rsaSign(canonicalize(params), config.privateKey);
  return params;
}

export interface PaymentUrlInput {
  orderNo: string;
  subject: string;
  body?: string;
  amountCents: number;
  channel: AlipayChannel;
  notifyUrl: string;
  returnUrl: string;
  expiresAt?: string;
}

/**
 * Cashier URL for 电脑网站支付 (`alipay.trade.page.pay`) or 手机网站支付
 * (`alipay.trade.wap.pay`). The browser is redirected here; benefit fulfilment never
 * depends on this redirect, only on the verified notification or an active query.
 */
export function buildPaymentUrl(input: PaymentUrlInput, config: AlipayConfig = alipayConfig()): string {
  if (!(input.amountCents > 0)) throw new Error("支付金额必须大于 0");
  if (!input.notifyUrl) throw new Error("未配置支付结果通知地址");
  const method = input.channel === "wap" ? "alipay.trade.wap.pay" : "alipay.trade.page.pay";
  const bizContent: Record<string, unknown> = {
    out_trade_no: input.orderNo,
    total_amount: centsToYuan(input.amountCents),
    subject: input.subject.slice(0, 256),
    product_code: input.channel === "wap" ? "QUICK_WAP_WAY" : "FAST_INSTANT_TRADE_PAY",
  };
  if (input.body) bizContent.body = String(input.body).slice(0, 256);
  const timeoutMinutes = timeoutExpressMinutes(input.expiresAt);
  if (timeoutMinutes) bizContent.timeout_express = `${timeoutMinutes}m`;
  if (input.channel === "wap" && input.returnUrl) bizContent.quit_url = input.returnUrl;
  const params = buildSignedParams({
    method,
    bizContent,
    notifyUrl: input.notifyUrl,
    returnUrl: input.returnUrl || undefined,
  }, config);
  const query = Object.keys(params).sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
  return `${config.gatewayUrl}?${query}`;
}

/** Order TTL translated into Alipay's relative `timeout_express` (minutes). */
export function timeoutExpressMinutes(expiresAt?: string): number {
  if (!expiresAt) return 0;
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.max(1, Math.min(1440, Math.ceil(remaining / 60_000)));
}

// ---------- gateway calls ----------

export interface AlipayResponse {
  ok: boolean;
  code: string;
  msg: string;
  subCode: string;
  subMsg: string;
  data: Record<string, any>;
  verified: boolean;
  status: number;
  raw: string;
}

function underscore(method: string) {
  return method.replace(/\./g, "_");
}

/**
 * Pull the exact JSON text of a response node out of the raw body so the signature
 * can be checked over the bytes Alipay signed.
 */
export function extractResponseNode(body: string, nodeName: string): { raw: string; sign: string } | null {
  const marker = `"${nodeName}":`;
  const start = body.indexOf(marker);
  if (start < 0) return null;
  let cursor = start + marker.length;
  while (cursor < body.length && /\s/.test(body[cursor])) cursor += 1;
  if (body[cursor] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = cursor; index < body.length; index += 1) {
    const char = body[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const tail = body.slice(index + 1);
        const match = tail.match(/"sign"\s*:\s*"([^"]*)"/);
        return { raw: body.slice(cursor, index + 1), sign: match ? match[1] : "" };
      }
    }
  }
  return null;
}

export function parseGatewayResponse(method: string, body: string, config: AlipayConfig, status = 200): AlipayResponse {
  const empty: AlipayResponse = { ok: false, code: "", msg: "", subCode: "", subMsg: "", data: {}, verified: false, status, raw: body.slice(0, 4000) };
  const errorNode = extractResponseNode(body, "error_response");
  const node = errorNode || extractResponseNode(body, `${underscore(method)}_response`);
  if (!node) return { ...empty, code: "NO_RESPONSE_NODE", msg: "支付宝没有返回可解析的响应", subMsg: body.slice(0, 200) };

  let data: Record<string, any> = {};
  try { data = JSON.parse(node.raw); } catch { return { ...empty, code: "BAD_JSON", msg: "支付宝响应无法解析" }; }

  // Gateway-level rejections (invalid app_id, bad signature…) arrive unsigned.
  if (errorNode) {
    return {
      ok: false, verified: false, status, raw: empty.raw, data,
      code: String(data.code || ""), msg: String(data.msg || ""),
      subCode: String(data.sub_code || data.subCode || ""), subMsg: String(data.sub_msg || data.subMsg || ""),
    };
  }

  let verified = false;
  if (node.sign && config.alipayPublicKey) {
    verified = rsaVerify(node.raw, node.sign, config.alipayPublicKey);
  }
  const code = String(data.code || "");
  const base: AlipayResponse = {
    ok: code === "10000", verified, status, raw: empty.raw, data,
    code, msg: String(data.msg || ""),
    subCode: String(data.sub_code || data.subCode || ""), subMsg: String(data.sub_msg || data.subMsg || ""),
  };
  // An unsigned or badly signed "success" is not a fact we may act on.
  if (base.ok && !verified) {
    return { ...base, ok: false, subCode: base.subCode || "RESPONSE_NOT_VERIFIED", subMsg: base.subMsg || "支付宝响应验签没有通过" };
  }
  return base;
}

export async function callAlipay(method: string, bizContent: Record<string, unknown>, options: {
  config?: AlipayConfig;
  timeoutMs?: number;
} = {}): Promise<AlipayResponse> {
  const config = options.config || alipayConfig();
  const params = buildSignedParams({ method, bizContent }, config);
  const response = await fetch(config.gatewayUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(params).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  const text = await response.text();
  return parseGatewayResponse(method, text, config, response.status);
}

export interface TradeState {
  found: boolean;
  status: AlipayTradeStatus | "";
  tradeNo: string;
  outTradeNo: string;
  amountCents: number | null;
  sellerId: string;
  buyerLogonId: string;
  paidAt: string | null;
  paid: boolean;
  response: AlipayResponse;
}

/** Active order query — the fallback when the notification is late or never arrives. */
export async function queryTrade(outTradeNo: string, options: { config?: AlipayConfig } = {}): Promise<TradeState> {
  const response = await callAlipay("alipay.trade.query", { out_trade_no: outTradeNo }, options);
  const data = response.data || {};
  const status = String(data.trade_status || "") as TradeState["status"];
  const found = response.ok && Boolean(status);
  return {
    found,
    status: found ? status : "",
    tradeNo: String(data.trade_no || ""),
    outTradeNo: String(data.out_trade_no || outTradeNo),
    amountCents: found ? yuanToCents(data.total_amount) : null,
    sellerId: String(data.seller_id || ""),
    buyerLogonId: String(data.buyer_logon_id || ""),
    paidAt: beijingToIso(data.send_pay_date || data.gmt_payment),
    paid: found && (TRADE_SUCCESS_STATUSES as readonly string[]).includes(status),
    response,
  };
}

export interface RefundCallResult {
  ok: boolean;
  fundChange: boolean;
  tradeNo: string;
  refundFeeCents: number | null;
  response: AlipayResponse;
}

export async function refundTrade(input: {
  outTradeNo: string;
  outRequestNo: string;
  amountCents: number;
  reason?: string;
}, options: { config?: AlipayConfig } = {}): Promise<RefundCallResult> {
  const bizContent: Record<string, unknown> = {
    out_trade_no: input.outTradeNo,
    out_request_no: input.outRequestNo,
    refund_amount: centsToYuan(input.amountCents),
  };
  if (input.reason) bizContent.refund_reason = String(input.reason).slice(0, 256);
  const response = await callAlipay("alipay.trade.refund", bizContent, options);
  const data = response.data || {};
  return {
    ok: response.ok,
    fundChange: String(data.fund_change || "").toUpperCase() === "Y",
    tradeNo: String(data.trade_no || ""),
    refundFeeCents: yuanToCents(data.refund_fee),
    response,
  };
}

/**
 * Confirm a refund whose fund movement is unknown. `REFUND_SUCCESS` means the money
 * really went back; anything else stays "unknown" and must be settled by a human —
 * we never resubmit a refund we cannot account for.
 */
export async function queryRefund(input: {
  outTradeNo: string;
  outRequestNo: string;
}, options: { config?: AlipayConfig } = {}): Promise<{ refunded: boolean; refundAmountCents: number | null; response: AlipayResponse }> {
  const response = await callAlipay("alipay.trade.fastpay.refund.query", {
    out_trade_no: input.outTradeNo,
    out_request_no: input.outRequestNo,
  }, options);
  const data = response.data || {};
  return {
    refunded: response.ok && String(data.refund_status || "").toUpperCase() === "REFUND_SUCCESS",
    refundAmountCents: yuanToCents(data.refund_amount),
    response,
  };
}

export async function closeTrade(outTradeNo: string, options: { config?: AlipayConfig } = {}): Promise<AlipayResponse> {
  return callAlipay("alipay.trade.close", { out_trade_no: outTradeNo }, options);
}

// ---------- connection test (§11 支付测试) ----------

export interface AlipayTestResult {
  ok: boolean;
  message: string;
  warnings: string[];
  detail: Record<string, unknown>;
  testedAt: string;
}

const TEST_RESULT_KEYS = { at: "alipay_last_test_at", ok: "alipay_last_test_result", message: "alipay_last_test_message" } as const;

/**
 * Prove the credentials work without moving money: query a trade number that cannot
 * exist. `ACQ.TRADE_NOT_EXIST` means the gateway authenticated our app_id and
 * signature, which is the strongest free signal available.
 */
export async function testAlipayConnection(): Promise<AlipayTestResult> {
  const config = alipayConfig();
  const testedAt = new Date().toISOString();
  const warnings: string[] = [];
  const readiness = alipayReadiness(config);

  const persist = (result: AlipayTestResult) => {
    setSetting(TEST_RESULT_KEYS.at, result.testedAt);
    setSetting(TEST_RESULT_KEYS.ok, result.ok ? "success" : "failed");
    setSetting(TEST_RESULT_KEYS.message, result.message.slice(0, 200));
    return result;
  };

  if (!readiness.ready) {
    return persist({
      ok: false, testedAt, warnings,
      message: `支付宝配置不完整，还缺少：${readiness.missing.join("、")}`,
      detail: { missing: readiness.missing },
    });
  }
  if (!config.notifyUrl) warnings.push("还没有填写支付结果通知地址，用户付款后平台无法自动收到结果");
  else if (!/^https:\/\//i.test(config.notifyUrl)) warnings.push("支付结果通知地址建议使用公网 HTTPS 地址，否则支付宝无法回调");
  if (!config.returnUrl) warnings.push("还没有填写支付完成返回地址");
  if (!config.sellerId) warnings.push("还没有填写收款主体（seller_id），到账通知将无法核对收款方");
  if (config.env !== "production") warnings.push("当前是测试环境，不会产生真实收款");

  const probe = `WKTEST${Date.now()}${randomBytes(3).toString("hex").toUpperCase()}`;
  try {
    const trade = await queryTrade(probe, { config });
    const response = trade.response;
    const detail = {
      probe,
      code: response.code,
      msg: response.msg,
      subCode: response.subCode,
      subMsg: response.subMsg,
      verified: response.verified,
      gateway: config.gatewayUrl,
      env: config.env,
    };
    if (response.subCode === "ACQ.TRADE_NOT_EXIST" || response.code === "40004" && response.subCode === "ACQ.TRADE_NOT_EXIST") {
      return persist({
        ok: true, testedAt, warnings, detail,
        message: "支付宝连接正常：网关已经接受本次签名请求（探针订单不存在属于预期结果）",
      });
    }
    const hint = response.subCode === "isv.invalid-signature"
      ? "签名被拒绝，请核对应用私钥是否与开放平台上传的公钥配对"
      : response.subCode === "isv.invalid-app-id" || response.subCode === "isv.app-id-not-exist"
        ? "应用编号无效，请核对开放平台的 APPID"
        : response.subCode === "isv.insufficient-isv-permissions"
          ? "应用权限不足，请在开放平台为应用签约「电脑网站支付/手机网站支付」"
          : "";
    return persist({
      ok: false, testedAt, warnings, detail,
      message: hint || `支付宝连接未通过：${[response.code, response.subCode, response.subMsg || response.msg].filter(Boolean).join(" ")}`,
    });
  } catch (error) {
    return persist({
      ok: false, testedAt, warnings,
      detail: { probe, error: error instanceof Error ? error.message : String(error), gateway: config.gatewayUrl },
      message: "无法连接支付宝网关，请检查网络或网关地址",
    });
  }
}

export function lastAlipayTest() {
  return {
    testedAt: getSetting(TEST_RESULT_KEYS.at),
    ok: getSetting(TEST_RESULT_KEYS.ok) === "success",
    message: getSetting(TEST_RESULT_KEYS.message),
  };
}

/** Operator-facing view of the payment channel; never exposes key material. */
export function describeAlipayChannel(config: AlipayConfig = alipayConfig()) {
  const readiness = alipayReadiness(config);
  return {
    enabled: config.enabled,
    ready: readiness.ready,
    missing: readiness.missing,
    available: config.enabled && readiness.ready,
    env: config.env,
    envText: config.env === "production" ? "正式环境" : "测试环境",
    appId: config.appId,
    gatewayUrl: config.gatewayUrl,
    notifyUrl: config.notifyUrl,
    returnUrl: config.returnUrl,
    sellerId: config.sellerId,
    keyMode: "公钥模式",
    signType: "RSA2",
    lastTest: lastAlipayTest(),
  };
}
