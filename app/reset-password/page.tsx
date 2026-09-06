import type { Metadata } from "next";
import ResetPassword from "@/components/reset-password";

export const metadata: Metadata = { title: "找回密码 · Wanke" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

/** Without `token` this is the request form; with one it is the set-new-password form. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return <ResetPassword token={first(params.token).trim()} />;
}
