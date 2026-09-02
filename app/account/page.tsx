import { redirect } from "next/navigation";
import AccountCenter from "@/components/account-center";
import { getPageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getPageUser();
  if (!user) redirect("/login?next=/account");
  return <AccountCenter />;
}
