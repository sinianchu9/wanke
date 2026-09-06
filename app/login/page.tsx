import type { Metadata } from "next";
import AuthForm from "@/components/auth-form";
import { getFreePlan } from "@/lib/billing/catalog";
import { getBooleanSetting, getSetting } from "@/lib/system-settings";

export const metadata: Metadata = { title: "登录 · Wanke" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <AuthForm
    mode="login"
    siteName={getSetting("site_name") || "Wanke"}
    freePlan={freePlanCopy()}
    registrationEnabled={getBooleanSetting("registration_enabled")}
  />;
}

function freePlanCopy() {
  const plan = getFreePlan();
  return { name: plan.name, credits: plan.credits, validityDays: plan.validityDays };
}
