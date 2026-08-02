"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import {
  canUseAndroidWallpaperProcessor,
  chooseAndPrepareAndroidWallpaper
} from "@/lib/android-wallpaper";
import {
  clearWallpaperBootstrap,
  persistWallpaperBootstrap
} from "@/lib/wallpaper-bootstrap";
import {
  commitNativePreparedWallpaper,
  DEFAULT_WALLPAPER_CONFIG,
  loadStoredWallpaper,
  prepareWallpaperFile,
  resetStoredWallpaper,
  savePreparedWallpaper,
  type NativePreparedWallpaper,
  type StoredWallpaper,
  type WallpaperConfig
} from "@/lib/wallpaper";

type WallpaperNotice = {
  text: string;
  tone: "error" | "success";
} | null;

export type WallpaperBusyAction = "choose" | "reset" | "restore" | null;

type WallpaperContextValue = {
  busyAction: WallpaperBusyAction;
  chooseWallpaper: () => Promise<void>;
  config: WallpaperConfig;
  isBusy: boolean;
  isLoading: boolean;
  mainImageUrl: string;
  notice: WallpaperNotice;
  resetWallpaper: () => Promise<void>;
};

const DEFAULT_WALLPAPER_URL = "/background.png";
const DEFAULT_WALLPAPER_DECODE_TIMEOUT_MS = 700;
const STARTUP_WALLPAPER_TIMEOUT_MS = 2500;
const WallpaperContext = createContext<WallpaperContextValue | null>(null);
let defaultWallpaperPreparation: Promise<void> | null = null;

export function WallpaperProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<WallpaperConfig>(
    DEFAULT_WALLPAPER_CONFIG
  );
  const [mainImageUrl, setMainImageUrl] = useState(DEFAULT_WALLPAPER_URL);
  const [blurImageUrl, setBlurImageUrl] = useState(DEFAULT_WALLPAPER_URL);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<WallpaperBusyAction>(null);
  const [notice, setNotice] = useState<WallpaperNotice>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const loadRequestRef = useRef(0);
  const isMountedRef = useRef(true);

  const reloadStoredWallpaper = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    const stored = await loadStoredWallpaper();
    const prepared = await prepareStoredWallpaperForDisplay(stored);

    if (!isMountedRef.current || requestId !== loadRequestRef.current) {
      revokeStoredObjectUrls(stored);
      return stored;
    }

    revokeObjectUrls(objectUrlsRef.current);
    objectUrlsRef.current = [
      prepared.mainImageUrl,
      prepared.blurImageUrl
    ].filter((url): url is string => Boolean(url?.startsWith("blob:")));
    setConfig(prepared.config);
    setMainImageUrl(prepared.mainImageUrl ?? DEFAULT_WALLPAPER_URL);
    setBlurImageUrl(
      prepared.blurImageUrl ?? prepared.mainImageUrl ?? DEFAULT_WALLPAPER_URL
    );

    if (prepared.loadError) {
      setNotice({
        text: prepared.loadError,
        tone: "error"
      });
    }

    return prepared;
  }, []);

  const importWebFile = useCallback(
    async (file: File) => {
      const prepared = await prepareWallpaperFile(file);

      await savePreparedWallpaper(prepared);
      await reloadStoredWallpaper();
      setNotice({
        text: "背景图片已保存，横竖屏都会自动适配。",
        tone: "success"
      });
    },
    [reloadStoredWallpaper]
  );

  const importNativePreparedWallpaper = useCallback(
    async (prepared: NativePreparedWallpaper) => {
      await commitNativePreparedWallpaper(prepared);
      await reloadStoredWallpaper();
      setNotice({
        text: "背景图片已保存，横竖屏都会自动适配。",
        tone: "success"
      });
    },
    [reloadStoredWallpaper]
  );

  useEffect(() => {
    isMountedRef.current = true;
    let effectDisposed = false;
    let startupFinished = false;

    void prepareDefaultWallpaperForDisplay();

    const startupTimeout = window.setTimeout(() => {
      if (!isMountedRef.current || startupFinished) {
        return;
      }

      startupFinished = true;
      loadRequestRef.current += 1;
      void prepareDefaultWallpaperForDisplay().then(() => {
        if (effectDisposed || !isMountedRef.current) {
          return;
        }

        setConfig({ ...DEFAULT_WALLPAPER_CONFIG });
        setMainImageUrl(DEFAULT_WALLPAPER_URL);
        setBlurImageUrl(DEFAULT_WALLPAPER_URL);
        setNotice({
          text: "自定义背景加载超时，已暂时使用默认背景。下次打开 App 时会再试。",
          tone: "error"
        });
        setIsLoading(false);
      });
    }, STARTUP_WALLPAPER_TIMEOUT_MS);

    void reloadStoredWallpaper()
      .catch(async () => {
        await prepareDefaultWallpaperForDisplay();

        if (isMountedRef.current && !startupFinished) {
          setNotice({
            text: "自定义背景没能加载，已暂时使用默认背景。下次打开 App 时会再试。",
            tone: "error"
          });
        }
      })
      .finally(() => {
        if (!isMountedRef.current || startupFinished) {
          return;
        }

        startupFinished = true;
        window.clearTimeout(startupTimeout);
        setIsLoading(false);
      });

    return () => {
      effectDisposed = true;
      startupFinished = true;
      window.clearTimeout(startupTimeout);
      isMountedRef.current = false;
      loadRequestRef.current += 1;
    };
  }, [reloadStoredWallpaper]);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (Capacitor.isNativePlatform() && config.custom) {
      persistWallpaperBootstrap(config.mode, mainImageUrl, blurImageUrl);
    } else {
      clearWallpaperBootstrap();
    }
  }, [blurImageUrl, config, isLoading, mainImageUrl]);

  useEffect(() => {
    if (isLoading || !Capacitor.isNativePlatform()) {
      return;
    }

    let isDisposed = false;

    void waitForCommittedPaint()
      .then(async () => {
        if (!isDisposed) {
          await SplashScreen.hide();
        }
      })
      .catch(() => {
        // Native auto-hide remains as a final safeguard if the plugin call fails.
      });

    return () => {
      isDisposed = true;
    };
  }, [isLoading]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let isDisposed = false;
    let removeListener: (() => Promise<void>) | undefined;

    void App.addListener("appRestoredResult", (event) => {
      if (!event.success) {
        return;
      }

      if (
        event.pluginId === "AndroidWallpaper" &&
        event.methodName === "chooseAndPrepare" &&
        isNativePreparedWallpaper(event.data)
      ) {
        setBusyAction("restore");
        setNotice(null);
        void importNativePreparedWallpaper(event.data)
          .catch((error) => {
            setNotice({
              text: getErrorMessage(error),
              tone: "error"
            });
          })
          .finally(() => setBusyAction(null));
        return;
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
  }, [importNativePreparedWallpaper]);

  useEffect(
    () => () => {
      revokeObjectUrls(objectUrlsRef.current);
    },
    []
  );

  const chooseWallpaper = useCallback(async () => {
    setBusyAction("choose");
    setNotice(null);

    try {
      if (canUseAndroidWallpaperProcessor()) {
        await importNativePreparedWallpaper(
          await chooseAndPrepareAndroidWallpaper()
        );
      } else {
        const file = await chooseImageFile();

        if (file) {
          await importWebFile(file);
        }
      }
    } catch (error) {
      if (!isWallpaperPickerCancellation(error)) {
        setNotice({
          text: getErrorMessage(error),
          tone: "error"
        });
      }
    } finally {
      setBusyAction(null);
    }
  }, [importNativePreparedWallpaper, importWebFile]);

  const resetWallpaper = useCallback(async () => {
    setBusyAction("reset");
    setNotice(null);

    try {
      await resetStoredWallpaper();
      await reloadStoredWallpaper();
      setNotice({
        text: "已恢复默认背景。",
        tone: "success"
      });
    } catch (error) {
      setNotice({
        text: getErrorMessage(error),
        tone: "error"
      });
    } finally {
      setBusyAction(null);
    }
  }, [reloadStoredWallpaper]);

  const contextValue = useMemo<WallpaperContextValue>(
    () => ({
      busyAction,
      chooseWallpaper,
      config,
      isBusy: busyAction !== null,
      isLoading,
      mainImageUrl,
      notice,
      resetWallpaper
    }),
    [
      busyAction,
      chooseWallpaper,
      config,
      isLoading,
      mainImageUrl,
      notice,
      resetWallpaper
    ]
  );

  return (
    <WallpaperContext.Provider value={contextValue}>
      {isLoading ? (
        <div aria-hidden="true" className="app-boot-cover">
          <div className="app-boot-brand">
            <span className="app-boot-icon" />
            <span>DDL-Reminder</span>
          </div>
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className="app-wallpaper"
        data-loading={isLoading ? "true" : "false"}
      >
        <div
          className="app-wallpaper-blur"
          style={
            isLoading
              ? undefined
              : { backgroundImage: `url(${JSON.stringify(blurImageUrl)})` }
          }
        />
        <div
          className="app-wallpaper-main"
          style={
            isLoading
              ? undefined
              : { backgroundImage: `url(${JSON.stringify(mainImageUrl)})` }
          }
        />
        <div className="app-wallpaper-overlay" />
      </div>
      <div className="app-foreground">{children}</div>
    </WallpaperContext.Provider>
  );
}

export function useWallpaper() {
  const context = useContext(WallpaperContext);

  if (!context) {
    throw new Error("useWallpaper 必须在 WallpaperProvider 中使用。");
  }

  return context;
}

async function prepareStoredWallpaperForDisplay(
  stored: StoredWallpaper
): Promise<StoredWallpaper> {
  if (!stored.mainImageUrl || !stored.blurImageUrl) {
    await prepareDefaultWallpaperForDisplay();
    return stored;
  }

  try {
    await Promise.all([
      decodeImageUrl(stored.mainImageUrl),
      decodeImageUrl(stored.blurImageUrl)
    ]);

    return stored;
  } catch {
    revokeStoredObjectUrls(stored);
    await prepareDefaultWallpaperForDisplay();

    return {
      ...stored,
      blurImageUrl: null,
      loadError:
        "无法打开自定义背景图片，已暂时使用默认背景。你可以重新选择图片或恢复默认背景。",
      mainImageUrl: null
    };
  }
}

function waitForCommittedPaint() {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = window.setTimeout(finish, 250);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(finish);
    });
  });
}

function prepareDefaultWallpaperForDisplay() {
  if (!defaultWallpaperPreparation) {
    defaultWallpaperPreparation = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        resolve();
      };
      const timeoutId = window.setTimeout(
        finish,
        DEFAULT_WALLPAPER_DECODE_TIMEOUT_MS
      );

      void decodeImageUrl(DEFAULT_WALLPAPER_URL).then(finish, finish);
    });
  }

  return defaultWallpaperPreparation;
}

async function decodeImageUrl(url: string) {
  const image = new Image();

  image.decoding = "async";

  if (typeof image.decode === "function") {
    image.src = url;
    await image.decode();
  } else {
    await new Promise<void>((resolve, reject) => {
      const handleLoad = () => finish(resolve);
      const handleError = () =>
        finish(() => reject(new Error("图片加载失败。")));
      const finish = (settle: () => void) => {
        image.removeEventListener("load", handleLoad);
        image.removeEventListener("error", handleError);
        settle();
      };

      image.addEventListener("load", handleLoad);
      image.addEventListener("error", handleError);
      image.src = url;

      if (image.complete) {
        queueMicrotask(() => {
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            handleLoad();
          } else {
            handleError();
          }
        });
      }
    });
  }

  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error("无法读取图片尺寸，请换一张图片。");
  }
}

function chooseImageFile() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    let settled = false;

    input.accept = "image/*";
    input.type = "file";

    const finish = (file: File | null) => {
      if (settled) {
        return;
      }

      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener(
      "change",
      () => finish(input.files?.item(0) ?? null),
      { once: true }
    );
    input.addEventListener("cancel", () => finish(null), { once: true });
    input.style.display = "none";
    document.body.append(input);
    input.click();
  });
}

function isNativePreparedWallpaper(
  value: unknown
): value is NativePreparedWallpaper {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    blur?: unknown;
    main?: unknown;
  };

  return (
    isNativeWallpaperAsset(candidate.main) &&
    isNativeWallpaperAsset(candidate.blur)
  );
}

function isNativeWallpaperAsset(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const asset = value as Record<string, unknown>;

  return (
    typeof asset["path"] === "string" &&
    typeof asset["width"] === "number" &&
    typeof asset["height"] === "number" &&
    typeof asset["bytes"] === "number" &&
    asset["mimeType"] === "image/jpeg"
  );
}

function isWallpaperPickerCancellation(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";

  return (
    code === "WALLPAPER_PICKER_CANCELLED" ||
    code === "OS-PLUG-CAMR-0006" ||
    code === "OS-PLUG-CAMR-0020" ||
    /cancel|取消/i.test(message)
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "背景设置失败，请再试一次。";
}

function revokeStoredObjectUrls(stored: StoredWallpaper) {
  revokeObjectUrls(
    [stored.mainImageUrl, stored.blurImageUrl].filter((url): url is string =>
      Boolean(url?.startsWith("blob:"))
    )
  );
}

function revokeObjectUrls(urls: string[]) {
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
}
