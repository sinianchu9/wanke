import type { Metadata } from "next";
import AuthForm from "@/components/auth-form";

export const metadata: Metadata = { title: "注册 · Wanke" };

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
