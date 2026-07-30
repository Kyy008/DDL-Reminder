import Link from "next/link";
import { activateEmailVerificationToken } from "@/lib/account-activation";

type ActivatePageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

const RESULT_COPY = {
  activated: {
    title: "账号已激活",
    body: "现在可以登录并开始管理你的 DDL。"
  },
  "already-used": {
    title: "链接已经使用过",
    body: "如果账号已经激活，可以直接登录。"
  },
  expired: {
    title: "激活链接已过期",
    body: "请重新注册，或之后使用重发激活邮件功能。"
  },
  invalid: {
    title: "激活链接无效",
    body: "请确认邮件中的链接是否完整。"
  }
} as const;

export default async function ActivatePage({
  searchParams
}: ActivatePageProps) {
  const params = await searchParams;
  const result = await activateEmailVerificationToken(params.token ?? "");
  const copy = RESULT_COPY[result];

  return (
    <main className="grid min-h-[calc(100vh-4rem)] place-items-center px-5 py-8 sm:px-6 lg:px-8">
      <section className="auth-glass-panel dialog-panel w-full max-w-md rounded-lg border border-[var(--border)] p-6 shadow-[0_20px_70px_rgba(0,0,0,0.36)]">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
          {copy.body}
        </p>
        <Link
          className="mt-8 inline-flex h-11 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)]"
          href="/login"
        >
          去登录
        </Link>
      </section>
    </main>
  );
}
