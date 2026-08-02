"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth-error-messages";

type LoginResponse = {
  error?: string;
  issues?: Array<{
    message: string;
  }>;
};

export function LoginForm() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const validationMessage = validateLoginForm(identifier, password);

    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ identifier, password })
      });
      const payload = (await response.json()) as LoginResponse;

      if (!response.ok) {
        throw new Error(
          payload.issues?.[0]?.message || payload.error || "登录失败。"
        );
      }

      window.location.href = "/";
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败。");
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="mt-6 flex flex-col gap-4"
      noValidate
      onSubmit={handleSubmit}
    >
      <label className="flex flex-col gap-2 text-sm font-medium">
        邮箱或用户名
        <input
          autoComplete="username"
          className="h-11 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
          onChange={(event) => setIdentifier(event.target.value)}
          required
          value={identifier}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        密码
        <input
          autoComplete="current-password"
          className="h-11 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
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
        {isSubmitting ? "登录中..." : "登录"}
      </button>
      <p className="text-sm text-[var(--muted-foreground)]">
        还没有账号？{" "}
        <Link className="font-semibold text-[var(--primary)]" href="/register">
          注册
        </Link>
      </p>
    </form>
  );
}

function validateLoginForm(identifier: string, password: string) {
  if (identifier.trim().length === 0) {
    return AUTH_ERROR_MESSAGES.identifierRequired;
  }

  if (password.length === 0) {
    return AUTH_ERROR_MESSAGES.passwordRequired;
  }

  return "";
}
