"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type RegisterResponse = {
  error?: string;
  issues?: Array<{
    message: string;
  }>;
};

export function RegisterForm() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, email, password })
      });
      const payload = (await response.json()) as RegisterResponse;

      if (!response.ok) {
        throw new Error(
          payload.issues?.[0]?.message || payload.error || "注册失败。"
        );
      }

      setIsRegistered(true);
    } catch (registerError) {
      setError(
        registerError instanceof Error ? registerError.message : "注册失败。"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isRegistered) {
    return (
      <div className="mt-8 rounded-md border border-[#4bae50]/40 bg-[#4bae50]/15 px-4 py-3 text-sm leading-6">
        <p className="font-semibold text-[#7ee084]">注册成功</p>
        <p className="mt-2 text-[var(--foreground)]">
          请检查邮箱并点击激活链接，激活后就可以登录使用。
        </p>
        <Link
          className="mt-4 inline-flex font-semibold text-[var(--primary)]"
          href="/login"
        >
          去登录
        </Link>
      </div>
    );
  }

  return (
    <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-2 text-sm font-medium">
        用户名
        <input
          autoComplete="username"
          className="h-11 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          onChange={(event) => setUsername(event.target.value)}
          required
          value={username}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        邮箱
        <input
          autoComplete="email"
          className="h-11 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        密码
        <input
          autoComplete="new-password"
          className="h-11 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <button
        className="h-11 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "注册中..." : "注册"}
      </button>
      <p className="text-sm text-[var(--muted-foreground)]">
        已有账号？{" "}
        <Link className="font-semibold text-[var(--primary)]" href="/login">
          登录
        </Link>
      </p>
    </form>
  );
}
