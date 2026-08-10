import { Capacitor, registerPlugin } from "@capacitor/core";

export type IOSNotificationSettingState =
  | "disabled"
  | "enabled"
  | "notSupported"
  | "unknown";

export type IOSNotificationSettingsStatus = {
  alert: IOSNotificationSettingState;
  sound: IOSNotificationSettingState;
  lockScreen: IOSNotificationSettingState;
  notificationCenter: IOSNotificationSettingState;
  scheduledDelivery: IOSNotificationSettingState;
};

type IOSNotificationSettingsPlugin = {
  getStatus: () => Promise<IOSNotificationSettingsStatus>;
  openSettings: () => Promise<{ opened: boolean }>;
};

const IOSNotificationSettings = registerPlugin<IOSNotificationSettingsPlugin>(
  "IOSNotificationSettings"
);

export function canUseIOSNotificationSettings() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export async function getIOSNotificationSettingsStatus() {
  if (!canUseIOSNotificationSettings()) {
    return null;
  }

  return normalizeIOSNotificationSettingsStatus(
    await IOSNotificationSettings.getStatus()
  );
}

export async function openIOSNotificationSettings() {
  if (!canUseIOSNotificationSettings()) {
    return false;
  }

  return (await IOSNotificationSettings.openSettings()).opened;
}

export function normalizeIOSNotificationSettingsStatus(
  value: Partial<Record<keyof IOSNotificationSettingsStatus, unknown>>
): IOSNotificationSettingsStatus {
  return {
    alert: normalizeSettingState(value.alert),
    sound: normalizeSettingState(value.sound),
    lockScreen: normalizeSettingState(value.lockScreen),
    notificationCenter: normalizeSettingState(value.notificationCenter),
    scheduledDelivery: normalizeSettingState(value.scheduledDelivery)
  };
}

function normalizeSettingState(value: unknown): IOSNotificationSettingState {
  return value === "enabled" || value === "disabled" || value === "notSupported"
    ? value
    : "unknown";
}
