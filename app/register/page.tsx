import type { Metadata } from "next";
import AuthForm from "@/components/auth-form";
import { getFreePlan } from "@/lib/billing/catalog";
import { getBooleanSetting, getSetting } from "@/lib/system-settings";

export const metadata: Metadata = { title: "注册 · 好秀" };
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  const plan = getFreePlan();
  return <AuthForm
    mode="register"
    siteName={getSetting("site_name")?.replace(/wanke/gi, "好秀") || "好秀"}
    freePlan={{ name: plan.name, credits: plan.credits, validityDays: plan.validityDays }}
    registrationEnabled={getBooleanSetting("registration_enabled")}
  />;
}
