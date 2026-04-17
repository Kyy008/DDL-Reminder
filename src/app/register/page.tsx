import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth-session";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const session = await getCurrentSession();

  if (session) {
    redirect("/");
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] px-5 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-md rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6">
        <h1 className="text-3xl font-bold">注册</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
          绑定邮箱后，DDL 提醒会发送到这个地址。
        </p>
        <RegisterForm />
      </section>
    </main>
  );
}
