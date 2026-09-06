// SaaS acceptance script. Run against a local server with a throwaway DB:
//   ./scripts/e2e-run.sh scripts/saas-e2e.mjs
// Covers the account/isolation/backoffice baseline. Money, credits and orders are
// covered by scripts/commerce-e2e.mjs.
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@wanke.test";
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
  const session = setCookie ? setCookie.split(";")[0] : null;
  return { status: response.status, json, text, session };
}

console.log("== visitor ==");
const landing = await call("/");
check("landing renders for visitors", landing.status === 200 && landing.text.includes("Wanke"));
check("landing sells plans from the catalog", landing.text.includes("创作者版") && landing.text.includes("工作室版"));
check("landing has no engineering copy", !/多租户|配额预扣|审计日志/.test(landing.text));

console.log("== unauthenticated cannot consume ==");
check("jobs list blocked", (await call("/api/jobs")).status === 401);
check("job submit blocked", (await call("/api/jobs", { method: "POST", body: { kind: "video_generation", input: { prompt: "x" } } })).status === 401);
check("assets blocked", (await call("/api/assets")).status === 401);
check("projects blocked", (await call("/api/projects")).status === 401);
check("membership blocked", (await call("/api/membership")).status === 401);
check("orders blocked", (await call("/api/orders")).status === 401);
check("admin blocked", (await call("/api/admin/stats")).status === 401);

console.log("== registration ==");
const admin = await call("/api/auth/register", { method: "POST", body: { email: ADMIN_EMAIL, name: "Operator", password: "admin-pass-123", termsAccepted: true } });
check("admin registers", admin.status === 201, JSON.stringify(admin.json));
check("admin promoted via ADMIN_EMAIL", admin.json?.user?.role === "admin");
const adminCookie = admin.session;

const alice = await call("/api/auth/register", { method: "POST", body: { email: "alice@wanke.test", name: "Alice", password: "alice-pass-123", termsAccepted: true } });
check("user registers", alice.status === 201);
check("new user defaults to free", alice.json?.plan === "free");
const aliceCookie = alice.session;
const dup = await call("/api/auth/register", { method: "POST", body: { email: "alice@wanke.test", name: "Alice2", password: "whatever-123", termsAccepted: true } });
check("duplicate email rejected", dup.status === 409);
const weak = await call("/api/auth/register", { method: "POST", body: { email: "weak@wanke.test", name: "Weak", password: "short", termsAccepted: true } });
check("weak password rejected", weak.status === 400);
const noTerms = await call("/api/auth/register", { method: "POST", body: { email: "noterms@wanke.test", name: "NoTerms", password: "noterms-pass-123" } });
check("agreement must be accepted", noTerms.status === 400 && /协议/.test(noTerms.json?.error || ""), JSON.stringify(noTerms.json));
check("rejected signup creates no account", (await call("/api/auth/login", { method: "POST", body: { email: "noterms@wanke.test", password: "noterms-pass-123" } })).status === 401);

const bob = await call("/api/auth/register", { method: "POST", body: { email: "bob@wanke.test", name: "Bob", password: "bob-pass-123", termsAccepted: true } });
const bobCookie = bob.session;

console.log("== membership defaults ==");
const aliceMe = await call("/api/auth/me", { cookie: aliceCookie });
const credits = aliceMe.json?.membership?.credits;
check("free plan grants 10 credits", credits?.planLimit === 10 && credits?.available === 10, JSON.stringify(credits));
check("plan shown in business language", aliceMe.json?.membership?.planName === "免费版");
check("membership exposes plan limits", aliceMe.json?.membership?.limits?.maxResolution === "720p");
check("membership hides internal price fields", !("priceMonthly" in (aliceMe.json?.membership?.planInfo || {})));

console.log("== credits reserve + refund on sync submit failure ==");
// No creation service is configured on the e2e server: submitJob throws synchronously,
// so the reserved credits must come back and the member must see business language.
const submit1 = await call("/api/jobs", { method: "POST", cookie: aliceCookie, body: { kind: "video_generation", title: "e2e", input: { prompt: "a cat" } } });
check("submit answered structurally", submit1.status === 201 || submit1.status === 400, `status=${submit1.status}`);
const afterSubmit = await call("/api/auth/me", { cookie: aliceCookie });
check("credits refunded after sync failure", afterSubmit.json?.membership?.credits?.planUsed === 0, JSON.stringify(afterSubmit.json?.membership?.credits));
check("failure message is business language", submit1.json?.error === "创作要求还没有填写完整，请检查后重新提交。" || submit1.json?.error === "当前创作服务暂时繁忙，请稍后再试。", submit1.json?.error);
check("member job payload carries no raw upstream response", submit1.json?.job?.provider === null || submit1.json?.job?.provider === undefined, JSON.stringify(submit1.json?.job?.provider)?.slice(0, 120));
check("member job error is scrubbed", !/Invalid option|Provider|RequestId|fetch failed/i.test(String(submit1.json?.job?.error || "")), String(submit1.json?.job?.error).slice(0, 160));

console.log("== credit exhaustion blocks with 402 ==");
const noReason = await call(`/api/admin/users/${alice.json.user.id}`, { method: "PATCH", cookie: adminCookie, body: { creditDelta: -10 } });
check("credit adjustment without reason rejected", noReason.status === 400, `status=${noReason.status}`);
const exhaust = await call(`/api/admin/users/${alice.json.user.id}`, { method: "PATCH", cookie: adminCookie, body: { creditDelta: -10, note: "e2e：模拟额度耗尽" } });
check("admin deducts credits with a reason", exhaust.status === 200 && exhaust.json?.membership?.credits?.available === 0, JSON.stringify(exhaust.json?.membership?.credits));
const blocked = await call("/api/jobs", { method: "POST", cookie: aliceCookie, body: { kind: "video_generation", input: { prompt: "another" } } });
check("insufficient credits -> 402", blocked.status === 402, `status=${blocked.status} ${blocked.json?.error}`);
check("stable error code", blocked.json?.code === "QUOTA_EXCEEDED");
check("member-facing wording", blocked.json?.error === "当前创作额度不足", blocked.json?.error);

console.log("== benefits are never granted without a confirmed payment ==");
const removedSwitch = await call("/api/membership/switch", { method: "POST", cookie: aliceCookie, body: { plan: "pro" } });
check("mock plan-switch endpoint is gone", removedSwitch.status === 404 || removedSwitch.status === 405, `status=${removedSwitch.status}`);
const selfUpgrade = await call("/api/membership", { method: "POST", cookie: aliceCookie, body: { plan: "pro" } });
check("membership cannot be self-upgraded", selfUpgrade.status === 404 || selfUpgrade.status === 405, `status=${selfUpgrade.status}`);

console.log("== backoffice plan change is a support action with a reason ==");
const silentPlan = await call(`/api/admin/users/${alice.json.user.id}`, { method: "PATCH", cookie: adminCookie, body: { plan: "pro" } });
check("plan change without reason rejected", silentPlan.status === 400);
const supportPlan = await call(`/api/admin/users/${alice.json.user.id}`, { method: "PATCH", cookie: adminCookie, body: { plan: "pro", note: "e2e：客服补偿升级" } });
check("admin plan change applied", supportPlan.status === 200 && supportPlan.json?.membership?.plan === "pro");
check("plan change resets the cycle", supportPlan.json?.membership?.credits?.planLimit === 100 && supportPlan.json?.membership?.credits?.planUsed === 0);
check("plan change writes a ledger row", (await call("/api/quota/ledger", { cookie: aliceCookie })).json?.total >= 2);

console.log("== isolation between users ==");
// Seed a succeeded job for Alice directly, then verify Bob cannot see it.
const Database = (await import("better-sqlite3")).default;
const db = new Database(process.env.E2E_DB || "./data/e2e.db");
const now = new Date().toISOString();
db.prepare(`INSERT OR REPLACE INTO jobs (id, kind, title, status, request_json, output_json, user_id, created_at, updated_at)
  VALUES ('e2e-job-alice', 'video_generation', 'Alice private job', 'succeeded', '{}', ?, ?, ?, ?)`)
  .run(JSON.stringify([{ kind: "video", outputUrl: "https://example.com/video.mp4" }]), alice.json.user.id, now, now);
db.close();

const aliceJob = await call("/api/jobs/e2e-job-alice", { cookie: aliceCookie });
check("owner sees own job", aliceJob.status === 200);
const bobSeesAliceJob = await call("/api/jobs/e2e-job-alice", { cookie: bobCookie });
check("other user gets 404 (not 403 leak)", bobSeesAliceJob.status === 404);
const anonSeesJob = await call("/api/jobs/e2e-job-alice");
check("anonymous gets 401", anonSeesJob.status === 401);
const bobJobs = await call("/api/jobs", { cookie: bobCookie });
check("bob job list excludes alice job", !(bobJobs.json?.jobs || []).some(job => job.id === "e2e-job-alice"));

console.log("== works ==");
const badWork = await call("/api/works", { method: "POST", cookie: bobCookie, body: { jobId: "e2e-job-alice", outputIndex: 0 } });
check("cannot save someone else's job as work", badWork.status === 404);
const work = await call("/api/works", { method: "POST", cookie: aliceCookie, body: { jobId: "e2e-job-alice", outputIndex: 0, title: "Alice Work" } });
check("owner saves work", work.status === 201 && work.json?.work?.title === "Alice Work", JSON.stringify(work.json));
const aliceWorks = await call("/api/works", { cookie: aliceCookie });
check("work listed for owner", (aliceWorks.json?.works || []).length === 1);
const bobWorks = await call("/api/works", { cookie: bobCookie });
check("work hidden from others", (bobWorks.json?.works || []).length === 0);

console.log("== admin backoffice ==");
check("non-admin blocked from admin api", (await call("/api/admin/stats", { cookie: bobCookie })).status === 403);
const stats = await call("/api/admin/stats", { cookie: adminCookie });
check("admin stats", stats.status === 200 && stats.json?.stats?.users?.total >= 3);
const users = await call("/api/admin/users?query=alice", { cookie: adminCookie });
check("admin user search", (users.json?.users || []).some(row => row.user.email === "alice@wanke.test"));
const adminJobs = await call("/api/admin/jobs", { cookie: adminCookie });
check("admin sees all jobs incl legacy", adminJobs.status === 200);
const adminOrders = await call("/api/admin/orders", { cookie: adminCookie });
check("admin order book reachable", adminOrders.status === 200);
check("non-admin cannot read the order book", (await call("/api/admin/orders", { cookie: bobCookie })).status === 403);

console.log("== platform configuration stays internal ==");
check("member cannot read creation-service settings", (await call("/api/settings", { cookie: bobCookie })).status === 403);
const adminSettings = await call("/api/settings", { cookie: adminCookie });
check("admin reads creation-service settings", adminSettings.status === 200);
const settingsWrite = await call("/api/settings", { method: "POST", cookie: aliceCookie, body: { videoProviderMode: "yike" } });
check("non-admin cannot change settings", settingsWrite.status === 403);
const memberStatus = await call("/api/status", { cookie: bobCookie });
check("member status is capability flags only", memberStatus.status === 200 && typeof memberStatus.json?.generationReady === "boolean");
check("member status leaks no provider detail", !/modelstudio|yike|accessKey|endpoint|region/i.test(memberStatus.text), memberStatus.text.slice(0, 200));

console.log("== account suspension ==");
const disable = await call(`/api/admin/users/${bob.json.user.id}`, { method: "PATCH", cookie: adminCookie, body: { status: "disabled" } });
check("admin disables user", disable.status === 200);
const bobLogin = await call("/api/auth/login", { method: "POST", body: { email: "bob@wanke.test", password: "bob-pass-123" } });
check("disabled user cannot login", bobLogin.status === 403);
check("disabled user loses the session", (await call("/api/auth/me", { cookie: bobCookie })).json?.user === null);
const audit = await call("/api/admin/audit-logs", { cookie: adminCookie });
const actions = (audit.json?.logs || []).map(log => log.action);
check("audit log recorded", actions.includes("user.disable") && actions.includes("membership.update"), JSON.stringify(actions));
check("credit adjustment audited", actions.includes("credits.deduct"), JSON.stringify(actions));

console.log("== login rate limiting ==");
for (let i = 0; i < 5; i += 1) {
  await call("/api/auth/login", { method: "POST", body: { email: "alice@wanke.test", password: "wrong-password" } });
}
const limited = await call("/api/auth/login", { method: "POST", body: { email: "alice@wanke.test", password: "wrong-password" } });
check("6th bad login rate limited", limited.status === 429, `status=${limited.status}`);

console.log(failures === 0 ? "\nALL E2E CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
