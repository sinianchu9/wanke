import { NextResponse } from "next/server";
import { listActiveJobs, updateJobRemote } from "@/lib/repository";
import { refreshJob } from "@/lib/video/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const jobs = listActiveJobs(12);
  const results = await Promise.allSettled(jobs.map(async job => {
    const remote = await refreshJob(job);
    return updateJobRemote(job.id, remote);
  }));
  return NextResponse.json({
    refreshed: results.filter(r => r.status === "fulfilled").length,
    failed: results.filter(r => r.status === "rejected").length,
  });
}
