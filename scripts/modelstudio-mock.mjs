// Local Model Studio (百炼 / DashScope) stand-in for acceptance tests.
//
//   import { startModelStudioMock } from "./modelstudio-mock.mjs";
//   const mock = await startModelStudioMock({ port: 3130, apiKey: "sk-ws-e2e" });
//   // then point the app at it: 设置 → 创作服务 → Base URL = mock.baseUrl
//
// It is a *protocol* mock, not a shortcut:
//   - it speaks the real async video API (`POST /api/v1/services/aigc/video-generation/
//     video-synthesis` + `GET /api/v1/tasks/{task_id}`) with the real envelope
//     (`output.task_id`, `output.task_status`, `output.video_url`, `usage`, `request_id`);
//   - it checks `Authorization: Bearer <key>` and the `X-DashScope-Async: enable` header,
//     so a wrong key or a missing async header fails the test instead of passing;
//   - it validates the request body shape (model / input.prompt / parameters);
//   - it can inject the failures the real service produces: FAILED with a provider code,
//     an unrecognised status, a task that never finishes, transient 500s and dead sockets.
//
// The product code under test (`lib/video/modelstudio.ts`, `lib/worker.ts`) is the real
// code path: nothing here simulates a Wanke-side success.
//
// Standalone: node scripts/modelstudio-mock.mjs   (prints the control API)

import http from "node:http";
import { randomUUID } from "node:crypto";

// A structurally valid MP4 header plus filler. It is a placeholder file, not a real
// video: the acceptance run only needs the archive/download path to move bytes.
const MP4_STUB = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypmp42", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("mp42isom", "ascii"),
  Buffer.alloc(2048, 0x20),
]);

const DEFAULT_POLICY = {
  apiKey: "sk-ws-e2e-mock-key",
  pollsToFinish: 2,
  outcome: "succeeded", // succeeded | failed | stall | unknown | canceled
  failCode: "InternalError",
  failMessage: "mock upstream failure",
  videoDurationSeconds: 5,
  transientCount: 0,
  transientMode: "socket", // socket | http500
  submitRejections: 0,
  requireAsyncHeader: true,
};

export async function startModelStudioMock(options = {}) {
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  if (options.apiKey) policy.apiKey = options.apiKey;
  const tasks = new Map();
  const state = {
    submits: 0, polls: 0, authFailures: 0, asyncHeaderMissing: 0, invalidBodies: 0,
    transientInjected: 0, submitRejections: 0, unknownTaskQueries: 0, videoDownloads: 0,
  };

  function send(node, payload, status = 200) {
    const body = JSON.stringify(payload);
    node.setHeader("Content-Type", "application/json");
    node.writeHead(status);
    node.end(body);
  }

  function requestId() {
    return randomUUID().replace(/-/g, "");
  }

  function authorized(node) {
    const header = String(node.headers["authorization"] || "");
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match || match[1].trim() !== policy.apiKey) {
      state.authFailures += 1;
      return false;
    }
    return true;
  }

  function taskPayload(task) {
    if (task.status === "SUCCEEDED") {
      return {
        request_id: task.requestId,
        output: {
          task_id: task.id, task_status: "SUCCEEDED", video_url: task.videoUrl,
          submit_time: task.submitTime, scheduled_time: task.scheduledTime, end_time: task.endTime,
        },
        usage: { video_duration: task.videoDurationSeconds, video_count: 1, video_ratio: task.aspectRatio },
      };
    }
    if (task.status === "FAILED" || task.status === "CANCELED") {
      return {
        request_id: task.requestId,
        output: { task_id: task.id, task_status: task.status, code: task.failCode, message: task.failMessage, submit_time: task.submitTime, end_time: task.endTime },
        usage: task.status === "CANCELED" ? {} : { video_duration: 0, video_count: 0 },
      };
    }
    if (task.status === "SUSPENDED") {
      // A status Wanke does not map: the app must keep it as 状态确认中 and never guess.
      return { request_id: task.requestId, output: { task_id: task.id, task_status: "SUSPENDED", submit_time: task.submitTime } };
    }
    return { request_id: task.requestId, output: { task_id: task.id, task_status: task.status, submit_time: task.submitTime, scheduled_time: task.scheduledTime } };
  }

  function advance(task) {
    task.polls += 1;
    if (task.outcome === "stall") {
      task.status = task.polls === 1 ? "PENDING" : "RUNNING";
      return;
    }
    if (task.outcome === "unknown") {
      task.status = task.polls >= task.pollsToFinish ? "SUSPENDED" : "RUNNING";
      return;
    }
    if (task.polls < task.pollsToFinish) {
      task.status = task.polls === 1 ? "PENDING" : "RUNNING";
      return;
    }
    task.status = task.outcome === "canceled" ? "CANCELED" : task.outcome === "failed" ? "FAILED" : "SUCCEEDED";
    task.endTime = new Date().toISOString().replace("T", " ").slice(0, 19);
  }

  async function readBody(node) {
    const chunks = [];
    for await (const chunk of node) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    try { return raw ? JSON.parse(raw) : {}; } catch { return { __invalidJson: raw.slice(0, 200) }; }
  }

  const server = http.createServer(async (node, res) => {
    const url = new URL(node.url, `http://${node.headers.host || "localhost"}`);
    const path = url.pathname;

    if (path === "/__mock/state" && node.method === "GET") {
      return send(res, {
        policy: { ...policy, apiKey: policy.apiKey ? `${policy.apiKey.slice(0, 6)}…` : "" },
        state,
        tasks: [...tasks.values()].map(task => ({
          id: task.id, model: task.model, status: task.status, outcome: task.outcome, polls: task.polls,
          pollsToFinish: task.pollsToFinish, videoUrl: task.videoUrl, failCode: task.failCode,
          failMessage: task.failMessage, videoDurationSeconds: task.videoDurationSeconds, prompt: task.prompt,
        })),
      });
    }
    if (path === "/__mock/config" && node.method === "POST") {
      Object.assign(policy, await readBody(node));
      return send(res, { ok: true, policy: { ...policy, apiKey: "…" } });
    }
    if (path.startsWith("/__mock/tasks/") && node.method === "POST") {
      const task = tasks.get(decodeURIComponent(path.split("/").pop() || ""));
      if (!task) return send(res, { error: "task not found" }, 404);
      const patch = await readBody(node);
      Object.assign(task, patch);
      if (patch.status) task.status = patch.status;
      return send(res, { ok: true, task: { id: task.id, status: task.status, outcome: task.outcome, polls: task.polls } });
    }
    if (path === "/__mock/reset" && node.method === "POST") {
      tasks.clear();
      for (const key of Object.keys(state)) state[key] = 0;
      return send(res, { ok: true });
    }
    if (path.startsWith("/mock-videos/") && node.method === "GET") {
      state.videoDownloads += 1;
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", String(MP4_STUB.length));
      res.writeHead(200);
      return res.end(MP4_STUB);
    }

    // Everything below is the real provider protocol: credentials first, always.
    if (!authorized(node)) {
      return send(res, { code: "InvalidApiKey", message: "Invalid API-key provided.", request_id: requestId() }, 401);
    }

    if (path === "/api/v1/services/aigc/video-generation/video-synthesis" && node.method === "POST") {
      if (policy.requireAsyncHeader && String(node.headers["x-dashscope-async"] || "") !== "enable") {
        state.asyncHeaderMissing += 1;
        return send(res, { code: "InvalidParameter", message: "missing X-DashScope-Async header", request_id: requestId() }, 400);
      }
      const body = await readBody(node);
      if (!body?.model || typeof body?.input?.prompt !== "string" || !body.input.prompt.trim()) {
        state.invalidBodies += 1;
        return send(res, { code: "InvalidParameter", message: "model and input.prompt are required", request_id: requestId() }, 400);
      }
      if (policy.submitRejections > 0) {
        policy.submitRejections -= 1;
        state.submitRejections += 1;
        return send(res, { code: "Throttling", message: "mock submit throttled", request_id: requestId() }, 429);
      }
      state.submits += 1;
      const id = `mock-task-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      const task = {
        id, model: body.model, prompt: body.input.prompt.slice(0, 120),
        aspectRatio: body.parameters?.ratio || body.parameters?.aspect_ratio || "16:9",
        requestedDuration: Number(body.parameters?.duration || policy.videoDurationSeconds),
        videoDurationSeconds: Number(body.parameters?.duration || policy.videoDurationSeconds),
        status: "PENDING", outcome: policy.outcome, polls: 0, pollsToFinish: Math.max(1, policy.pollsToFinish),
        failCode: policy.failCode, failMessage: policy.failMessage,
        transientCount: policy.transientCount, transientMode: policy.transientMode,
        videoUrl: "", submitTime: now, scheduledTime: now, endTime: null, requestId: requestId(),
      };
      task.videoUrl = `http://${url.host}/mock-videos/${id}.mp4`;
      tasks.set(id, task);
      return send(res, { request_id: task.requestId, output: { task_id: id, task_status: "PENDING", submit_time: now } });
    }

    const taskMatch = /^\/api\/v1\/tasks\/([^/]+)$/.exec(path);
    if (taskMatch && node.method === "GET") {
      const task = tasks.get(decodeURIComponent(taskMatch[1]));
      if (!task) {
        state.unknownTaskQueries += 1;
        return send(res, { code: "InvalidParameter", message: "Task not exist.", request_id: requestId() }, 404);
      }
      state.polls += 1;
      if (task.transientCount > 0) {
        task.transientCount -= 1;
        state.transientInjected += 1;
        if (task.transientMode === "http500") {
          return send(res, { code: "InternalError", message: "mock transient upstream error", request_id: requestId() }, 500);
        }
        return node.destroy(); // a real dead socket: the app sees `fetch failed`
      }
      task.history = (task.history || []).concat(task.status);
      advance(task);
      return send(res, taskPayload(task));
    }

    return send(res, { code: "InvalidParameter", message: `mock has no route ${node.method} ${path}`, request_id: requestId() }, 404);
  });

  await new Promise(resolve => server.listen(options.port || 0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    port,
    apiKey: policy.apiKey,
    get state() { return state; },
    get policy() { return policy; },
    /** Change the default lifecycle for tasks submitted from now on. */
    async configure(patch) {
      Object.assign(policy, patch);
      return { ...policy, apiKey: "…" };
    },
    /** Change one existing task (e.g. force a stall or a provider failure). */
    task(taskId) {
      return tasks.get(taskId) || null;
    },
    async setTask(taskId, patch) {
      const task = tasks.get(taskId);
      if (!task) return null;
      Object.assign(task, patch);
      return { id: task.id, status: task.status, outcome: task.outcome, polls: task.polls };
    },
    stop() {
      return new Promise(resolve => server.close(() => resolve()));
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("modelstudio-mock.mjs")) {
  const mock = await startModelStudioMock({ port: Number(process.env.MOCK_PORT || 3130) });
  console.log(`Model Studio mock listening on ${mock.baseUrl}`);
  console.log(`  submit:  POST ${mock.baseUrl}/api/v1/services/aigc/video-generation/video-synthesis`);
  console.log(`  query:   GET  ${mock.baseUrl}/api/v1/tasks/{task_id}`);
  console.log(`  control: GET /__mock/state · POST /__mock/config · POST /__mock/tasks/{id} · POST /__mock/reset`);
  console.log(`  api key: ${mock.apiKey}`);
}
