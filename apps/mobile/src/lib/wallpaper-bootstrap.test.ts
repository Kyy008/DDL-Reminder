import { describe, expect, it } from "vitest";
import {
  createWallpaperBootstrap,
  parseWallpaperBootstrap,
  WALLPAPER_BOOTSTRAP_STORAGE_KEY
} from "./wallpaper-bootstrap";

const MAIN_URL =
  "http://localhost/_capacitor_file_/data/user/0/com.kyy.ddlreminder/files/wallpapers/revision-main.jpg";
const BLUR_URL =
  "https://localhost/_capacitor_file_/data/user/0/com.kyy.ddlreminder/files/wallpapers/revision-blur.jpg";

describe("wallpaper startup bootstrap", () => {
  it("accepts Capacitor-local wallpaper URLs for cover mode", () => {
    expect(createWallpaperBootstrap("cover", MAIN_URL, BLUR_URL)).toEqual({
      blurImageUrl: BLUR_URL,
      mainImageUrl: MAIN_URL,
      mode: "cover",
      version: 1
    });
  });

  it("migrates the retired contain-blur mode to cover", () => {
    expect(
      parseWallpaperBootstrap(
        JSON.stringify({
          blurImageUrl: BLUR_URL,
          mainImageUrl: MAIN_URL,
          mode: "contain-blur",
          version: 1
        })
      )
    ).toEqual({
      blurImageUrl: BLUR_URL,
      mainImageUrl: MAIN_URL,
      mode: "cover",
      version: 1
    });
  });

  it.each([
    "https://example.com/_capacitor_file_/wallpaper.jpg",
    "data:image/jpeg;base64,AAAA",
    "blob:http://localhost/revision",
    "file:///data/user/0/com.kyy.ddlreminder/files/wallpaper.jpg",
    "http://localhost/not-a-capacitor-file/wallpaper.jpg",
    "http://localhost/_capacitor_file_/wallpaper.jpg?changed=1"
  ])("rejects an unsafe or unstable URL: %s", (unsafeUrl) => {
    expect(createWallpaperBootstrap("cover", unsafeUrl, BLUR_URL)).toBeNull();
  });

  it("rejects malformed, stale, and same-file bootstrap records", () => {
    expect(parseWallpaperBootstrap("{invalid")).toBeNull();
    expect(
      parseWallpaperBootstrap(
        JSON.stringify({
          blurImageUrl: BLUR_URL,
          mainImageUrl: MAIN_URL,
          mode: "stretch",
          version: 1
        })
      )
    ).toBeNull();
    expect(createWallpaperBootstrap("cover", MAIN_URL, MAIN_URL)).toBeNull();
  });

  it("keeps the storage key stable for the pre-hydration script", () => {
    expect(WALLPAPER_BOOTSTRAP_STORAGE_KEY).toBe(
      "ddl-reminder:wallpaper-bootstrap"
    );
  });
});
