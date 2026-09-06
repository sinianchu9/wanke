import "server-only";
import { db } from "@/lib/db";
import { applySecretInput, describeSecret, readSecret } from "@/lib/secrets";

/**
 * Operator-facing system settings (site, payment, creation service, storage, mail,
 * notifications, security). Non-sensitive values live in the `settings` KV table;
 * credentials live encrypted in `secrets` and are only ever returned masked.
 *
 * Values fall back to environment variables and then to safe defaults, so a fresh
 * deployment works before an operator opens the backoffice.
 */

export type SettingScope = "site" | "payment" | "storage" | "email" | "security" | "worker";

interface SettingDefinition {
  key: string;
  scope: SettingScope;
  label: string;
  help: string;
  technicalKey?: string;
  type: "text" | "number" | "boolean" | "url" | "select";
  options?: Array<{ value: string; label: string }>;
  default?: string;
  env?: string;
  secret?: boolean;
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  { key: "site_name", scope: "site", label: "网站名称", help: "显示在页面标题、邮件和通知中。", type: "text", default: "Wanke", env: "WANKE_SITE_NAME" },
  { key: "site_logo_url", scope: "site", label: "网站 Logo 地址", help: "建议使用正方形图片，留空则显示文字标识。", type: "url", default: "", env: "WANKE_SITE_LOGO_URL" },
  { key: "contact_email", scope: "site", label: "客服邮箱", help: "用户遇到问题时看到的联系方式。", type: "text", default: "", env: "WANKE_CONTACT_EMAIL" },
  { key: "registration_enabled", scope: "site", label: "开放注册", help: "关闭后新用户无法注册，已登录用户不受影响。", type: "boolean", default: "true" },
  { key: "order_ttl_minutes", scope: "payment", label: "订单有效时间（分钟）", help: "超过这个时间未支付的订单会自动关闭。", technicalKey: "order_ttl_minutes", type: "number", default: "30" },
  { key: "alipay_enabled", scope: "payment", label: "启用支付宝收款", help: "关闭后用户无法下单支付，已支付订单不受影响。", type: "boolean", default: "false" },
  { key: "alipay_env", scope: "payment", label: "支付宝环境", help: "正式环境用于真实收款，测试环境用于联调。", type: "select", options: [{ value: "production", label: "正式环境" }, { value: "sandbox", label: "测试环境" }], default: "sandbox" },
  { key: "alipay_app_id", scope: "payment", label: "应用编号", help: "支付宝开放平台应用的 APPID。", technicalKey: "app_id", type: "text", default: "", env: "ALIPAY_APP_ID" },
  { key: "alipay_gateway_url", scope: "payment", label: "支付网关地址", help: "留空时按环境自动选择官方网关。", technicalKey: "gateway", type: "url", default: "", env: "ALIPAY_GATEWAY_URL" },
  { key: "alipay_notify_url", scope: "payment", label: "支付结果通知地址", help: "支付宝付款完成后，会通过这个地址把结果通知给 Wanke。必须是公网可访问的 HTTPS 地址。", technicalKey: "notify_url", type: "url", default: "", env: "ALIPAY_NOTIFY_URL" },
  { key: "alipay_return_url", scope: "payment", label: "支付完成返回地址", help: "用户付款完成后浏览器跳回的页面。", technicalKey: "return_url", type: "url", default: "", env: "ALIPAY_RETURN_URL" },
  { key: "alipay_seller_id", scope: "payment", label: "收款主体", help: "支付宝商家账号的 2088 开头的商户编号。到账通知会核对这个编号，防止资金进错账户。", technicalKey: "seller_id", type: "text", default: "", env: "ALIPAY_SELLER_ID" },
  { key: "alipay_private_key", scope: "payment", label: "应用私钥", help: "用于对请求签名，只保存在服务器，不会返回浏览器。", secret: true, type: "text", env: "ALIPAY_PRIVATE_KEY" },
  { key: "alipay_public_key", scope: "payment", label: "支付宝公钥", help: "用于校验支付宝发来的结果通知，防止伪造通知。", secret: true, type: "text", env: "ALIPAY_PUBLIC_KEY" },
  { key: "storage_driver", scope: "storage", label: "作品存储方式", help: "本地存储适合开发与单机部署，对象存储适合正式运营。", type: "select", options: [{ value: "local", label: "本地存储" }, { value: "oss", label: "对象存储（OSS）" }], default: "local", env: "WANKE_STORAGE_DRIVER" },
  { key: "oss_region", scope: "storage", label: "对象存储区域", help: "例如 oss-cn-hangzhou。", technicalKey: "region", type: "text", default: "", env: "WANKE_OSS_REGION" },
  { key: "oss_bucket", scope: "storage", label: "对象存储空间名称", help: "存放作品与素材的空间。", technicalKey: "bucket", type: "text", default: "", env: "WANKE_OSS_BUCKET" },
  { key: "oss_endpoint", scope: "storage", label: "对象存储访问地址", help: "留空时按区域自动生成。", technicalKey: "endpoint", type: "url", default: "", env: "WANKE_OSS_ENDPOINT" },
  { key: "oss_access_key_id", scope: "storage", label: "对象存储访问账号", help: "建议使用只授权该空间的子账号。", secret: true, type: "text", env: "WANKE_OSS_ACCESS_KEY_ID" },
  { key: "oss_access_key_secret", scope: "storage", label: "对象存储访问密钥", help: "只保存在服务器，不会返回浏览器。", secret: true, type: "text", env: "WANKE_OSS_ACCESS_KEY_SECRET" },
  { key: "email_enabled", scope: "email", label: "启用邮件通知", help: "用于验证邮箱、找回密码和重要业务通知。", type: "boolean", default: "false" },
  { key: "email_host", scope: "email", label: "邮件服务器地址", help: "例如 smtp.example.com。", technicalKey: "smtp_host", type: "text", default: "", env: "WANKE_EMAIL_HOST" },
  { key: "email_port", scope: "email", label: "邮件服务器端口", help: "常见为 465（SSL）或 587（STARTTLS）。", technicalKey: "smtp_port", type: "number", default: "465", env: "WANKE_EMAIL_PORT" },
  { key: "email_secure", scope: "email", label: "使用 SSL 连接", help: "端口 465 通常需要开启，587 通常关闭。", technicalKey: "smtp_secure", type: "boolean", default: "true", env: "WANKE_EMAIL_SECURE" },
  { key: "email_from", scope: "email", label: "发件人地址", help: "用户收到邮件时看到的发件人。", technicalKey: "from", type: "text", default: "", env: "WANKE_EMAIL_FROM" },
  { key: "email_username", scope: "email", label: "邮件登录账号", help: "留空表示不使用账号密码登录。", technicalKey: "user", type: "text", default: "", env: "WANKE_EMAIL_USERNAME" },
  { key: "email_password", scope: "email", label: "邮件登录密码", help: "只保存在服务器，不会返回浏览器。", secret: true, type: "text", env: "WANKE_EMAIL_PASSWORD" },
  { key: "require_email_verification", scope: "security", label: "注册后必须验证邮箱", help: "开启后未验证邮箱的账号不能创作，但可以登录补验证。", type: "boolean", default: "false" },
  { key: "worker_enabled", scope: "worker", label: "启用后台任务调度", help: "关闭后创作任务只能由用户手动刷新推进，正式运营必须开启。", type: "boolean", default: "true" },
  { key: "worker_interval_seconds", scope: "worker", label: "后台调度间隔（秒）", help: "建议 20 到 60 秒。", type: "number", default: "30" },
];

function nowIso() {
  return new Date().toISOString();
}

function storedValue(key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value?: string } | undefined;
  return row?.value?.trim() || "";
}

export function getSetting(key: string): string {
  const definition = SETTING_DEFINITIONS.find(item => item.key === key);
  if (definition?.secret) {
    const fromDb = (() => { try { return readSecret(key); } catch { return ""; } })();
    if (fromDb) return fromDb;
    return definition.env ? (process.env[definition.env]?.trim() || "") : "";
  }
  const fromDb = storedValue(key);
  if (fromDb) return fromDb;
  if (definition?.env) {
    const fromEnv = process.env[definition.env]?.trim();
    if (fromEnv) return fromEnv;
  }
  return definition?.default ?? "";
}

export function getBooleanSetting(key: string): boolean {
  const value = getSetting(key).toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

export function getNumberSetting(key: string, fallback: number): number {
  const parsed = Number(getSetting(key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function setSetting(key: string, value: string): void {
  const definition = SETTING_DEFINITIONS.find(item => item.key === key);
  const clean = String(value ?? "").trim();
  if (definition?.secret) {
    applySecretInput(key, { value: clean });
    return;
  }
  if (!clean) {
    db.prepare("DELETE FROM settings WHERE key=?").run(key);
    return;
  }
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, clean, nowIso());
}

export function clearSetting(key: string): void {
  const definition = SETTING_DEFINITIONS.find(item => item.key === key);
  if (definition?.secret) {
    applySecretInput(key, { clear: true });
    return;
  }
  db.prepare("DELETE FROM settings WHERE key=?").run(key);
}

export interface SettingUpdate {
  values?: Record<string, string | number | boolean | null>;
  clear?: string[];
}

/** Apply an admin form submission. Blank secret fields keep the stored value. */
export function applySettingUpdate(update: SettingUpdate): string[] {
  const changed: string[] = [];
  for (const key of update.clear || []) {
    if (!SETTING_DEFINITIONS.some(item => item.key === key)) continue;
    clearSetting(key);
    changed.push(key);
  }
  for (const [key, value] of Object.entries(update.values || {})) {
    const definition = SETTING_DEFINITIONS.find(item => item.key === key);
    if (!definition) continue;
    if (definition.secret) {
      const next = value === null || value === undefined ? "" : String(value).trim();
      if (!next) continue;
      if (applySecretInput(key, { value: next })) changed.push(key);
      continue;
    }
    const next = value === null || value === undefined ? "" : String(value).trim();
    if (next === storedValue(key)) continue;
    setSetting(key, next);
    changed.push(key);
  }
  return changed;
}

/** Backoffice view: labels, help text and current values with secrets masked. */
export function describeSystemSettings(scope?: SettingScope) {
  return SETTING_DEFINITIONS
    .filter(definition => !scope || definition.scope === scope)
    .map(definition => {
      if (definition.secret) {
        const secret = describeSecret(definition.key);
        const fromEnv = definition.env ? Boolean(process.env[definition.env]?.trim()) : false;
        return {
          key: definition.key, scope: definition.scope, label: definition.label, help: definition.help,
          technicalKey: definition.technicalKey || definition.key, type: definition.type, options: definition.options || [],
          value: "", configured: secret.configured || fromEnv, masked: secret.masked,
          source: secret.configured ? "database" : fromEnv ? "environment" : "default",
        };
      }
      const value = getSetting(definition.key);
      const fromDb = storedValue(definition.key);
      const fromEnv = !fromDb && definition.env ? Boolean(process.env[definition.env]?.trim()) : false;
      return {
        key: definition.key, scope: definition.scope, label: definition.label, help: definition.help,
        technicalKey: definition.technicalKey || definition.key, type: definition.type, options: definition.options || [],
        value, configured: Boolean(value), masked: "",
        source: fromDb ? "database" : fromEnv ? "environment" : "default",
      };
    });
}

/** Values a member's browser may know: nothing about credentials or infrastructure. */
export function publicSiteSettings() {
  return {
    siteName: getSetting("site_name") || "Wanke",
    siteLogoUrl: getSetting("site_logo_url"),
    contactEmail: getSetting("contact_email"),
    registrationEnabled: getBooleanSetting("registration_enabled"),
    paymentEnabled: getBooleanSetting("alipay_enabled") && Boolean(getSetting("alipay_app_id")),
    emailEnabled: getBooleanSetting("email_enabled"),
    requireEmailVerification: getBooleanSetting("require_email_verification"),
  };
}
