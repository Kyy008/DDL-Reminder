import { Capacitor, registerPlugin } from "@capacitor/core";

type DdlAlarmsPlugin = {
  cancelAll: () => Promise<{
    cancelled: number;
  }>;
};

const DdlAlarms = registerPlugin<DdlAlarmsPlugin>("DdlAlarms");

function canCleanUpLegacyNativeDdlAlarms() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function cancelAllLegacyNativeDdlAlarms() {
  if (!canCleanUpLegacyNativeDdlAlarms()) {
    return 0;
  }

  const result = await DdlAlarms.cancelAll();

  return result.cancelled;
}
