import { z } from "zod";

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(32, "Username must be at most 32 characters.")
  .regex(
    /^[A-Za-z0-9_]+$/,
    "Username can only contain letters, numbers, and underscores."
  );

const emailSchema = z
  .string()
  .trim()
  .email("Email must be valid.")
  .max(254, "Email is too long.")
  .transform((email) => normalizeEmail(email));

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.");

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Email or username is required."),
  password: z.string().min(1, "Password is required.")
});

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string) {
  return username.trim();
}

export function isEmailIdentifier(identifier: string) {
  return identifier.includes("@");
}
