import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob, listJobs, updateJobRemote } from "@/lib/repository";
import { JOB_KINDS } from "@/lib/types";
import { submitJob } from "@/lib/yike/provider";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  kind: z.enum(JOB_KINDS),
  title: z.string().max(160).optional(),
  input: z.record(z.string(), z.unknown()),
  parentJobId: z.string().optional().nullable(),
});

export async function GET() {
  return NextResponse.json({ jobs: listJobs() });
}

export async function POST(request: Request) {
  let job: ReturnType<typeof createJob> | null = null;
  try {
    const payload = createSchema.parse(await request.json());
    job = createJob({ kind: payload.kind, title: payload.title, request: payload.input, parentJobId: payload.parentJobId });
    const submitted = await submitJob(payload.kind, payload.input);
    job = updateJobRemote(job.id, {
      providerJobId: submitted.providerJobId,
      status: submitted.initialStatus,
      provider: submitted.provider,
      requestId: submitted.requestId,
      error: null,
      details: submitted.details,
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    const message = errorMessage(error);
    if (job) updateJobRemote(job.id, { status: "failed", error: message });
    return NextResponse.json({ error: message, job: job ? updateJobRemote(job.id, {}) : null }, { status: 400 });
  }
}

function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) return (error as any).issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("；");
  return describeError(error);
}
