"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "@capacitor/app";
import {
  getAndroidVendorGuidance,
  openAndroidAppSettings,
  openAndroidVendorBackgroundSettings,
  requestAndroidBackgroundProtection
} from "@/lib/android-power";
import {
  getNotificationDiagnostics,
  openExactAlarmSettings,
  openReminderNotificationSettings,
  requestReminderNotificationPermission,
  sendTestNotifications,
  syncAllTaskReminders,
  type NotificationDiagnostics
} from "@/lib/local-reminder-scheduler";
import { localTaskStore } from "@/lib/local-task-store";
import {
  getIOSNotificationSettingsStatus,
  openIOSNotificationSettings,
  type IOSNotificationSettingsStatus
} from "@/lib/ios-notification-settings";

type GuideAction =
  | "battery"
  | "channel"
  | "exact"
  | "notification"
  | "refresh"
  | "test"
  | "vendor";

type GuideNotice = {
  text: string;
  tone: "error" | "success" | "warning";
} | null;

type StepTone = "done" | "manual" | "neutral" | "required";

const ANDROID_HEADS_UP_IMPORTANCE = 4;

export function NotificationSetupGuide() {
  const [diagnostics, setDiagnostics] =
    useState<NotificationDiagnostics | null>(null);
  const [iosSettings, setIOSSettings] =
    useState<IOSNotificationSettingsStatus | null>(null);
  const [busyAction, setBusyAction] = useState<GuideAction | null>("refresh");
  const [notice, setNotice] = useState<GuideNotice>(null);
  const refreshRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current;
    const nextDiagnostics = await getNotificationDiagnostics();
    const nextIOSSettings =
      nextDiagnostics.isNative && nextDiagnostics.platform === "ios"
        ? await getIOSNotificationSettingsStatus().catch(() => null)
        : null;

    if (requestId === refreshRequestRef.current) {
      setDiagnostics(nextDiagnostics);
      setIOSSettings(nextIOSSettings);
    }

    return nextDiagnostics;
  }, []);

  useEffect(() => {
    let isDisposed = false;
    let removeListener: (() => Promise<void>) | undefined;

    void refresh()
      .catch(() => {
        if (!isDisposed) {
          setNotice({
            text: "暂时无法检查提醒设置，请稍后重试。",
            tone: "error"
          });
        }
      })
      .finally(() => {
        if (!isDisposed) {
          setBusyAction(null);
        }
      });

    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        void refresh().catch(() => {
          setNotice({
            text: "暂时无法更新提醒设置，请稍后重试。",
            tone: "error"
          });
        });
      }
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
  }, [refresh]);

  const isAndroid = diagnostics?.platform === "android";
  const isIOS = diagnostics?.platform === "ios";
  const isNative = diagnostics?.isNative ?? false;
  const power = diagnostics?.power ?? null;
  const notificationGranted = diagnostics?.notificationPermission === "granted";
  const exactGranted = !isAndroid || diagnostics?.exactAlarm === "granted";
  const batteryReady =
    !isAndroid ||
    Boolean(power?.batteryOptimizationIgnored && !power.backgroundRestricted);
  const channelReady = isNotificationChannelFullyReady(diagnostics);
  const iosSettingsReady = isIOSNotificationSettingsFullyReady(iosSettings);
  const detectableSteps = diagnostics
    ? isAndroid
      ? [notificationGranted, exactGranted, batteryReady, channelReady]
      : isIOS && diagnostics.isNative
        ? [notificationGranted, iosSettingsReady]
        : diagnostics.isNative
          ? [notificationGranted]
          : []
    : null;
  const completedDetectableSteps = detectableSteps?.filter(Boolean).length ?? 0;
  const deviceLabel = useMemo(() => {
    if (isIOS) {
      return "iPhone 或 iPad";
    }

    if (!isAndroid) {
      return diagnostics?.isNative ? "当前设备" : "浏览器预览";
    }

    if (!power) {
      return "Android 设备（暂时无法读取设备信息）";
    }

    return `${power.manufacturer || power.brand || "Android"} ${power.model}`.trim();
  }, [diagnostics?.isNative, isAndroid, isIOS, power]);

  const runAction = useCallback(
    async (
      action: GuideAction,
      operation: () => Promise<string | null | undefined>,
      fallbackMessage: string,
      resultTone:
        | "success"
        | "warning"
        | ((message: string) => "success" | "warning") = "success"
    ) => {
      setBusyAction(action);
      setNotice(null);

      try {
        const message = await operation();

        await refresh();
        const resultMessage = message ?? fallbackMessage;

        setNotice({
          text: resultMessage,
          tone:
            typeof resultTone === "function"
              ? resultTone(resultMessage)
              : resultTone
        });
      } catch (error) {
        setNotice({
          text: getErrorMessage(error),
          tone: "error"
        });
      } finally {
        setBusyAction(null);
      }
    },
    [refresh]
  );

  const handleNotificationPermission = useCallback(async () => {
    await runAction(
      "notification",
      async () => {
        if (diagnostics?.notificationPermission === "denied") {
          if (isAndroid) {
            return openAndroidAppSettings();
          }

          if (isIOS) {
            const opened = await openIOSNotificationSettings();

            return opened
              ? "系统通知设置已打开。完成后返回 App，状态会自动更新。"
              : "没能打开系统通知设置，请稍后重试。";
          }
        }

        const granted = await requestReminderNotificationPermission();

        if (
          granted &&
          isIOS &&
          diagnostics?.notificationPermission !== "granted"
        ) {
          try {
            const state = await localTaskStore.getState();
            const warning = await syncAllTaskReminders(
              state.tasks,
              state.settings
            );

            return warning ?? "通知权限已经打开，现有任务提醒也已更新。";
          } catch {
            return "通知权限已经打开，但现有任务提醒暂时没能更新。App 下次打开时会再试。";
          }
        }

        return granted
          ? "通知权限已经打开。"
          : isIOS
            ? "通知权限还没打开。再点一次可以前往系统设置。"
            : "通知权限还没打开。再点一次可以前往应用设置。";
      },
      "已重新检查通知权限。",
      classifyReminderResult
    );
  }, [diagnostics?.notificationPermission, isAndroid, isIOS, runAction]);

  const handleBatterySettings = useCallback(async () => {
    await runAction(
      "battery",
      () =>
        power?.batteryOptimizationIgnored && power.backgroundRestricted
          ? openAndroidAppSettings()
          : requestAndroidBackgroundProtection(),
      "已重新检查电池与后台设置。"
    );
  }, [
    power?.backgroundRestricted,
    power?.batteryOptimizationIgnored,
    runAction
  ]);

  const notificationStatus = getNotificationStatus(diagnostics);
  const exactStatus = getExactStatus(diagnostics);
  const batteryStatus = getBatteryStatus(diagnostics);
  const channelStatus = getChannelStatus(diagnostics);
  const iosSettingsStatus = getIOSNotificationSettingsSummary(iosSettings);
  const vendorStatus = getVendorStatus(diagnostics);
  const actionDisabled = !isNative || busyAction !== null;

  return (
    <section
      aria-busy={busyAction !== null}
      aria-labelledby="notification-guide-title"
      className="flex flex-col gap-4 py-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold" id="notification-guide-title">
            提醒设置检查
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
            {deviceLabel}。{getGuideIntroduction(isAndroid, isIOS, isNative)}
          </p>
        </div>
        <button
          className="h-10 shrink-0 rounded-md border border-[var(--border)] bg-[var(--panel)] px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busyAction !== null}
          onClick={() =>
            void runAction(
              "refresh",
              async () => "提醒设置已重新检查。",
              "提醒设置已重新检查。"
            )
          }
          type="button"
        >
          {busyAction === "refresh" ? "检查中…" : "重新检查"}
        </button>
      </div>

      <p
        aria-live="polite"
        className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm leading-6"
        role="status"
      >
        {detectableSteps
          ? detectableSteps.length > 0
            ? `已检查 ${detectableSteps.length} 项，其中 ${completedDetectableSteps} 项正常。`
            : "安装 App 后，就能在这里检查提醒设置。"
          : "正在检查提醒设置…"}
        {diagnostics?.pendingCount === null ||
        diagnostics?.pendingCount === undefined
          ? " 暂时无法读取待发送提醒的数量。"
          : ` 目前还有 ${diagnostics.pendingCount} 条提醒等待发送。`}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <GuideStep
          actionLabel={
            diagnostics?.notificationPermission === "denied"
              ? isIOS
                ? "打开系统设置"
                : "打开应用设置"
              : notificationGranted
                ? "重新检查"
                : "允许通知"
          }
          busy={busyAction === "notification"}
          description={getNotificationPermissionDescription(isAndroid, isIOS)}
          disabled={actionDisabled}
          onAction={
            notificationGranted
              ? () =>
                  void runAction(
                    "notification",
                    async () => "已重新检查通知权限。",
                    "已重新检查通知权限。"
                  )
              : () => void handleNotificationPermission()
          }
          status={notificationStatus.label}
          title="1. 通知权限"
          tone={notificationStatus.tone}
        />

        {isAndroid ? (
          <>
            <GuideStep
              actionLabel={exactGranted ? "重新检查" : "允许“闹钟和提醒”"}
              busy={busyAction === "exact"}
              description="Android 12 及以上需允许“闹钟和提醒”才能尽量准时通知；未开启时仍会提醒，但可能延迟。"
              disabled={actionDisabled}
              onAction={
                exactGranted
                  ? () =>
                      void runAction(
                        "exact",
                        async () => "已重新检查“闹钟和提醒”。",
                        "已重新检查“闹钟和提醒”。"
                      )
                  : () =>
                      void runAction(
                        "exact",
                        openExactAlarmSettings,
                        "“闹钟和提醒”设置已打开。"
                      )
              }
              status={exactStatus.label}
              title="2. 闹钟和提醒"
              tone={exactStatus.tone}
            />

            <GuideStep
              actionLabel={batteryReady ? "重新检查" : "调整电池设置"}
              busy={busyAction === "battery"}
              description="让 DDL-Reminder 不受电池优化影响，同时允许它在后台运行。"
              disabled={actionDisabled}
              onAction={
                batteryReady
                  ? () =>
                      void runAction(
                        "battery",
                        async () => "已重新检查电池与后台设置。",
                        "已重新检查电池与后台设置。"
                      )
                  : () => void handleBatterySettings()
              }
              status={batteryStatus.label}
              title="3. 电池与后台"
              tone={batteryStatus.tone}
            />

            <GuideStep
              actionLabel={
                power?.vendorSettingsAvailable
                  ? `打开${power.vendorSettingsLabel}`
                  : "打开后台设置"
              }
              busy={busyAction === "vendor"}
              description={getAndroidVendorGuidance(power)}
              disabled={actionDisabled || power?.vendorFamily === "pixel"}
              onAction={() =>
                void runAction(
                  "vendor",
                  openAndroidVendorBackgroundSettings,
                  "后台设置已打开。请按上面的说明完成设置；这一步需要你手动确认。"
                )
              }
              status={vendorStatus.label}
              title="4. 自启动与后台"
              tone={vendorStatus.tone}
            />

            <GuideStep
              actionLabel={
                diagnostics?.channel.applicable === false
                  ? "系统无需设置"
                  : "设置通知样式"
              }
              busy={busyAction === "channel"}
              description={
                diagnostics?.channel.importance === 3
                  ? "通知已开启，但可能不弹横幅。请在系统设置中把提醒级别调高。"
                  : "可以在这里调整声音、振动、横幅和锁屏显示。不同系统里的名称可能不一样。"
              }
              disabled={
                actionDisabled || diagnostics?.channel.applicable === false
              }
              onAction={() =>
                void runAction(
                  "channel",
                  openReminderNotificationSettings,
                  "通知设置已打开。"
                )
              }
              status={channelStatus.label}
              title="5. 通知样式"
              tone={channelStatus.tone}
            />
          </>
        ) : (
          <GuideStep
            actionLabel={isIOS ? "打开通知设置" : "安装 App 后设置"}
            busy={busyAction === "channel"}
            description={getIOSNotificationSettingsDescription(iosSettings)}
            disabled={actionDisabled || !isIOS}
            onAction={() =>
              void runAction(
                "channel",
                async () => {
                  const opened = await openIOSNotificationSettings();

                  return opened
                    ? "系统通知设置已打开。完成后返回 App，状态会自动更新。"
                    : "没能打开系统通知设置，请稍后重试。";
                },
                "系统通知设置已打开。",
                classifyReminderResult
              )
            }
            status={isIOS ? iosSettingsStatus.label : "安装后可用"}
            title="2. 通知显示与声音"
            tone={isIOS ? iosSettingsStatus.tone : "neutral"}
          />
        )}

        <GuideStep
          actionLabel="发送两条测试通知"
          busy={busyAction === "test"}
          description="先发一条立即通知，再安排一条约 15 秒后的后台通知。点完后可以回到桌面或锁屏等待，请不要连续重复测试。"
          disabled={actionDisabled}
          onAction={() =>
            void runAction(
              "test",
              sendTestNotifications,
              "已立即发送一条通知，并安排约 15 秒后再发送一条。现在可以回到桌面或锁屏等待，请不要连续重复测试。",
              classifyReminderResult
            )
          }
          status="最后检查"
          title={`${isAndroid ? 6 : 3}. 测试通知`}
          tone="neutral"
        />
      </div>

      {!isNative && diagnostics ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          这里是浏览器预览。安装 Android 或 iOS 版 App
          后，才能检查系统通知设置并发送测试通知。
        </p>
      ) : null}

      {notice ? (
        <p
          aria-live={notice.tone === "error" ? "assertive" : "polite"}
          className={`rounded-md border px-3 py-2 text-sm leading-6 ${
            notice.tone === "error"
              ? "border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error-text)]"
              : notice.tone === "warning"
                ? "border-[var(--status-approaching-border)] bg-[var(--status-approaching-bg)] text-[var(--status-approaching-text)]"
                : "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-text)]"
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}

function GuideStep({
  actionLabel,
  busy,
  description,
  disabled,
  onAction,
  status,
  title,
  tone
}: {
  actionLabel: string;
  busy: boolean;
  description: string;
  disabled: boolean;
  onAction: () => void;
  status: string;
  title: string;
  tone: StepTone;
}) {
  return (
    <article className="flex min-h-48 flex-col rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <StatusBadge label={status} tone={tone} />
      </div>
      <p className="mt-3 flex-1 text-sm leading-6 text-[var(--muted-foreground)]">
        {description}
      </p>
      <button
        className="mt-4 min-h-10 rounded-md border border-[var(--border)] bg-[var(--active-surface)] px-3 py-2 text-sm font-semibold transition hover:border-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={onAction}
        type="button"
      >
        {busy ? "处理中…" : actionLabel}
      </button>
    </article>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: StepTone }) {
  const toneClass: Record<StepTone, string> = {
    done: "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-text)]",
    manual:
      "border-[var(--status-approaching-border)] bg-[var(--status-approaching-bg)] text-[var(--status-approaching-text)]",
    neutral:
      "border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]",
    required:
      "border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error-text)]"
  };

  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${toneClass[tone]}`}
    >
      {label}
    </span>
  );
}

function getNotificationStatus(diagnostics: NotificationDiagnostics | null): {
  label: string;
  tone: StepTone;
} {
  if (!diagnostics) {
    return { label: "检查中", tone: "neutral" };
  }

  if (!diagnostics.isNative) {
    return { label: "仅供预览", tone: "neutral" };
  }

  if (diagnostics.notificationPermission === "granted") {
    return { label: "已允许", tone: "done" };
  }

  if (diagnostics.notificationPermission === "unknown") {
    return { label: "检测失败", tone: "required" };
  }

  return { label: "需允许", tone: "required" };
}

function getExactStatus(diagnostics: NotificationDiagnostics | null): {
  label: string;
  tone: StepTone;
} {
  if (!diagnostics) {
    return { label: "检查中", tone: "neutral" };
  }

  if (diagnostics.platform !== "android") {
    return { label: "不适用", tone: "neutral" };
  }

  if (diagnostics.exactAlarm === "granted") {
    return { label: "已允许", tone: "done" };
  }

  if (diagnostics.exactAlarm === "unknown") {
    return { label: "检测失败", tone: "required" };
  }

  return { label: "建议开启", tone: "required" };
}

function getBatteryStatus(diagnostics: NotificationDiagnostics | null): {
  label: string;
  tone: StepTone;
} {
  if (!diagnostics) {
    return { label: "检查中", tone: "neutral" };
  }

  if (diagnostics.platform !== "android") {
    return { label: "不适用", tone: "neutral" };
  }

  if (!diagnostics.power) {
    return { label: "检测失败", tone: "required" };
  }

  if (
    diagnostics.power.batteryOptimizationIgnored &&
    !diagnostics.power.backgroundRestricted
  ) {
    return { label: "已允许", tone: "done" };
  }

  return { label: "需要调整", tone: "required" };
}

export function getChannelStatus(diagnostics: NotificationDiagnostics | null): {
  label: string;
  tone: StepTone;
} {
  if (!diagnostics) {
    return { label: "检查中", tone: "neutral" };
  }

  if (diagnostics.platform !== "android") {
    return { label: "不适用", tone: "neutral" };
  }

  const channel = diagnostics.channel;

  if (!channel.applicable) {
    return { label: "不适用", tone: "neutral" };
  }

  if (channel.exists === null || channel.enabled === null) {
    return { label: "检测失败", tone: "required" };
  }

  if (!channel.exists || !channel.enabled) {
    return { label: "需开启", tone: "required" };
  }

  if ((channel.importance ?? 0) < 3) {
    return { label: "提醒级别较低", tone: "manual" };
  }

  if (channel.importance === 3) {
    return { label: "可能没有横幅", tone: "manual" };
  }

  return { label: "正常", tone: "done" };
}

export function isNotificationChannelFullyReady(
  diagnostics: NotificationDiagnostics | null
) {
  if (!diagnostics) {
    return false;
  }

  if (diagnostics.platform !== "android" || !diagnostics.channel.applicable) {
    return true;
  }

  return Boolean(
    diagnostics.channel.enabled &&
    (diagnostics.channel.importance ?? 0) >= ANDROID_HEADS_UP_IMPORTANCE
  );
}

export function getIOSNotificationSettingsSummary(
  settings: IOSNotificationSettingsStatus | null
): {
  label: string;
  tone: StepTone;
} {
  if (!settings) {
    return { label: "检测失败", tone: "required" };
  }

  const values = Object.values(settings);

  if (values.includes("unknown")) {
    return { label: "检测失败", tone: "required" };
  }

  if (
    settings.alert === "disabled" &&
    settings.lockScreen === "disabled" &&
    settings.notificationCenter === "disabled"
  ) {
    return { label: "显示已关闭", tone: "required" };
  }

  if (settings.alert === "disabled") {
    return { label: "横幅已关闭", tone: "manual" };
  }

  if (settings.sound === "disabled") {
    return { label: "声音已关闭", tone: "manual" };
  }

  if (settings.scheduledDelivery === "enabled") {
    return { label: "可能延迟送达", tone: "manual" };
  }

  return { label: "正常", tone: "done" };
}

export function isIOSNotificationSettingsFullyReady(
  settings: IOSNotificationSettingsStatus | null
) {
  return getIOSNotificationSettingsSummary(settings).tone === "done";
}

export function formatIOSNotificationSettings(
  settings: IOSNotificationSettingsStatus
) {
  return [
    `横幅：${formatIOSNotificationSettingState(settings.alert)}`,
    `声音：${formatIOSNotificationSettingState(settings.sound)}`,
    `锁定屏幕：${formatIOSNotificationSettingState(settings.lockScreen)}`,
    `通知中心：${formatIOSNotificationSettingState(settings.notificationCenter)}`,
    `定时摘要：${formatIOSNotificationSettingState(settings.scheduledDelivery)}`
  ].join("；");
}

function formatIOSNotificationSettingState(
  state: IOSNotificationSettingsStatus[keyof IOSNotificationSettingsStatus]
) {
  const labels: Record<
    IOSNotificationSettingsStatus[keyof IOSNotificationSettingsStatus],
    string
  > = {
    disabled: "已关闭",
    enabled: "已开启",
    notSupported: "系统不支持",
    unknown: "暂时无法读取"
  };

  return labels[state];
}

function getGuideIntroduction(
  isAndroid: boolean,
  isIOS: boolean,
  isNative: boolean
) {
  if (isAndroid) {
    return "能自动检查的项目会直接显示结果；自启动等厂商设置无法由 App 读取，需要你手动确认。";
  }

  if (isIOS) {
    return "这里会检查通知权限、显示位置和声音；修改系统设置后，返回 App 就会自动更新。";
  }

  return isNative
    ? "这里会检查当前系统支持的通知设置。"
    : "这里可以预览通知设置流程，安装 App 后才能读取和修改系统状态。";
}

function getNotificationPermissionDescription(
  isAndroid: boolean,
  isIOS: boolean
) {
  if (isAndroid) {
    return "要收到任务提醒，需要先允许系统通知。Android 13 及以上会单独询问。";
  }

  if (isIOS) {
    return "要收到任务提醒，需要先允许系统通知。首次开启时，iOS 会弹出授权窗口。";
  }

  return "要收到任务提醒，需要在安装后的 App 中允许系统通知。";
}

function getIOSNotificationSettingsDescription(
  settings: IOSNotificationSettingsStatus | null
) {
  const guidance =
    "可在系统设置中调整横幅、声音、锁定屏幕、通知中心和定时摘要。";

  return settings
    ? `${guidance} 当前状态：${formatIOSNotificationSettings(settings)}。`
    : `${guidance} 暂时无法读取当前状态。`;
}

function getVendorStatus(diagnostics: NotificationDiagnostics | null): {
  label: string;
  tone: StepTone;
} {
  if (!diagnostics) {
    return { label: "检查中", tone: "neutral" };
  }

  if (
    diagnostics.platform !== "android" ||
    diagnostics.power?.vendorFamily === "pixel"
  ) {
    return { label: "不适用", tone: "neutral" };
  }

  return { label: "请手动确认", tone: "manual" };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

function classifyReminderResult(message: string): "success" | "warning" {
  return /未开启|未允许|未授予|无法确认|检查失败|失败|没能|可能延迟|尚未/.test(
    message
  )
    ? "warning"
    : "success";
}
