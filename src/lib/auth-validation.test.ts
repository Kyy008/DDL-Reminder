import { describe, expect, it } from "vitest";
import {
  isEmailIdentifier,
  loginSchema,
  normalizeEmail,
  normalizeUsername,
  registerSchema
} from "./auth-validation";

describe("registerSchema", () => {
  it("normalizes email and trims username", () => {
    const result = registerSchema.safeParse({
      username: "  kyy008  ",
      email: "  KYY008@EXAMPLE.COM  ",
      password: "password123"
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.username).toBe("kyy008");
      expect(result.data.email).toBe("kyy008@example.com");
    }
  });

  it("rejects invalid emails", () => {
    const result = registerSchema.safeParse({
      username: "kyy008",
      email: "not-an-email",
      password: "password123"
    });

    expect(result.success).toBe(false);
  });

  it("rejects short passwords", () => {
    const result = registerSchema.safeParse({
      username: "kyy008",
      email: "kyy008@example.com",
      password: "short"
    });

    expect(result.success).toBe(false);
  });

  it("rejects unsupported username characters", () => {
    const result = registerSchema.safeParse({
      username: "kyy-008",
      email: "kyy008@example.com",
      password: "password123"
    });

    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts an email or username identifier", () => {
    expect(
      loginSchema.safeParse({
        identifier: "kyy008@example.com",
        password: "password123"
      }).success
    ).toBe(true);
    expect(
      loginSchema.safeParse({
        identifier: "kyy008",
        password: "password123"
      }).success
    ).toBe(true);
  });

  it("rejects empty values", () => {
    expect(
      loginSchema.safeParse({
        identifier: "",
        password: "password123"
      }).success
    ).toBe(false);
    expect(
      loginSchema.safeParse({
        identifier: "kyy008",
        password: ""
      }).success
    ).toBe(false);
  });
});

describe("auth validation helpers", () => {
  it("normalizes email and username values", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(normalizeUsername("  User_123 ")).toBe("User_123");
  });

  it("detects email identifiers", () => {
    expect(isEmailIdentifier("user@example.com")).toBe(true);
    expect(isEmailIdentifier("username")).toBe(false);
  });
});
