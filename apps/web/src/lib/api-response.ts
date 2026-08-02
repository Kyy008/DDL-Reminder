import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AUTH_ERROR_MESSAGES } from "./auth-error-messages";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function validationError(error: ZodError) {
  return NextResponse.json(
    {
      error: AUTH_ERROR_MESSAGES.invalidRequest,
      issues: error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message
      }))
    },
    { status: 400 }
  );
}
