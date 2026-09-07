import "server-only";
import { businessJobStatus, publicErrorMessage } from "@/lib/copy";
import type { ResultMedia, StoredJob } from "@/lib/types";

/**
 * Member-facing job payloads (§47 log layering, §54 wording audit).
 *
 * The stored record keeps the full technical truth for the backoffice and the worker:
 * the upstream task id, the upstream request id, the raw upstream response, and details
 * such as engine / model / route / endpoint / taskStatus / usage. A member's browser
 * must not receive any of them — not even as a null value, because the key names alone
 * are internal vocabulary a page could render by accident. The member view is therefore
 * built from an allowlist, and the two things the studio genuinely needs are restated in
 * business terms:
 *
 *   tracked          the server worker is following an upstream creation (§20)
 *   durationSeconds  how long the finished result is, without the raw usage payload
 *
 * Admins keep the raw record because §31 requires it for operations.
 */

/** Detail keys the studio UI renders. Anything not listed stays server-side. */
const MEMBER_DETAIL_KEYS = [
  "pollable", "note", "batchId", "batchIndex", "batchTotal", "creationAction",
  "failedShots", "storyboardInfo", "targetDuration", "effectiveDuration", "requestedDuration",
];

/** Result fields a member may see; `mediaId` / `editingProjectId` are upstream identifiers. */
const MEMBER_OUTPUT_KEYS: Array<keyof ResultMedia> = [
  "outputUrl", "outputLanguage", "label", "kind", "archivedFile", "archivedAt",
];

export type MemberJobView = Omit<StoredJob, "providerJobId" | "requestId" | "provider">;
export type JobView = MemberJobView | StoredJob;

/** Does the server worker have an upstream creation to follow for this job? (§20) */
export function jobTracked(job: StoredJob): boolean {
  return Boolean(job.providerJobId);
}

export function memberJobView<T extends StoredJob | null | undefined>(job: T, viewerIsAdmin = false): T {
  if (!job) return job;
  if (viewerIsAdmin) return { ...job, tracked: jobTracked(job) } as unknown as T;
  const safe: Record<string, unknown> = { ...job };
  delete safe.providerJobId;
  delete safe.requestId;
  delete safe.provider;
  return {
    ...safe,
    error: job.error ? publicErrorMessage(job.error) : job.error,
    details: memberDetails(job.details),
    outputs: (job.outputs || []).map(memberOutput),
    tracked: jobTracked(job),
  } as unknown as T;
}

export function memberJobListView(jobs: StoredJob[], viewerIsAdmin = false): JobView[] {
  return jobs.map(job => memberJobView(job, viewerIsAdmin));
}

/**
 * §21 business state for one creation. Members get the four business fields; admins also
 * keep `internalStatus` because 任务监管 (§31) has to show the raw enum next to it.
 */
export function businessView(job: StoredJob | null | undefined, viewerIsAdmin = false) {
  if (!job) return null;
  const business = businessJobStatus(job);
  if (viewerIsAdmin) return business;
  return { code: business.code, label: business.label, hint: business.hint, tone: business.tone };
}

function memberDetails(details: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!details || typeof details !== "object") return details;
  const safe: Record<string, unknown> = {};
  for (const key of MEMBER_DETAIL_KEYS) if (key in details) safe[key] = details[key];
  const duration = usageDurationSeconds(details.usage);
  if (duration !== null) safe.durationSeconds = duration;
  return safe;
}

/** The only piece of the raw usage payload a member ever needed: the finished length. */
function usageDurationSeconds(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const raw = usage as Record<string, unknown>;
  const value = Number(raw.output_video_duration ?? raw.video_duration ?? raw.videoDuration ?? raw.duration ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function memberOutput(output: ResultMedia): ResultMedia {
  const safe: ResultMedia = {};
  for (const key of MEMBER_OUTPUT_KEYS) {
    if (output?.[key] !== undefined) (safe as Record<string, unknown>)[key] = output[key];
  }
  return safe;
}
