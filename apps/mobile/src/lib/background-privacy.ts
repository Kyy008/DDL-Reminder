import { Capacitor, registerPlugin } from "@capacitor/core";

export type BackgroundPrivacyKind = "android-recents";

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

export function getBackgroundPrivacyKind(): BackgroundPrivacyKind | null {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  return Capacitor.getPlatform() === "android" ? "android-recents" : null;
}

export function canControlBackgroundPrivacy() {
  return getBackgroundPrivacyKind() !== null;
}

export async function getBackgroundPrivacyEnabled() {
  const kind = getBackgroundPrivacyKind();

  if (kind === "android-recents") {
    return (await AndroidRecents.getExcluded()).excluded;
  }

  return false;
}

export async function setBackgroundPrivacyEnabled(enabled: boolean) {
  const kind = getBackgroundPrivacyKind();

  if (kind === "android-recents") {
    return (await AndroidRecents.setExcluded({ excluded: enabled })).excluded;
  }

  return false;
}
