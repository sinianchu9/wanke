import { NextResponse } from "next/server";
import { archiveJobOutput } from "@/lib/archive";
import { listActiveJobs, updateJobRemote } from "@/lib/repository";
import { refreshJob } from "@/lib/video/provider";
import type { ResultMedia, StoredJob } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const jobs = listActiveJobs(12);
  const refreshResults = await Promise.allSettled(jobs.map(async job => {
    const remote = await refreshJob(job);
    return updateJobRemote(job.id, remote);
  }));

  const updatedJobs = refreshResults
    .filter((result): result is PromiseFulfilledResult<StoredJob | null> => result.status === "fulfilled")
    .map(result => result.value)
    .filter((job): job is StoredJob => Boolean(job));

  const archiveCandidates = updatedJobs.filter(job => shouldAutoArchive(job));
  const archiveResults = await mapLimit(archiveCandidates, 2, async job => autoArchiveQuickResult(job));

  return NextResponse.json({
    refreshed: refreshResults.filter(result => result.status === "fulfilled").length,
    failed: refreshResults.filter(result => result.status === "rejected").length,
    autoArchived: archiveResults.filter(result => result.ok).length,
    archivePending: archiveResults.filter(result => !result.ok).length,
  });
}

function shouldAutoArchive(job: StoredJob) {
  if (job.status !== "succeeded") return false;
  if (!(job.request as any)?._quickCreation) return false;
  const index = firstVideoOutputIndex(job.outputs);
  return index >= 0 && !job.outputs[index]?.archivedFile;
}

async function autoArchiveQuickResult(job: StoredJob) {
  const index = firstVideoOutputIndex(job.outputs);
  if (index < 0) return { ok: false };
  try {
    const archived = await archiveJobOutput(job, index);
    const outputs = job.outputs.map((item, outputIndex) => outputIndex === index ? archived : item);
    updateJobRemote(job.id, {
      outputs,
      details: {
        ...(job.details || {}),
        quickArchive: "saved",
        quickArchiveError: null,
      },
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateJobRemote(job.id, {
      details: {
        ...(job.details || {}),
        quickArchive: "pending",
        quickArchiveError: message,
      },
    });
    return { ok: false };
  }
}

function firstVideoOutputIndex(outputs: ResultMedia[]) {
  const exact = outputs.findIndex(output => output.kind === "video");
  if (exact >= 0) return exact;
  return outputs.findIndex(output => /\.(mp4|mov|webm)(\?|$)/i.test(String(output.outputUrl || "")));
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  if (!items.length) return [] as R[];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function run() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}
