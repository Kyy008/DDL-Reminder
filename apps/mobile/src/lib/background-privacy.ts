import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { PrivacyScreen } from "@capacitor/privacy-screen";

export type BackgroundPrivacyKind = "android-recents" | "ios-preview";

type AndroidRecentsResult = {
  excluded: boolean;
};

type AndroidRecentsPlugin = {
  getExcluded: () => Promise<AndroidRecentsResult>;
  setExcluded: (options: {
    excluded: boolean;
  }) => Promise<AndroidRecentsResult>;
};

const IOS_BACKGROUND_PRIVACY_KEY = "ddl-reminder:hide-background-preview";
const AndroidRecents = registerPlugin<AndroidRecentsPlugin>("AndroidRecents");

export function getBackgroundPrivacyKind(): BackgroundPrivacyKind | null {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  const platform = Capacitor.getPlatform();

  if (platform === "android") {
    return "android-recents";
  }

  if (platform === "ios") {
    return "ios-preview";
  }

  return null;
}

export function canControlBackgroundPrivacy() {
  return getBackgroundPrivacyKind() !== null;
}

export async function getBackgroundPrivacyEnabled() {
  const kind = getBackgroundPrivacyKind();

  if (kind === "android-recents") {
    return (await AndroidRecents.getExcluded()).excluded;
  }

  if (kind === "ios-preview") {
    return readIOSBackgroundPrivacyPreference();
  }

  return false;
}

export async function setBackgroundPrivacyEnabled(enabled: boolean) {
  const kind = getBackgroundPrivacyKind();

  if (kind === "android-recents") {
    return (await AndroidRecents.setExcluded({ excluded: enabled })).excluded;
  }

  if (kind === "ios-preview") {
    await applyIOSBackgroundPrivacy(enabled);
    await Preferences.set({
      key: IOS_BACKGROUND_PRIVACY_KEY,
      value: String(enabled)
    });
    return enabled;
  }

  return false;
}

export async function initializeBackgroundPrivacy() {
  if (getBackgroundPrivacyKind() !== "ios-preview") {
    return false;
  }

  const enabled = await readIOSBackgroundPrivacyPreference();

  await applyIOSBackgroundPrivacy(enabled);
  return enabled;
}

async function readIOSBackgroundPrivacyPreference() {
  return (
    (
      await Preferences.get({
        key: IOS_BACKGROUND_PRIVACY_KEY
      })
    ).value === "true"
  );
}

async function applyIOSBackgroundPrivacy(enabled: boolean) {
  if (enabled) {
    await PrivacyScreen.enable({
      ios: {
        blurEffect: "dark"
      }
    });
  } else {
    await PrivacyScreen.disable();
  }
}
