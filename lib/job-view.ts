import "server-only";
import { publicErrorMessage } from "@/lib/copy";
import type { StoredJob } from "@/lib/types";

/**
 * Member-facing job payloads (§47 log layering).
 *
 * The stored record keeps the full technical truth for the backoffice and the worker:
 * raw upstream response, upstream task id, original error text. A member's browser only
 * receives the business error message, so no interface can render provider detail by
 * accident. Admins keep the raw record because §31 requires it for operations.
 */
export function memberJobView<T extends StoredJob | null | undefined>(job: T, viewerIsAdmin = false): T {
  if (!job || viewerIsAdmin) return job;
  return {
    ...job,
    error: job.error ? publicErrorMessage(job.error) : job.error,
    provider: null,
  };
}

export function memberJobListView(jobs: StoredJob[], viewerIsAdmin = false): StoredJob[] {
  return viewerIsAdmin ? jobs : jobs.map(job => memberJobView(job));
}
