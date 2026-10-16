"use client";

import { useEffect, useRef, useState } from "react";
import {
  ASSISTANT_MODEL_LABEL,
  getAssistantCredentialStatus,
  nativeAssistantAvailable,
  setAssistantApiKey,
  type AssistantCredentialStatus
} from "@/lib/assistant-client";
import {
  ASSISTANT_SETTINGS_EVENT,
  getAssistantEnabled,
  getThinkingEffort,
  saveThinkingEffort,
  saveAssistantEnabled
} from "@/lib/assistant-storage";
import { exportLocalDataBackup } from "@/lib/data-backup";
import type { ThinkingEffort } from "@/lib/task-assistant";
import { AssistantHistory } from "./assistant-history";

const EFFORTS: { value: ThinkingEffort; label: string }[] = [
  { value: "off", label: "关闭" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" }
];

export function AssistantSettings() {
  const [enabled, setEnabled] = useState(false);
  const [effort, setEffort] = useState<ThinkingEffort>("high");
  const [credentials, setCredentials] =
    useState<AssistantCredentialStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    Promise.all([
      getThinkingEffort(),
      getAssistantCredentialStatus(),
      getAssistantEnabled()
    ])
      .then(([value, status, isEnabled]) => {
        if (current) {
          setEffort(value);
          setCredentials(status);
          setEnabled(isEnabled);
        }
      })
      .catch(() => {
        if (current) {
          setFailed(true);
          setMessage("助手设置未能读取，请重试。");
        }
      });
    return () => {
      current = false;
    };
  }, []);
  async function perform(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await action();
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "设置未能保存，请重试。"
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="glass-panel rounded-xl border border-[var(--border)] p-5 shadow-2xl shadow-black/20 sm:p-7"
      aria-labelledby="assistant-settings-title"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="assistant-settings-title" className="text-lg font-semibold">
          对话助手
        </h2>
        <button
          type="button"
          role="switch"
          aria-label="启用对话助手"
          aria-checked={enabled}
          disabled={busy || credentials === null}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition disabled:opacity-60 ${enabled ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--border)] bg-[var(--muted)]"}`}
          onClick={() =>
            void perform(async () => {
              await saveAssistantEnabled(!enabled);
              setEnabled(!enabled);
            })
          }
        >
          <span
            className={`absolute left-1 top-1/2 size-5 -translate-y-1/2 rounded-full bg-[var(--background)] transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </div>
      <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
        默认关闭。开启后，只在“查看任务”主界面右下角显示“聊聊任务”，不会出现在日历、添加任务或设置页。
      </p>
      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
        使用 {ASSISTANT_MODEL_LABEL}{" "}
        聊天或查询任务。新增、修改、删除和标记完成都会先展示确认卡片；修改会列出前后内容，点绿色确认才执行，红色取消不会改动任务。
      </p>
      <fieldset className="mt-5" disabled={busy}>
        <legend className="mb-2 text-sm font-semibold">思考强度</legend>
        <div className="grid grid-cols-4 gap-2">
          {EFFORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={effort === option.value}
              className={`h-10 rounded-md border text-sm font-semibold transition disabled:opacity-60 ${effort === option.value ? "border-[var(--primary)] bg-[var(--active-surface)] text-[var(--primary)]" : "border-[var(--border)] bg-[var(--field)] text-[var(--muted-foreground)]"}`}
              onClick={() =>
                void perform(async () => {
                  await saveThinkingEffort(option.value);
                  setEffort(option.value);
                })
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
          默认 High。强度越高，通常等待越久；修改后从下一条消息生效。
        </p>
      </fieldset>
      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <label htmlFor="assistant-api-key" className="text-sm font-semibold">
          DeepSeek API 密钥
        </label>
        <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
          {credentials?.usingCustomKey
            ? "正在使用你填写的密钥。"
            : credentials?.hasPreset
              ? "当前为私用构建，已预置密钥。"
              : "公开版不带密钥，填写后即可使用。"}{" "}
          密钥仅保存在本机，不会随备份导出。
        </p>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (key.trim())
              void perform(async () => {
                setCredentials(await setAssistantApiKey(key));
                setKey("");
                setMessage("API 密钥已保存。");
                window.dispatchEvent(new Event(ASSISTANT_SETTINGS_EVENT));
              });
          }}
        >
          <input
            id="assistant-api-key"
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={
              credentials?.hasKey ? "输入新密钥可替换当前密钥" : "sk-…"
            }
            value={key}
            disabled={busy || !nativeAssistantAvailable()}
            onChange={(event) => setKey(event.target.value)}
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--success)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy || !key.trim() || !nativeAssistantAvailable()}
          >
            保存密钥
          </button>
        </form>
        {credentials?.usingCustomKey ? (
          <button
            type="button"
            className="mt-3 text-xs font-medium text-[var(--danger)] underline underline-offset-4 disabled:opacity-50"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                setCredentials(await setAssistantApiKey(""));
                setKey("");
                setMessage(
                  credentials.hasPreset
                    ? "已恢复使用私用预置密钥。"
                    : "已移除本机密钥。"
                );
                window.dispatchEvent(new Event(ASSISTANT_SETTINGS_EVENT));
              })
            }
          >
            {credentials.hasPreset ? "恢复预置密钥" : "移除本机密钥"}
          </button>
        ) : null}
      </div>
      <p className="mt-4 text-xs leading-5 text-[var(--muted-foreground)]">
        仅在你发消息后联网。聊天内容及助手按需查询的任务会发送至
        DeepSeek；壁纸、备份文件和 API 密钥不会作为聊天内容发送。
      </p>
      <AssistantHistory />
      {message ? (
        <p
          role={failed ? "alert" : "status"}
          className={`mt-3 text-sm ${failed ? "text-[var(--error-text)]" : "text-[var(--success)]"}`}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}

export function BackupSettings() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function exportBackup() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await exportLocalDataBackup();
      setMessage(
        result.cancelled
          ? "已取消导出，原数据没有改动。"
          : "备份已保存。请妥善保管，它包含你的任务和对话内容。"
      );
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "备份导出失败，原数据没有改动。"
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="glass-panel rounded-xl border border-[var(--border)] p-5 shadow-2xl shadow-black/20 sm:p-7"
      aria-labelledby="backup-settings-title"
    >
      <h2 id="backup-settings-title" className="text-lg font-semibold">
        数据备份
      </h2>
      <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
        导出任务、提醒设置、主题、壁纸和已保存的对话。不包含 API
        密钥，也不会修改或清空现有数据。
      </p>
      <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
        保存为带校验和的 ZIP
        文件，由你选择位置。目前提供导出，暂未提供一键导入。
      </p>
      <button
        type="button"
        onClick={() => void exportBackup()}
        disabled={busy}
        className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-[var(--success)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--success-hover)] disabled:opacity-60"
      >
        {busy ? "正在导出…" : "导出备份"}
      </button>
      {message ? (
        <p
          className={`mt-3 text-sm leading-6 ${failed ? "text-[var(--error-text)]" : "text-[var(--muted-foreground)]"}`}
          role={failed ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
