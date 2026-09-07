// Phase 3 account acceptance (§13 完整用户账号系统, §45 安全要求).
//
//   ./scripts/e2e-run.sh scripts/account-e2e.mjs
//
// Mail is exercised against a real local SMTP server (scripts/smtp-mock.mjs) that speaks
// the protocol strictly, checks credentials and can refuse, stall or fail. Nothing here
// asserts a simulated success: when the platform cannot deliver, the member is told so
// and the mail journal records the true outcome.
import fs from "node:fs";
import path from "node:path";
import { parseMessage, startSmtpMock } from "./smtp-mock.mjs";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@wanke.test";
const DB_PATH = process.env.E2E_DB || "./data/e2e.db";
const SMTP_BASE_PORT = Number(process.env.E2E_SMTP_PORT || 3120);
const SITE_URL = "https://wanke.test";
const SMTP_USER = "mailer@wanke.test";
const SMTP_PASSWORD = "smtp-mock-password";
const SMTP_FROM = "Wanke <no-reply@wanke.test>";
const CERT_PATH = process.env.WANKE_SMTP_TEST_CERT || "";
const KEY_PATH = process.env.WANKE_SMTP_TEST_KEY || "";
const OUTBOX_DIR = path.resolve(process.env.WANKE_MAIL_OUTBOX_DIR || "./data/mail-outbox");

// Anything engineering-shaped must never reach a member-facing response.
const TECHNICAL_PATTERN = /Provider|Endpoint|RequestId|MediaId|\bSMTP\b|EHLO|STARTTLS|AUTH LOGIN|ECONNREFUSED|EACCES|SQLITE|scrypt|token_hash|biz_content|\bTLS\b/i;

let failures = 0;
let skips = 0;
let checks = 0;
const leakHits = [];

function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`); }
}

function skip(name, reason) {
  skips += 1;
  console.log(`  SKIP ${name} -> ${reason}`);
}

/** Record a member-facing payload and fail the run if it leaks internals. */
function scanLeak(label, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (TECHNICAL_PATTERN.test(text)) leakHits.push(`${label}: ${text.slice(0, 220)}`);
}

async function call(pathname, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
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

async function register(email, name, password = "account-pass-123", extra = {}) {
  const result = await call("/api/auth/register", { method: "POST", body: { email, name, password, termsAccepted: true, ...extra } });
  if (result.status !== 201) throw new Error(`register ${email} failed: ${result.status} ${result.text}`);
  scanLeak(`register ${email}`, result.json);
  return { cookie: result.session, id: result.json.user.id, email, password, body: result.json };
}

async function login(email, password) {
  const result = await call("/api/auth/login", { method: "POST", body: { email, password } });
  scanLeak(`login ${email}`, result.json);
  return result;
}

async function configure(values) {
  const result = await call("/api/admin/system-settings", { method: "POST", cookie: admin.cookie, body: { values } });
  if (result.status !== 200) throw new Error(`settings update failed: ${result.status} ${result.text}`);
  return result;
}

/** Push a mail journal row out of the 60s resend window so the next send is allowed. */
function rewindMailCooldown(userId, kind) {
  execute("UPDATE email_messages SET created_at=? WHERE user_id=? AND kind=?",
    new Date(Date.now() - 10 * 60 * 1000).toISOString(), userId, kind);
}

function tokenFromMail(message, route) {
  const match = new RegExp(`${route}\\?token=([a-f0-9]{64})`).exec(message.text);
  return match ? match[1] : "";
}

function lastMail(mock, to) {
  return [...mock.messages].reverse().find(message => message.envelope?.to?.includes(to)) || null;
}

function emailRow(userId, kind) {
  return queryOne("SELECT * FROM email_messages WHERE user_id=? AND kind=? ORDER BY created_at DESC, rowid DESC LIMIT 1", userId, kind);
}

// ---------- fixtures ----------

const admin = await register(ADMIN_EMAIL, "Operator", "admin-pass-123");
// A member whose session stays valid for the whole run: used for every 越权 assertion.
const member = await register("member@wanke.test", "Member");
const mocks = {};

async function mock(name, options) {
  if (!mocks[name]) mocks[name] = await startSmtpMock({ port: SMTP_BASE_PORT + Object.keys(mocks).length, ...options });
  return mocks[name];
}

const plain = await mock("plain", { credentials: { username: SMTP_USER, password: SMTP_PASSWORD } });
const loginOnly = await mock("login", { credentials: { username: SMTP_USER, password: SMTP_PASSWORD }, mechanisms: ["LOGIN"] });
const refusing = await mock("refusing", { credentials: { username: SMTP_USER, password: SMTP_PASSWORD }, behaviour: { rcptCode: 550 } });
const stalling = await mock("stalling", { credentials: { username: SMTP_USER, password: SMTP_PASSWORD }, behaviour: { stall: "data" } });

const haveCertificate = Boolean(CERT_PATH && KEY_PATH && fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH));
const tlsMaterial = haveCertificate ? { cert: fs.readFileSync(CERT_PATH, "utf8"), key: fs.readFileSync(KEY_PATH, "utf8") } : null;
const implicitTls = tlsMaterial ? await mock("tls", { tls: tlsMaterial, credentials: { username: SMTP_USER, password: SMTP_PASSWORD } }) : null;
const startTls = tlsMaterial ? await mock("starttls", { tls: tlsMaterial, starttls: true, credentials: { username: SMTP_USER, password: SMTP_PASSWORD } }) : null;

const useSmtp = port => configure({
  email_enabled: true, email_host: "127.0.0.1", email_port: port, email_secure: false,
  email_from: SMTP_FROM, email_username: SMTP_USER, email_password: SMTP_PASSWORD,
  site_url: SITE_URL, require_email_verification: false, registration_enabled: true,
});

await useSmtp(plain.port);

try {
  console.log("== 注册即发送验证邮件（真实 SMTP 投递） ==");
  const vera = await register("vera@wanke.test", "Vera");
  check("注册成功并返回邮箱验证状态", vera.body.emailVerification?.delivered === true, JSON.stringify(vera.body.emailVerification));
  const veraMail = lastMail(plain, "vera@wanke.test");
  check("验证邮件真的到达了邮件服务器", Boolean(veraMail), `messages=${plain.messages.length}`);
  check("邮件收件人是注册邮箱", veraMail?.envelope?.to?.[0] === "vera@wanke.test", JSON.stringify(veraMail?.envelope));
  check("信封发件人来自后台配置", veraMail?.envelope?.from === "no-reply@wanke.test", veraMail?.envelope?.from);
  check("邮件标题是业务语言", /验证/.test(veraMail?.subject || ""), veraMail?.subject);
  check("邮件正文包含一次性验证链接", (veraMail?.text || "").includes(`${SITE_URL}/verify-email?token=`), (veraMail?.text || "").slice(0, 120));
  check("链接使用后台配置的网站地址", !(veraMail?.text || "").includes("localhost:3000"));
  check("邮件正文使用中文称呼与站点名", /Vera/.test(veraMail?.text || "") && /Wanke/.test(veraMail?.text || ""));
  check("邮件正文没有留下未替换的占位符", !/\{(name|site|link|minutes|contact)\}/.test(veraMail?.text || ""), (veraMail?.text || "").slice(0, 160));
  check("中文正文以 base64 传输并可解码", (veraMail?.headers["content-transfer-encoding"] || "").toLowerCase() === "base64" && /验证/.test(veraMail?.text || ""));
  check("SMTP 会话通过了登录校验", veraMail?.authenticated === true && plain.state.authAttempts.some(a => a.ok));
  const veraRow = emailRow(vera.id, "verify_email");
  check("邮件流水记录为已发送", veraRow?.status === "sent" && veraRow?.transport === "smtp", JSON.stringify(veraRow));
  check("邮件流水记录了收件人与时间", veraRow?.to_address === "vera@wanke.test" && Boolean(veraRow?.sent_at));
  const veraToken = tokenFromMail(veraMail, "/verify-email");
  check("链接里是一次性令牌", /^[a-f0-9]{64}$/.test(veraToken));
  check("数据库只保存令牌摘要", queryOne("SELECT * FROM account_tokens WHERE user_id=? AND purpose='verify_email'", vera.id)?.token_hash !== veraToken);
  check("令牌明文没有落库", !JSON.stringify(query("SELECT * FROM account_tokens")).includes(veraToken));
  check("邮件流水不保存可用的一次性链接", !JSON.stringify(query("SELECT * FROM email_messages")).includes(veraToken) && /token=<已隐去>/.test(veraRow?.body_text || ""), (veraRow?.body_text || "").slice(0, 120));

  console.log("== 验证链接一次性使用，旧链接立即失效 ==");
  const verified = await call("/api/auth/verify-email", { method: "POST", body: { token: veraToken } });
  check("验证链接可用", verified.status === 200 && verified.json?.ok === true, `${verified.status} ${verified.text}`);
  scanLeak("verify-email", verified.json);
  check("验证结果回显邮箱", verified.json?.email === "vera@wanke.test");
  check("账号标记为已验证", Number(queryOne("SELECT email_verified FROM users WHERE id=?", vera.id).email_verified) === 1);
  check("记录了验证时间", Boolean(queryOne("SELECT email_verified_at FROM users WHERE id=?", vera.id).email_verified_at));
  check("验证成功后产生站内通知", Number(queryOne("SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND type='system'", vera.id).c) >= 1);
  const replay = await call("/api/auth/verify-email", { method: "POST", body: { token: veraToken } });
  check("同一链接不能重复使用", replay.status === 400 && replay.json?.code === "TOKEN_USED", `${replay.status} ${replay.text}`);
  scanLeak("verify-email replay", replay.json);
  check("并发点击只有一个成功", Number(queryOne("SELECT COUNT(*) AS c FROM account_tokens WHERE user_id=? AND purpose='verify_email' AND consumed_at IS NOT NULL", vera.id).c) === 1);
  const garbage = await call("/api/auth/verify-email", { method: "POST", body: { token: "not-a-token" } });
  check("伪造令牌被拒绝", garbage.status === 400 && garbage.json?.code === "TOKEN_INVALID", `${garbage.status} ${garbage.text}`);
  const randomToken = await call("/api/auth/verify-email", { method: "POST", body: { token: "a".repeat(64) } });
  check("猜测的令牌被拒绝", randomToken.status === 400);
  const alreadyVerified = await call("/api/account/verify-email", { method: "POST", cookie: vera.cookie });
  check("已验证账号不再发送验证邮件", alreadyVerified.status === 409 && alreadyVerified.json?.code === "EMAIL_ALREADY_VERIFIED", `${alreadyVerified.status} ${alreadyVerified.text}`);

  console.log("== 重发验证邮件：旧链接立即失效 + 60 秒节流 ==");
  const ivan = await register("ivan@wanke.test", "Ivan");
  const ivanFirstToken = tokenFromMail(lastMail(plain, "ivan@wanke.test"), "/verify-email");
  const tooFast = await call("/api/account/verify-email", { method: "POST", cookie: ivan.cookie });
  check("60 秒内重复请求被限制", tooFast.status === 429 && tooFast.json?.code === "RATE_LIMITED", `${tooFast.status} ${tooFast.text}`);
  check("限流响应告知还需要等待多久", Number(tooFast.json?.retryAfterSeconds) > 0 && Number(tooFast.json?.retryAfterSeconds) <= 60, JSON.stringify(tooFast.json));
  scanLeak("verify-email rate limit", tooFast.json);
  rewindMailCooldown(ivan.id, "verify_email");
  const resent = await call("/api/account/verify-email", { method: "POST", cookie: ivan.cookie });
  check("冷却结束后可以重新发送", resent.status === 200 && resent.json?.delivered === true, `${resent.status} ${resent.text}`);
  check("重发响应使用业务文案并告知有效期", /验证邮件已发送/.test(resent.json?.notice || "") && /小时/.test(resent.json?.notice || ""), resent.json?.notice);
  scanLeak("verify-email resend", resent.json);
  const ivanSecondToken = tokenFromMail(lastMail(plain, "ivan@wanke.test"), "/verify-email");
  check("重发生成了新的令牌", Boolean(ivanSecondToken) && ivanSecondToken !== ivanFirstToken);
  const oldLink = await call("/api/auth/verify-email", { method: "POST", body: { token: ivanFirstToken } });
  check("旧的验证链接立即失效", oldLink.status === 400, `${oldLink.status} ${oldLink.text}`);
  check("同一账号同一用途只保留一条有效链接", Number(queryOne("SELECT COUNT(*) AS c FROM account_tokens WHERE user_id=? AND purpose='verify_email' AND consumed_at IS NULL", ivan.id).c) === 1);
  const anonymousResend = await call("/api/account/verify-email", { method: "POST" });
  check("未登录不能请求发送验证邮件", anonymousResend.status === 401, `${anonymousResend.status}`);
  const crossResend = await call("/api/account/verify-email", { method: "POST", cookie: ivan.cookie });
  check("重发只作用于自己的账号", crossResend.status === 429 && Number(queryOne("SELECT COUNT(*) AS c FROM email_messages WHERE to_address='vera@wanke.test' AND kind='verify_email'").c) === 1);
  const newLink = await call("/api/auth/verify-email", { method: "POST", body: { token: ivanSecondToken } });
  check("新链接可以完成验证", newLink.status === 200);

  console.log("== 过期链接不能使用 ==");
  const carl = await register("carl@wanke.test", "Carl");
  const carlToken = tokenFromMail(lastMail(plain, "carl@wanke.test"), "/verify-email");
  execute("UPDATE account_tokens SET expires_at=? WHERE user_id=? AND purpose='verify_email'",
    new Date(Date.now() - 60_000).toISOString(), carl.id);
  const expired = await call("/api/auth/verify-email", { method: "POST", body: { token: carlToken } });
  check("过期链接被拒绝并给出业务提示", expired.status === 400 && expired.json?.code === "TOKEN_EXPIRED" && /过期/.test(expired.json?.error || ""), `${expired.status} ${expired.text}`);
  check("过期链接没有验证邮箱", Number(queryOne("SELECT email_verified FROM users WHERE id=?", carl.id).email_verified) === 0);
  check("过期令牌已被清理", Number(queryOne("SELECT COUNT(*) AS c FROM account_tokens WHERE user_id=? AND purpose='verify_email'", carl.id).c) === 0);
  const expiredAgain = await call("/api/auth/verify-email", { method: "POST", body: { token: carlToken } });
  check("过期令牌重放同样被拒绝", expiredAgain.status === 400);

  console.log("== 强制验证邮箱：限制创作但不限制登录（§13） ==");
  await configure({ require_email_verification: true });
  const dora = await register("dora@wanke.test", "Dora");
  check("开启强制验证后注册仍然成功", Boolean(dora.id));
  check("注册响应说明需要验证邮箱", dora.body.emailVerification?.required === true, JSON.stringify(dora.body.emailVerification));
  const doraLogin = await login("dora@wanke.test", "account-pass-123");
  check("未验证邮箱仍然可以登录", doraLogin.status === 200, `${doraLogin.status} ${doraLogin.text}`);
  const doraMe = await call("/api/auth/me", { cookie: dora.cookie });
  check("会员状态接口说明创作受限原因", doraMe.json?.account?.blocked === true && /验证邮箱/.test(doraMe.json?.account?.message || ""), JSON.stringify(doraMe.json?.account));
  check("受限说明使用业务文案并给出下一步", /账号设置/.test(doraMe.json?.account?.hint || ""), doraMe.json?.account?.hint);
  scanLeak("me.account", doraMe.json?.account);
  const doraOrders = await call("/api/orders", { cookie: dora.cookie });
  check("未验证邮箱仍然可以查看订单", doraOrders.status === 200, `${doraOrders.status}`);
  const doraQuote = await call("/api/quota/quote", { method: "POST", cookie: dora.cookie, body: { kind: "video_generation", input: { prompt: "a cat" } } });
  check("提交前报价提前告知无法创作", doraQuote.status === 200 && doraQuote.json?.account?.blocked === true, JSON.stringify(doraQuote.json?.account));
  const doraJob = await call("/api/jobs", { method: "POST", cookie: dora.cookie, body: { kind: "video_generation", title: "blocked", input: { prompt: "a dog" }, clientRequestId: `acct-${Date.now()}-1` } });
  check("未验证邮箱不能提交创作", doraJob.status === 403 && doraJob.json?.code === "EMAIL_NOT_VERIFIED", `${doraJob.status} ${doraJob.text}`);
  check("拒绝原因是用户能行动的中文提示", /验证邮箱/.test(doraJob.json?.error || ""), doraJob.json?.error);
  scanLeak("blocked job", doraJob.json);
  check("被拒绝的提交没有扣额度", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", dora.id).c) === 0);
  check("被拒绝的提交没有产生任务", Number(queryOne("SELECT COUNT(*) AS c FROM jobs WHERE user_id=?", dora.id).c) === 0);
  check("被拒绝的提交没有产生额度流水", Number(queryOne("SELECT COUNT(*) AS c FROM quota_ledger WHERE user_id=?", dora.id).c) === 0);
  const doraBatch = await call("/api/jobs/batch", { method: "POST", cookie: dora.cookie, body: { kind: "video_generation", count: 2, input: { prompt: "batch" }, clientRequestId: `acct-batch-${Date.now()}` } });
  check("批量提交同样被拦住", doraBatch.status === 403 && doraBatch.json?.code === "EMAIL_NOT_VERIFIED", `${doraBatch.status} ${doraBatch.text}`);
  check("批量提交没有扣额度", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", dora.id).c) === 0);
  const doraToken = tokenFromMail(lastMail(plain, "dora@wanke.test"), "/verify-email");
  check("未验证账号的验证邮件已经发出", Boolean(doraToken));
  const doraVerify = await call("/api/auth/verify-email", { method: "POST", body: { token: doraToken } });
  check("验证链接可以正常完成验证", doraVerify.status === 200, `${doraVerify.status} ${doraVerify.text}`);
  const doraAfter = await call("/api/jobs", { method: "POST", cookie: dora.cookie, body: { kind: "video_generation", title: "allowed", input: { prompt: "a dog" }, clientRequestId: `acct-${Date.now()}-2` } });
  // No provider key is configured in the harness, so the creation itself may answer 400;
  // what matters here is that the mailbox gate no longer blocks it and it charged once.
  check("验证后不再被邮箱验证拦住", doraAfter.status !== 403 && doraAfter.json?.code !== "EMAIL_NOT_VERIFIED", `${doraAfter.status} ${doraAfter.text.slice(0, 160)}`);
  check("验证后的创作只扣一次额度", Number(queryOne("SELECT COUNT(*) AS c FROM task_charges WHERE user_id=?", dora.id).c) === 1);
  const doraMeAfter = await call("/api/auth/me", { cookie: dora.cookie });
  check("验证后受限提示消失", doraMeAfter.json?.account?.blocked === false, JSON.stringify(doraMeAfter.json?.account));
  const verifyPage = await call("/verify-email");
  check("验证页在没有链接时给出指引", verifyPage.status === 200 && /链接不完整/.test(verifyPage.text));
  const verifyPageBad = await call("/verify-email?token=" + "a".repeat(64));
  check("验证页带链接打开时先显示确认中，不预先声称成功", verifyPageBad.status === 200 && /正在验证邮箱/.test(verifyPageBad.text) && !/验证成功/.test(verifyPageBad.text));
  check("无效链接由服务器拒绝", (await call("/api/auth/verify-email", { method: "POST", body: { token: "a".repeat(64) } })).status === 400);
  await configure({ require_email_verification: false });

  console.log("== 忘记密码：反枚举、一次性链接、重置后全部退出 ==");
  const veraLoginBefore = await login("vera@wanke.test", "account-pass-123");
  check("重置前可以正常登录", veraLoginBefore.status === 200, `${veraLoginBefore.status}`);
  plain.reset();
  const existingRequest = await call("/api/auth/password-reset", { method: "POST", body: { email: "vera@wanke.test" } });
  check("已注册邮箱请求重置被受理", existingRequest.status === 200 && existingRequest.json?.ok === true, `${existingRequest.status} ${existingRequest.text}`);
  const unknownRequest = await call("/api/auth/password-reset", { method: "POST", body: { email: "nobody@wanke.test" } });
  check("未注册邮箱得到完全相同的响应", unknownRequest.status === existingRequest.status && JSON.stringify(unknownRequest.json) === JSON.stringify(existingRequest.json), JSON.stringify(unknownRequest.json));
  check("响应文案不泄露账号是否存在", /如果这个邮箱已经注册/.test(existingRequest.json?.notice || ""), existingRequest.json?.notice);
  scanLeak("password-reset", existingRequest.json);
  check("未注册邮箱不会产生邮件", lastMail(plain, "nobody@wanke.test") === null);
  const malformed = await call("/api/auth/password-reset", { method: "POST", body: { email: "not-an-email" } });
  check("格式错误的邮箱也是同样的响应", malformed.status === 200 && JSON.stringify(malformed.json) === JSON.stringify(existingRequest.json));
  const veraResetMail = lastMail(plain, "vera@wanke.test");
  check("重置邮件真的发出去了", Boolean(veraResetMail), `messages=${plain.messages.length}`);
  check("重置邮件包含一次性链接", (veraResetMail?.text || "").includes(`${SITE_URL}/reset-password?token=`));
  check("重置链接有明确的有效期说明", /30 分钟/.test(veraResetMail?.text || ""), (veraResetMail?.text || "").slice(0, 160));
  const veraResetToken = tokenFromMail(veraResetMail, "/reset-password");
  check("重置流水记录为已发送", emailRow(vera.id, "password_reset")?.status === "sent");
  const crossPurpose = await call("/api/auth/verify-email", { method: "POST", body: { token: veraResetToken } });
  check("重置链接不能用于验证邮箱", crossPurpose.status === 400, `${crossPurpose.status}`);
  const crossPurpose2 = await call("/api/auth/password-reset/confirm", { method: "POST", body: { token: veraToken, password: "another-pass-123" } });
  check("验证链接不能用于重置密码", crossPurpose2.status === 400, `${crossPurpose2.status}`);
  const throttled = await call("/api/auth/password-reset", { method: "POST", body: { email: "vera@wanke.test" } });
  check("重复请求不会连续轰炸邮箱", throttled.status === 200 && lastMail(plain, "vera@wanke.test") === veraResetMail);
  rewindMailCooldown(vera.id, "password_reset");
  await call("/api/auth/password-reset", { method: "POST", body: { email: "vera@wanke.test" } });
  const veraResetToken2 = tokenFromMail(lastMail(plain, "vera@wanke.test"), "/reset-password");
  check("重新申请会生成新链接", Boolean(veraResetToken2) && veraResetToken2 !== veraResetToken);
  const staleReset = await call("/api/auth/password-reset/confirm", { method: "POST", body: { token: veraResetToken, password: "stale-pass-123" } });
  check("旧的重置链接立即失效", staleReset.status === 400, `${staleReset.status} ${staleReset.text}`);
  const weakReset = await call("/api/auth/password-reset/confirm", { method: "POST", body: { token: veraResetToken2, password: "short" } });
  check("弱密码被拒绝", weakReset.status === 400 && /8 位/.test(weakReset.text), `${weakReset.status} ${weakReset.text}`);
  check("弱密码没有消耗链接", Number(queryOne("SELECT COUNT(*) AS c FROM account_tokens WHERE user_id=? AND purpose='reset_password' AND consumed_at IS NULL", vera.id).c) === 1);
  const confirmed = await call("/api/auth/password-reset/confirm", { method: "POST", body: { token: veraResetToken2, password: "brand-new-pass-123" } });
  check("新密码设置成功", confirmed.status === 200 && confirmed.json?.ok === true, `${confirmed.status} ${confirmed.text}`);
  scanLeak("password-reset confirm", confirmed.json);
  check("重置后所有登录被退出", Number(confirmed.json?.revokedSessions) >= 1 && Number(queryOne("SELECT COUNT(*) AS c FROM sessions WHERE user_id=?", vera.id).c) === 0);
  check("重置前的会话已经失效", (await call("/api/auth/me", { cookie: veraLoginBefore.session })).json?.user === null);
  const oldPassword = await login("vera@wanke.test", "account-pass-123");
  check("旧密码不再可用", oldPassword.status === 401 && oldPassword.json?.code === "BAD_CREDENTIALS", `${oldPassword.status}`);
  const newPassword = await login("vera@wanke.test", "brand-new-pass-123");
  check("新密码可以登录", newPassword.status === 200, `${newPassword.status} ${newPassword.text}`);
  const reused = await call("/api/auth/password-reset/confirm", { method: "POST", body: { token: veraResetToken2, password: "hijack-pass-123" } });
  check("重置链接不能重复使用", reused.status === 400 && reused.json?.code === "TOKEN_USED", `${reused.status} ${reused.text}`);
  check("重放没有再次修改密码", (await login("vera@wanke.test", "brand-new-pass-123")).status === 200 && (await login("vera@wanke.test", "hijack-pass-123")).status === 401);
  check("收到重置邮件即证明邮箱可控", Number(queryOne("SELECT email_verified FROM users WHERE id=?", vera.id).email_verified) === 1);
  const resetPage = await call("/reset-password");
  check("找回密码页默认是申请入口", resetPage.status === 200 && /找回密码/.test(resetPage.text) && /发送重置链接/.test(resetPage.text));
  const resetPageToken = await call("/reset-password?token=abc");
  check("带链接打开时直接进入设置新密码", /设置新密码/.test(resetPageToken.text) && /保存新密码/.test(resetPageToken.text));

  console.log("== 修改密码、登录管理与资料（§13） ==");
  const erin = await register("erin@wanke.test", "Erin");
  const wrongCurrent = await call("/api/account/password", { method: "POST", cookie: erin.cookie, body: { currentPassword: "wrong-pass-123", newPassword: "next-pass-123" } });
  check("修改密码必须确认当前密码", wrongCurrent.status === 403 && wrongCurrent.json?.code === "BAD_PASSWORD", `${wrongCurrent.status} ${wrongCurrent.text}`);
  const samePassword = await call("/api/account/password", { method: "POST", cookie: erin.cookie, body: { currentPassword: "account-pass-123", newPassword: "account-pass-123" } });
  check("新密码不能与当前密码相同", samePassword.status === 400, `${samePassword.status}`);
  const otherSession = await login("erin@wanke.test", "account-pass-123");
  check("同一账号可以有多个登录", otherSession.status === 200);
  const changed = await call("/api/account/password", { method: "POST", cookie: erin.cookie, body: { currentPassword: "account-pass-123", newPassword: "next-pass-123", logoutOthers: true } });
  check("修改密码成功", changed.status === 200, `${changed.status} ${changed.text}`);
  check("修改密码后退出了其他登录", Number(changed.json?.revokedSessions) >= 1, JSON.stringify(changed.json));
  check("被退出的登录立即失效", (await call("/api/auth/me", { cookie: otherSession.session })).json?.user === null);
  check("当前登录仍然有效", (await call("/api/auth/me", { cookie: erin.cookie })).json?.user?.email === "erin@wanke.test");
  check("新密码可以登录", (await login("erin@wanke.test", "next-pass-123")).status === 200);
  const sessionList = await call("/api/account/sessions", { cookie: erin.cookie });
  check("可以看到当前登录设备", Array.isArray(sessionList.json?.sessions) && sessionList.json.sessions.some(s => s.current === true), JSON.stringify(sessionList.json));
  check("登录状态使用业务文案", sessionList.json?.sessions?.every(s => /电脑|手机|平板/.test(s.device || "")), JSON.stringify(sessionList.json?.sessions));
  check("登录 IP 使用普通写法", sessionList.json?.sessions?.every(s => !/::ffff:/.test(s.ip || "")), JSON.stringify(sessionList.json?.sessions?.map(s => s.ip)));
  scanLeak("sessions", sessionList.json);
  const second = await login("erin@wanke.test", "next-pass-123");
  const revokedOthers = await call("/api/account/sessions", { method: "DELETE", cookie: erin.cookie, body: { scope: "others" } });
  check("可以退出其他登录", revokedOthers.status === 200 && Number(revokedOthers.json?.revoked) >= 1, JSON.stringify(revokedOthers.json));
  check("其他登录已经失效", (await call("/api/auth/me", { cookie: second.session })).json?.user === null);
  const revokedAll = await call("/api/account/sessions", { method: "DELETE", cookie: erin.cookie, body: { scope: "all" } });
  check("可以全部退出", revokedAll.status === 200 && (await call("/api/auth/me", { cookie: erin.cookie })).json?.user === null);
  const profileBefore = await login("erin@wanke.test", "next-pass-123");
  const erinCookie = profileBefore.session;
  const profilePatch = await call("/api/account/profile", { method: "PATCH", cookie: erinCookie, body: { name: "Erin 工作室", avatarUrl: "https://cdn.wanke.test/a.png" } });
  check("可以修改昵称与头像", profilePatch.status === 200 && profilePatch.json?.profile?.name === "Erin 工作室", JSON.stringify(profilePatch.json?.profile));
  const profileRead = await call("/api/account/profile", { cookie: erinCookie });
  check("资料页返回邮箱验证状态", typeof profileRead.json?.profile?.emailVerified === "boolean");
  check("账号状态使用业务文案", profileRead.json?.profile?.statusText === "正常", profileRead.json?.profile?.statusText);
  check("资料页不返回内部字段", !JSON.stringify(profileRead.json).includes("password_hash") && !("status" in (profileRead.json?.profile || {})), JSON.stringify(profileRead.json?.profile).slice(0, 200));
  scanLeak("profile", profileRead.json);
  const preferencePatch = await call("/api/account/preferences", { method: "PATCH", cookie: erinCookie, body: { notifications: { email: true, job: false }, creation: { aspectRatio: "9:16" } } });
  check("通知偏好可以保存", preferencePatch.status === 200 && preferencePatch.json?.preferences?.notifications?.email === true && preferencePatch.json?.preferences?.notifications?.job === false, JSON.stringify(preferencePatch.json?.preferences));
  check("创作偏好可以保存", preferencePatch.json?.preferences?.creation?.aspectRatio === "9:16");
  check("偏好接口不返回平台内部配置", !/modelstudio|yike|access_key|api_key/i.test(JSON.stringify(preferencePatch.json)));
  const settingsPanel = await call("/account", { cookie: erinCookie });
  check("会员中心可以访问", settingsPanel.status === 200, `${settingsPanel.status}`);

  console.log("== 账号状态：正常 / 暂停使用 / 已注销（§13） ==");
  const finn = await register("finn@wanke.test", "Finn");
  const disabled = await call(`/api/admin/users/${finn.id}`, { method: "PATCH", cookie: admin.cookie, body: { status: "disabled" } });
  check("运营可以暂停账号", disabled.status === 200, `${disabled.status} ${disabled.text}`);
  check("暂停后现有登录立即失效", (await call("/api/auth/me", { cookie: finn.cookie })).json?.user === null);
  const disabledLogin = await login("finn@wanke.test", "account-pass-123");
  check("暂停后不能登录", disabledLogin.status === 403 && disabledLogin.json?.code === "USER_DISABLED", `${disabledLogin.status} ${disabledLogin.text}`);
  check("暂停提示是业务语言", /暂停使用/.test(disabledLogin.json?.error || "") && !/disabled/.test(disabledLogin.json?.error || ""), disabledLogin.json?.error);
  scanLeak("disabled login", disabledLogin.json);
  await call(`/api/admin/users/${finn.id}`, { method: "PATCH", cookie: admin.cookie, body: { status: "active" } });
  check("恢复后可以登录", (await login("finn@wanke.test", "account-pass-123")).status === 200);
  const finnLogin = await login("finn@wanke.test", "account-pass-123");
  const closed = await call("/api/account/close", { method: "POST", cookie: finnLogin.session, body: { password: "account-pass-123", confirm: true } });
  check("用户可以注销账号", closed.status === 200, `${closed.status} ${closed.text}`);
  check("注销后状态是已注销", queryOne("SELECT status, closed_at FROM users WHERE id=?", finn.id)?.status === "closed" && Boolean(queryOne("SELECT closed_at FROM users WHERE id=?", finn.id).closed_at));
  const closedLogin = await login("finn@wanke.test", "account-pass-123");
  check("注销后不能登录", closedLogin.status === 403 && closedLogin.json?.code === "USER_CLOSED", `${closedLogin.status}`);
  check("注销提示是业务语言", /注销/.test(closedLogin.json?.error || "") && !/closed/.test(closedLogin.json?.error || ""), closedLogin.json?.error);
  plain.reset();
  const closedReset = await call("/api/auth/password-reset", { method: "POST", body: { email: "finn@wanke.test" } });
  check("注销账号的重置请求得到同样的通用响应", closedReset.status === 200 && closedReset.json?.ok === true);
  check("注销账号不会收到重置邮件", lastMail(plain, "finn@wanke.test") === null, `messages=${plain.messages.length}`);

  console.log("== 管理员只有一种角色，系统永远保留一个可登录的管理员（§42 / 收敛修订 §8.2） ==");
  const hana = await register("hana@wanke.test", "Hana");
  let thirdRoleRejected = false;
  try { execute("UPDATE users SET role='operator' WHERE id=?", hana.id); } catch { thirdRoleRejected = true; }
  check("数据库只承认「普通用户」与「管理员」两种身份", thirdRoleRejected && queryOne("SELECT role FROM users WHERE id=?", hana.id)?.role === "user");
  const adminCountBefore = await call("/api/admin/stats", { cookie: admin.cookie });
  check("后台可以看到管理员数量", adminCountBefore.json?.stats?.users?.admins === 1, JSON.stringify(adminCountBefore.json?.stats?.users));

  const adminClose = await call("/api/account/close", { method: "POST", cookie: admin.cookie, body: { password: "admin-pass-123", confirm: true } });
  check("管理员不能在会员中心注销自己", adminClose.status === 409 && adminClose.json?.code === "ADMIN_ACCOUNT", `${adminClose.status} ${adminClose.text}`);
  check("拒绝理由说明由另一位管理员在后台处理", /另一位管理员/.test(adminClose.json?.error || ""), adminClose.json?.error);
  scanLeak("admin self cancellation", adminClose.json);
  check("管理员账号没有被注销", queryOne("SELECT status FROM users WHERE id=?", admin.id)?.status === "active");
  check("管理员仍然可以进入后台", (await call("/api/admin/stats", { cookie: admin.cookie })).status === 200);

  const selfDisable = await call(`/api/admin/users/${admin.id}`, { method: "PATCH", cookie: admin.cookie, body: { status: "disabled", note: "自助停用测试" } });
  check("管理员不能在后台停用自己", selfDisable.status === 400 && selfDisable.json?.code === "SELF_DISABLE", `${selfDisable.status} ${selfDisable.text}`);
  const selfClose = await call(`/api/admin/users/${admin.id}`, { method: "PATCH", cookie: admin.cookie, body: { status: "closed", note: "自助注销测试" } });
  check("管理员也不能在后台注销自己", selfClose.status === 400 && selfClose.json?.code === "SELF_DISABLE", `${selfClose.status} ${selfClose.text}`);
  check("两次自助操作之后管理员依然可用", queryOne("SELECT status FROM users WHERE id=?", admin.id)?.status === "active");

  // Revoking *another* operator must stay possible, or a departed administrator could never
  // be removed. Suspending one of two administrators still leaves one who can sign in.
  const ivy = await register("ivy@wanke.test", "Ivy");
  execute("UPDATE users SET role='admin', updated_at=? WHERE id=?", new Date().toISOString(), ivy.id);
  const ivyLogin = await login("ivy@wanke.test", "account-pass-123");
  check("第二位管理员可以进入后台", (await call("/api/admin/stats", { cookie: ivyLogin.session })).status === 200);
  check("后台管理员数量随之变化", (await call("/api/admin/stats", { cookie: admin.cookie })).json?.stats?.users?.admins === 2);
  const suspendIvy = await call(`/api/admin/users/${ivy.id}`, { method: "PATCH", cookie: admin.cookie, body: { status: "disabled", note: "离职交接测试" } });
  check("可以停用另一位管理员", suspendIvy.status === 200, `${suspendIvy.status} ${suspendIvy.text}`);
  check("被停用的管理员立即失去后台访问", (await call("/api/admin/stats", { cookie: ivyLogin.session })).status === 401);
  check("停用管理员写入操作记录", query("SELECT action FROM admin_audit_logs WHERE target_id=? ORDER BY created_at DESC LIMIT 1", ivy.id)[0]?.action === "user.disable");
  const restoreIvy = await call(`/api/admin/users/${ivy.id}`, { method: "PATCH", cookie: admin.cookie, body: { status: "active" } });
  // Suspension revoked Ivy's sessions, so the restored account signs in again from scratch.
  const ivyBack = await login("ivy@wanke.test", "account-pass-123");
  check("管理员可以恢复另一位管理员", restoreIvy.status === 200 && ivyBack.status === 200, `${restoreIvy.status} / ${ivyBack.status}`);
  execute("UPDATE users SET role='user', updated_at=? WHERE id=?", new Date().toISOString(), ivy.id);
  check("收回管理员身份后该账号立刻回到普通用户", queryOne("SELECT role FROM users WHERE id=?", ivy.id)?.role === "user"
    && (await call("/api/admin/stats", { cookie: ivyBack.session })).status === 403);
  check("收回身份不影响普通功能", (await call("/api/auth/me", { cookie: ivyBack.session })).json?.user?.role === "user");

  console.log("== 邮件服务未开启：留档而不是假装发送 ==");
  await configure({ email_enabled: false });
  const gina = await register("gina@wanke.test", "Gina");
  rewindMailCooldown(gina.id, "verify_email");
  check("邮件未开启时注册仍然成功", Boolean(gina.id));
  check("注册响应诚实说明邮件没有送达", gina.body.emailVerification?.delivered === false, JSON.stringify(gina.body.emailVerification));
  const ginaSend = await call("/api/account/verify-email", { method: "POST", cookie: gina.cookie });
  check("不能谎报验证邮件已发送", ginaSend.status === 503 && ginaSend.json?.code === "EMAIL_UNAVAILABLE" && ginaSend.json?.delivered === false, `${ginaSend.status} ${ginaSend.text}`);
  check("提示引导用户联系客服", /客服/.test(ginaSend.json?.error || ""), ginaSend.json?.error);
  scanLeak("email unavailable", ginaSend.json);
  const ginaRow = emailRow(gina.id, "verify_email");
  check("未送达的邮件在流水里是留档状态", ginaRow?.status === "outbox" && ginaRow?.transport === "outbox", JSON.stringify(ginaRow));
  const outboxFiles = fs.existsSync(OUTBOX_DIR) ? fs.readdirSync(OUTBOX_DIR).filter(name => name.endsWith(".eml")) : [];
  check("留档邮件写入了本地邮件目录", outboxFiles.length > 0, OUTBOX_DIR);
  const outboxContent = outboxFiles.length ? fs.readFileSync(path.join(OUTBOX_DIR, outboxFiles[outboxFiles.length - 1]), "utf8") : "";
  const outboxMail = parseMessage(outboxContent);
  check("留档邮件保留了收件人", outboxMail.headers.to === "gina@wanke.test", outboxMail.headers.to);
  check("留档邮件保留了可用的验证链接", /\/verify-email\?token=[a-f0-9]{64}/.test(outboxMail.text), outboxMail.text.slice(0, 120));
  check("留档邮件标注了未送达状态", outboxMail.headers["x-wanke-delivery"] === "outbox", outboxMail.headers["x-wanke-delivery"]);
  check("留档原因记录在邮件流水里", /邮件服务未开启/.test(ginaRow?.error || ""), ginaRow?.error);

  console.log("== 邮件发送失败：不谎报成功，运营能看到异常 ==");
  await useSmtp(refusing.port);
  const henry = await register("henry@wanke.test", "Henry");
  rewindMailCooldown(henry.id, "verify_email");
  const refusedSend = await call("/api/account/verify-email", { method: "POST", cookie: henry.cookie });
  check("收件人被拒绝时不谎报成功", refusedSend.status === 502 && refusedSend.json?.code === "EMAIL_SEND_FAILED", `${refusedSend.status} ${refusedSend.text}`);
  check("失败提示是可行动的中文", /稍后重试|客服/.test(refusedSend.json?.error || ""), refusedSend.json?.error);
  check("失败原因不泄露给会员", !TECHNICAL_PATTERN.test(JSON.stringify(refusedSend.json)), JSON.stringify(refusedSend.json));
  check("失败记录留在邮件流水里", emailRow(henry.id, "verify_email")?.status === "failed");
  check("技术原因只对运营可见", /收件人|550/.test(emailRow(henry.id, "verify_email")?.error || ""), emailRow(henry.id, "verify_email")?.error);
  await useSmtp(plain.port);
  await configure({ email_password: "wrong-password" });
  const iris = await register("iris@wanke.test", "Iris");
  rewindMailCooldown(iris.id, "verify_email");
  const authFailure = await call("/api/account/verify-email", { method: "POST", cookie: iris.cookie });
  check("邮件账号密码错误时不谎报成功", authFailure.status === 502 && authFailure.json?.code === "EMAIL_SEND_FAILED", `${authFailure.status} ${authFailure.text}`);
  check("登录失败原因记录在流水里", /登录/.test(emailRow(iris.id, "verify_email")?.error || ""), emailRow(iris.id, "verify_email")?.error);
  check("邮件服务器拒绝了错误凭据", plain.state.authAttempts.some(attempt => attempt.ok === false));
  await useSmtp(1);
  const jake = await register("jake@wanke.test", "Jake");
  rewindMailCooldown(jake.id, "verify_email");
  const unreachable = await call("/api/account/verify-email", { method: "POST", cookie: jake.cookie });
  check("邮件服务器不可达时不谎报成功", unreachable.status === 502 && unreachable.json?.code === "EMAIL_SEND_FAILED", `${unreachable.status} ${unreachable.text}`);
  check("不可达的技术细节没有回给会员", !/ECONNREFUSED|EACCES|connect/.test(JSON.stringify(unreachable.json)), JSON.stringify(unreachable.json));
  const statsAfterFailure = await call("/api/admin/stats", { cookie: admin.cookie });
  check("后台异常视图统计邮件失败", Number(statsAfterFailure.json?.stats?.email?.failed24h) >= 3, JSON.stringify(statsAfterFailure.json?.stats?.email));
  check("后台异常视图记录最后一次失败原因", Boolean(statsAfterFailure.json?.stats?.email?.lastFailure?.error), JSON.stringify(statsAfterFailure.json?.stats?.email?.lastFailure));
  check("后台异常视图统计未验证邮箱账号", Number(statsAfterFailure.json?.stats?.users?.unverifiedEmails) >= 3, JSON.stringify(statsAfterFailure.json?.stats?.users));
  check("会员看不到运营异常数据", (await call("/api/admin/stats", { cookie: member.cookie })).status === 403);
  check("会员看不到邮件流水里的技术原因", !TECHNICAL_PATTERN.test(JSON.stringify((await call("/api/account/profile", { cookie: member.cookie })).json)));

  console.log("== 加密连接与登录方式（SSL / STARTTLS / AUTH LOGIN） ==");
  await useSmtp(plain.port);
  if (implicitTls && startTls) {
    await configure({ email_host: "localhost", email_port: implicitTls.port, email_secure: true, email_password: SMTP_PASSWORD });
    const kim = await register("kim@wanke.test", "Kim");
    rewindMailCooldown(kim.id, "verify_email");
    const tlsSend = await call("/api/account/verify-email", { method: "POST", cookie: kim.cookie });
    check("SSL 直连（465 风格）可以发送", tlsSend.status === 200 && tlsSend.json?.delivered === true, `${tlsSend.status} ${tlsSend.text}`);
    check("SSL 会话确实是加密的", lastMail(implicitTls, "kim@wanke.test")?.secured === true);
    await configure({ email_host: "localhost", email_port: startTls.port, email_secure: false });
    const leo = await register("leo@wanke.test", "Leo");
    rewindMailCooldown(leo.id, "verify_email");
    const starttlsSend = await call("/api/account/verify-email", { method: "POST", cookie: leo.cookie });
    check("STARTTLS（587 风格）可以发送", starttlsSend.status === 200 && starttlsSend.json?.delivered === true, `${starttlsSend.status} ${starttlsSend.text}`);
    check("连接真的升级成了加密通道", startTls.state.tlsUpgrades >= 1, `upgrades=${startTls.state.tlsUpgrades}`);
    check("升级后的会话投递成功", lastMail(startTls, "leo@wanke.test")?.secured === true);
    await configure({ email_host: "127.0.0.1", email_port: loginOnly.port, email_secure: false });
    const mia = await register("mia@wanke.test", "Mia");
    rewindMailCooldown(mia.id, "verify_email");
    const loginSend = await call("/api/account/verify-email", { method: "POST", cookie: mia.cookie });
    check("AUTH LOGIN 方式可以发送", loginSend.status === 200 && loginSend.json?.delivered === true, `${loginSend.status} ${loginSend.text}`);
    check("使用了服务器公布的登录方式", loginOnly.state.authAttempts.some(attempt => attempt.mechanism === "LOGIN" && attempt.ok));
    check("PLAIN 方式同样可用", plain.state.authAttempts.some(attempt => attempt.mechanism === "PLAIN" && attempt.ok));
    await useSmtp(plain.port);
  } else {
    skip("SSL / STARTTLS / AUTH LOGIN 投递", "缺少本地测试证书（需要 openssl），未执行");
  }

  console.log("== 邮件超时必须失败而不是挂住请求 ==");
  await configure({ email_host: "127.0.0.1", email_port: stalling.port, email_secure: false, email_password: SMTP_PASSWORD });
  const noel = await register("noel@wanke.test", "Noel");
  rewindMailCooldown(noel.id, "verify_email");
  const stalledStart = Date.now();
  const stalled = await call("/api/account/verify-email", { method: "POST", cookie: noel.cookie });
  const stalledMs = Date.now() - stalledStart;
  check("服务器不响应时请求会结束", stalled.status === 502 && stalled.json?.code === "EMAIL_SEND_FAILED", `${stalled.status} ${stalled.text}`);
  check("超时时间有上限（未超过 40 秒）", stalledMs < 40_000, `${stalledMs}ms`);
  check("超时记录为失败", emailRow(noel.id, "verify_email")?.status === "failed");
  await useSmtp(plain.port);

  console.log("== 邮件模板可在后台配置（§13） ==");
  await configure({ email_verify_body: "{name} 你好，欢迎使用 {site}。请在 {minutes} 分钟内完成验证：{link} 有问题联系 {contact}。" });
  const olga = await register("olga@wanke.test", "Olga");
  const olgaMail = lastMail(plain, "olga@wanke.test");
  check("自定义模板生效", (olgaMail?.text || "").includes("欢迎使用 Wanke"), (olgaMail?.text || "").slice(0, 160));
  check("模板占位符被真实值替换", (olgaMail?.text || "").includes("Olga") && (olgaMail?.text || "").includes("/verify-email?token=") && (olgaMail?.text || "").includes("1440 分钟"));
  check("模板没有留下占位符", !/\{[a-z]+\}/.test(olgaMail?.text || ""));
  await configure({ email_verify_body: "", email_reset_body: "" });
  const pete = await register("pete@wanke.test", "Pete");
  check("清空模板后回到内置模板", /请在 \d+ 分钟内点击下面的链接完成邮箱验证/.test(lastMail(plain, "pete@wanke.test")?.text || ""), (lastMail(plain, "pete@wanke.test")?.text || "").slice(0, 160));

  console.log("== 注册开关与协议入口（§13 / §41） ==");
  await configure({ registration_enabled: false });
  const blockedRegister = await call("/api/auth/register", { method: "POST", body: { email: "blocked@wanke.test", name: "Blocked", password: "blocked-pass-123", termsAccepted: true } });
  check("关闭注册后不能注册", blockedRegister.status === 403 && blockedRegister.json?.code === "REGISTRATION_CLOSED", `${blockedRegister.status} ${blockedRegister.text}`);
  check("关闭注册的提示是业务语言", /没有开放注册/.test(blockedRegister.json?.error || ""), blockedRegister.json?.error);
  check("关闭注册没有创建账号", (await login("blocked@wanke.test", "blocked-pass-123")).status === 401);
  const registerPageClosed = await call("/register");
  check("注册页说明当前没有开放注册", /没有开放注册/.test(registerPageClosed.text));
  await configure({ registration_enabled: true });
  const registerPage = await call("/register");
  check("注册页包含协议确认入口", /用户协议/.test(registerPage.text) && /隐私政策/.test(registerPage.text));
  check("协议入口是真实链接", registerPage.text.includes("/legal/terms") && registerPage.text.includes("/legal/privacy"));
  check("注册页免费额度文案来自商品目录", /每 30 天 10 个创作额度/.test(registerPage.text), registerPage.text.match(/注册即可获得[^<]{0,60}/)?.[0] || "");
  check("注册页没有写死的过期文案", !/每月 10 条/.test(registerPage.text));
  const loginPage = await call("/login");
  check("登录页提供忘记密码入口", loginPage.text.includes("/reset-password") && /忘记密码/.test(loginPage.text));
  const terms = await call("/legal/terms");
  check("用户协议页面可读", terms.status === 200 && /用户协议/.test(terms.text) && /退款/.test(terms.text) && /创作额度/.test(terms.text));
  const privacy = await call("/legal/privacy");
  check("隐私政策页面可读", privacy.status === 200 && /隐私政策/.test(privacy.text) && /注销账号/.test(privacy.text));
  const landing = await call("/");
  check("首页页脚链接到协议与政策", landing.text.includes("/legal/terms") && landing.text.includes("/legal/privacy"));
  check("首页页脚不再暴露供应商名称", !/万镜一刻|Yike|yike/i.test(landing.text));

  console.log("== 越权与配置泄露（§45） ==");
  const memberSettings = await call("/api/admin/system-settings", { method: "POST", cookie: member.cookie, body: { values: { email_enabled: true } } });
  check("会员不能修改系统设置", memberSettings.status === 403, `${memberSettings.status}`);
  const memberReadSettings = await call("/api/admin/system-settings", { cookie: member.cookie });
  check("会员不能读取系统设置", memberReadSettings.status === 403, `${memberReadSettings.status}`);
  const anonymousReset = await call("/api/account/verify-email", { method: "POST", body: {} });
  check("未登录不能触发发信", anonymousReset.status === 401);
  const settingsMask = await call("/api/admin/system-settings?scope=email", { cookie: admin.cookie });
  const passwordSetting = (settingsMask.json?.settings || []).find(item => item.key === "email_password");
  check("邮件密码只返回掩码", passwordSetting?.value === "" && Boolean(passwordSetting?.masked), JSON.stringify(passwordSetting));
  check("后台设置里不含明文密码", !JSON.stringify(settingsMask.json).includes(SMTP_PASSWORD));
  check("邮件配置项在后台可见", ["email_enabled", "email_host", "email_port", "email_secure", "email_from", "email_username", "email_verify_body"].every(key => (settingsMask.json?.settings || []).some(item => item.key === key)));
  const siteSetting = (await call("/api/admin/system-settings?scope=site", { cookie: admin.cookie })).json?.settings || [];
  check("网站访问地址可在后台配置", siteSetting.some(item => item.key === "site_url"));
  const audit = await call("/api/admin/audit-logs", { cookie: admin.cookie });
  check("设置变更写入管理员操作记录", (audit.json?.logs || []).some(log => log.action === "system_settings.update"), JSON.stringify((audit.json?.logs || []).slice(0, 3)));

  console.log("== 页面与入口没有死链 ==");
  const accountPage = await call("/account", { cookie: member.cookie });
  check("会员中心可以打开", accountPage.status === 200, `${accountPage.status}`);
  const memberProfile = await call("/api/account/profile", { cookie: member.cookie });
  check("设置页拿到了验证邮箱所需的状态", typeof memberProfile.json?.profile?.emailVerified === "boolean" && memberProfile.json?.site?.requireEmailVerification === false, JSON.stringify(memberProfile.json?.site));
  const studioPage = await call("/studio", { cookie: member.cookie });
  check("工作台可以访问", studioPage.status === 200, `${studioPage.status}`);
} finally {
  for (const name of Object.keys(mocks)) await mocks[name].close();
}

console.log("");
if (leakHits.length) {
  failures += leakHits.length;
  for (const hit of leakHits) console.log(`  LEAK ${hit}`);
}
if (failures === 0) {
  console.log(`ALL ACCOUNT CHECKS PASSED (${checks} 项${skips ? `，跳过 ${skips} 项` : ""})`);
  process.exit(0);
}
console.log(`${failures} ACCOUNT CHECK(S) FAILED (${checks} 项${skips ? `，跳过 ${skips} 项` : ""})`);
process.exit(1);
