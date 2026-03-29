"use client";

import { useRouter } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { signup } from "@/lib/auth";

export default function SignupPage() {
  const router = useRouter();

  async function handleSignup(data: { name?: string; email: string; password: string }) {
    await signup(data.name || "", data.email, data.password);
    router.push("/dashboard");
  }

  return <AuthForm mode="signup" onSubmit={handleSignup} />;
}
