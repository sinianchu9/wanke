// SaaS acceptance script. Run against a local server with a throwaway DB:
//   ADMIN_EMAIL=admin@wanke.test node_modules/.bin/next start -p 3100   (WANKE_DB_PATH=./data/e2e.db)
//   node scripts/saas-e2e.mjs
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const ADMIN_EMAIL = "admin@wanke.test";
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
  try { json = await response.json(); } catch { /* html page */ }
  const setCookie = response.headers.get("set-cookie");
  const session = setCookie ? setCookie.split(";")[0] : null;
  return { status: response.status, json, session };
}

console.log("== visitor ==");
const landing = await fetch(`${BASE}/`);
check("landing renders for visitors", landing.status === 200 && (await landing.text()).includes("Wanke"));

console.log("== unauthenticated cannot consume ==");
check("jobs list blocked", (await call("/api/jobs")).status === 401);
check("job submit blocked", (await call("/api/jobs", { method: "POST", body: { kind: "video_generation", input: { prompt: "x" } } })).status === 401);
check("assets blocked", (await call("/api/assets")).status === 401);
check("projects blocked", (await call("/api/projects")).status === 401);
check("admin blocked", (await call("/api/admin/stats")).status === 401);

console.log("== registration ==");
const admin = await call("/api/auth/register", { method: "POST", body: { email: ADMIN_EMAIL, name: "Operator", password: "admin-pass-123" } });
check("admin registers", admin.status === 201, JSON.stringify(admin.json));
check("admin promoted via ADMIN_EMAIL", admin.json?.user?.role === "admin");
const adminCookie = admin.session;

const alice = await call("/api/auth/register", { method: "POST", body: { email: "alice@wanke.test", name: "Alice", password: "alice-pass-123" } });
check("user registers", alice.status === 201);
check("new user defaults to free", alice.json?.plan === "free");
const aliceCookie = alice.session;
const dup = await call("/api/auth/register", { method: "POST", body: { email: "alice@wanke.test", name: "Alice2", password: "whatever-123" } });
check("duplicate email rejected", dup.status === 409);

const bob = await call("/api/auth/register", { method: "POST", body: { email: "bob@wanke.test", name: "Bob", password: "bob-pass-123" } });
const bobCookie = bob.session;

console.log("== membership defaults ==");
const aliceMe = await call("/api/auth/me", { cookie: aliceCookie });
check("free plan quota 10", aliceMe.json?.membership?.quotaLimitVideos === 10, JSON.stringify(aliceMe.json?.membership));

console.log("== quota reserve + refund on sync submit failure ==");
// No provider keys configured on the e2e server: submitJob throws synchronously,
// so the reserved unit must be refunded.
const submit1 = await call("/api/jobs", { method: "POST", cookie: aliceCookie, body: { kind: "video_generation", title: "e2e", input: { prompt: "a cat" } } });
check("submit accepted structurally", submit1.status === 201 || submit1.status === 400, `status=${submit1.status}`);
const afterSubmit = await call("/api/auth/me", { cookie: aliceCookie });
check("quota refunded after sync failure", afterSubmit.json?.membership?.quotaUsedVideos === 0, JSON.stringify(afterSubmit.json?.membership));

console.log("== quota exhaustion blocks with 402 ==");
const exhaust = await call(`/api/admin/users/${alice.json.user.id}`, { method: "PATCH", cookie: adminCookie, body: { quotaUsed: 10 } });
check("admin sets usage", exhaust.status === 200);
const blocked = await call("/api/jobs", { method: "POST", cookie: aliceCookie, body: { kind: "video_generation", input: { prompt: "another" } } });
check("quota exceeded -> 402", blocked.status === 402, `status=${blocked.status} ${blocked.json?.error}`);
check("stable error code", blocked.json?.code === "QUOTA_EXCEEDED");

console.log("== plan switch resets quota ==");
const upgrade = await call("/api/membership/switch", { method: "POST", cookie: aliceCookie, body: { plan: "pro" } });
check("upgrade to pro", upgrade.status === 200 && upgrade.json?.membership?.plan === "pro");
check("pro quota 100 + reset", upgrade.json?.membership?.quotaLimitVideos === 100 && upgrade.json?.membership?.quotaUsedVideos === 0);

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
const disable = await call(`/api/admin/users/${bob.json.user.id}`, { method: "PATCH", cookie: adminCookie, body: { status: "disabled" } });
check("admin disables user", disable.status === 200);
const bobLogin = await call("/api/auth/login", { method: "POST", body: { email: "bob@wanke.test", password: "bob-pass-123" } });
check("disabled user cannot login", bobLogin.status === 403);
const audit = await call("/api/admin/audit-logs", { cookie: adminCookie });
const actions = (audit.json?.logs || []).map(log => log.action);
check("audit log recorded", actions.includes("user.disable") && actions.includes("membership.update"), JSON.stringify(actions));

console.log("== admin settings write protection ==");
const settingsWrite = await call("/api/settings", { method: "POST", cookie: aliceCookie, body: { videoProviderMode: "yike" } });
check("non-admin cannot change settings", settingsWrite.status === 403);

console.log("== login rate limiting ==");
for (let i = 0; i < 5; i += 1) {
  await call("/api/auth/login", { method: "POST", body: { email: "alice@wanke.test", password: "wrong-password" } });
}
const limited = await call("/api/auth/login", { method: "POST", body: { email: "alice@wanke.test", password: "wrong-password" } });
check("6th bad login rate limited", limited.status === 429, `status=${limited.status}`);

console.log(failures === 0 ? "\nALL E2E CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
