import type { Metadata } from "next";
import AuthForm from "@/components/auth-form";
import { getFreePlan } from "@/lib/billing/catalog";
import { getBooleanSetting, getSetting } from "@/lib/system-settings";

export const metadata: Metadata = { title: "注册 · Wanke" };
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  const plan = getFreePlan();
  return <AuthForm
    mode="register"
    siteName={getSetting("site_name") || "Wanke"}
    freePlan={{ name: plan.name, credits: plan.credits, validityDays: plan.validityDays }}
    registrationEnabled={getBooleanSetting("registration_enabled")}
  />;
}
