import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";

export type WallpaperMode = "cover";

export type WallpaperAsset = {
  bytes: number;
  height: number;
  mimeType: "image/jpeg";
  path: string;
  width: number;
};

export type WallpaperConfig = {
  custom: {
    blur: WallpaperAsset;
    main: WallpaperAsset;
    updatedAt: string;
  } | null;
  mode: WallpaperMode;
  version: 1;
};

type EncodedWallpaperAsset = {
  base64: string;
  blob: Blob;
  height: number;
  mimeType: "image/jpeg";
  width: number;
};

export type PreparedWallpaper = {
  blur: EncodedWallpaperAsset;
  main: EncodedWallpaperAsset;
};

export type NativePreparedWallpaper = {
  blur: WallpaperAsset;
  main: WallpaperAsset;
};

export type StoredWallpaper = {
  blurImageUrl: string | null;
  config: WallpaperConfig;
  loadError: string | null;
  mainImageUrl: string | null;
};

export const DEFAULT_WALLPAPER_CONFIG: WallpaperConfig = {
  custom: null,
  mode: "cover",
  version: 1
};

export const MAX_WALLPAPER_SOURCE_BYTES = 30 * 1024 * 1024;
export const MAX_WALLPAPER_EDGE = 2880;
export const MAX_WALLPAPER_PIXELS = 8_000_000;

const WALLPAPER_CONFIG_KEY = "ddl-reminder:wallpaper-config";
const WALLPAPER_DIRECTORY = "wallpapers";
const MAIN_MAX_BYTES = 5 * 1024 * 1024;
const BLUR_MAX_BYTES = 300 * 1024;
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let wallpaperMutationQueue: Promise<void> = Promise.resolve();

export function calculateWallpaperDimensions(
  width: number,
  height: number,
  maxEdge = MAX_WALLPAPER_EDGE,
  maxPixels = MAX_WALLPAPER_PIXELS
) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxEdge) ||
    !Number.isFinite(maxPixels) ||
    width <= 0 ||
    height <= 0 ||
    maxEdge <= 0 ||
    maxPixels <= 0
  ) {
    throw new Error("无法读取图片尺寸，请换一张图片。");
  }

  const edgeScale = maxEdge / Math.max(width, height);
  const pixelScale = Math.sqrt(maxPixels / (width * height));
  const scale = Math.min(1, edgeScale, pixelScale);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export function parseWallpaperConfig(value: string | null): WallpaperConfig {
  if (!value) {
    return { ...DEFAULT_WALLPAPER_CONFIG };
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!isRecord(parsed) || parsed["version"] !== 1) {
      return { ...DEFAULT_WALLPAPER_CONFIG };
    }

    const custom = parseCustomWallpaper(parsed["custom"]);

    return {
      custom,
      mode: "cover",
      version: 1
    };
  } catch {
    return { ...DEFAULT_WALLPAPER_CONFIG };
  }
}

export async function loadStoredWallpaper(): Promise<StoredWallpaper> {
  await wallpaperMutationQueue;

  return loadStoredWallpaperInternal();
}

async function loadStoredWallpaperInternal(): Promise<StoredWallpaper> {
  const storedConfig = await Preferences.get({ key: WALLPAPER_CONFIG_KEY });
  const config = parseWallpaperConfig(storedConfig.value);

  void cleanupWallpaperOrphans(config);

  if (!config.custom) {
    return {
      blurImageUrl: null,
      config,
      loadError: null,
      mainImageUrl: null
    };
  }

  try {
    const [mainImageUrl, blurImageUrl] = await Promise.all([
      loadWallpaperAssetUrl(config.custom.main),
      loadWallpaperAssetUrl(config.custom.blur)
    ]);

    return {
      blurImageUrl,
      config,
      loadError: null,
      mainImageUrl
    };
  } catch {
    return {
      blurImageUrl: null,
      config,
      loadError: "自定义背景暂时无法读取，已改用默认背景。原来的设置仍然保留。",
      mainImageUrl: null
    };
  }
}

export async function savePreparedWallpaper(
  wallpaper: PreparedWallpaper,
  mode?: WallpaperMode
) {
  return enqueueWallpaperMutation(() =>
    savePreparedWallpaperInternal(wallpaper, mode)
  );
}

async function savePreparedWallpaperInternal(
  wallpaper: PreparedWallpaper,
  mode?: WallpaperMode
) {
  const oldConfig = parseWallpaperConfig(
    (await Preferences.get({ key: WALLPAPER_CONFIG_KEY })).value
  );
  const revision = createRevision();
  const mainPath = `${WALLPAPER_DIRECTORY}/${revision}-main.jpg`;
  const blurPath = `${WALLPAPER_DIRECTORY}/${revision}-blur.jpg`;
  const newPaths = [mainPath, blurPath];

  try {
    await Filesystem.writeFile({
      data: wallpaper.main.base64,
      directory: Directory.Data,
      path: mainPath,
      recursive: true
    });
    await Filesystem.writeFile({
      data: wallpaper.blur.base64,
      directory: Directory.Data,
      path: blurPath,
      recursive: true
    });

    const [mainStat, blurStat] = await Promise.all(
      newPaths.map((path) =>
        Filesystem.stat({
          directory: Directory.Data,
          path
        })
      )
    );

    if (mainStat.size <= 0 || blurStat.size <= 0) {
      throw new Error("背景图片保存失败，请重试。");
    }

    const config: WallpaperConfig = {
      custom: {
        blur: toWallpaperAsset(
          wallpaper.blur,
          blurPath,
          wallpaper.blur.blob.size
        ),
        main: toWallpaperAsset(
          wallpaper.main,
          mainPath,
          wallpaper.main.blob.size
        ),
        updatedAt: new Date().toISOString()
      },
      mode: mode ?? oldConfig.mode,
      version: 1
    };

    await persistWallpaperConfig(config);
    await deleteConfigAssetsBestEffort(oldConfig);

    return config;
  } catch (error) {
    await Promise.all(newPaths.map(deleteWallpaperFileBestEffort));
    throw error;
  }
}

export async function resetStoredWallpaper() {
  return enqueueWallpaperMutation(async () => {
    const oldConfig = parseWallpaperConfig(
      (await Preferences.get({ key: WALLPAPER_CONFIG_KEY })).value
    );

    await persistWallpaperConfig(DEFAULT_WALLPAPER_CONFIG);
    await deleteConfigAssetsBestEffort(oldConfig);

    return { ...DEFAULT_WALLPAPER_CONFIG };
  });
}

export async function commitNativePreparedWallpaper(
  prepared: NativePreparedWallpaper
) {
  return enqueueWallpaperMutation(async () => {
    const parsed = parseNativePreparedWallpaper(prepared);

    if (!parsed) {
      throw new Error("图片处理失败，请重新选择。");
    }

    const oldConfig = parseWallpaperConfig(
      (await Preferences.get({ key: WALLPAPER_CONFIG_KEY })).value
    );

    try {
      await verifyStoredWallpaperAsset(parsed.main);
      await verifyStoredWallpaperAsset(parsed.blur);

      const config: WallpaperConfig = {
        custom: {
          blur: parsed.blur,
          main: parsed.main,
          updatedAt: new Date().toISOString()
        },
        mode: oldConfig.mode,
        version: 1
      };

      await persistWallpaperConfig(config);
      await deleteConfigAssetsBestEffort(oldConfig);

      return config;
    } catch (error) {
      await Promise.all([
        deleteWallpaperFileBestEffort(parsed.main.path),
        deleteWallpaperFileBestEffort(parsed.blur.path)
      ]);
      throw error;
    }
  });
}

export async function prepareWallpaperFile(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件。");
  }

  return prepareWallpaperBlob(file);
}

export async function prepareWallpaperBlob(blob: Blob) {
  if (blob.size <= 0) {
    throw new Error("无法读取所选图片，请重新选择。");
  }

  if (blob.size > MAX_WALLPAPER_SOURCE_BYTES) {
    throw new Error("请选择不超过 30 MB 的图片。");
  }

  const decodedImage = await decodeWallpaperImage(blob);

  try {
    const mainDimensions = calculateWallpaperDimensions(
      decodedImage.width,
      decodedImage.height
    );
    const blurDimensions = calculateWallpaperDimensions(
      decodedImage.width,
      decodedImage.height,
      640,
      640 * 640
    );
    const main = await renderWallpaperAsset(
      decodedImage.source,
      mainDimensions,
      MAIN_MAX_BYTES,
      [0.86, 0.78, 0.7, 0.62, 0.54]
    );
    const blur = await renderWallpaperAsset(
      decodedImage.source,
      blurDimensions,
      BLUR_MAX_BYTES,
      [0.76, 0.66, 0.56, 0.46]
    );

    return {
      blur,
      main
    };
  } finally {
    decodedImage.dispose();
  }
}

async function loadWallpaperAssetUrl(asset: WallpaperAsset) {
  await verifyStoredWallpaperAsset(asset);

  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.getUri({
      directory: Directory.Data,
      path: asset.path
    });

    return Capacitor.convertFileSrc(uri);
  }

  const result = await Filesystem.readFile({
    directory: Directory.Data,
    path: asset.path
  });

  return typeof result.data === "string"
    ? `data:${asset.mimeType};base64,${result.data}`
    : URL.createObjectURL(
        result.data.type
          ? result.data
          : new Blob([result.data], { type: asset.mimeType })
      );
}

async function verifyStoredWallpaperAsset(asset: WallpaperAsset) {
  const stat = await Filesystem.stat({
    directory: Directory.Data,
    path: asset.path
  });

  if (
    stat.type !== "file" ||
    stat.size <= 0 ||
    (Capacitor.isNativePlatform() && stat.size !== asset.bytes)
  ) {
    throw new Error("背景图片保存失败，请重试。");
  }
}

async function renderWallpaperAsset(
  source: CanvasImageSource,
  dimensions: {
    height: number;
    width: number;
  },
  targetBytes: number,
  qualities: number[]
): Promise<EncodedWallpaperAsset> {
  let canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;

  const context = canvas.getContext("2d", {
    alpha: false
  });

  if (!context) {
    throw new Error("手机无法处理这张图片，请换一张再试。");
  }

  context.fillStyle = "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, dimensions.width, dimensions.height);

  let encoded: Blob | null = null;

  for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
    for (const quality of qualities) {
      encoded = await canvasToBlob(canvas, "image/jpeg", quality);

      if (encoded && encoded.size <= targetBytes) {
        break;
      }
    }

    if (encoded && encoded.size <= targetBytes) {
      break;
    }

    const nextCanvas = document.createElement("canvas");
    nextCanvas.width = Math.max(1, Math.round(canvas.width * 0.85));
    nextCanvas.height = Math.max(1, Math.round(canvas.height * 0.85));
    const nextContext = nextCanvas.getContext("2d", {
      alpha: false
    });

    if (!nextContext) {
      throw new Error("手机无法继续压缩这张图片，请换一张再试。");
    }

    nextContext.fillStyle = "#000000";
    nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    nextContext.imageSmoothingEnabled = true;
    nextContext.imageSmoothingQuality = "high";
    nextContext.drawImage(canvas, 0, 0, nextCanvas.width, nextCanvas.height);
    canvas.width = 1;
    canvas.height = 1;
    canvas = nextCanvas;
  }

  if (!encoded || encoded.size > targetBytes) {
    throw new Error("压缩后的图片还是太大，请换张图片再试。");
  }

  const dataUrl = await blobToDataUrl(encoded);

  return {
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    blob: encoded,
    height: canvas.height,
    mimeType: "image/jpeg",
    width: canvas.width
  };
}

async function decodeWallpaperImage(blob: Blob): Promise<{
  dispose: () => void;
  height: number;
  source: CanvasImageSource;
  width: number;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: "from-image"
      });

      return {
        dispose: () => bitmap.close(),
        height: bitmap.height,
        source: bitmap,
        width: bitmap.width
      };
    } catch {
      // Some OEM WebViews expose createImageBitmap but cannot decode every
      // gallery format. HTMLImageElement is the compatibility fallback.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();

  try {
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();

    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new Error("无法读取图片尺寸，请换一张图片。");
    }

    return {
      dispose: () => URL.revokeObjectURL(objectUrl),
      height: image.naturalHeight,
      source: image,
      width: image.naturalWidth
    };
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error("无法打开这张图片，请改用 JPEG、PNG 或 WebP 格式。");
  }
}

function parseCustomWallpaper(value: unknown): WallpaperConfig["custom"] {
  if (!isRecord(value)) {
    return null;
  }

  const main = parseWallpaperAsset(value["main"], "main");
  const blur = parseWallpaperAsset(value["blur"], "blur");
  const updatedAt =
    typeof value["updatedAt"] === "string" ? value["updatedAt"] : null;

  if (
    !main ||
    !blur ||
    !updatedAt ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    getWallpaperRevision(main.path, "main") !==
      getWallpaperRevision(blur.path, "blur")
  ) {
    return null;
  }

  return {
    blur,
    main,
    updatedAt
  };
}

function parseWallpaperAsset(
  value: unknown,
  role: "blur" | "main"
): WallpaperAsset | null {
  if (!isRecord(value)) {
    return null;
  }

  const path = value["path"];
  const width = toStoredPositiveInteger(value["width"], 100_000);
  const height = toStoredPositiveInteger(value["height"], 100_000);
  const bytes = toStoredPositiveInteger(
    value["bytes"],
    role === "main" ? MAIN_MAX_BYTES : BLUR_MAX_BYTES
  );
  const maxEdge = role === "main" ? MAX_WALLPAPER_EDGE : 640;
  const maxPixels = role === "main" ? MAX_WALLPAPER_PIXELS : 640 * 640;

  if (
    typeof path !== "string" ||
    !new RegExp(`^wallpapers/[a-zA-Z0-9_-]+-${role}\\.jpg$`).test(path) ||
    value["mimeType"] !== "image/jpeg" ||
    width === null ||
    height === null ||
    bytes === null ||
    Math.max(width, height) > maxEdge ||
    width * height > maxPixels
  ) {
    return null;
  }

  return {
    bytes,
    height,
    mimeType: "image/jpeg",
    path,
    width
  };
}

function parseNativePreparedWallpaper(
  value: NativePreparedWallpaper
): NativePreparedWallpaper | null {
  if (!isRecord(value)) {
    return null;
  }

  const main = parseWallpaperAsset(value["main"], "main");
  const blur = parseWallpaperAsset(value["blur"], "blur");

  if (
    !main ||
    !blur ||
    getWallpaperRevision(main.path, "main") !==
      getWallpaperRevision(blur.path, "blur")
  ) {
    return null;
  }

  return {
    blur,
    main
  };
}

function getWallpaperRevision(path: string, role: "blur" | "main") {
  const match = path.match(
    new RegExp(`^wallpapers/([a-zA-Z0-9_-]+)-${role}\\.jpg$`)
  );

  return match?.[1] ?? null;
}

function toWallpaperAsset(
  asset: EncodedWallpaperAsset,
  path: string,
  bytes: number
): WallpaperAsset {
  return {
    bytes,
    height: asset.height,
    mimeType: asset.mimeType,
    path,
    width: asset.width
  };
}

async function persistWallpaperConfig(config: WallpaperConfig) {
  await Preferences.set({
    key: WALLPAPER_CONFIG_KEY,
    value: JSON.stringify(config)
  });
}

function enqueueWallpaperMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = wallpaperMutationQueue.then(operation, operation);

  wallpaperMutationQueue = result.then(
    () => undefined,
    () => undefined
  );

  return result;
}

async function deleteConfigAssetsBestEffort(config: WallpaperConfig) {
  if (!config.custom) {
    return;
  }

  await Promise.all([
    deleteWallpaperFileBestEffort(config.custom.main.path),
    deleteWallpaperFileBestEffort(config.custom.blur.path)
  ]);
}

async function deleteWallpaperFileBestEffort(path: string) {
  try {
    await Filesystem.deleteFile({
      directory: Directory.Data,
      path
    });
  } catch {
    // Old or partially written files must not block the active wallpaper.
  }
}

async function cleanupWallpaperOrphans(config: WallpaperConfig) {
  const activePaths = new Set(
    config.custom ? [config.custom.main.path, config.custom.blur.path] : []
  );

  try {
    const { files } = await Filesystem.readdir({
      directory: Directory.Data,
      path: WALLPAPER_DIRECTORY
    });
    const now = Date.now();

    await Promise.all(
      files
        .filter(({ name, mtime, type }) => {
          if (
            type !== "file" ||
            !/^[a-zA-Z0-9_-]+-(main|blur)\.jpg(?:\.tmp)?$/.test(name)
          ) {
            return false;
          }

          const path = `${WALLPAPER_DIRECTORY}/${name}`;

          return (
            !activePaths.has(path) &&
            Number.isFinite(mtime) &&
            now - mtime >= ORPHAN_MAX_AGE_MS
          );
        })
        .map(({ name }) =>
          deleteWallpaperFileBestEffort(`${WALLPAPER_DIRECTORY}/${name}`)
        )
    );
  } catch {
    // A missing directory and transient cleanup failures do not affect the
    // active wallpaper.
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("无法读取背景图片。"));
      }
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("无法读取背景图片。"));
    });
    reader.readAsDataURL(blob);
  });
}

function createRevision() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStoredPositiveInteger(value: unknown, max: number) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= max
    ? value
    : null;
}
