import { describe, expect, it } from "vitest";
import {
  calculateWallpaperDimensions,
  DEFAULT_WALLPAPER_CONFIG,
  parseWallpaperConfig
} from "./wallpaper";

describe("wallpaper settings", () => {
  it("keeps small images at their original dimensions", () => {
    expect(calculateWallpaperDimensions(1080, 1920)).toEqual({
      width: 1080,
      height: 1920
    });
  });

  it("scales portrait and landscape images without changing aspect ratio", () => {
    expect(calculateWallpaperDimensions(4000, 2000)).toEqual({
      width: 2880,
      height: 1440
    });
    expect(calculateWallpaperDimensions(2000, 4000)).toEqual({
      width: 1440,
      height: 2880
    });
  });

  it("keeps a valid custom wallpaper while migrating its old display mode", () => {
    expect(
      parseWallpaperConfig(
        JSON.stringify({
          version: 1,
          mode: "contain-blur",
          custom: {
            main: {
              path: "wallpapers/revision-main.jpg",
              width: 1440,
              height: 2880,
              bytes: 2_000_000,
              mimeType: "image/jpeg"
            },
            blur: {
              path: "wallpapers/revision-blur.jpg",
              width: 320,
              height: 640,
              bytes: 100_000,
              mimeType: "image/jpeg"
            },
            updatedAt: "2026-07-31T09:00:00.000Z"
          }
        })
      )
    ).toEqual({
      version: 1,
      mode: "cover",
      custom: {
        main: {
          path: "wallpapers/revision-main.jpg",
          width: 1440,
          height: 2880,
          bytes: 2_000_000,
          mimeType: "image/jpeg"
        },
        blur: {
          path: "wallpapers/revision-blur.jpg",
          width: 320,
          height: 640,
          bytes: 100_000,
          mimeType: "image/jpeg"
        },
        updatedAt: "2026-07-31T09:00:00.000Z"
      }
    });
  });

  it("falls back safely when persisted metadata is incomplete", () => {
    expect(
      parseWallpaperConfig(
        JSON.stringify({
          version: 1,
          mode: "contain-blur",
          custom: {
            main: {
              path: "../escape.jpg"
            }
          }
        })
      )
    ).toEqual({
      ...DEFAULT_WALLPAPER_CONFIG
    });
    expect(parseWallpaperConfig("{invalid")).toEqual(DEFAULT_WALLPAPER_CONFIG);
  });

  it("rejects mismatched main and blur revisions", () => {
    expect(
      parseWallpaperConfig(
        JSON.stringify({
          version: 1,
          mode: "cover",
          custom: {
            main: {
              path: "wallpapers/revision-a-main.jpg",
              width: 1080,
              height: 1920,
              bytes: 1_000_000,
              mimeType: "image/jpeg"
            },
            blur: {
              path: "wallpapers/revision-b-blur.jpg",
              width: 360,
              height: 640,
              bytes: 90_000,
              mimeType: "image/jpeg"
            },
            updatedAt: "2026-07-31T09:00:00.000Z"
          }
        })
      )
    ).toEqual(DEFAULT_WALLPAPER_CONFIG);
  });

  it("rejects assets that exceed their role-specific limits", () => {
    expect(
      parseWallpaperConfig(
        JSON.stringify({
          version: 1,
          mode: "cover",
          custom: {
            main: {
              path: "wallpapers/revision-main.jpg",
              width: 2881,
              height: 1000,
              bytes: 1_000_000,
              mimeType: "image/jpeg"
            },
            blur: {
              path: "wallpapers/revision-blur.jpg",
              width: 640,
              height: 320,
              bytes: 90_000,
              mimeType: "image/jpeg"
            },
            updatedAt: "2026-07-31T09:00:00.000Z"
          }
        })
      )
    ).toEqual(DEFAULT_WALLPAPER_CONFIG);
  });
});
