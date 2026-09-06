import type { Metadata } from "next";
import VerifyEmail from "@/components/verify-email";

export const metadata: Metadata = { title: "验证邮箱 · Wanke" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

/** Public landing for the verification mail: the token is the credential, no session needed. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return <VerifyEmail token={first(params.token).trim()} />;
}
