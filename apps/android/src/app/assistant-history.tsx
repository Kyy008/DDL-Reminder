"use client";

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ASSISTANT_HISTORY_EVENT,
  ASSISTANT_OPEN_EVENT,
  deleteAssistantConversation,
  listAssistantConversations,
  saveAssistantEnabled,
  type ConversationRecord
} from "@/lib/assistant-storage";

export function AssistantHistory() {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<ConversationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteRequested, setDeleteRequested] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteLock = useRef(false);
  const deleteTargetRef = useRef<string | null>(null);
  const deleteDialogRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const requestDelete = useCallback((id: string | null) => {
    deleteTargetRef.current = id;
    setDeleteRequested(id);
    setDeleteError("");
  }, []);
  useEffect(() => {
    if (!open) return;
    let current = true;
    const refresh = () => {
      setLoading(true);
      listAssistantConversations()
        .then((history) => {
          if (current) {
            setRecords(history);
            setError("");
          }
        })
        .catch((failure: unknown) => {
          if (current)
            setError(
              failure instanceof Error
                ? failure.message
                : "历史对话未能读取，请重试。"
            );
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    };
    refresh();
    window.addEventListener(ASSISTANT_HISTORY_EVENT, refresh);
    return () => {
      current = false;
      window.removeEventListener(ASSISTANT_HISTORY_EVENT, refresh);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    const opener = buttonRef.current;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const close = () => {
      if (deleteTargetRef.current) {
        if (!deleteLock.current) requestDelete(null);
      } else setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      const activeDialog = deleteTargetRef.current
        ? deleteDialogRef.current
        : dialogRef.current;
      if (event.key === "Tab" && activeDialog) {
        const focusable = Array.from(
          activeDialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [tabindex="0"]'
          )
        );
        const first = focusable[0],
          last = focusable.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === activeDialog)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", keydown);
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    if (Capacitor.isNativePlatform())
      void App.addListener("backButton", close).then((listener) => {
        if (disposed) void listener.remove();
        else remove = () => listener.remove();
      });
    return () => {
      disposed = true;
      void remove?.();
      window.removeEventListener("keydown", keydown);
      document.body.style.overflow = oldOverflow;
      opener?.focus();
    };
  }, [open, requestDelete]);
  useEffect(() => {
    if (!deleteRequested) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const historyDialog = dialogRef.current;
    deleteDialogRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
      else historyDialog?.focus();
    };
  }, [deleteRequested]);
  async function continueConversation(id: string) {
    if (deleteLock.current) return;
    try {
      // This explicit action also opts in if the assistant switch is off.
      await saveAssistantEnabled(true);
      window.dispatchEvent(
        new CustomEvent(ASSISTANT_OPEN_EVENT, {
          detail: { conversationId: id }
        })
      );
      setOpen(false);
    } catch {
      setError("对话未能打开，请稍后重试。");
    }
  }
  async function deleteConversation(id: string) {
    if (deleteLock.current || deleteRequested !== id) return;
    deleteLock.current = true;
    setDeleting(true);
    try {
      await deleteAssistantConversation(id);
      setRecords((current) => current.filter((record) => record.id !== id));
      requestDelete(null);
      setError("");
    } catch {
      setDeleteError("对话未能删除，请重试。任务数据没有改动。");
    } finally {
      deleteLock.current = false;
      setDeleting(false);
    }
  }
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <div>
          <h3 className="text-sm font-semibold">历史对话</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            记录只保存在本机。可查看以前的聊天，点“继续聊”会开启助手并回到主界面恢复对话。
          </p>
        </div>
        <button
          ref={buttonRef}
          type="button"
          className="h-10 shrink-0 rounded-md border border-[var(--border)] bg-[var(--field)] px-4 text-sm font-semibold transition hover:border-[var(--primary)]"
          onClick={() => {
            requestDelete(null);
            setOpen(true);
          }}
        >
          查看历史对话
        </button>
      </div>
      {open
        ? createPortal(
            <div
              className="dialog-backdrop fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) setOpen(false);
              }}
            >
              <section
                ref={dialogRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-hidden={deleteRequested ? true : undefined}
                inert={Boolean(deleteRequested)}
                aria-labelledby="assistant-history-title"
                className="dialog-panel glass-panel flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border)] shadow-2xl outline-none"
              >
                <header className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
                  <h2
                    id="assistant-history-title"
                    className="text-lg font-semibold"
                  >
                    历史对话
                  </h2>
                  <button
                    type="button"
                    aria-label="关闭历史对话"
                    className="flex size-9 items-center justify-center rounded-md text-xl text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                    onClick={() => setOpen(false)}
                  >
                    ×
                  </button>
                </header>
                <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
                  {error ? (
                    <p
                      role="alert"
                      className="mb-3 text-sm text-[var(--error-text)]"
                    >
                      {error}
                    </p>
                  ) : null}
                  {loading ? (
                    <p
                      className="p-4 text-sm text-[var(--muted-foreground)]"
                      role="status"
                    >
                      正在读取…
                    </p>
                  ) : null}
                  {!loading && !records.length && !error ? (
                    <p className="p-4 text-sm text-[var(--muted-foreground)]">
                      还没有历史对话，聊过之后会保存在这里。
                    </p>
                  ) : null}
                  <div className="flex flex-col gap-3">
                    {records.map((record) => (
                      <article
                        key={record.id}
                        className="rounded-lg border border-[var(--border)] bg-[var(--glass-panel-strong)] p-4"
                      >
                        <h3 className="break-words text-sm font-semibold">
                          {record.title}
                        </h3>
                        <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-6 text-[var(--muted-foreground)]">
                          {record.entries.filter((entry) => entry.text).at(-1)
                            ?.text || "任务操作记录"}
                        </p>
                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <time
                            dateTime={record.updatedAt}
                            className="text-xs text-[var(--muted-foreground)]"
                          >
                            {new Date(record.updatedAt).toLocaleString(
                              "zh-CN",
                              {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false
                              }
                            )}
                          </time>
                          <div className="grid grid-cols-2 gap-2 sm:shrink-0">
                            <button
                              type="button"
                              disabled={deleting}
                              className="inline-flex h-9 min-w-0 items-center justify-center whitespace-nowrap rounded-md border border-[var(--error-border)] px-4 text-sm font-semibold text-[var(--danger)] transition hover:bg-[var(--error-bg)] disabled:opacity-50"
                              onClick={() => requestDelete(record.id)}
                            >
                              删除
                            </button>
                            <button
                              type="button"
                              disabled={deleting}
                              className="inline-flex h-9 min-w-0 items-center justify-center whitespace-nowrap rounded-md bg-[var(--success)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--success-hover)] disabled:opacity-50"
                              onClick={() =>
                                void continueConversation(record.id)
                              }
                            >
                              继续聊
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
      {open && deleteRequested
        ? createPortal(
            <div
              className="dialog-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target && !deleteLock.current)
                  requestDelete(null);
              }}
            >
              <section
                ref={deleteDialogRef}
                tabIndex={-1}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="assistant-delete-title"
                aria-describedby="assistant-delete-description"
                className="dialog-panel glass-panel max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-xl border border-[var(--border)] p-5 shadow-2xl outline-none"
              >
                <h2
                  id="assistant-delete-title"
                  className="text-base font-semibold"
                >
                  删除这条对话？
                </h2>
                <p className="mt-3 line-clamp-2 break-words text-sm leading-6">
                  {
                    records.find((record) => record.id === deleteRequested)
                      ?.title
                  }
                </p>
                <p
                  id="assistant-delete-description"
                  className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]"
                >
                  删除后无法恢复，不会影响任务或其他对话。
                </p>
                {deleteError ? (
                  <p
                    role="alert"
                    className="mt-3 text-sm text-[var(--error-text)]"
                  >
                    {deleteError}
                  </p>
                ) : null}
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => requestDelete(null)}
                    className="inline-flex h-10 min-w-0 items-center justify-center whitespace-nowrap rounded-md bg-rose-500 px-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => void deleteConversation(deleteRequested)}
                    className="inline-flex h-10 min-w-0 items-center justify-center whitespace-nowrap rounded-md bg-[var(--success)] px-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {deleting ? "正在删除…" : "确认删除"}
                  </button>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
