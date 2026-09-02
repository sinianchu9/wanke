import { redirect } from "next/navigation";
import Studio from "@/components/studio";
import { getPageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await getPageUser();
  if (!user) redirect("/login?next=/studio");
  return <Studio />;
}
