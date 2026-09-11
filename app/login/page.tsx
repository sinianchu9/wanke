import type { Metadata } from "next";
import AuthForm from "@/components/auth-form";
import { getFreePlan } from "@/lib/billing/catalog";
import { getBooleanSetting, getSetting } from "@/lib/system-settings";

export const metadata: Metadata = { title: "登录 · 好秀" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <AuthForm
    mode="login"
    siteName={getSetting("site_name")?.replace(/wanke/gi, "好秀") || "好秀"}
    freePlan={freePlanCopy()}
    registrationEnabled={getBooleanSetting("registration_enabled")}
  />;
}

function freePlanCopy() {
  const plan = getFreePlan();
  return { name: plan.name, credits: plan.credits, validityDays: plan.validityDays };
}
