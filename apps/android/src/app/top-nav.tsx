"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { applyNativeSystemBars } from "@/lib/system-bars";
import brandIcon from "../../assets/icon/tubiao.png";

type ThemeMode = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "ddl-reminder:theme-mode";
const THEME_CHANGE_EVENT = "ddl-reminder:theme-change";
let fallbackThemeMode: ThemeMode = "dark";
const THEME_MODES: Array<{
  icon: "dark" | "light" | "system";
  label: string;
  value: ThemeMode;
}> = [
  {
    icon: "system",
    label: "跟随系统",
    value: "system"
  },
  {
    icon: "light",
    label: "浅色模式",
    value: "light"
  },
  {
    icon: "dark",
    label: "深色模式",
    value: "dark"
  }
];

export function TopNav() {
  const themeMode = useSyncExternalStore<ThemeMode>(
    subscribeThemeMode,
    getThemeModeSnapshot,
    () => "dark"
  );

  useEffect(() => {
    applyThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (themeMode !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyThemeMode("system");

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [themeMode]);

  return (
    <nav className="fixed inset-x-0 top-0 z-30 border-b border-[var(--border)] bg-[var(--nav-background)] backdrop-blur-xl">
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

        <div className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--glass-panel-strong)] p-1 backdrop-blur">
          {THEME_MODES.map((mode) => {
            const isActive = mode.value === themeMode;

            return (
              <button
                aria-label={mode.label}
                aria-pressed={isActive}
                className={`inline-flex size-8 items-center justify-center rounded text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] ${
                  isActive
                    ? "bg-[var(--active-surface)] text-[var(--foreground)]"
                    : ""
                }`}
                key={mode.value}
                onClick={() => setStoredThemeMode(mode.value)}
                title={mode.label}
                type="button"
              >
                <ThemeIcon name={mode.icon} />
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function subscribeThemeMode(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
  };
}

function getThemeModeSnapshot(): ThemeMode {
  try {
    const storedThemeMode = window.localStorage.getItem(THEME_STORAGE_KEY);

    return storedThemeMode === "light" ||
      storedThemeMode === "dark" ||
      storedThemeMode === "system"
      ? storedThemeMode
      : fallbackThemeMode;
  } catch {
    return fallbackThemeMode;
  }
}

function setStoredThemeMode(themeMode: ThemeMode) {
  fallbackThemeMode = themeMode;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  } catch {}

  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function ThemeIcon({ name }: { name: "dark" | "light" | "system" }) {
  const commonProps = {
    "aria-hidden": true,
    className: "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: "2",
    viewBox: "0 0 24 24"
  };

  if (name === "light") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    );
  }

  if (name === "dark") {
    return (
      <svg {...commonProps}>
        <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <rect height="12" rx="2" width="18" x="3" y="4" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
    </svg>
  );
}

function applyThemeMode(themeMode: ThemeMode) {
  const root = document.documentElement;

  if (themeMode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.dataset.theme = themeMode;
  }

  const effectiveTheme =
    themeMode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : themeMode;

  root.style.colorScheme = effectiveTheme;
  applyNativeSystemBars(effectiveTheme);

  const themeColor =
    getComputedStyle(root).getPropertyValue("--background").trim() ||
    (effectiveTheme === "dark" ? "#0c0d0b" : "#f7faf4");

  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((themeColorMeta) => {
      themeColorMeta.setAttribute("content", themeColor);
    });
}
