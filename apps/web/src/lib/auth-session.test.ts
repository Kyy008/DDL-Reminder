import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_SESSION_COOKIE,
  buildClearSessionCookie,
  buildSessionCookie
} from "./auth-session";
import { SESSION_MAX_AGE_SECONDS } from "./auth-crypto";

describe("session cookies", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds an http-only session cookie with the shared session lifetime", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(buildSessionCookie("raw-token")).toEqual({
      name: AUTH_SESSION_COOKIE,
      value: "raw-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: SESSION_MAX_AGE_SECONDS
      }
    });
  });

  it("marks session cookies secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(buildSessionCookie("raw-token").options.secure).toBe(true);
    expect(buildClearSessionCookie().options.secure).toBe(true);
  });

  it("builds a clearing cookie that expires immediately", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(buildClearSessionCookie()).toEqual({
      name: AUTH_SESSION_COOKIE,
      value: "",
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 0
      }
    });
  });
});
