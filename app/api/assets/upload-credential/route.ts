import { NextResponse } from "next/server";
import { z } from "zod";
import { createUploadCredential } from "@/lib/yike/provider";
import { describeError } from "@/lib/errors";

export const runtime = "nodejs";

const schema = z.object({ fileExt: z.string().min(1).max(12), fileType: z.string().max(64).optional() });

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const credential = await createUploadCredential(input.fileExt, input.fileType);
    return NextResponse.json(credential);
  } catch (error) {
    return NextResponse.json({ error: describeError(error) }, { status: 400 });
  }
}
