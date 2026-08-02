import { Capacitor, registerPlugin } from "@capacitor/core";

type AndroidRecentsResult = {
  excluded: boolean;
};

type AndroidRecentsPlugin = {
  getExcluded: () => Promise<AndroidRecentsResult>;
  setExcluded: (options: {
    excluded: boolean;
  }) => Promise<AndroidRecentsResult>;
};

const AndroidRecents = registerPlugin<AndroidRecentsPlugin>("AndroidRecents");

export function canControlAndroidRecents() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function getAndroidRecentsExcluded() {
  if (!canControlAndroidRecents()) {
    return false;
  }

  return (await AndroidRecents.getExcluded()).excluded;
}

export async function setAndroidRecentsExcluded(excluded: boolean) {
  if (!canControlAndroidRecents()) {
    return false;
  }

  return (await AndroidRecents.setExcluded({ excluded })).excluded;
}
