import "server-only";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getBooleanSetting, getNumberSetting, getSetting } from "@/lib/system-settings";

/**
 * Outbound mail (verification, password reset, business notices).
 *
 * Written directly on `node:net` / `node:tls` so the project keeps zero extra runtime
 * dependencies. Three transports, all honest:
 *
 * - `smtp`   — configured and reachable; the message really left the server.
 * - `outbox` — mail is disabled or not configured; the message is written to
 *              `data/mail-outbox/*.eml` and journaled as `outbox`. Development only,
 *              and never reported to a member as "已发送".
 * - `failed` — SMTP was attempted and refused/timed out. The error is stored for the
 *              backoffice; the member-facing copy stays generic.
 *
 * Every attempt is journaled in `email_messages` first (`queued`) and then updated to
 * its final state, so "mail is broken" is visible in 后台 → 异常 instead of only in
 * server logs.
 */

export type EmailKind = "verify_email" | "password_reset" | "notification";

export type EmailTransport = "smtp" | "outbox";

export type EmailStatus = "queued" | "sent" | "outbox" | "failed";

export interface EmailInput {
  to: string;
  subject: string;
  text: string;
  kind: EmailKind;
  userId?: string | null;
  refId?: string | null;
}

export interface EmailResult {
  id: string;
  status: EmailStatus;
  transport: EmailTransport;
  /** True only when an SMTP server accepted the message for delivery. */
  delivered: boolean;
  /** Technical reason, for the backoffice and internal logs only. */
  error?: string;
  /** Outbox file path when the message was written to disk instead of sent. */
  file?: string;
}

export interface MailConfiguration {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  username: string;
  password: string;
  /** Everything needed for a real send is present. */
  ready: boolean;
  missing: string[];
}

const ADDRESS_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const CONNECT_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 20_000;

export function mailConfiguration(): MailConfiguration {
  const enabled = getBooleanSetting("email_enabled");
  const host = getSetting("email_host").trim();
  const port = getNumberSetting("email_port", 465) || 465;
  const secure = getBooleanSetting("email_secure");
  const from = getSetting("email_from").trim();
  const username = getSetting("email_username").trim();
  let password = "";
  try {
    password = getSetting("email_password").trim();
  } catch {
    // A password sealed with a lost master key must not be reported as "not configured".
    password = "";
  }
  const missing: string[] = [];
  if (!host) missing.push("邮件服务器地址");
  if (!from) missing.push("发件人地址");
  if (username && !password) missing.push("邮件登录密码");
  return { enabled, host, port, secure, from, username, password, ready: missing.length === 0, missing };
}

export function outboxDirectory() {
  return path.resolve(process.env.WANKE_MAIL_OUTBOX_DIR || "./data/mail-outbox");
}

/** `Wanke <no-reply@example.com>` -> `no-reply@example.com` */
export function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match ? match[1] : from).trim();
}

/**
 * One-time links must never be persisted outside the message itself: `account_tokens`
 * stores only a digest, so keeping the rendered body would hand a database reader the
 * ability to verify an email or reset a password. The transport still gets the real link.
 */
export function redactOneTimeLinks(text: string): string {
  return String(text || "").replace(/([?&]token=)[A-Za-z0-9_-]{16,}/gi, "$1<已隐去>");
}

function nowIso() {
  return new Date().toISOString();
}

function stampFileName(id: string) {
  return `${nowIso().replace(/[:.]/g, "-")}-${id}.eml`;
}

function encodeSubject(subject: string) {
  // RFC 2047 encoded-word: only needed for non-ASCII, and safer to always emit ASCII as-is.
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

/** RFC 2047-encode a display name so a non-ASCII sender never produces a raw 8-bit header. */
export function encodeAddressHeader(from: string) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!match) return from.trim();
  const display = match[1].trim();
  return display ? `${encodeSubject(display)} <${match[2].trim()}>` : match[2].trim();
}

function buildMessage(input: EmailInput, config: MailConfiguration, extraHeaders: Record<string, string> = {}) {
  const from = encodeAddressHeader(config.from || `Wanke <${envelopeAddress(input.to)}>`);
  const domain = envelopeAddress(from).split("@")[1] || "localhost";
  const headers: Array<[string, string]> = [
    ["From", from],
    ["To", input.to],
    ["Subject", encodeSubject(input.subject)],
    ["Date", new Date().toUTCString().replace("GMT", "+0000")],
    ["Message-ID", `<${randomUUID()}@${domain}>`],
    ["X-Wanke-Mail-Kind", input.kind],
    ...Object.entries(extraHeaders),
    ["MIME-Version", "1.0"],
    ["Content-Type", "text/plain; charset=utf-8"],
    ["Content-Transfer-Encoding", "base64"],
  ];
  const body = Buffer.from(input.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${headers.map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n${body}\r\n`;
}

// ---------- journal ----------

function insertJournal(input: EmailInput): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO email_messages (id, user_id, kind, to_address, subject, body_text, status, transport, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', 'outbox', ?)`)
    .run(id, input.userId || null, input.kind, input.to, input.subject, redactOneTimeLinks(input.text), nowIso());
  return id;
}

function finalizeJournal(id: string, patch: { status: EmailStatus; transport: EmailTransport; error?: string | null }) {
  db.prepare(`UPDATE email_messages SET status=?, transport=?, error=?, sent_at=? WHERE id=?`)
    .run(patch.status, patch.transport, patch.error ?? null, patch.status === "sent" || patch.status === "outbox" ? nowIso() : null, id);
}

/** When the last message of this kind went to this recipient (used for resend throttling). */
export function lastEmailAt(userId: string, kind: EmailKind): string | null {
  const row = db.prepare(`SELECT created_at FROM email_messages WHERE user_id=? AND kind=? AND status IN ('sent','outbox')
    ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(userId, kind) as { created_at?: string } | undefined;
  return row?.created_at || null;
}

export function secondsSinceLastEmail(userId: string, kind: EmailKind): number | null {
  const at = lastEmailAt(userId, kind);
  if (!at) return null;
  const then = new Date(at).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.round((Date.now() - then) / 1000));
}

export interface EmailJournalRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  kind: EmailKind;
  toAddress: string;
  subject: string;
  status: EmailStatus;
  transport: EmailTransport;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

export function listEmails(filter: { status?: EmailStatus; userId?: string; limit?: number } = {}): EmailJournalRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) { where.push("e.status = ?"); params.push(filter.status); }
  if (filter.userId) { where.push("e.user_id = ?"); params.push(filter.userId); }
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT e.*, u.email AS user_email FROM email_messages e
    LEFT JOIN users u ON u.id = e.user_id ${whereSql}
    ORDER BY e.created_at DESC, e.rowid DESC LIMIT ?`).all(...params, limit) as any[];
  return rows.map(row => ({
    id: row.id, userId: row.user_id || null, userEmail: row.user_email || null, kind: row.kind,
    toAddress: row.to_address, subject: row.subject, status: row.status, transport: row.transport,
    error: row.error || null, createdAt: row.created_at, sentAt: row.sent_at || null,
  }));
}

export function emailHealth(sinceIso: string) {
  const count = (sql: string, ...params: unknown[]) => Number((db.prepare(sql).get(...params) as any)?.c || 0);
  return {
    sent24h: count("SELECT COUNT(*) AS c FROM email_messages WHERE status='sent' AND created_at >= ?", sinceIso),
    failed24h: count("SELECT COUNT(*) AS c FROM email_messages WHERE status='failed' AND created_at >= ?", sinceIso),
    failedTotal: count("SELECT COUNT(*) AS c FROM email_messages WHERE status='failed'"),
    outboxTotal: count("SELECT COUNT(*) AS c FROM email_messages WHERE status='outbox'"),
    stuckQueued: count("SELECT COUNT(*) AS c FROM email_messages WHERE status='queued'"),
    lastFailure: (db.prepare(`SELECT error, to_address, created_at FROM email_messages WHERE status='failed'
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).get() as any) || null,
  };
}

// ---------- SMTP ----------

interface SmtpResponse {
  code: number;
  text: string;
  capabilities: string[];
}

class SmtpError extends Error {}

/** Line-oriented SMTP conversation over a plain or TLS socket. */
class SmtpSession {
  private buffer = "";
  private pending: Array<(response: SmtpResponse) => void> = [];
  private broken: Error | null = null;

  constructor(private socket: net.Socket | tls.TLSSocket) {
    socket.setEncoding("utf8");
    socket.on("data", chunk => this.onData(String(chunk)));
    socket.on("error", error => this.fail(error));
    socket.on("close", () => this.fail(new SmtpError("邮件服务器提前关闭了连接")));
    socket.on("timeout", () => this.fail(new SmtpError("邮件服务器响应超时")));
  }

  private fail(error: Error) {
    if (this.broken) return;
    this.broken = error;
    const waiters = this.pending.splice(0, this.pending.length);
    for (const waiter of waiters) waiter({ code: 0, text: error.message, capabilities: [] });
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    for (;;) {
      const complete = this.takeResponse();
      if (!complete) return;
      const waiter = this.pending.shift();
      if (waiter) waiter(complete);
    }
  }

  /** A response ends at the first `NNN ` line; `NNN-` lines continue it. */
  private takeResponse(): SmtpResponse | null {
    const lines: string[] = [];
    let cursor = 0;
    for (;;) {
      const end = this.buffer.indexOf("\r\n", cursor);
      if (end < 0) {
        const bare = this.buffer.indexOf("\n", cursor);
        if (bare < 0) return null;
        const line = this.buffer.slice(cursor, bare);
        cursor = bare + 1;
        lines.push(line);
        if (/^\d{3}( |$)/.test(line)) break;
        continue;
      }
      const line = this.buffer.slice(cursor, end);
      cursor = end + 2;
      lines.push(line);
      if (/^\d{3}( |$)/.test(line)) break;
    }
    this.buffer = this.buffer.slice(cursor);
    const code = Number(lines[0]?.slice(0, 3) || 0);
    const capabilities = lines.map(line => line.slice(4).trim()).filter(Boolean);
    return { code, text: lines.join("\n"), capabilities };
  }

  private read(timeoutMs = COMMAND_TIMEOUT_MS): Promise<SmtpResponse> {
    if (this.broken) return Promise.resolve({ code: 0, text: this.broken.message, capabilities: [] });
    return new Promise(resolve => {
      const timer = setTimeout(() => this.fail(new SmtpError("等待邮件服务器响应超时")), timeoutMs);
      this.pending.push(response => { clearTimeout(timer); resolve(response); });
    });
  }

  async command(line: string, expected: number[], options: { timeoutMs?: number; masked?: boolean; verb?: string } = {}): Promise<SmtpResponse> {
    if (this.broken) throw new SmtpError(this.broken.message);
    this.socket.write(`${line}\r\n`);
    return this.expect(expected, options);
  }

  /** Read one response and require it to carry one of these codes. */
  async expect(expected: number[], options: { timeoutMs?: number; masked?: boolean; verb?: string } = {}): Promise<SmtpResponse> {
    const response = await this.read(options.timeoutMs);
    if (response.code === 0) throw new SmtpError(response.text);
    if (!expected.includes(response.code)) {
      const verb = options.masked ? "登录" : options.verb || "本次请求";
      throw new SmtpError(`邮件服务器拒绝了${verb}：${response.text.slice(0, 200)}`);
    }
    return response;
  }

  async sendRaw(payload: string): Promise<void> {
    if (this.broken) throw new SmtpError(this.broken.message);
    this.socket.write(payload);
  }

  detach() {
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("error");
    this.socket.removeAllListeners("close");
    this.socket.removeAllListeners("timeout");
    this.socket.pause();
  }

  quit() {
    try { this.socket.write("QUIT\r\n"); } catch { /* best effort */ }
    try { this.socket.destroy(); } catch { /* best effort */ }
  }
}

function connectPlain(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once("connect", () => { socket.setTimeout(0); resolve(socket); });
    socket.once("timeout", () => { socket.destroy(); reject(new SmtpError("连接邮件服务器超时")); });
    socket.once("error", error => { socket.destroy(); reject(new SmtpError(`无法连接邮件服务器：${error.message}`)); });
  });
}

function connectTls(host: string, port: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    // SNI only accepts hostnames; an IP literal is matched against the certificate's IP SANs.
    const options: tls.ConnectionOptions = { host, port };
    if (!net.isIP(host)) options.servername = host;
    const socket = tls.connect(options);
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once("secureConnect", () => {
      socket.setTimeout(0);
      if (!socket.authorized) {
        const reason = socket.authorizationError?.message || String(socket.authorizationError || "");
        socket.destroy();
        return reject(new SmtpError(`邮件服务器证书校验失败：${reason}`));
      }
      resolve(socket);
    });
    socket.once("timeout", () => { socket.destroy(); reject(new SmtpError("连接邮件服务器超时")); });
    socket.once("error", error => { socket.destroy(); reject(new SmtpError(`无法安全连接邮件服务器：${error.message}`)); });
  });
}

function upgradeToTls(socket: net.Socket, host: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const options: tls.ConnectionOptions = { socket };
    if (!net.isIP(host)) options.servername = host;
    const secure = tls.connect(options, () => {
      if (!secure.authorized) {
        const reason = secure.authorizationError?.message || String(secure.authorizationError || "");
        secure.destroy();
        return reject(new SmtpError(`邮件服务器证书校验失败：${reason}`));
      }
      resolve(secure);
    });
    secure.setTimeout(CONNECT_TIMEOUT_MS);
    secure.once("timeout", () => { secure.destroy(); reject(new SmtpError("升级加密连接超时")); });
    secure.once("error", error => { secure.destroy(); reject(new SmtpError(`升级加密连接失败：${error.message}`)); });
  });
}

function ehloDomain(): string {
  const configured = getSetting("site_url").trim();
  try {
    if (configured) return new URL(configured).hostname;
  } catch { /* fall through */ }
  const from = envelopeAddress(getSetting("email_from").trim());
  return from.split("@")[1] || "localhost";
}

async function authenticate(session: SmtpSession, config: MailConfiguration, capabilities: string[]) {
  const advertised = capabilities
    .find(line => /^AUTH\b/i.test(line))
    ?.replace(/^AUTH/i, "")
    .split(/\s+/)
    .map(item => item.toUpperCase()) || [];
  const mechanisms = advertised.length ? advertised : ["LOGIN", "PLAIN"];

  if (mechanisms.includes("PLAIN")) {
    const credentials = Buffer.from(`${config.username}\u0000${config.username}\u0000${config.password}`, "utf8").toString("base64");
    await session.command(`AUTH PLAIN ${credentials}`, [235], { masked: true });
    return;
  }
  if (mechanisms.includes("LOGIN")) {
    await session.command("AUTH LOGIN", [334], { masked: true });
    await session.command(Buffer.from(config.username, "utf8").toString("base64"), [334], { masked: true });
    await session.command(Buffer.from(config.password, "utf8").toString("base64"), [235], { masked: true });
    return;
  }
  throw new SmtpError(`邮件服务器不支持可用的登录方式（${mechanisms.join("/")}）`);
}

async function smtpDeliver(config: MailConfiguration, message: string, envelopeTo: string): Promise<void> {
  let socket: net.Socket | tls.TLSSocket = config.secure
    ? await connectTls(config.host, config.port)
    : await connectPlain(config.host, config.port);
  let session = new SmtpSession(socket);
  try {
    await session.expect([220], { verb: "建立连接" });
    const greeting = await session.command(`EHLO ${ehloDomain()}`, [250]);
    if (!config.secure && greeting.capabilities.some(line => /^STARTTLS$/i.test(line))) {
      await session.command("STARTTLS", [220]);
      session.detach();
      socket = await upgradeToTls(socket as net.Socket, config.host);
      session = new SmtpSession(socket);
      const regreeting = await session.command(`EHLO ${ehloDomain()}`, [250]);
      if (config.username) await authenticate(session, config, regreeting.capabilities);
      await relay(session, config, message, envelopeTo);
      return;
    }
    if (config.username) await authenticate(session, config, greeting.capabilities);
    await relay(session, config, message, envelopeTo);
  } finally {
    session.quit();
  }
}

async function relay(session: SmtpSession, config: MailConfiguration, message: string, envelopeTo: string) {
  await session.command(`MAIL FROM:<${envelopeAddress(config.from)}>`, [250], { verb: "发件人" });
  await session.command(`RCPT TO:<${envelopeTo}>`, [250, 251], { verb: "收件人" });
  await session.command("DATA", [354]);
  // Dot-stuff any line that starts with a dot, then close the payload with a lone dot.
  const payload = message.replace(/^\./gm, "..");
  await session.sendRaw(`${payload.endsWith("\r\n") ? payload : `${payload}\r\n`}.\r\n`);
  await session.expect([250], { verb: "邮件内容" });
}

// ---------- public API ----------

function writeOutbox(id: string, message: string, reason: string): string {
  const dir = outboxDirectory();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, stampFileName(id));
  const header = `X-Wanke-Delivery: outbox\r\nX-Wanke-Reason: ${encodeSubject(reason)}\r\n`;
  fs.writeFileSync(file, `${header}${message}`, "utf8");
  return file;
}

/**
 * Send one message and journal the outcome. Never throws for transport problems: the
 * caller decides what a member is told, and a failed send is always recorded as failed.
 */
export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const to = input.to.trim().toLowerCase();
  const id = insertJournal({ ...input, to });
  const config = mailConfiguration();

  if (!ADDRESS_PATTERN.test(to)) {
    finalizeJournal(id, { status: "failed", transport: "outbox", error: "收件人地址格式不正确" });
    return { id, status: "failed", transport: "outbox", delivered: false, error: "收件人地址格式不正确" };
  }

  if (!config.enabled || !config.ready) {
    const reason = !config.enabled
      ? "邮件服务未开启（后台 → 系统设置 → 邮件）"
      : `邮件服务配置不完整：缺少 ${config.missing.join("、")}`;
    const message = buildMessage({ ...input, to }, { ...config, from: config.from || `Wanke <wanke@localhost>` }, { "X-Wanke-Status": encodeSubject(reason) });
    let file = "";
    try {
      file = writeOutbox(id, message, reason);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      finalizeJournal(id, { status: "failed", transport: "outbox", error: `留档失败：${detail}` });
      return { id, status: "failed", transport: "outbox", delivered: false, error: detail };
    }
    // The reason is kept on the row too, so the backoffice can tell "mail is off" from
    // "mail is broken" without opening the file.
    finalizeJournal(id, { status: "outbox", transport: "outbox", error: reason });
    return { id, status: "outbox", transport: "outbox", delivered: false, error: reason, file };
  }

  const message = buildMessage({ ...input, to }, config);
  try {
    await smtpDeliver(config, message, to);
    finalizeJournal(id, { status: "sent", transport: "smtp" });
    return { id, status: "sent", transport: "smtp", delivered: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    finalizeJournal(id, { status: "failed", transport: "smtp", error: detail });
    if (process.env.NODE_ENV !== "test") console.error(`[wanke] 邮件发送失败 kind=${input.kind} to=${to}: ${detail}`);
    return { id, status: "failed", transport: "smtp", delivered: false, error: detail };
  }
}

// ---------- templates ----------

export const DEFAULT_VERIFY_TEMPLATE = [
  "{name}，你好：",
  "",
  "请在 {minutes} 分钟内点击下面的链接完成邮箱验证：",
  "{link}",
  "",
  "如果这不是你本人的操作，忽略这封邮件即可，你的账号不会有任何变化。",
  "",
  "—— {site}",
].join("\n");

export const DEFAULT_RESET_TEMPLATE = [
  "{name}，你好：",
  "",
  "我们收到了重置 {site} 账号密码的请求。请在 {minutes} 分钟内点击下面的链接设置新密码：",
  "{link}",
  "",
  "链接只能使用一次，使用后其他未使用的链接会立即失效。",
  "如果这不是你本人的操作，请忽略这封邮件，并建议登录后修改一次密码。",
  "",
  "—— {site}",
].join("\n");

export type TemplateVariables = Record<string, string | number>;

export function renderEmailTemplate(template: string, variables: TemplateVariables): string {
  return (template || "").replace(/\{(\w+)\}/g, (match, key: string) =>
    variables[key] === undefined ? match : String(variables[key]));
}

export function siteName() {
  return getSetting("site_name") || "Wanke";
}

/**
 * Public base URL used inside emails. The configured 网站访问地址 wins; only when it is
 * missing do we fall back to the request's own origin (documented in OPERATIONS.md,
 * because a proxy-supplied host must not be able to rewrite password-reset links).
 */
export function publicBaseUrl(request?: Request): string {
  const configured = getSetting("site_url").trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch { /* fall through */ }
  }
  const fromEnv = process.env.WANKE_SITE_URL?.trim();
  if (fromEnv) {
    try { return new URL(fromEnv).origin; } catch { /* fall through */ }
  }
  if (request) {
    const proto = (request.headers.get("x-forwarded-proto") || "").split(",")[0]?.trim();
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    if (host) return `${proto === "https" ? "https" : "http"}://${host}`;
    try { return new URL(request.url).origin; } catch { /* fall through */ }
  }
  return "http://localhost:3000";
}
