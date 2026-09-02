import { redirect } from "next/navigation";
import AdminConsole from "@/components/admin-console";
import { getPageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getPageUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") redirect("/studio");
  return <AdminConsole />;
}
