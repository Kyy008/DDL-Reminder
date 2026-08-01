"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  type DeadlineStatus,
  getDeadlineStatus,
  MINUTE_MS
} from "@/lib/deadline";
import type { LocalTask } from "@/lib/local-app-state";

const HOUR_MS = 60 * 60 * 1000;
export const TIMELINE_RANGE_DAYS = 5;
const TIMELINE_HALF_HOURS = TIMELINE_RANGE_DAYS * 24;
const TIMELINE_TOTAL_HOURS = TIMELINE_HALF_HOURS * 2;
const TIMELINE_CANVAS_WIDTH_PX = TIMELINE_TOTAL_HOURS * 18;
const TIMELINE_BUCKET_HOURS = 6;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const MONTH_SLIDE_DURATION_MS = 460;

export type CalendarViewProps = {
  approachingReminderMinutes: number;
  tasks: LocalTask[];
  urgentReminderMinutes: number;
};

type CalendarTask = {
  deadlineStatus: DeadlineStatus;
  dueDate: Date | null;
  id: string;
  status: LocalTask["status"];
  title: string;
};

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
  normal: {
    color: "var(--calendar-status-normal)",
    label: "进行中"
  },
  approaching: {
    color: "var(--calendar-status-approaching)",
    label: "临近"
  },
  urgent: {
    color: "var(--calendar-status-urgent)",
    label: "紧急"
  },
  overdue: {
    color: "var(--calendar-status-overdue)",
    label: "已逾期"
  },
  completed: {
    color: "var(--calendar-status-completed)",
    label: "已完成"
  },
  archived: {
    color: "var(--calendar-status-archived)",
    label: "已归档"
  }
};

export default function CalendarView({
  approachingReminderMinutes,
  tasks,
  urgentReminderMinutes
}: CalendarViewProps) {
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
  const closeSelectedDay = useCallback(() => setSelectedDay(null), []);

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

  const calendarTasks = useMemo(
    () =>
      tasks.map((task) =>
        toCalendarTask(
          task,
          now,
          approachingReminderMinutes,
          urgentReminderMinutes
        )
      ),
    [approachingReminderMinutes, now, tasks, urgentReminderMinutes]
  );

  const tasksByDay = useMemo(() => {
    const groupedTasks = new Map<string, CalendarTask[]>();

    for (const task of calendarTasks) {
      if (!task.dueDate) {
        continue;
      }

      const key = getDateKey(task.dueDate);
      const tasksForDay = groupedTasks.get(key) ?? [];
      tasksForDay.push(task);
      groupedTasks.set(key, tasksForDay);
    }

    return groupedTasks;
  }, [calendarTasks]);

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

    if (!completedTransition || completedTransition.key !== transitionKey) {
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
    : [-2, -1, 0, 1, 2].map((offset) => addMonths(centerMonth, offset));
  const activeSlideIndex = monthTransition
    ? monthTransition.direction === 1
      ? 3
      : 1
    : 2;

  return (
    <section className="calendar-view-enter calendar-view-layout flex flex-col gap-6">
      <section className="calendar-main-panel calendar-panel rounded-xl border border-[var(--border)] p-4 shadow-2xl shadow-black/10 sm:p-6">
        <div className="relative z-10 mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold">任务日历</h1>
          <YearMonthPicker
            month={centerMonth}
            onChange={(year, month) =>
              navigateToMonth(new Date(year, month, 1))
            }
          />
        </div>

        <div
          aria-label="按月浏览任务日历"
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
              const isNeighbor = Math.abs(index - activeSlideIndex) === 1;

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
            className="calendar-square-button"
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
            className="calendar-square-button"
            onClick={() => moveMonth(1)}
            type="button"
          >
            ›
          </button>
        </div>
      </section>

      <RecentTimeline now={now} tasks={calendarTasks} />

      {selectedDay ? (
        <DayTasksDialog
          dateKey={selectedDay}
          onClose={closeSelectedDay}
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
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab" && popoverRef.current) {
        trapFocusWithin(event, popoverRef.current);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", handleKeyDown, true);
    const focusFrame = window.requestAnimationFrame(() => {
      popoverRef.current
        ?.querySelector<HTMLElement>("button:not(:disabled)")
        ?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !Capacitor.isNativePlatform()) {
      return;
    }

    let isDisposed = false;
    let removeListener: (() => Promise<void>) | undefined;

    void App.addListener("backButton", () => {
      setIsOpen(false);
      triggerRef.current?.focus();
    }).then((listener) => {
      if (isDisposed) {
        void listener.remove();
      } else {
        removeListener = () => listener.remove();
      }
    });

    return () => {
      isDisposed = true;
      void removeListener?.();
    };
  }, [isOpen]);

  function togglePicker() {
    if (!isOpen) {
      setViewYear(month.getFullYear());
    }

    setIsOpen((currentValue) => !currentValue);
  }

  return (
    <div className="calendar-year-picker" ref={pickerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="选择年月"
        className="calendar-picker-trigger"
        onClick={togglePicker}
        ref={triggerRef}
        type="button"
      >
        <CalendarGlyph />
        {formatYearMonth(month)}
        <CalendarChevronGlyph />
      </button>

      {isOpen ? (
        <div
          aria-label="选择年月"
          aria-modal="true"
          className="calendar-year-picker-popover calendar-dialog-panel"
          ref={popoverRef}
          role="dialog"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              aria-label="上一年"
              className="calendar-small-square-button"
              onClick={() => setViewYear((year) => year - 1)}
              type="button"
            >
              ‹
            </button>
            <strong>{viewYear} 年</strong>
            <button
              aria-label="下一年"
              className="calendar-small-square-button"
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
                  className={`calendar-month-option ${
                    selected ? "is-selected" : ""
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
      className={`calendar-month-card rounded-xl border p-3 sm:p-5 ${
        isActive ? "is-active" : ""
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
              aria-label={`${formatChineseDate(day)}，${dayTasks.length} 项任务截止`}
              className={`calendar-day-cell ${
                isActive && isSelected ? "is-selected" : ""
              } ${isActive && isToday ? "is-today" : ""}`}
              disabled={!isActive}
              key={key}
              onClick={() => onSelectDay(key)}
              role="gridcell"
              type="button"
            >
              <span className="relative z-10">{day.getDate()}</span>
              {dayTasks.length > 0 ? <TaskStatusDots tasks={dayTasks} /> : null}
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
            backgroundColor: STATUS_META[task.deadlineStatus].color
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
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab" && dialogRef.current) {
        trapFocusWithin(event, dialogRef.current);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("button:not(:disabled)")
        ?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let isDisposed = false;
    let removeListener: (() => Promise<void>) | undefined;

    void App.addListener("backButton", onClose).then((listener) => {
      if (isDisposed) {
        void listener.remove();
      } else {
        removeListener = () => listener.remove();
      }
    });

    return () => {
      isDisposed = true;
      void removeListener?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="calendar-dialog-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-labelledby="calendar-day-tasks-title"
        aria-modal="true"
        className="calendar-dialog-panel calendar-popover-panel max-h-[min(620px,calc(100dvh-2rem))] w-[min(520px,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-[var(--border)] p-5 shadow-2xl"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold" id="calendar-day-tasks-title">
              {formatDateKeyChinese(dateKey)}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              当天有 {tasks.length} 项任务截止
            </p>
          </div>
          <button
            aria-label="关闭当天任务"
            className="calendar-dialog-close-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
            这一天没有任务截止
          </p>
        ) : (
          <div className="calendar-day-task-list">
            {tasks.map((task) => {
              const meta = STATUS_META[task.deadlineStatus];

              return (
                <article className="calendar-day-task-card" key={task.id}>
                  <span
                    className="calendar-day-task-dot"
                    style={{ backgroundColor: meta.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="break-words font-semibold">
                        {task.title}
                      </h3>
                      <span
                        className="rounded-full border px-2 py-0.5 text-xs font-bold"
                        style={{
                          borderColor: meta.color,
                          color: meta.color
                        }}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                      截止时间：
                      {task.dueDate
                        ? formatFullDateTime(task.dueDate)
                        : "未设置"}
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

function RecentTimeline({ now, tasks }: { now: Date; tasks: CalendarTask[] }) {
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const nowMs = now.getTime();
  const startMs = nowMs - TIMELINE_HALF_HOURS * HOUR_MS;
  const endMs = nowMs + TIMELINE_HALF_HOURS * HOUR_MS;
  const timelineTasks = tasks
    .filter((task) => {
      const dueMs = task.dueDate?.getTime();

      return (
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
  const pastTimelineTasks = timelineTasks.filter(
    (task) => (task.dueDate?.getTime() ?? nowMs) < nowMs
  );
  const futureTimelineTasks = timelineTasks.filter(
    (task) => (task.dueDate?.getTime() ?? nowMs) >= nowMs
  );
  const bucketSizeMs = TIMELINE_BUCKET_HOURS * HOUR_MS;
  const groupedByBucket = new Map<number, CalendarTask[]>();

  for (const task of timelineTasks) {
    const dueMs = task.dueDate?.getTime() ?? nowMs;
    const bucket = Math.floor((dueMs - startMs) / bucketSizeMs);
    const bucketTasks = groupedByBucket.get(bucket) ?? [];
    bucketTasks.push(task);
    groupedByBucket.set(bucket, bucketTasks);
  }

  const eventGroups = [...groupedByBucket.entries()].map(
    ([bucket, groupTasks]) => {
      const firstDueMs = groupTasks[0].dueDate?.getTime() ?? nowMs;
      const lastDueMs =
        groupTasks[groupTasks.length - 1].dueDate?.getTime() ?? firstDueMs;
      const centerDueMs = (firstDueMs + lastDueMs) / 2;
      const rawPosition = ((centerDueMs - startMs) / (endMs - startMs)) * 100;

      return {
        bucket,
        tasks: groupTasks,
        firstDueMs,
        lastDueMs,
        position: Math.min(95, Math.max(5, rawPosition))
      };
    }
  );
  const axisTop = 174;
  const lowerRowsStart = axisTop + 52;
  const rowTops = [8, 74, lowerRowsStart, lowerRowsStart + 66];
  const rowIsAbove = [true, true, false, false];
  const lastPositionByRow = [-999, -999, -999, -999];
  const minimumGap = (280 / TIMELINE_CANVAS_WIDTH_PX) * 100;
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
  const scaleMarks = Array.from(
    { length: TIMELINE_RANGE_DAYS * 2 + 1 },
    (_, index) => (index - TIMELINE_RANGE_DAYS) * 24
  );

  useEffect(() => {
    const container = timelineScrollRef.current;

    if (!container) {
      return;
    }

    function centerTimeline() {
      if (container && container.clientWidth > 0) {
        container.scrollLeft =
          Math.max(0, container.scrollWidth - container.clientWidth) / 2;
      }
    }

    const frame = window.requestAnimationFrame(centerTimeline);
    const resizeObserver = new ResizeObserver(centerTimeline);
    resizeObserver.observe(container);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <section className="calendar-recent-panel calendar-panel rounded-xl border border-[var(--border)] p-4 shadow-2xl shadow-black/10 sm:p-6">
      <div className="mb-4">
        <div>
          <h2 className="text-xl font-semibold">近期任务</h2>
          <p className="calendar-mobile-timeline-description mt-1 text-sm text-[var(--muted-foreground)] md:hidden">
            按时间查看截止安排
          </p>
          <p className="calendar-desktop-timeline-description mt-1 hidden text-sm text-[var(--muted-foreground)] md:block">
            横向滚动查看前后各 {TIMELINE_RANGE_DAYS} 天
          </p>
        </div>
      </div>

      <div
        aria-label="近期任务时间线"
        className="calendar-mobile-timeline grid md:hidden"
        role="list"
      >
        <MobileTimelineBoundary
          label={`${TIMELINE_RANGE_DAYS} 天前`}
          position="start"
        />

        {pastTimelineTasks.map((task) => (
          <MobileTimelineTask key={task.id} now={now} task={task} />
        ))}

        <div className="calendar-mobile-now" role="listitem">
          <span aria-hidden="true" className="calendar-mobile-now-dot" />
          <div className="calendar-mobile-now-card">
            <div>
              <strong>现在</strong>
              <p>{formatTimelineNow(now)}</p>
            </div>
          </div>
        </div>

        {timelineTasks.length === 0 ? (
          <div className="calendar-mobile-empty" role="listitem">
            <span aria-hidden="true" className="calendar-mobile-empty-dot" />
            <div>
              <strong>这几天没有任务要截止</strong>
              <p>前后各 {TIMELINE_RANGE_DAYS} 天都没有截止安排</p>
            </div>
          </div>
        ) : null}

        {futureTimelineTasks.map((task) => (
          <MobileTimelineTask key={task.id} now={now} task={task} />
        ))}

        <MobileTimelineBoundary
          label={`${TIMELINE_RANGE_DAYS} 天后`}
          position="end"
        />
      </div>

      <div className="calendar-desktop-timeline hidden md:block">
        <div
          aria-label="可横向滚动的近期任务时间轴"
          className="calendar-timeline-scroll touch-pan-x overscroll-x-contain overflow-x-auto pb-4"
          ref={timelineScrollRef}
          tabIndex={0}
        >
          <div
            className="relative h-[400px]"
            style={{ width: TIMELINE_CANVAS_WIDTH_PX }}
          >
            <div
              className="absolute inset-x-4 h-0.5 -translate-y-1/2 bg-[var(--muted)]"
              style={{ top: axisTop }}
            />

            {scaleMarks.map((hour) => {
              const left =
                ((hour + TIMELINE_HALF_HOURS) / TIMELINE_TOTAL_HOURS) * 100;
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
                  key={group.bucket}
                  style={eventStyle}
                >
                  <article className="calendar-timeline-event h-16 rounded-lg border border-[var(--border)] px-4 py-2.5 text-center shadow-lg">
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
                    title={`${group.tasks.length} 项任务`}
                  />
                </div>
              );
            })}

            {timelineTasks.length === 0 ? (
              <p
                className="absolute inset-x-0 text-center text-sm text-[var(--muted-foreground)]"
                style={{ top: axisTop + 48 }}
              >
                前后各 {TIMELINE_RANGE_DAYS} 天都没有截止任务
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function MobileTimelineTask({ now, task }: { now: Date; task: CalendarTask }) {
  const dueDate = task.dueDate;

  if (!dueDate) {
    return null;
  }

  const meta = STATUS_META[task.deadlineStatus];
  const isPast = dueDate.getTime() < now.getTime();

  return (
    <article
      className="calendar-mobile-timeline-item"
      data-past={isPast ? "true" : "false"}
      role="listitem"
    >
      <span
        aria-hidden="true"
        className="calendar-mobile-timeline-dot"
        style={{ backgroundColor: meta.color }}
      />
      <div className="calendar-mobile-timeline-card">
        <div className="calendar-mobile-timeline-heading flex min-w-0 items-start justify-between gap-3">
          <h3 className="min-w-0 break-words text-sm font-semibold leading-5">
            {task.title}
          </h3>
          <span
            className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold"
            style={{ borderColor: meta.color, color: meta.color }}
          >
            {meta.label}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          <time dateTime={dueDate.toISOString()}>
            {formatTimelineTime(dueDate)}
          </time>
          <span style={{ color: meta.color }}>
            {formatTimelineDistance(dueDate, now)}
          </span>
        </div>
      </div>
    </article>
  );
}

function MobileTimelineBoundary({
  label,
  position
}: {
  label: string;
  position: "end" | "start";
}) {
  return (
    <div
      aria-hidden="true"
      className="calendar-mobile-boundary"
      data-position={position}
    >
      <span />
      <small>{label}</small>
    </div>
  );
}

function toCalendarTask(
  task: LocalTask,
  now: Date,
  approachingReminderMinutes: number,
  urgentReminderMinutes: number
): CalendarTask {
  const dueDate = parseDate(task.dueAt);

  return {
    deadlineStatus: dueDate
      ? getDeadlineStatus({
          approachingThresholdMs:
            normalizeReminderMinutes(approachingReminderMinutes) * MINUTE_MS,
          dueAt: dueDate,
          now,
          taskStatus: task.status,
          urgentThresholdMs:
            normalizeReminderMinutes(urgentReminderMinutes) * MINUTE_MS
        })
      : getStatusWithoutDeadline(task.status),
    dueDate,
    id: task.id,
    status: task.status,
    title: task.title
  };
}

function getStatusWithoutDeadline(status: LocalTask["status"]): DeadlineStatus {
  if (status === "COMPLETED") {
    return "completed";
  }

  if (status === "ARCHIVED") {
    return "archived";
  }

  return "normal";
}

function normalizeReminderMinutes(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
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
    urgencyRank[task.deadlineStatus] > urgencyRank[mostUrgent.deadlineStatus]
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

function CalendarChevronGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="calendar-picker-chevron"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 20 20"
    >
      <path d="m5 7.5 5 5 5-5" />
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

function trapFocusWithin(event: KeyboardEvent, container: HTMLElement) {
  const focusableElements = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("hidden"));

  if (focusableElements.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements.at(-1)!;
  const activeElement = document.activeElement;

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (
    !event.shiftKey &&
    (activeElement === lastElement || !container.contains(activeElement))
  ) {
    event.preventDefault();
    firstElement.focus();
  }
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

function formatTimelineNow(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short"
  }).format(date);
}

export function formatTimelineDistance(date: Date, now: Date) {
  const differenceMs = date.getTime() - now.getTime();
  const direction = differenceMs < 0 ? "前" : "后";
  const absoluteMinutes = Math.round(Math.abs(differenceMs) / MINUTE_MS);

  if (absoluteMinutes < 1) {
    return differenceMs < 0 ? "刚刚截止" : "即将截止";
  }

  if (absoluteMinutes < 60) {
    return `${absoluteMinutes} 分钟${direction}`;
  }

  const totalHours = Math.floor(absoluteMinutes / 60);
  const remainingMinutes = absoluteMinutes % 60;

  if (totalHours < 24) {
    return `${totalHours} 小时${
      remainingMinutes > 0 ? ` ${remainingMinutes} 分钟` : ""
    }${direction}`;
  }

  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;

  return `${days} 天${remainingHours > 0 ? ` ${remainingHours} 小时` : ""}${direction}`;
}

function formatTimeOnly(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
