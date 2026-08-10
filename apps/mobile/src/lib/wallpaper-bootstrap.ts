export type WallpaperBootstrapMode = "cover";

export type WallpaperBootstrap = {
  blurImageUrl: string;
  mainImageUrl: string;
  mode: WallpaperBootstrapMode;
  version: 1;
};

export const WALLPAPER_BOOTSTRAP_STORAGE_KEY =
  "ddl-reminder:wallpaper-bootstrap";

const BOOTSTRAP_MODE_ATTRIBUTE = "wallpaperBootstrapMode";
const BOOTSTRAP_MAIN_PROPERTY = "--startup-wallpaper-main";
const BOOTSTRAP_BLUR_PROPERTY = "--startup-wallpaper-blur";
const MAX_BOOTSTRAP_URL_LENGTH = 4096;

export function createWallpaperBootstrap(
  mode: WallpaperBootstrapMode,
  mainImageUrl: string,
  blurImageUrl: string
): WallpaperBootstrap | null {
  const candidate = {
    blurImageUrl,
    mainImageUrl,
    mode,
    version: 1
  };

  return normalizeWallpaperBootstrap(candidate);
}

export function parseWallpaperBootstrap(
  value: string | null
): WallpaperBootstrap | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return normalizeWallpaperBootstrap(parsed);
  } catch {
    return null;
  }
}

export function persistWallpaperBootstrap(
  mode: WallpaperBootstrapMode,
  mainImageUrl: string,
  blurImageUrl: string
) {
  const bootstrap = createWallpaperBootstrap(mode, mainImageUrl, blurImageUrl);

  if (!bootstrap) {
    clearWallpaperBootstrap();
    return;
  }

  try {
    window.localStorage.setItem(
      WALLPAPER_BOOTSTRAP_STORAGE_KEY,
      JSON.stringify(bootstrap)
    );
  } catch {
    // The current frame can still use the validated wallpaper when storage is full.
  }

  applyWallpaperBootstrap(document.documentElement, bootstrap);
}

export function clearWallpaperBootstrap() {
  try {
    window.localStorage.removeItem(WALLPAPER_BOOTSTRAP_STORAGE_KEY);
  } catch {
    // Keep clearing the in-memory document state even if storage is unavailable.
  }

  const root = document.documentElement;

  delete root.dataset[BOOTSTRAP_MODE_ATTRIBUTE];
  root.style.removeProperty(BOOTSTRAP_MAIN_PROPERTY);
  root.style.removeProperty(BOOTSTRAP_BLUR_PROPERTY);
}

function applyWallpaperBootstrap(
  root: HTMLElement,
  bootstrap: WallpaperBootstrap
) {
  root.dataset[BOOTSTRAP_MODE_ATTRIBUTE] = bootstrap.mode;
  root.style.setProperty(
    BOOTSTRAP_MAIN_PROPERTY,
    toCssBackgroundImage(bootstrap.mainImageUrl)
  );
  root.style.setProperty(
    BOOTSTRAP_BLUR_PROPERTY,
    toCssBackgroundImage(bootstrap.blurImageUrl)
  );
}

function normalizeWallpaperBootstrap(
  value: unknown
): WallpaperBootstrap | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (
    candidate["version"] !== 1 ||
    (candidate["mode"] !== "cover" && candidate["mode"] !== "contain-blur") ||
    !isSafeNativeWallpaperUrl(candidate["mainImageUrl"]) ||
    !isSafeNativeWallpaperUrl(candidate["blurImageUrl"]) ||
    candidate["mainImageUrl"] === candidate["blurImageUrl"]
  ) {
    return null;
  }

  return {
    blurImageUrl: candidate["blurImageUrl"],
    mainImageUrl: candidate["mainImageUrl"],
    mode: "cover",
    version: 1
  };
}

function isSafeNativeWallpaperUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_BOOTSTRAP_URL_LENGTH
  ) {
    return false;
  }

  try {
    const url = new URL(value);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname === "localhost" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname.startsWith("/_capacitor_file_/")
    );
  } catch {
    return false;
  }
}

function toCssBackgroundImage(url: string) {
  return `url(${JSON.stringify(url)})`;
}

export const WALLPAPER_BOOTSTRAP_SCRIPT = `
(function () {
  var key = ${JSON.stringify(WALLPAPER_BOOTSTRAP_STORAGE_KEY)};
  var root = document.documentElement;
  var mainProperty = ${JSON.stringify(BOOTSTRAP_MAIN_PROPERTY)};
  var blurProperty = ${JSON.stringify(BOOTSTRAP_BLUR_PROPERTY)};

  function clearBootstrap() {
    delete root.dataset.wallpaperBootstrapMode;
    root.style.removeProperty(mainProperty);
    root.style.removeProperty(blurProperty);
  }

  function isSafeUrl(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > ${MAX_BOOTSTRAP_URL_LENGTH}) {
      return false;
    }

    try {
      var url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname === "localhost" &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        url.pathname.indexOf("/_capacitor_file_/") === 0;
    } catch (_) {
      return false;
    }
  }

  try {
    var raw = window.localStorage.getItem(key);
    var value = raw ? JSON.parse(raw) : null;
    var valid = value &&
      value.version === 1 &&
      (value.mode === "cover" || value.mode === "contain-blur") &&
      isSafeUrl(value.mainImageUrl) &&
      isSafeUrl(value.blurImageUrl) &&
      value.mainImageUrl !== value.blurImageUrl;

    if (!valid) {
      window.localStorage.removeItem(key);
      clearBootstrap();
      return;
    }

    if (value.mode !== "cover") {
      value = {
        blurImageUrl: value.blurImageUrl,
        mainImageUrl: value.mainImageUrl,
        mode: "cover",
        version: 1
      };
      window.localStorage.setItem(key, JSON.stringify(value));
    }

    root.dataset.wallpaperBootstrapMode = "cover";
    root.style.setProperty(mainProperty, "url(" + JSON.stringify(value.mainImageUrl) + ")");
    root.style.setProperty(blurProperty, "url(" + JSON.stringify(value.blurImageUrl) + ")");
  } catch (_) {
    try {
      window.localStorage.removeItem(key);
    } catch (_) {}
    clearBootstrap();
  }
})();
`.trim();
