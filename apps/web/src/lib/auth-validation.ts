import { z } from "zod";
import { AUTH_ERROR_MESSAGES } from "./auth-error-messages";

const usernameSchema = z
  .string()
  .trim()
  .min(1, AUTH_ERROR_MESSAGES.usernameRequired)
  .min(3, AUTH_ERROR_MESSAGES.usernameTooShort)
  .max(32, AUTH_ERROR_MESSAGES.usernameTooLong)
  .regex(/^[A-Za-z0-9_]+$/, AUTH_ERROR_MESSAGES.usernameInvalid);

const emailSchema = z
  .string()
  .trim()
  .min(1, AUTH_ERROR_MESSAGES.emailRequired)
  .email(AUTH_ERROR_MESSAGES.emailInvalid)
  .max(254, AUTH_ERROR_MESSAGES.emailTooLong)
  .transform((email) => normalizeEmail(email));

const passwordSchema = z
  .string()
  .min(1, AUTH_ERROR_MESSAGES.passwordRequired)
  .min(6, AUTH_ERROR_MESSAGES.passwordTooShort)
  .max(128, AUTH_ERROR_MESSAGES.passwordTooLong);

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, AUTH_ERROR_MESSAGES.identifierRequired),
  password: z.string().min(1, AUTH_ERROR_MESSAGES.passwordRequired)
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
