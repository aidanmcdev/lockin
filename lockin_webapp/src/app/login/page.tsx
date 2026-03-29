"use client";

import { useRouter } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { login } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();

  async function handleLogin(data: { email: string; password: string }) {
    await login(data.email, data.password);
    router.push("/dashboard");
  }

  return <AuthForm mode="login" onSubmit={handleLogin} />;
}
