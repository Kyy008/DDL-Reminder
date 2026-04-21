import Image from "next/image";
import Link from "next/link";
import { getCurrentSession } from "@/lib/auth-session";
import brandIcon from "../../assets/icon/tubiao.png";
import { LogoutButton } from "./logout-button";

export async function TopNav() {
  const session = await getCurrentSession();

  return (
    <nav className="fixed inset-x-0 top-0 z-30 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
      <div className="flex h-16 items-center justify-between px-5 sm:px-6 lg:px-8">
        <Link
          className="flex items-center gap-2 text-lg font-bold tracking-normal text-[var(--foreground)]"
          href="/"
        >
          <Image
            alt=""
            aria-hidden="true"
            className="size-8 shrink-0"
            priority
            src={brandIcon}
          />
          DDL-Reminder
        </Link>

        <div className="flex items-center gap-3">
          {session ? (
            <>
              <span className="hidden text-sm font-medium text-[var(--muted-foreground)] sm:inline">
                {session.user.username}
              </span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link
                className="rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-2 text-sm font-semibold text-[var(--foreground)]"
                href="/login"
              >
                登录
              </Link>
              <Link
                className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
                href="/register"
              >
                注册
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
