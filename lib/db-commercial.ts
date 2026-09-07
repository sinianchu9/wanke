import type { Database } from "better-sqlite3";

/**
 * Commercial schema layer (plans, credits, orders, payments, refunds, services).
 *
 * Rules:
 * - Every statement is idempotent: repeated boots and concurrent Next workers are safe.
 * - Legacy databases upgrade in place; no data is dropped or reinterpreted silently.
 * - Money is stored in integer minor units (cents). Credits are integers.
 * - Idempotency keys are UNIQUE indexes, not application conventions.
 */
export function ensureCommercialSchema(db: Database) {
  // `next build` collects page data with several workers and a production server boots
  // several processes, so every connection reaches this migration at the same instant.
  // One IMMEDIATE write lock serialises them: the first connection does the work, the
  // others wait (busy_timeout) and then find every statement already satisfied.
  // `PRAGMA foreign_keys` is a no-op inside a transaction, so it is toggled out here;
  // the rebuilds below drop parent tables and must not cascade into child rows.
  db.pragma("foreign_keys = OFF");
  try {
    const migrate = db.transaction(() => migrateCommercialSchema(db));
    (migrate as any).immediate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function migrateCommercialSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'membership' CHECK(kind IN ('membership','quota_pack')),
      name TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0,
      original_price_cents INTEGER NOT NULL DEFAULT 0,
      credits INTEGER NOT NULL DEFAULT 0,
      validity_days INTEGER NOT NULL DEFAULT 30,
      features_json TEXT NOT NULL DEFAULT '[]',
      max_concurrent_jobs INTEGER NOT NULL DEFAULT 2,
      max_asset_mb INTEGER NOT NULL DEFAULT 512,
      max_works INTEGER NOT NULL DEFAULT 100,
      max_resolution TEXT NOT NULL DEFAULT '1080p',
      purchasable INTEGER NOT NULL DEFAULT 1,
      recommended INTEGER NOT NULL DEFAULT 0,
      public INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plans_kind_sort ON plans(kind, sort_order ASC);

    CREATE TABLE IF NOT EXISTS quota_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      balance_before INTEGER NOT NULL DEFAULT 0,
      balance_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_type TEXT NOT NULL DEFAULT '',
      ref_id TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT UNIQUE,
      note TEXT NOT NULL DEFAULT '',
      admin_user_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_quota_ledger_user_created ON quota_ledger(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quota_ledger_ref ON quota_ledger(ref_type, ref_id);

    CREATE TABLE IF NOT EXISTS task_charges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      job_id TEXT,
      kind TEXT NOT NULL,
      credits INTEGER NOT NULL,
      plan_credits INTEGER NOT NULL DEFAULT 0,
      bonus_credits INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','refunded','voided')),
      quote_json TEXT NOT NULL DEFAULT '{}',
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
      actual_cost_cents INTEGER,
      provider TEXT NOT NULL DEFAULT '',
      failure_class TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      settled_at TEXT,
      refunded_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_charges_user_created ON task_charges(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_charges_job ON task_charges(job_id);
    CREATE INDEX IF NOT EXISTS idx_task_charges_status ON task_charges(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS pricing_rules (
      job_kind TEXT PRIMARY KEY,
      base_credits INTEGER NOT NULL DEFAULT 1,
      rule_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS failure_rules (
      failure_class TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      user_message TEXT NOT NULL,
      refund_policy TEXT NOT NULL DEFAULT 'auto_refund' CHECK(refund_policy IN ('auto_refund','no_refund','manual_review')),
      match_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 100,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('membership_new','membership_renew','membership_upgrade','quota_pack')),
      plan_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      payable_cents INTEGER NOT NULL,
      refunded_cents INTEGER NOT NULL DEFAULT 0,
      coupon_id TEXT,
      currency TEXT NOT NULL DEFAULT 'CNY',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paying','paid','closed','canceled','partial_refund','refunded','abnormal')),
      device TEXT NOT NULL DEFAULT 'pc' CHECK(device IN ('pc','wap')),
      client_token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      item_type TEXT NOT NULL CHECK(item_type IN ('membership','quota_pack','renewal','upgrade')),
      plan_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      credits INTEGER NOT NULL DEFAULT 0,
      validity_days INTEGER NOT NULL DEFAULT 0,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

    CREATE TABLE IF NOT EXISTS order_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'alipay',
      channel TEXT NOT NULL DEFAULT 'page' CHECK(channel IN ('page','wap')),
      out_trade_no TEXT NOT NULL UNIQUE,
      trade_no TEXT,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','success','failed','closed','abnormal')),
      verified INTEGER NOT NULL DEFAULT 0,
      notify_count INTEGER NOT NULL DEFAULT 0,
      notify_json TEXT,
      buyer_logon_id TEXT,
      error TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, updated_at DESC);

    -- Every inbound payment notification is stored raw, verified or not. This is the
    -- evidence trail for replay defence, forged notifications and unknown orders.
    CREATE TABLE IF NOT EXISTS payment_notifications (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'alipay',
      fingerprint TEXT NOT NULL UNIQUE,
      out_trade_no TEXT NOT NULL DEFAULT '',
      trade_no TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER,
      trade_status TEXT NOT NULL DEFAULT '',
      verified INTEGER NOT NULL DEFAULT 0,
      accepted INTEGER NOT NULL DEFAULT 0,
      order_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payment_notifications_order ON payment_notifications(out_trade_no, created_at DESC);

    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY,
      refund_no TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL,
      payment_id TEXT,
      user_id TEXT NOT NULL,
      out_request_no TEXT NOT NULL UNIQUE,
      amount_cents INTEGER NOT NULL,
      credits_reclaimed INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','processing','succeeded','failed','rejected')),
      requested_by TEXT NOT NULL DEFAULT 'user' CHECK(requested_by IN ('user','admin')),
      admin_user_id TEXT,
      provider_refund_no TEXT,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      dedupe_key TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(user_id, dedupe_key);

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      creation_json TEXT NOT NULL DEFAULT '{}',
      notify_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      ticket_no TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      order_id TEXT,
      job_id TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','processing','waiting_user','resolved','closed')),
      attachments_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_reply_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      author_type TEXT NOT NULL CHECK(author_type IN ('user','admin','system')),
      author_id TEXT,
      body TEXT NOT NULL,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS invoice_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      order_id TEXT,
      title_type TEXT NOT NULL DEFAULT 'personal' CHECK(title_type IN ('personal','company')),
      invoice_title TEXT NOT NULL,
      tax_no TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL,
      email TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','issued','rejected')),
      admin_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      processed_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_invoice_requests_status ON invoice_requests(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      starts_at TEXT,
      ends_at TEXT,
      popup INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all','paid','free','admin')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'fixed' CHECK(kind IN ('fixed','percent')),
      value INTEGER NOT NULL DEFAULT 0,
      plan_scope_json TEXT NOT NULL DEFAULT '[]',
      starts_at TEXT,
      ends_at TEXT,
      usage_limit INTEGER NOT NULL DEFAULT 0,
      used_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS secrets (
      key TEXT PRIMARY KEY,
      ciphertext TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Outbound mail journal. Every message is recorded with its final transport state so
    -- "email is broken" is visible in the backoffice instead of only in server logs.
    CREATE TABLE IF NOT EXISTS email_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      kind TEXT NOT NULL DEFAULT 'notification',
      to_address TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','outbox','failed')),
      transport TEXT NOT NULL DEFAULT 'outbox',
      error TEXT,
      ref_id TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_email_messages_user ON email_messages(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(status, created_at DESC);

    -- One token table for every single-use account link (email verification and
    -- password reset). A purpose column keeps them apart instead of modelling the
    -- same concept twice.
    CREATE TABLE IF NOT EXISTS account_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('verify_email','reset_password')),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_account_tokens_user ON account_tokens(user_id, purpose);

    CREATE TABLE IF NOT EXISTS worker_runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'scheduler',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      succeeded INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      detail_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_worker_runs_kind ON worker_runs(kind, started_at DESC);

    CREATE TABLE IF NOT EXISTS storage_objects (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      bucket TEXT NOT NULL DEFAULT 'outputs',
      storage_key TEXT NOT NULL UNIQUE,
      driver TEXT NOT NULL DEFAULT 'local',
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      ref_type TEXT NOT NULL DEFAULT '',
      ref_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_accessed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_storage_objects_user ON storage_objects(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS storage_object_refs (
      storage_key TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (storage_key, ref_type, ref_id)
    );
    CREATE INDEX IF NOT EXISTS idx_storage_object_refs_ref ON storage_object_refs(ref_type, ref_id);

    CREATE TABLE IF NOT EXISTS guard_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      kind TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_guard_events_user ON guard_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_guard_events_kind ON guard_events(kind, created_at DESC);
  `);

  addColumn(db, "sessions", "user_agent", "TEXT");
  addColumn(db, "sessions", "ip", "TEXT");
  addColumn(db, "memberships", "bonus_credits", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "memberships", "plan_id", "TEXT");
  addColumn(db, "jobs", "charge_id", "TEXT");
  // §23 成本与毛利: what the member paid for one creation, what it cost us, and
  // whether that cost is a real upstream number or only an estimate.
  addColumn(db, "task_charges", "user_value_cents", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "task_charges", "cost_source", "TEXT NOT NULL DEFAULT 'unknown'");
  addColumn(db, "task_charges", "duration_seconds", "INTEGER");
  addColumn(db, "jobs", "attempts", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "jobs", "last_poll_at", "TEXT");
  addColumn(db, "works", "size_bytes", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "works", "storage_key", "TEXT");
  addColumn(db, "works", "duration_seconds", "REAL");
  addColumn(db, "assets", "size_bytes", "INTEGER NOT NULL DEFAULT 0");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memberships_plan ON memberships(plan, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_charge ON jobs(charge_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status, updated_at DESC);
  `);

  migrateUsersAccountColumns(db);
  migrateMembershipsPlanCheck(db);
  seedCommercialDefaults(db);
  migrateLegacyPlainSecrets(db);
}

function addColumn(db: Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some(entry => entry.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (!String((error as Error)?.message || "").includes("duplicate column")) throw error;
  }
}

/**
 * `users.status` was created with CHECK(status IN ('active','disabled')). Account
 * cancellation needs a third business state, and SQLite cannot widen a CHECK in
 * place, so the table is rebuilt once (guarded by the current DDL) with foreign
 * keys temporarily disabled. All referencing tables keep resolving `users(id)` by
 * name after the rename.
 */
function migrateUsersAccountColumns(db: Database) {
  const ddl = String((db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as any)?.sql || "");
  if (!ddl) return;
  const needsRebuild = !ddl.includes("'closed'");
  if (needsRebuild) {
    // FK enforcement is already off for the whole migration (see ensureCommercialSchema).
    const rebuild = db.transaction(() => {
      db.exec(`
        CREATE TABLE users_new (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE COLLATE NOCASE,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','closed')),
          avatar_url TEXT,
          email_verified INTEGER NOT NULL DEFAULT 0,
          email_verified_at TEXT,
          closed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_login_at TEXT
        );
        INSERT INTO users_new (id, email, name, password_hash, role, status, avatar_url, created_at, updated_at, last_login_at)
          SELECT id, email, name, password_hash, role, status, avatar_url, created_at, updated_at, last_login_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
    });
    rebuild();
  } else {
    addColumn(db, "users", "email_verified", "INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "users", "email_verified_at", "TEXT");
    addColumn(db, "users", "closed_at", "TEXT");
  }
}

/**
 * `memberships.plan` was created with CHECK(plan IN ('free','pro','studio')). The
 * catalog is now operator-managed, so plan ids are data, not an enum. Rebuild the
 * table once (guarded by the current DDL) without the plan CHECK.
 */
function migrateMembershipsPlanCheck(db: Database) {
  const ddl = String((db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='memberships'").get() as any)?.sql || "");
  if (!ddl || !ddl.includes("'studio'")) return;
  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE memberships_new (
        user_id TEXT PRIMARY KEY,
        plan TEXT NOT NULL DEFAULT 'free',
        plan_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','suspended')),
        quota_limit_videos INTEGER NOT NULL,
        quota_used_videos INTEGER NOT NULL DEFAULT 0,
        bonus_credits INTEGER NOT NULL DEFAULT 0,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO memberships_new (user_id, plan, plan_id, status, quota_limit_videos, quota_used_videos, bonus_credits, period_start, period_end, updated_at)
        SELECT user_id, plan, COALESCE(plan_id, plan), status, quota_limit_videos, quota_used_videos,
               COALESCE(bonus_credits, 0), period_start, period_end, updated_at FROM memberships;
      DROP TABLE memberships;
      ALTER TABLE memberships_new RENAME TO memberships;
    `);
  });
  rebuild();
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memberships_plan ON memberships(plan, status);
    CREATE INDEX IF NOT EXISTS idx_memberships_period_end ON memberships(period_end);
  `);
}

const DEFAULT_PLANS = [
  {
    id: "free", kind: "membership", name: "免费版", subtitle: "体验完整的 AI 视频创作",
    priceCents: 0, credits: 10, validityDays: 30, sortOrder: 10, recommended: 0,
    maxConcurrentJobs: 1, maxAssetMb: 512, maxWorks: 50, maxResolution: "720p",
    features: ["每月 10 个创作额度", "全部基础创作能力", "作品库与素材库", "个人工作台"],
  },
  {
    id: "pro", kind: "membership", name: "创作者版", subtitle: "面向持续创作的创作者",
    priceCents: 9900, credits: 100, validityDays: 30, sortOrder: 20, recommended: 1,
    maxConcurrentJobs: 3, maxAssetMb: 4096, maxWorks: 500, maxResolution: "1080p",
    features: ["每月 100 个创作额度", "全部高级创作工作流", "批量版本与快速向导", "更高同时任务数"],
  },
  {
    id: "studio", kind: "membership", name: "工作室版", subtitle: "面向重度用户与小团队",
    priceCents: 69900, credits: 1000, validityDays: 30, sortOrder: 30, recommended: 0,
    maxConcurrentJobs: 6, maxAssetMb: 20480, maxWorks: 5000, maxResolution: "1080p",
    features: ["每月 1000 个创作额度", "全部高级创作工作流", "更高并发与容量", "优先支持"],
  },
  {
    id: "pack_50", kind: "quota_pack", name: "创作额度加油包 · 50", subtitle: "额度用完时按需补充，不改变会员周期",
    priceCents: 3900, credits: 50, validityDays: 365, sortOrder: 110, recommended: 0,
    maxConcurrentJobs: 0, maxAssetMb: 0, maxWorks: 0, maxResolution: "",
    features: ["立即到账 50 个创作额度", "有效期 365 天", "可与任意会员套餐叠加"],
  },
  {
    id: "pack_200", kind: "quota_pack", name: "创作额度加油包 · 200", subtitle: "适合集中创作阶段",
    priceCents: 12900, credits: 200, validityDays: 365, sortOrder: 120, recommended: 1,
    maxConcurrentJobs: 0, maxAssetMb: 0, maxWorks: 0, maxResolution: "",
    features: ["立即到账 200 个创作额度", "有效期 365 天", "可与任意会员套餐叠加"],
  },
];

const DEFAULT_FAILURE_RULES = [
  { failureClass: "user_input", label: "创作要求不符合", userMessage: "本次创作没有开始，未扣除创作额度。请调整素材或描述后重新提交。", policy: "no_refund", sortOrder: 10, match: [] },
  { failureClass: "platform", label: "平台处理异常", userMessage: "本次创作因平台原因没有完成，创作额度已退回。", policy: "auto_refund", sortOrder: 20, match: ["WORKER_", "DATABASE", "STORAGE", "ARCHIVE", "TIMEOUT_LOCAL"] },
  { failureClass: "provider", label: "创作服务异常", userMessage: "创作服务当前繁忙，本次创作额度已退回，请稍后重试。", policy: "auto_refund", sortOrder: 30, match: ["Throttling", "InternalError", "ServiceUnavailable", "500", "502", "503", "504"] },
  { failureClass: "content", label: "内容无法生成", userMessage: "本次内容无法完成生成，可调整素材或描述后重试。", policy: "manual_review", sortOrder: 40, match: ["DataInspection", "InvalidParameter.Content", "content", "审核"] },
  { failureClass: "user_cancel", label: "用户取消", userMessage: "已取消本次创作。", policy: "manual_review", sortOrder: 50, match: [] },
  { failureClass: "unknown", label: "状态确认中", userMessage: "本次创作结果正在确认，如未完成创作额度会自动退回。", policy: "manual_review", sortOrder: 90, match: [] },
];

function seedCommercialDefaults(db: Database) {
  const now = new Date().toISOString();

  const planCount = Number((db.prepare("SELECT COUNT(*) AS c FROM plans").get() as any).c || 0);
  if (planCount === 0) {
    const insert = db.prepare(`INSERT OR IGNORE INTO plans
      (id, kind, name, subtitle, price_cents, original_price_cents, credits, validity_days, features_json,
       max_concurrent_jobs, max_asset_mb, max_works, max_resolution, purchasable, recommended, public, sort_order,
       status, created_at, updated_at)
      VALUES (@id, @kind, @name, @subtitle, @priceCents, @originalPriceCents, @credits, @validityDays, @featuresJson,
       @maxConcurrentJobs, @maxAssetMb, @maxWorks, @maxResolution, 1, @recommended, 1, @sortOrder, 'active', @now, @now)`);
    const seed = db.transaction(() => {
      for (const plan of DEFAULT_PLANS) {
        insert.run({
          id: plan.id, kind: plan.kind, name: plan.name, subtitle: plan.subtitle,
          priceCents: plan.priceCents, originalPriceCents: plan.priceCents, credits: plan.credits,
          validityDays: plan.validityDays, featuresJson: JSON.stringify(plan.features),
          maxConcurrentJobs: plan.maxConcurrentJobs, maxAssetMb: plan.maxAssetMb, maxWorks: plan.maxWorks,
          maxResolution: plan.maxResolution, recommended: plan.recommended, sortOrder: plan.sortOrder, now,
        });
      }
    });
    seed();
  }

  const ruleCount = Number((db.prepare("SELECT COUNT(*) AS c FROM pricing_rules").get() as any).c || 0);
  if (ruleCount === 0) {
    // Baseline parity with the pre-commercial rule "1 job = 1 credit" so existing
    // users see no change until an operator tunes the rules in the backoffice.
    const insert = db.prepare(`INSERT OR IGNORE INTO pricing_rules (job_kind, base_credits, rule_json, enabled, note, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)`);
    const seed = db.transaction(() => {
      insert.run("*", 1, JSON.stringify({ perMinuteCredits: 0, minCredits: 1, maxCredits: 20 }), "默认创作额度规则（与商业化前保持一致）", now);
    });
    seed();
  }

  const failureCount = Number((db.prepare("SELECT COUNT(*) AS c FROM failure_rules").get() as any).c || 0);
  if (failureCount === 0) {
    const insert = db.prepare(`INSERT OR IGNORE INTO failure_rules (failure_class, label, user_message, refund_policy, match_json, sort_order, updated_at)
      VALUES (@failureClass, @label, @userMessage, @policy, @matchJson, @sortOrder, @now)`);
    const seed = db.transaction(() => {
      for (const rule of DEFAULT_FAILURE_RULES) {
        insert.run({ ...rule, matchJson: JSON.stringify(rule.match), now });
      }
    });
    seed();
  }
}

const LEGACY_SECRET_KEYS = ["modelstudio_api_key", "yike_access_key_secret", "yike_access_key_id"] as const;

/**
 * Older releases stored provider credentials as plain text in `settings`. Move them
 * into the encrypted `secrets` table exactly once; the plain row is removed so the
 * same value never lives in two places.
 */
function migrateLegacyPlainSecrets(db: Database) {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'").get();
  if (!hasTable) return;
  for (const key of LEGACY_SECRET_KEYS) {
    const existing = db.prepare("SELECT 1 FROM secrets WHERE key=?").get(key);
    if (existing) {
      db.prepare("DELETE FROM settings WHERE key=?").run(key);
      continue;
    }
    const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value?: string } | undefined;
    const value = row?.value?.trim();
    if (!value) continue;
    // Lazy: encryption needs the master key which lives in lib/secrets.ts. The
    // migration hook is registered from there to avoid a circular import.
    const encrypt = (globalThis as any).__wankeSecretEncrypt as ((plain: string) => string) | undefined;
    if (typeof encrypt !== "function") continue;
    const move = db.transaction(() => {
      db.prepare(`INSERT INTO secrets (key, ciphertext, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET ciphertext=excluded.ciphertext, updated_at=excluded.updated_at`)
        .run(key, encrypt(value), new Date().toISOString());
      db.prepare("DELETE FROM settings WHERE key=?").run(key);
    });
    move();
  }
}
