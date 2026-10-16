"use client";

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { AssistantMarkdown } from "@/app/assistant-markdown";
import {
  ASSISTANT_MODEL_LABEL,
  getAssistantCredentialStatus,
  requestAssistantCompletion
} from "@/lib/assistant-client";
import { runAssistantTurn, type ProposalOutcome } from "@/lib/assistant-runner";
import {
  ASSISTANT_SETTINGS_EVENT,
  ASSISTANT_OPEN_EVENT,
  EMPTY_CONVERSATION,
  TASKS_CHANGED_EVENT,
  clearAssistantConversation,
  getAssistantEnabled,
  getThinkingEffort,
  loadAssistantConversation,
  saveAssistantConversation,
  startAssistantConversation,
  trimAssistantConversation,
  type AssistantConversation,
  type ChatEntry
} from "@/lib/assistant-storage";
import type { LocalTask } from "@/lib/local-app-state";
import { syncAllTaskReminders } from "@/lib/local-reminder-scheduler";
import { localTaskStore } from "@/lib/local-task-store";
import type { TaskProposal, ThinkingEffort } from "@/lib/task-assistant";
import { pickAssistantSuggestions } from "@/lib/assistant-suggestions";

type Review = {
  proposal: TaskProposal;
  resolve: (outcome: ProposalOutcome) => void;
};

export function TaskAssistant({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const visible = open && enabled && active;
  const [ready, setReady] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [effort, setEffort] = useState<ThinkingEffort>("high");
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const openingRef = useRef(false);
  const idleResolvers = useRef<Array<() => void>>([]);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const entriesRef = useRef<ChatEntry[]>([]);
  const conversationRef = useRef<AssistantConversation>({
    ...EMPTY_CONVERSATION
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<TaskProposal | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearRequested, setClearRequested] = useState(false);
  const busyRef = useRef(false);
  const confirmationLock = useRef(false);
  const reviewRef = useRef<Review | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resizeInput = useCallback(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "0px";
    const borderHeight = field.offsetHeight - field.clientHeight;
    field.style.height = `${field.scrollHeight + borderHeight}px`;
  }, []);
  useLayoutEffect(() => {
    resizeInput();
  }, [input, visible, resizeInput]);
  useEffect(() => {
    const field = inputRef.current;
    if (!visible || !field) return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth !== width) {
        width = field.clientWidth;
        resizeInput();
      }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [visible, resizeInput]);

  const updateEntries = useCallback(
    (update: (current: ChatEntry[]) => ChatEntry[]) => {
      entriesRef.current = update(entriesRef.current);
      setEntries(entriesRef.current);
    },
    []
  );

  useEffect(() => {
    let current = true;
    startAssistantConversation()
      .then((saved) => {
        if (current) {
          conversationRef.current = saved;
          updateEntries(() => saved.entries);
        }
      })
      .catch(() => {
        if (current)
          setError(
            "上次对话未能读取。任务数据没有改动，可以清空对话后重新开始。"
          );
      })
      .finally(() => {
        if (current) setReady(true);
      });
    return () => {
      current = false;
      controllerRef.current?.abort();
    };
  }, [updateEntries]);
  useEffect(() => {
    const handleOpen = (event: Event) => {
      const id = (event as CustomEvent<{ conversationId?: string }>).detail
        ?.conversationId;
      if (typeof id === "string") void openConversation(id);
    };
    window.addEventListener(ASSISTANT_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, handleOpen);
    // The listener uses refs for the current conversation and in-flight turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let current = true;
    const refresh = () => {
      Promise.all([
        getThinkingEffort(),
        getAssistantCredentialStatus(),
        getAssistantEnabled()
      ])
        .then(([value, credentials, isEnabled]) => {
          if (current) {
            setEffort(value);
            setHasKey(credentials.hasKey);
            setEnabled(isEnabled);
            if (!isEnabled) {
              setOpen(false);
              controllerRef.current?.abort();
            }
          }
        })
        .catch(() => {
          if (current) setError("助手设置未能读取，请在设置中检查 API 密钥。");
        });
    };
    refresh();
    window.addEventListener(ASSISTANT_SETTINGS_EVENT, refresh);
    return () => {
      current = false;
      window.removeEventListener(ASSISTANT_SETTINGS_EVENT, refresh);
    };
  }, []);

  const close = useCallback(() => {
    controllerRef.current?.abort();
    setOpen(false);
    setClearRequested(false);
    launcherRef.current?.focus();
  }, []);
  async function openConversation(id?: string) {
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      controllerRef.current?.abort();
      if (busyRef.current)
        await new Promise<void>((resolve) =>
          idleResolvers.current.push(resolve)
        );
      const record = id
        ? await loadAssistantConversation(id)
        : await startAssistantConversation();
      conversationRef.current = record;
      updateEntries(() => record.entries);
      setPending(null);
      setInput("");
      setError("");
      setClearRequested(false);
      setSuggestions((previous) => pickAssistantSuggestions(previous));
      setOpen(true);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "对话未能打开，请重试。"
      );
      setOpen(true);
    } finally {
      openingRef.current = false;
    }
  }
  useEffect(() => {
    if (!visible) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const resize = () =>
      dialogRef.current?.style.setProperty(
        "--assistant-viewport-height",
        `${window.visualViewport?.height ?? window.innerHeight}px`
      );
    resize();
    window.visualViewport?.addEventListener("resize", resize);
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key === "Tab" && dialogRef.current) {
        const buttons = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
          )
        );
        const first = buttons[0];
        const last = buttons.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialogRef.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener("keydown", keydown);
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    if (Capacitor.isNativePlatform()) {
      void App.addListener("backButton", close).then((listener) => {
        if (disposed) void listener.remove();
        else remove = () => listener.remove();
      });
    }
    return () => {
      disposed = true;
      void remove?.();
      window.removeEventListener("keydown", keydown);
      window.visualViewport?.removeEventListener("resize", resize);
      document.body.style.overflow = oldOverflow;
      previousFocus?.focus();
    };
  }, [visible, close]);
  useEffect(() => {
    if (visible)
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "instant"
      });
  }, [entries, status, visible]);

  function finishReview(outcome: ProposalOutcome) {
    const review = reviewRef.current;
    if (!review) return;
    reviewRef.current = null;
    setPending(null);
    updateEntries((current) =>
      current.map((entry) =>
        entry.proposal?.id === review.proposal.id
          ? { ...entry, outcome: outcome.status, detail: outcome.message }
          : entry
      )
    );
    review.resolve(outcome);
  }

  async function confirmProposal() {
    if (
      confirmationLock.current ||
      !reviewRef.current ||
      controllerRef.current?.signal.aborted
    )
      return;
    confirmationLock.current = true;
    setConfirming(true);
    const proposal = reviewRef.current.proposal;
    try {
      const task = await localTaskStore.confirmTaskProposal(proposal);
      window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
      let warning = "";
      try {
        const state = await localTaskStore.getState();
        warning =
          (await syncAllTaskReminders(state.tasks, state.settings)) ?? "";
      } catch {
        warning = "任务已保存，但提醒暂未更新。下次打开应用时会重试。";
      }
      finishReview({
        status: "confirmed",
        task,
        message: `已${operationLabel(proposal.operation)}。${warning}`
      });
    } catch (failure) {
      finishReview({
        status: "failed",
        message:
          failure instanceof Error
            ? failure.message
            : "操作未执行，请重新查询后再试。"
      });
    } finally {
      confirmationLock.current = false;
      setConfirming(false);
    }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || !ready || busyRef.current) return;
    if (content.length > 8000) {
      setError("这条消息太长了，请控制在 8000 字以内。");
      return;
    }
    if (!hasKey) {
      setError("还没有可用的 API 密钥，请在“设置 → 对话助手”中填写。");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setInput("");
    setError("");
    setClearRequested(false);
    const controller = new AbortController();
    controllerRef.current = controller;
    updateEntries((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: content }
    ]);
    const context = trimAssistantConversation(conversationRef.current).messages;
    const result = await runAssistantTurn(
      context,
      content,
      {
        complete: (messages) =>
          requestAssistantCompletion(messages, effort, controller.signal),
        getState: () => localTaskStore.getState(),
        onText: (text) =>
          updateEntries((current) => [
            ...current,
            { id: crypto.randomUUID(), role: "assistant", text }
          ]),
        onStatus: setStatus,
        review: (proposal) =>
          new Promise((resolve) => {
            if (controller.signal.aborted) {
              resolve({
                status: "cancelled",
                message: "已停止，操作没有执行。"
              });
              return;
            }
            updateEntries((current) => [
              ...current,
              { id: crypto.randomUUID(), role: "assistant", text: "", proposal }
            ]);
            setPending(proposal);
            const onAbort = () => {
              if (!confirmationLock.current)
                finishReview({
                  status: "cancelled",
                  message: "已停止，操作没有执行。"
                });
            };
            reviewRef.current = {
              proposal,
              resolve: (outcome) => {
                controller.signal.removeEventListener("abort", onAbort);
                resolve(outcome);
              }
            };
            controller.signal.addEventListener("abort", onAbort, {
              once: true
            });
          })
      },
      controller.signal
    );
    if (result.error)
      updateEntries((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "notice", text: result.error! }
      ]);
    const saved: AssistantConversation = {
      ...conversationRef.current,
      messages: [
        ...conversationRef.current.messages,
        ...result.messages.slice(context.length)
      ],
      entries: entriesRef.current
    };
    conversationRef.current = saved;
    updateEntries(() => saved.entries);
    try {
      conversationRef.current = await saveAssistantConversation(saved);
    } catch {
      setError("本次对话未能保存。已确认的任务操作不受影响。");
    }
    controllerRef.current = null;
    busyRef.current = false;
    setBusy(false);
    setStatus("");
    for (const resolve of idleResolvers.current.splice(0)) resolve();
  }

  async function clearHistory() {
    if (busyRef.current) return;
    try {
      conversationRef.current = await clearAssistantConversation(
        conversationRef.current.id
      );
      updateEntries(() => []);
      setClearRequested(false);
      setError("");
      setSuggestions((previous) => pickAssistantSuggestions(previous));
    } catch {
      setError("对话未能清空，请重试。任务数据没有改动。");
    }
  }

  if (!enabled || !active) return null;
  return (
    <>
      <button
        type="button"
        ref={launcherRef}
        className="assistant-launcher glass-panel flex h-12 items-center gap-2 rounded-full border border-[var(--border)] px-4 text-sm font-semibold text-[var(--foreground)] shadow-xl shadow-black/20 transition hover:border-[var(--primary)]"
        aria-label={
          pending ? "打开对话助手，有待确认的任务操作" : "打开对话助手"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!ready}
        onClick={() => void openConversation()}
      >
        <ChatIcon />
        {pending ? "待确认" : "聊聊任务"}
        {busy && !pending ? (
          <span className="size-1.5 rounded-full bg-[var(--success)]" />
        ) : null}
      </button>
      {visible
        ? createPortal(
            <div
              className="dialog-backdrop fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
              role="presentation"
            >
              <section
                className="assistant-panel dialog-panel glass-panel flex flex-col overflow-hidden border border-[var(--border)] shadow-[0_22px_60px_rgba(0,0,0,0.42)]"
                role="dialog"
                aria-modal="true"
                aria-labelledby="assistant-title"
                ref={dialogRef}
                tabIndex={-1}
              >
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
                  <div className="min-w-0">
                    <h2
                      id="assistant-title"
                      className="flex items-center gap-2 text-base font-semibold"
                    >
                      <ChatIcon />
                      聊聊任务
                    </h2>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      {ASSISTANT_MODEL_LABEL} ·{" "}
                      {effort === "off"
                        ? "思考已关闭"
                        : `${effort.toUpperCase()} 思考`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy || (!entries.length && !error)}
                      className="rounded-md px-2 py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:opacity-40"
                      onClick={() => setClearRequested((current) => !current)}
                    >
                      清空
                    </button>
                    <button
                      type="button"
                      aria-label="收起对话"
                      className="flex size-9 items-center justify-center rounded-md text-xl text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                      onClick={close}
                    >
                      ×
                    </button>
                  </div>
                </header>
                {clearRequested ? (
                  <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="leading-6">
                      只清空当前对话，不会删除任务。
                    </span>
                    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0">
                      <button
                        className="inline-flex h-10 min-w-0 items-center justify-center whitespace-nowrap rounded-md bg-rose-500 px-3 font-semibold text-white sm:min-w-24"
                        type="button"
                        onClick={() => setClearRequested(false)}
                      >
                        取消
                      </button>
                      <button
                        className="inline-flex h-10 min-w-0 items-center justify-center whitespace-nowrap rounded-md bg-[var(--success)] px-3 font-semibold text-white sm:min-w-24"
                        type="button"
                        onClick={() => void clearHistory()}
                      >
                        确认清空
                      </button>
                    </div>
                  </div>
                ) : null}
                <div
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5"
                  ref={scrollRef}
                >
                  {!entries.length ? (
                    <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4 pb-5">
                      <div>
                        <p className="text-xl font-semibold">
                          有什么要记下来？
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                          可以查任务、安排截止时间，也可以随便聊聊。增删改之前，我会把信息列给你确认。
                        </p>
                      </div>
                      <div className="flex flex-col gap-2">
                        {suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            disabled={!ready || busy}
                            className="rounded-lg border border-[var(--border)] bg-[var(--glass-panel-strong)] px-4 py-3 text-left text-sm transition hover:border-[var(--primary)]"
                            onClick={() => void send(suggestion)}
                          >
                            {suggestion}
                            <span
                              aria-hidden="true"
                              className="float-right text-[var(--muted-foreground)]"
                            >
                              ↗
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      className="flex flex-col gap-4"
                      role="log"
                      aria-label="对话记录"
                    >
                      {entries.map((entry) =>
                        entry.proposal ? (
                          <TaskProposalCard
                            key={entry.id}
                            entry={entry}
                            busy={confirming}
                            active={pending?.id === entry.proposal.id}
                            onConfirm={() => void confirmProposal()}
                            onCancel={() => {
                              if (!confirmationLock.current)
                                finishReview({
                                  status: "cancelled",
                                  message: "你取消了这个操作，任务没有改动。"
                                });
                            }}
                          />
                        ) : (
                          <div
                            key={entry.id}
                            className={`min-w-0 max-w-[94%] break-words rounded-xl px-4 py-3 text-sm leading-7 ${entry.role === "user" ? "self-end whitespace-pre-wrap bg-[var(--primary)] text-[var(--primary-foreground)]" : entry.role === "notice" ? "whitespace-pre-wrap border border-[var(--border)] text-[var(--muted-foreground)]" : "self-start border border-[var(--border)] bg-[var(--glass-panel-strong)]"}`}
                          >
                            {entry.role === "assistant" ? (
                              <AssistantMarkdown text={entry.text} />
                            ) : (
                              entry.text
                            )}
                          </div>
                        )
                      )}
                    </div>
                  )}
                  {busy ? (
                    <p
                      className="mt-4 text-xs text-[var(--muted-foreground)]"
                      role="status"
                    >
                      {status}
                    </p>
                  ) : null}
                </div>
                <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--glass-panel-strong)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
                  {error ? (
                    <p
                      role="alert"
                      className="mb-2 text-xs leading-5 text-[var(--error-text)]"
                    >
                      {error}
                    </p>
                  ) : null}
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void send(input);
                    }}
                  >
                    <textarea
                      ref={inputRef}
                      aria-label="给任务助手发消息"
                      className="h-12 max-h-32 min-h-12 min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]"
                      placeholder="说说你想做什么…"
                      rows={1}
                      maxLength={8000}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          (event.ctrlKey || event.metaKey) &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          void send(input);
                        }
                      }}
                    />
                    {busy ? (
                      <button
                        type="button"
                        aria-label="停止回答"
                        disabled={confirming}
                        className="h-12 shrink-0 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--danger)] disabled:opacity-50"
                        onClick={() => controllerRef.current?.abort()}
                      >
                        停止
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!ready || !input.trim()}
                        className="h-12 shrink-0 rounded-lg bg-[var(--success)] px-4 text-sm font-semibold text-white hover:bg-[var(--success-hover)] disabled:opacity-50"
                      >
                        发送
                      </button>
                    )}
                  </form>
                </footer>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function TaskProposalCard({
  entry,
  active,
  busy,
  onConfirm,
  onCancel
}: {
  entry: ChatEntry;
  active: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const proposal = entry.proposal!;
  const label = operationLabel(proposal.operation);
  return (
    <article
      className="rounded-xl border border-[var(--border)] bg-[var(--glass-panel-strong)] p-4"
      aria-label={`${label}任务确认`}
    >
      <h3 className="text-sm font-semibold">是否{label}这个任务？</h3>
      <div
        className={`mt-3 grid gap-3 ${proposal.operation === "update" ? "sm:grid-cols-2" : ""}`}
      >
        {proposal.before ? (
          <TaskPreview
            label={proposal.operation === "update" ? "修改前" : "将要删除"}
            task={proposal.before}
          />
        ) : null}
        {proposal.after ? (
          <TaskPreview
            label={proposal.operation === "update" ? "修改后" : "将要添加"}
            task={proposal.after}
          />
        ) : null}
      </div>
      {proposal.operation === "delete" ? (
        <p className="mt-3 text-xs text-[var(--danger)]">
          删除后无法直接撤销，请核对任务。
        </p>
      ) : null}
      {!entry.outcome && active ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-10 rounded-md bg-rose-500 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="h-10 rounded-md bg-[var(--success)] text-sm font-semibold text-white transition hover:bg-[var(--success-hover)] disabled:opacity-50"
          >
            {busy ? "正在保存…" : `确认${label}`}
          </button>
        </div>
      ) : (
        <p
          className={`mt-3 text-xs leading-5 ${entry.outcome === "confirmed" ? "text-[var(--success)]" : "text-[var(--muted-foreground)]"}`}
        >
          {entry.detail ?? "本次操作未执行。"}
        </p>
      )}
    </article>
  );
}
function TaskPreview({ label, task }: { label: string; task: LocalTask }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--field)] p-3 text-xs leading-6">
      <p className="mb-1 text-[var(--muted-foreground)]">{label}</p>
      <p className="break-words text-sm font-semibold">{task.title}</p>
      <dl className="mt-2 space-y-1">
        <div>
          <dt className="inline text-[var(--muted-foreground)]">描述：</dt>
          <dd className="inline whitespace-pre-wrap break-words">
            {task.description || "无"}
          </dd>
        </div>
        <div>
          <dt className="inline text-[var(--muted-foreground)]">截止：</dt>
          <dd className="inline">
            {task.dueAt
              ? new Date(task.dueAt).toLocaleString("zh-CN", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false
                })
              : "不设置"}
          </dd>
        </div>
        <div>
          <dt className="inline text-[var(--muted-foreground)]">状态：</dt>
          <dd className="inline">
            {task.status === "ACTIVE"
              ? "进行中"
              : task.status === "COMPLETED"
                ? "已完成"
                : "已归档"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
function operationLabel(operation: TaskProposal["operation"]) {
  return operation === "create"
    ? "添加"
    : operation === "update"
      ? "修改"
      : "删除";
}
function ChatIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M20 11.5a8 8 0 0 1-8 8H5l-4 3 1.8-6A8 8 0 1 1 20 11.5Z"
        transform="translate(1 -1) scale(.92)"
      />
      <path d="M7 9h10M7 13h6" />
    </svg>
  );
}
