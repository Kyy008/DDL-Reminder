import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth-session";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const session = await getCurrentSession();

  if (session) {
    redirect("/");
  }

  return (
    <main className="grid min-h-[calc(100vh-4rem)] place-items-center px-5 py-8 sm:px-6 lg:px-8">
      <section className="auth-glass-panel dialog-panel w-full max-w-md rounded-lg border border-[var(--border)] p-6 shadow-[0_20px_70px_rgba(0,0,0,0.36)]">
        <h1 className="text-3xl font-bold">注册</h1>
        <RegisterForm />
      </section>
    </main>
  );
}
