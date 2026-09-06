// Local Alipay gateway stand-in for acceptance tests.
//
//   import { startAlipayMock, generateKeyPair } from "./alipay-mock.mjs";
//   const mock = await startAlipayMock({ port: 3110, merchantPublicKey, alipayPrivateKey });
//
// It is a *protocol* mock, not a shortcut: every request it receives is signature-checked
// with the merchant public key (so bad signing fails the test), every response and every
// asynchronous notification it produces is signed with the Alipay private key (so the app
// under test really has to verify). Money never moves, and the app's own code path is the
// one being exercised — notification handling, active query, refunds and idempotency.
//
// Standalone: node scripts/alipay-mock.mjs   (prints generated keys and the control API)

import http from "node:http";
import { createSign, createVerify, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";

export function generateKeyPair(modulusLength = 2048) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** Request/response canonical string: `sign` and empty values never take part. */
export function canonicalize(params, { excludeSignType = false } = {}) {
  return Object.keys(params)
    .filter(key => key !== "sign" && !(excludeSignType && key === "sign_type"))
    .filter(key => params[key] !== undefined && params[key] !== null && String(params[key]) !== "")
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join("&");
}

function sign(content, privatePem) {
  return createSign("RSA-SHA256").update(content, "utf8").sign(privatePem, "base64");
}

function verify(content, signature, publicPem) {
  try {
    return createVerify("RSA-SHA256").update(content, "utf8").verify(publicPem, signature, "base64");
  } catch {
    return false;
  }
}

function beijingTimestamp(date = new Date()) {
  const beijing = new Date(date.getTime() + (8 * 60 + date.getTimezoneOffset()) * 60_000);
  const pad = value => String(value).padStart(2, "0");
  return `${beijing.getFullYear()}-${pad(beijing.getMonth() + 1)}-${pad(beijing.getDate())} `
    + `${pad(beijing.getHours())}:${pad(beijing.getMinutes())}:${pad(beijing.getSeconds())}`;
}

function jsonResponse(node, payload, { alipayPrivateKey, signIt = true } = {}) {
  const body = JSON.stringify(payload);
  const signed = signIt && alipayPrivateKey ? `,"sign":"${sign(body, alipayPrivateKey)}"` : "";
  return `{"${node}":${body}${signed}}`;
}

function errorResponse(payload) {
  return jsonResponse("error_response", payload, { signIt: false });
}

const TRADE_NOT_EXIST = { code: "40004", msg: "Business Failed", sub_code: "ACQ.TRADE_NOT_EXIST", sub_msg: "交易不存在" };

export async function startAlipayMock(options = {}) {
  const {
    port = 0,
    merchantPublicKey,
    alipayPrivateKey,
    appId = "2021000000000001",
    sellerId = "2088900000000001",
    sellerEmail = "merchant@wanke.test",
    verifyRequests = true,
    defaultNotifyUrl = "",
  } = options;

  if (!merchantPublicKey) throw new Error("merchantPublicKey is required");
  if (!alipayPrivateKey) throw new Error("alipayPrivateKey is required");

  /** out_trade_no -> trade */
  const trades = new Map();
  const log = { gateway: [], notifications: [] };
  let refundMode = "normal"; // normal | no_fund_change | no_fund_change_confirmed
  let notifyAppId = appId;
  let signKeyOverride = null; // sign notifications with the wrong key (forged notify test)

  function tradeOf(outTradeNo) {
    return trades.get(outTradeNo) || null;
  }

  function ensureTrade(outTradeNo, totalAmount) {
    let trade = trades.get(outTradeNo);
    if (!trade) {
      trade = {
        out_trade_no: outTradeNo,
        trade_no: `2026${randomBytes(8).toString("hex")}`,
        total_amount: totalAmount,
        trade_status: "WAIT_BUYER_PAY",
        buyer_id: `2088buyer${randomBytes(3).toString("hex")}`,
        buyer_logon_id: "buyer@wanke.test",
        gmt_create: beijingTimestamp(),
        gmt_payment: null,
        refunds: new Map(),
        pay_requests: [],
      };
      trades.set(outTradeNo, trade);
    } else if (totalAmount && !trade.total_amount) {
      trade.total_amount = totalAmount;
    }
    return trade;
  }

  function tradePayload(trade) {
    const payload = {
      code: "10000",
      msg: "Success",
      trade_no: trade.trade_no,
      out_trade_no: trade.out_trade_no,
      buyer_logon_id: trade.buyer_logon_id,
      trade_status: trade.trade_status,
      total_amount: trade.total_amount,
      receipt_amount: trade.total_amount,
      buyer_pay_amount: trade.trade_status === "WAIT_BUYER_PAY" ? "0.00" : trade.total_amount,
      invoice_amount: trade.total_amount,
      point_amount: "0.00",
      send_pay_date: trade.gmt_payment || undefined,
      buyer_user_id: trade.buyer_id,
      seller_id: sellerId,
    };
    return JSON.parse(JSON.stringify(payload));
  }

  function notifyParams(trade, overrides = {}) {
    const params = {
      notify_time: beijingTimestamp(),
      notify_type: "trade_status_sync",
      notify_id: randomUUID().replace(/-/g, ""),
      app_id: overrides.app_id ?? notifyAppId,
      charset: "utf-8",
      version: "1.0",
      sign_type: "RSA2",
      trade_no: trade.trade_no,
      out_trade_no: trade.out_trade_no,
      buyer_id: trade.buyer_id,
      buyer_logon_id: trade.buyer_logon_id,
      seller_id: overrides.seller_id ?? sellerId,
      seller_email: sellerEmail,
      trade_status: overrides.trade_status ?? trade.trade_status,
      total_amount: overrides.total_amount ?? trade.total_amount,
      receipt_amount: overrides.total_amount ?? trade.total_amount,
      buyer_pay_amount: overrides.total_amount ?? trade.total_amount,
      invoice_amount: overrides.total_amount ?? trade.total_amount,
      point_amount: "0.00",
      gmt_payment: trade.gmt_payment || beijingTimestamp(),
      fund_bill_list: JSON.stringify([{ amount: overrides.total_amount ?? trade.total_amount, fundChannel: "ALIPAYACCOUNT" }]),
    };
    if (overrides.drop_sign) {
      delete params.sign_type;
      return params;
    }
    const key = signKeyOverride || alipayPrivateKey;
    // Async notification signature excludes sign and sign_type (verifyV1).
    params.sign = sign(canonicalize(params, { excludeSignType: true }), key);
    return params;
  }

  async function sendNotification(params, notifyUrl) {
    const body = new URLSearchParams(params).toString();
    const started = Date.now();
    try {
      const response = await fetch(notifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const text = (await response.text()).trim();
      const entry = {
        at: new Date().toISOString(), out_trade_no: params.out_trade_no, trade_status: params.trade_status,
        total_amount: params.total_amount, status: response.status, reply: text, ms: Date.now() - started,
      };
      log.notifications.push(entry);
      return entry;
    } catch (error) {
      const entry = {
        at: new Date().toISOString(), out_trade_no: params.out_trade_no, trade_status: params.trade_status,
        status: 0, reply: "", error: error instanceof Error ? error.message : String(error),
      };
      log.notifications.push(entry);
      return entry;
    }
  }

  function readBody(request) {
    return new Promise(resolve => {
      const chunks = [];
      request.on("data", chunk => chunks.push(chunk));
      request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }

  function send(response, status, body, type = "application/json;charset=utf-8") {
    response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(body);
  }

  async function handleGateway(request, response, url) {
    const raw = request.method === "POST" ? await readBody(request) : "";
    const formParams = {};
    if (raw) new URLSearchParams(raw).forEach((value, key) => { formParams[key] = value; });
    url.searchParams.forEach((value, key) => { formParams[key] = value; });

    const method = formParams.method || "";
    const signatureValid = verifyRequests
      ? verify(canonicalize(formParams), String(formParams.sign || ""), merchantPublicKey)
      : true;
    let bizContent = {};
    try { bizContent = JSON.parse(formParams.biz_content || "{}"); } catch { bizContent = {}; }

    log.gateway.push({
      at: new Date().toISOString(), method, out_trade_no: bizContent.out_trade_no || "",
      total_amount: bizContent.total_amount || "", product_code: bizContent.product_code || "",
      notify_url: formParams.notify_url || "", return_url: formParams.return_url || "",
      timeout_express: bizContent.timeout_express || "", app_id: formParams.app_id || "",
      signatureValid, hasSign: Boolean(formParams.sign), signType: formParams.sign_type || "",
    });

    if (!signatureValid) {
      return send(response, 200, errorResponse({ code: "40002", msg: "Invalid Arguments", sub_code: "isv.invalid-signature", sub_msg: "签名不正确" }));
    }
    if ((formParams.app_id || "") !== appId) {
      return send(response, 200, errorResponse({ code: "40002", msg: "Invalid Arguments", sub_code: "isv.invalid-app-id", sub_msg: "应用编号无效" }));
    }

    if (method === "alipay.trade.page.pay" || method === "alipay.trade.wap.pay") {
      const outTradeNo = String(bizContent.out_trade_no || "");
      if (!outTradeNo || !bizContent.total_amount) {
        return send(response, 200, errorResponse({ code: "40002", msg: "Invalid Arguments", sub_code: "isv.missing-parameter", sub_msg: "缺少参数" }));
      }
      const trade = ensureTrade(outTradeNo, String(bizContent.total_amount));
      trade.pay_requests.push({ at: new Date().toISOString(), method, product_code: bizContent.product_code, notify_url: formParams.notify_url, return_url: formParams.return_url, timeout_express: bizContent.timeout_express, subject: bizContent.subject });
      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>收银台（本地测试）</title></head>
<body style="font-family:system-ui;padding:40px">
<h1>支付宝收银台（本地测试桩）</h1>
<p>商户订单号：${trade.out_trade_no}</p>
<p>金额：¥${trade.total_amount}</p>
<p>商品：${bizContent.subject || ""}</p>
<p>这是本地测试网关，不会发生真实扣款。</p>
</body></html>`;
      return send(response, 200, html, "text/html; charset=utf-8");
    }

    if (method === "alipay.trade.query") {
      const trade = tradeOf(String(bizContent.out_trade_no || ""));
      if (!trade) return send(response, 200, jsonResponse("alipay_trade_query_response", TRADE_NOT_EXIST, { alipayPrivateKey }));
      return send(response, 200, jsonResponse("alipay_trade_query_response", tradePayload(trade), { alipayPrivateKey }));
    }

    if (method === "alipay.trade.refund") {
      const trade = tradeOf(String(bizContent.out_trade_no || ""));
      if (!trade) return send(response, 200, jsonResponse("alipay_trade_refund_response", TRADE_NOT_EXIST, { alipayPrivateKey }));
      if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(trade.trade_status)) {
        return send(response, 200, jsonResponse("alipay_trade_refund_response", {
          code: "40004", msg: "Business Failed", sub_code: "ACQ.TRADE_STATUS_ERROR", sub_msg: "交易状态错误",
        }, { alipayPrivateKey }));
      }
      const outRequestNo = String(bizContent.out_request_no || "");
      const refundAmount = String(bizContent.refund_amount || "0.00");
      const existing = trade.refunds.get(outRequestNo);
      if (existing) {
        // Same out_request_no: Alipay de-duplicates and reports no new fund movement.
        return send(response, 200, jsonResponse("alipay_trade_refund_response", {
          code: "10000", msg: "Success", trade_no: trade.trade_no, out_trade_no: trade.out_trade_no,
          buyer_logon_id: trade.buyer_logon_id, fund_change: "N", refund_fee: existing.refund_amount,
        }, { alipayPrivateKey }));
      }
      const refunded = [...trade.refunds.values()].reduce((sum, item) => sum + Number(item.refund_amount), 0);
      if (refunded + Number(refundAmount) > Number(trade.total_amount) + 1e-9) {
        return send(response, 200, jsonResponse("alipay_trade_refund_response", {
          code: "40004", msg: "Business Failed", sub_code: "ACQ.REFUND_AMT_NOT_EQUAL_TOTAL", sub_msg: "退款金额超过可退金额",
        }, { alipayPrivateKey }));
      }
      if (refundMode === "no_fund_change" || refundMode === "no_fund_change_confirmed") {
        // The money did not move and no refund is recorded: the app must treat this as
        // "unknown" instead of claiming success.
        if (refundMode === "no_fund_change_confirmed") {
          trade.refunds.set(outRequestNo, { out_request_no: outRequestNo, refund_amount: refundAmount, confirmed_only: true, at: new Date().toISOString() });
        }
        return send(response, 200, jsonResponse("alipay_trade_refund_response", {
          code: "10000", msg: "Success", trade_no: trade.trade_no, out_trade_no: trade.out_trade_no,
          buyer_logon_id: trade.buyer_logon_id, fund_change: "N", refund_fee: refundAmount,
        }, { alipayPrivateKey }));
      }
      trade.refunds.set(outRequestNo, { out_request_no: outRequestNo, refund_amount: refundAmount, at: new Date().toISOString() });
      return send(response, 200, jsonResponse("alipay_trade_refund_response", {
        code: "10000", msg: "Success", trade_no: trade.trade_no, out_trade_no: trade.out_trade_no,
        buyer_logon_id: trade.buyer_logon_id, fund_change: "Y", refund_fee: refundAmount,
        gmt_refund_pay: beijingTimestamp(), send_back_fee: "0.00",
      }, { alipayPrivateKey }));
    }

    if (method === "alipay.trade.fastpay.refund.query") {
      const trade = tradeOf(String(bizContent.out_trade_no || ""));
      const outRequestNo = String(bizContent.out_request_no || "");
      const refund = trade?.refunds.get(outRequestNo);
      if (!refund) {
        // Real Alipay answers 10000 without `refund_status` when it never saw the request.
        return send(response, 200, jsonResponse("alipay_trade_fastpay_refund_query_response", {
          code: "10000", msg: "Success", out_request_no: outRequestNo, out_trade_no: bizContent.out_trade_no,
        }, { alipayPrivateKey }));
      }
      return send(response, 200, jsonResponse("alipay_trade_fastpay_refund_query_response", {
        code: "10000", msg: "Success", out_request_no: outRequestNo, out_trade_no: trade.out_trade_no,
        refund_amount: refund.refund_amount, refund_status: "REFUND_SUCCESS", gmt_refund_pay: beijingTimestamp(),
      }, { alipayPrivateKey }));
    }

    if (method === "alipay.trade.close") {
      const trade = tradeOf(String(bizContent.out_trade_no || ""));
      if (!trade) return send(response, 200, jsonResponse("alipay_trade_close_response", TRADE_NOT_EXIST, { alipayPrivateKey }));
      if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(trade.trade_status)) trade.trade_status = "TRADE_CLOSED";
      return send(response, 200, jsonResponse("alipay_trade_close_response", {
        code: "10000", msg: "Success", trade_no: trade.trade_no, out_trade_no: trade.out_trade_no,
      }, { alipayPrivateKey }));
    }

    return send(response, 200, errorResponse({ code: "40002", msg: "Invalid Arguments", sub_code: "isv.invalid-method", sub_msg: `不支持的方法 ${method}` }));
  }

  async function handleControl(request, response, url) {
    const route = url.pathname;
    const input = request.method === "POST" ? JSON.parse((await readBody(request)) || "{}") : {};

    if (route === "/__mock/state") {
      return send(response, 200, JSON.stringify({
        appId, sellerId, refundMode, notifyAppId,
        trades: [...trades.values()].map(trade => ({ ...trade, refunds: [...trade.refunds.values()] })),
        gateway: log.gateway, notifications: log.notifications,
      }, null, 2));
    }

    if (route === "/__mock/reset") {
      trades.clear();
      log.gateway.length = 0;
      log.notifications.length = 0;
      refundMode = "normal";
      notifyAppId = appId;
      signKeyOverride = null;
      return send(response, 200, JSON.stringify({ ok: true }));
    }

    if (route === "/__mock/config") {
      if (input.refund_mode) refundMode = input.refund_mode;
      if (input.notify_app_id !== undefined) notifyAppId = input.notify_app_id;
      if (input.forged_sign_key !== undefined) signKeyOverride = input.forged_sign_key || null;
      return send(response, 200, JSON.stringify({ ok: true, refundMode, notifyAppId, forged: Boolean(signKeyOverride) }));
    }

    if (route === "/__mock/trade") {
      // Create or update a trade without paying it (used for expired-order scenarios).
      const trade = ensureTrade(String(input.out_trade_no), String(input.total_amount ?? "0.01"));
      if (input.trade_status) trade.trade_status = input.trade_status;
      if (input.trade_no) trade.trade_no = input.trade_no;
      return send(response, 200, JSON.stringify({ ok: true, trade: { ...trade, refunds: [...trade.refunds.values()] } }));
    }

    if (route === "/__mock/pay") {
      const outTradeNo = String(input.out_trade_no || "");
      const trade = ensureTrade(outTradeNo, String(input.total_amount ?? trades.get(outTradeNo)?.total_amount ?? "0.01"));
      trade.trade_status = "TRADE_SUCCESS";
      trade.gmt_payment = beijingTimestamp();
      if (input.total_amount) trade.total_amount = String(input.total_amount);
      if (input.buyer_logon_id) trade.buyer_logon_id = input.buyer_logon_id;
      if (input.notify === false) return send(response, 200, JSON.stringify({ ok: true, notified: false, trade: { ...trade, refunds: [] } }));
      const payRequest = [...trade.pay_requests].reverse().find(item => item.notify_url);
      const notifyUrl = input.notify_url || payRequest?.notify_url || defaultNotifyUrl;
      if (!notifyUrl) return send(response, 400, JSON.stringify({ ok: false, error: "no notify_url known for this trade" }));
      const entry = await sendNotification(notifyParams(trade, input.overrides || {}), notifyUrl);
      return send(response, 200, JSON.stringify({ ok: true, notified: true, notification: entry }));
    }

    if (route === "/__mock/notify") {
      const outTradeNo = String(input.out_trade_no || "");
      const trade = trades.get(outTradeNo) || ensureTrade(outTradeNo, String(input.total_amount ?? "0.01"));
      const payRequest = [...trade.pay_requests].reverse().find(item => item.notify_url);
      const notifyUrl = input.notify_url || payRequest?.notify_url || defaultNotifyUrl;
      if (!notifyUrl) return send(response, 400, JSON.stringify({ ok: false, error: "no notify_url known for this trade" }));
      const overrides = {
        trade_status: input.trade_status,
        total_amount: input.total_amount === undefined ? undefined : String(input.total_amount),
        seller_id: input.seller_id,
        app_id: input.app_id,
        drop_sign: input.drop_sign,
      };
      const times = Math.max(1, Math.min(50, Number(input.times || 1)));
      const replies = [];
      for (let index = 0; index < times; index += 1) {
        if (input.delay_ms) await new Promise(resolve => setTimeout(resolve, Number(input.delay_ms)));
        replies.push(await sendNotification(notifyParams(trade, overrides), notifyUrl));
      }
      return send(response, 200, JSON.stringify({ ok: true, sent: replies.length, replies }));
    }

    return send(response, 404, JSON.stringify({ ok: false, error: `unknown control route ${route}` }));
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const task = (async () => {
      if (url.pathname === "/gateway.do") return handleGateway(request, response, url);
      if (url.pathname.startsWith("/__mock/")) return handleControl(request, response, url);
      if (url.pathname === "/health") return send(response, 200, JSON.stringify({ ok: true }));
      return send(response, 404, JSON.stringify({ ok: false, error: "not found" }));
    })();
    task.catch(error => {
      try { send(response, 500, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); } catch { /* already sent */ }
    });
  });

  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  const baseUrl = `http://127.0.0.1:${boundPort}`;

  return {
    baseUrl,
    port: boundPort,
    gatewayUrl: `${baseUrl}/gateway.do`,
    appId,
    sellerId,
    state: async () => (await fetch(`${baseUrl}/__mock/state`, { cache: "no-store" })).json(),
    reset: async () => (await fetch(`${baseUrl}/__mock/reset`, { method: "POST", cache: "no-store" })).json(),
    config: async input => (await fetch(`${baseUrl}/__mock/config`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store",
    })).json(),
    pay: async input => (await fetch(`${baseUrl}/__mock/pay`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store",
    })).json(),
    notify: async input => (await fetch(`${baseUrl}/__mock/notify`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store",
    })).json(),
    trade: async input => (await fetch(`${baseUrl}/__mock/trade`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store",
    })).json(),
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

if (process.argv[1] && process.argv[1].endsWith("alipay-mock.mjs")) {
  const merchant = generateKeyPair();
  const alipay = generateKeyPair();
  const port = Number(process.env.MOCK_PORT || 3110);
  const mock = await startAlipayMock({ port, merchantPublicKey: merchant.publicPem, alipayPrivateKey: alipay.privatePem });
  console.log(`alipay mock gateway: ${mock.gatewayUrl}`);
  console.log(`control api: ${mock.baseUrl}/__mock/state | /__mock/pay | /__mock/notify | /__mock/config | /__mock/reset`);
  console.log("\n# merchant keypair (应用私钥 → 后台 alipay_private_key)\n" + merchant.privatePem);
  console.log("# merchant public key (上传到支付宝开放平台，测试桩用它验签)\n" + merchant.publicPem);
  console.log("# alipay keypair (测试桩用它签名)\n" + alipay.privatePem);
  console.log("# alipay public key (支付宝公钥 → 后台 alipay_public_key)\n" + alipay.publicPem);
}
