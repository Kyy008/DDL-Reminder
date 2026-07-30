"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DeadlineStatus } from "@/lib/deadline";

const HOUR_MS = 60 * 60 * 1000;
const TIMELINE_HALF_HOURS = 72;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const MONTH_SLIDE_DURATION_MS = 460;

type MonthTransition = {
  direction: -1 | 1;
  key: number;
  target: Date;
};

const STATUS_META: Record<
  DeadlineStatus,
  {
    color: string;
    label: string;
  }
> = {
  normal: { color: "#57bfda", label: "进行中" },
  approaching: { color: "#f5c84c", label: "临近" },
  urgent: { color: "#ff3325", label: "紧急" },
  overdue: { color: "#ff3325", label: "已逾期" },
  completed: { color: "#67b45b", label: "已完成" },
  archived: { color: "#8d9488", label: "已归档" }
};

export type CalendarTask = {
  id: string;
  title: string;
  status: string;
  startDate: Date | null;
  dueDate: Date | null;
  deadlineStatus: DeadlineStatus;
  hasDeadline: boolean;
};

export default function CalendarView({ tasks }: { tasks: CalendarTask[] }) {
  const [now, setNow] = useState(() => new Date());
  const [centerMonth, setCenterMonth] = useState(() => {
    const currentDate = new Date();
    return new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  });
  const centerMonthRef = useRef(centerMonth);
  const [monthTransition, setMonthTransition] =
    useState<MonthTransition | null>(null);
  const monthTransitionRef = useRef<MonthTransition | null>(null);
  const queuedMonthRef = useRef<Date | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const resumeFrameRef = useRef<number | null>(null);
  const transitionKeyRef = useRef(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }

      if (resumeFrameRef.current !== null) {
        window.cancelAnimationFrame(resumeFrameRef.current);
      }
    },
    []
  );

  const tasksByDay = useMemo(() => {
    const groupedTasks = new Map<string, CalendarTask[]>();

    for (const task of tasks) {
      if (!task.hasDeadline || !task.dueDate) {
        continue;
      }

      const key = getDateKey(task.dueDate);
      const tasksForDay = groupedTasks.get(key) ?? [];
      tasksForDay.push(task);
      groupedTasks.set(key, tasksForDay);
    }

    return groupedTasks;
  }, [tasks]);

  const selectedTasks = useMemo(() => {
    if (!selectedDay) {
      return [];
    }

    return [...(tasksByDay.get(selectedDay) ?? [])].sort(
      (left, right) =>
        (left.dueDate?.getTime() ?? 0) - (right.dueDate?.getTime() ?? 0)
    );
  }, [selectedDay, tasksByDay]);

  function commitMonth(month: Date) {
    centerMonthRef.current = month;
    setCenterMonth(month);
  }

  function startMonthTransition(targetMonth: Date) {
    const target = new Date(
      targetMonth.getFullYear(),
      targetMonth.getMonth(),
      1
    );
    const current = centerMonthRef.current;

    if (isSameMonth(current, target)) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      commitMonth(target);
      return;
    }

    const transition: MonthTransition = {
      direction: target.getTime() > current.getTime() ? 1 : -1,
      key: transitionKeyRef.current + 1,
      target
    };
    transitionKeyRef.current = transition.key;
    monthTransitionRef.current = transition;
    setMonthTransition(transition);
    transitionTimerRef.current = window.setTimeout(
      () => finishMonthTransition(transition.key),
      MONTH_SLIDE_DURATION_MS + 120
    );
  }

  function finishMonthTransition(transitionKey: number) {
    const completedTransition = monthTransitionRef.current;

    if (
      !completedTransition ||
      completedTransition.key !== transitionKey
    ) {
      return;
    }

    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }

    monthTransitionRef.current = null;
    commitMonth(completedTransition.target);
    setMonthTransition(null);

    const queuedMonth = queuedMonthRef.current;
    queuedMonthRef.current = null;

    if (queuedMonth && !isSameMonth(queuedMonth, completedTransition.target)) {
      resumeFrameRef.current = window.requestAnimationFrame(() => {
        resumeFrameRef.current = null;
        startMonthTransition(queuedMonth);
      });
    }
  }

  function navigateToMonth(targetMonth: Date) {
    const target = new Date(
      targetMonth.getFullYear(),
      targetMonth.getMonth(),
      1
    );

    if (monthTransitionRef.current) {
      queuedMonthRef.current = target;
      return;
    }

    startMonthTransition(target);
  }

  function moveMonth(offset: number) {
    const baseMonth =
      queuedMonthRef.current ??
      monthTransitionRef.current?.target ??
      centerMonthRef.current;
    navigateToMonth(addMonths(baseMonth, offset));
  }

  const slideMonths = monthTransition
    ? monthTransition.direction === 1
      ? [
          addMonths(centerMonth, -2),
          addMonths(centerMonth, -1),
          centerMonth,
          monthTransition.target,
          addMonths(monthTransition.target, 1)
        ]
      : [
          addMonths(monthTransition.target, -1),
          monthTransition.target,
          centerMonth,
          addMonths(centerMonth, 1),
          addMonths(centerMonth, 2)
        ]
    : [-2, -1, 0, 1, 2].map((offset) =>
        addMonths(centerMonth, offset)
      );
  const activeSlideIndex = monthTransition
    ? monthTransition.direction === 1
      ? 3
      : 1
    : 2;

  return (
    <section className="task-list-enter flex flex-col gap-6">
      <section className="glass-panel rounded-xl border border-[var(--border)] p-4 shadow-2xl shadow-black/20 sm:p-6">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">任务日历</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              按截止日期查看任务，点击日期可查看当天安排。
            </p>
          </div>
          <YearMonthPicker
            month={centerMonth}
            onChange={(year, month) =>
              navigateToMonth(new Date(year, month, 1))
            }
          />
        </div>

        <div
          aria-label="月份日历轮播"
          className="calendar-month-carousel"
          role="region"
        >
          <div
            className="calendar-month-carousel-track"
            data-direction={
              monthTransition
                ? monthTransition.direction === 1
                  ? "forward"
                  : "backward"
                : "idle"
            }
            data-transitioning={monthTransition ? "true" : "false"}
            onTransitionEnd={(event) => {
              if (
                event.currentTarget === event.target &&
                event.propertyName === "transform" &&
                monthTransition
              ) {
                finishMonthTransition(monthTransition.key);
              }
            }}
          >
            {slideMonths.map((month, index) => {
              const isActive = index === activeSlideIndex;
              const isNeighbor =
                Math.abs(index - activeSlideIndex) === 1;

              return (
                <div
                  className="calendar-month-carousel-slide"
                  data-position={
                    isActive
                      ? "active"
                      : index < activeSlideIndex
                        ? "left"
                        : "right"
                  }
                  key={`${month.getFullYear()}-${month.getMonth()}`}
                >
                  <MonthCard
                    isActive={isActive}
                    month={month}
                    onSelectDay={setSelectedDay}
                    selectedDay={selectedDay}
                    tasksByDay={tasksByDay}
                    today={now}
                  />
                  {!monthTransition && isNeighbor ? (
                    <button
                      aria-label={`切换到${formatYearMonth(month)}`}
                      className="calendar-month-preview-button"
                      onClick={() => navigateToMonth(month)}
                      type="button"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-4">
          <button
            aria-label="上一个月"
            className="inline-flex size-10 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] text-xl transition hover:border-[var(--primary)] hover:bg-[var(--muted)] active:translate-y-px"
            onClick={() => moveMonth(-1)}
            type="button"
          >
            ‹
          </button>
          <strong className="min-w-32 text-center">
            {formatYearMonth(centerMonth)}
          </strong>
          <button
            aria-label="下一个月"
            className="inline-flex size-10 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] text-xl transition hover:border-[var(--primary)] hover:bg-[var(--muted)] active:translate-y-px"
            onClick={() => moveMonth(1)}
            type="button"
          >
            ›
          </button>
        </div>
      </section>

      <RecentTimeline now={now} tasks={tasks} />

      {selectedDay ? (
        <DayTasksDialog
          dateKey={selectedDay}
          onClose={() => setSelectedDay(null)}
          tasks={selectedTasks}
        />
      ) : null}
    </section>
  );
}

function YearMonthPicker({
  month,
  onChange
}: {
  month: Date;
  onChange: (year: number, month: number) => void;
}) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(month.getFullYear());

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  function togglePicker() {
    if (!isOpen) {
      setViewYear(month.getFullYear());
    }

    setIsOpen((currentValue) => !currentValue);
  }

  return (
    <div className="relative" ref={pickerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="选择年月"
        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--field)] px-4 text-sm font-semibold transition hover:border-[var(--primary)] focus-visible:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10"
        onClick={togglePicker}
        type="button"
      >
        <CalendarGlyph />
        {formatYearMonth(month)}
        <span
          aria-hidden="true"
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          ⌄
        </span>
      </button>

      {isOpen ? (
        <div
          aria-label="选择年月"
          className="dialog-panel absolute right-0 top-[calc(100%+8px)] z-50 w-72 rounded-lg border border-[var(--border)] bg-[rgba(21,24,17,0.96)] p-4 shadow-2xl backdrop-blur-xl"
          role="dialog"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              aria-label="上一年"
              className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] text-lg hover:bg-[var(--muted)]"
              onClick={() => setViewYear((year) => year - 1)}
              type="button"
            >
              ‹
            </button>
            <strong>{viewYear} 年</strong>
            <button
              aria-label="下一年"
              className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] text-lg hover:bg-[var(--muted)]"
              onClick={() => setViewYear((year) => year + 1)}
              type="button"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }, (_, monthIndex) => {
              const selected =
                viewYear === month.getFullYear() &&
                monthIndex === month.getMonth();

              return (
                <button
                  className={`rounded-md border px-2 py-2 text-sm font-semibold transition ${
                    selected
                      ? "border-[var(--primary)] bg-[#263245] text-[var(--primary)]"
                      : "border-transparent text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                  key={monthIndex}
                  onClick={() => {
                    onChange(viewYear, monthIndex);
                    setIsOpen(false);
                  }}
                  type="button"
                >
                  {monthIndex + 1}月
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MonthCard({
  isActive,
  month,
  onSelectDay,
  selectedDay,
  tasksByDay,
  today
}: {
  isActive: boolean;
  month: Date;
  onSelectDay: (dateKey: string) => void;
  selectedDay: string | null;
  tasksByDay: Map<string, CalendarTask[]>;
  today: Date;
}) {
  const days = getMonthDays(month);
  const todayKey = getDateKey(today);

  return (
    <article
      aria-hidden={!isActive}
      className={`calendar-month-card rounded-xl border bg-[var(--glass-panel-strong)] p-3 shadow-xl sm:p-5 ${
        isActive
          ? "border-[var(--primary)]/70"
          : "border-[var(--border)]"
      }`}
    >
      <h2 className="mb-3 text-center text-lg font-bold">
        {formatYearMonth(month)}
      </h2>
      <div
        aria-label={`${formatYearMonth(month)}任务日历`}
        className="grid grid-cols-7 gap-1 text-center"
        role="grid"
      >
        {WEEKDAY_LABELS.map((weekday) => (
          <span
            className="py-1 text-xs font-bold text-[var(--muted-foreground)]"
            key={weekday}
            role="columnheader"
          >
            {weekday}
          </span>
        ))}
        {days.map((day, index) => {
          if (!day) {
            return <span aria-hidden="true" key={`empty-${index}`} />;
          }

          const key = getDateKey(day);
          const dayTasks = tasksByDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedDay;

          return (
            <button
              aria-label={`${formatChineseDate(day)}，${dayTasks.length}个任务`}
              className={`relative flex aspect-square min-h-10 items-center justify-center rounded-lg border text-sm font-semibold transition sm:min-h-12 ${
                isActive && isSelected
                  ? "border-[var(--primary)] bg-[#263245] text-[var(--primary)]"
                  : isActive && isToday
                    ? "border-[#67b45b] bg-[#67b45b]/20 text-white"
                    : isActive
                      ? "border-transparent hover:border-[var(--border)] hover:bg-[var(--muted)]"
                      : "border-transparent"
              }`}
              disabled={!isActive}
              key={key}
              onClick={() => onSelectDay(key)}
              role="gridcell"
              type="button"
            >
              <span className="relative z-10">{day.getDate()}</span>
              {dayTasks.length > 0 ? (
                <TaskStatusDots tasks={dayTasks} />
              ) : null}
            </button>
          );
        })}
      </div>
    </article>
  );
}

function TaskStatusDots({ tasks }: { tasks: CalendarTask[] }) {
  const visibleTasks = tasks.slice(0, 4);

  return (
    <span className="absolute inset-x-1 bottom-1 flex justify-center gap-0.5">
      {visibleTasks.map((task) => (
        <span
          className="size-1.5 rounded-full shadow-sm"
          key={task.id}
          style={{
            backgroundColor:
              task.deadlineStatus === "overdue"
                ? "#8d9488"
                : STATUS_META[task.deadlineStatus].color
          }}
        />
      ))}
      {tasks.length > visibleTasks.length ? (
        <span className="text-[8px] leading-[6px] text-[var(--muted-foreground)]">
          +{tasks.length - visibleTasks.length}
        </span>
      ) : null}
    </span>
  );
}

function DayTasksDialog({
  dateKey,
  onClose,
  tasks
}: {
  dateKey: string;
  onClose: () => void;
  tasks: CalendarTask[];
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div
      className="dialog-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-labelledby="day-tasks-title"
        aria-modal="true"
        className="dialog-panel glass-panel max-h-[min(620px,calc(100dvh-2rem))] w-[min(520px,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-[var(--border)] p-5 shadow-2xl"
        role="dialog"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold" id="day-tasks-title">
              {formatDateKeyChinese(dateKey)}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              共 {tasks.length} 个截止任务
            </p>
          </div>
          <button
            aria-label="关闭当天任务弹窗"
            className="inline-flex size-9 items-center justify-center rounded-md border border-[#ff5656] bg-[#ff0000] text-2xl leading-none text-white transition hover:bg-[#d90000] active:translate-y-px"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
            当天没有截止任务
          </p>
        ) : (
          <div className="relative flex flex-col gap-3 before:absolute before:bottom-5 before:left-[9px] before:top-5 before:w-px before:bg-[var(--border)]">
            {tasks.map((task) => {
              const meta = STATUS_META[task.deadlineStatus];

              return (
                <article
                  className="relative flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-strong)] p-4 pl-9"
                  key={task.id}
                >
                  <span
                    className="absolute left-[3px] top-5 z-10 size-3 rounded-full ring-4 ring-[var(--panel-strong)]"
                    style={{ backgroundColor: meta.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">{task.title}</h3>
                      <span
                        className="rounded-full border px-2 py-0.5 text-xs font-bold"
                        style={{
                          borderColor: `${meta.color}88`,
                          color: meta.color
                        }}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                      截止时间：
                      {task.dueDate ? formatFullDateTime(task.dueDate) : "未设置"}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>,
    document.body
  );
}

function RecentTimeline({
  now,
  tasks
}: {
  now: Date;
  tasks: CalendarTask[];
}) {
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const nowMs = now.getTime();
  const startMs = nowMs - TIMELINE_HALF_HOURS * HOUR_MS;
  const endMs = nowMs + TIMELINE_HALF_HOURS * HOUR_MS;
  const timelineTasks = tasks
    .filter((task) => {
      const dueMs = task.dueDate?.getTime();

      return (
        task.hasDeadline &&
        dueMs !== undefined &&
        dueMs >= startMs &&
        dueMs <= endMs &&
        task.status !== "ARCHIVED"
      );
    })
    .sort(
      (left, right) =>
        (left.dueDate?.getTime() ?? 0) - (right.dueDate?.getTime() ?? 0)
    );
  const bucketSizeMs = 6 * HOUR_MS;
  const groupedByBucket = new Map<number, CalendarTask[]>();

  for (const task of timelineTasks) {
    const dueMs = task.dueDate?.getTime() ?? nowMs;
    const bucket = Math.floor((dueMs - startMs) / bucketSizeMs);
    const bucketTasks = groupedByBucket.get(bucket) ?? [];
    bucketTasks.push(task);
    groupedByBucket.set(bucket, bucketTasks);
  }

  const eventGroups = [...groupedByBucket.values()].map((groupTasks) => {
    const firstDueMs = groupTasks[0].dueDate?.getTime() ?? nowMs;
    const lastDueMs =
      groupTasks[groupTasks.length - 1].dueDate?.getTime() ?? firstDueMs;
    const centerDueMs = (firstDueMs + lastDueMs) / 2;
    const rawPosition = ((centerDueMs - startMs) / (endMs - startMs)) * 100;

    return {
      tasks: groupTasks,
      firstDueMs,
      lastDueMs,
      position: Math.min(95, Math.max(5, rawPosition))
    };
  });
  const axisTop = 174;
  const lowerRowsStart = axisTop + 52;
  const rowTops = [8, 74, lowerRowsStart, lowerRowsStart + 66];
  const rowIsAbove = [true, true, false, false];
  const lastPositionByRow = [-999, -999, -999, -999];
  const minimumGap = 11;
  let previousSideWasAbove = false;

  const eventLayout = eventGroups.map((group) => {
    const preferredRows = previousSideWasAbove ? [2, 3, 0, 1] : [0, 1, 2, 3];
    let row = preferredRows.find(
      (rowIndex) =>
        Math.abs(group.position - lastPositionByRow[rowIndex]) >= minimumGap
    );

    if (row === undefined) {
      row = lastPositionByRow.reduce(
        (bestRow, lastPosition, rowIndex) =>
          Math.abs(group.position - lastPosition) >
          Math.abs(group.position - lastPositionByRow[bestRow])
            ? rowIndex
            : bestRow,
        0
      );
    }

    lastPositionByRow[row] = group.position;
    previousSideWasAbove = rowIsAbove[row];

    return { ...group, row };
  });
  const scaleMarks = [-72, -48, -24, 0, 24, 48, 72];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = timelineScrollRef.current;

      if (container) {
        container.scrollLeft =
          Math.max(0, container.scrollWidth - container.clientWidth) / 2;
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <section className="glass-panel rounded-xl border border-[var(--border)] p-4 shadow-2xl shadow-black/20 sm:p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">近期任务</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          ← 横向滑动查看完整时间轴 →
        </p>
      </div>

      <div
        aria-label="可横向滚动的近期任务时间轴"
        className="touch-pan-x overscroll-x-contain overflow-x-auto pb-4 [scrollbar-color:var(--primary)_transparent]"
        ref={timelineScrollRef}
        tabIndex={0}
      >
        <div className="relative h-[400px] w-[2400px] sm:w-[2600px]">
          <div
            className="absolute inset-x-4 h-0.5 -translate-y-1/2 bg-[var(--muted)]"
            style={{ top: axisTop }}
          />

          {scaleMarks.map((hour) => {
            const left = ((hour + TIMELINE_HALF_HOURS) / 144) * 100;
            const isNow = hour === 0;

            return (
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2"
                key={hour}
                style={{
                  left: `calc(1rem + (100% - 2rem) * ${left / 100})`,
                  top: axisTop
                }}
              >
                <span
                  className={`block rounded-full ${
                    isNow
                      ? "size-4 border-4 border-[var(--primary)] bg-[var(--background)]"
                      : "size-2 bg-[var(--muted-foreground)]"
                  }`}
                />
                <span
                  className={`absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap text-[11px] ${
                    isNow
                      ? "font-bold text-[var(--primary)]"
                      : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {isNow ? "现在" : `${hour > 0 ? "+" : ""}${hour}h`}
                </span>
              </div>
            );
          })}

          {eventLayout.map((group) => {
            const above = rowIsAbove[group.row];
            const meta = getMostUrgentMeta(group.tasks);
            const firstDueDate = new Date(group.firstDueMs);
            const lastDueDate = new Date(group.lastDueMs);
            const timeLabel =
              group.firstDueMs === group.lastDueMs
                ? formatTimelineTime(firstDueDate)
                : `${formatTimelineTime(firstDueDate)}–${formatTimeOnly(lastDueDate)}`;
            const eventStyle: CSSProperties = {
              left: `calc(1rem + (100% - 2rem) * ${group.position / 100})`,
              top: rowTops[group.row]
            };
            const lineTop = above ? rowTops[group.row] + 64 : axisTop;
            const lineHeight = above
              ? axisTop - lineTop
              : rowTops[group.row] - axisTop;

            return (
              <div
                className="absolute w-64 -translate-x-1/2"
                key={`${group.firstDueMs}-${group.row}`}
                style={eventStyle}
              >
                <article className="h-16 rounded-lg border border-[var(--border)] bg-[rgba(21,24,17,0.94)] px-4 py-2.5 text-center shadow-lg backdrop-blur-lg">
                  <p
                    className="truncate text-sm font-semibold"
                    title={group.tasks.map((task) => task.title).join("、")}
                  >
                    {group.tasks[0].title}
                  </p>
                  <p
                    className="mt-1 whitespace-nowrap text-xs"
                    style={{ color: meta.color }}
                  >
                    {timeLabel}
                    {group.tasks.length > 1
                      ? ` · 另 ${group.tasks.length - 1} 项`
                      : ""}
                  </p>
                </article>
                <span
                  className="absolute left-1/2 w-px -translate-x-1/2 bg-[var(--border)]"
                  style={{
                    height: lineHeight,
                    top: lineTop - rowTops[group.row]
                  }}
                />
                <span
                  className="absolute left-1/2 size-2.5 -translate-x-1/2 rounded-full"
                  style={{
                    backgroundColor: meta.color,
                    top: axisTop - rowTops[group.row] - 5
                  }}
                  title={`${group.tasks.length} 个任务`}
                />
              </div>
            );
          })}

          {timelineTasks.length === 0 ? (
            <p
              className="absolute inset-x-0 text-center text-sm text-[var(--muted-foreground)]"
              style={{ top: axisTop + 48 }}
            >
              前后 72 小时内没有任务
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function getMostUrgentMeta(tasks: CalendarTask[]) {
  const urgencyRank: Record<DeadlineStatus, number> = {
    overdue: 5,
    urgent: 4,
    approaching: 3,
    normal: 2,
    completed: 1,
    archived: 0
  };
  const mostUrgentTask = tasks.reduce((mostUrgent, task) =>
    urgencyRank[task.deadlineStatus] >
    urgencyRank[mostUrgent.deadlineStatus]
      ? task
      : mostUrgent
  );

  return STATUS_META[mostUrgentTask.deadlineStatus];
}

function CalendarGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect height="18" rx="2" width="18" x="3" y="4" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

function addMonths(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function isSameMonth(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  );
}

function getMonthDays(month: Date): Array<Date | null> {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const mondayFirstOffset = (firstDay.getDay() + 6) % 7;
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const days: Array<Date | null> = Array.from(
    { length: mondayFirstOffset },
    () => null
  );

  for (let day = 1; day <= dayCount; day += 1) {
    days.push(new Date(year, monthIndex, day));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

function getDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatYearMonth(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatChineseDate(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDateKeyChinese(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function formatFullDateTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatTimelineTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatTimeOnly(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
