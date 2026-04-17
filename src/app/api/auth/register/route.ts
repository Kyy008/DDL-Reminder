import { NextResponse } from "next/server";
import { createEmailVerificationToken } from "@/lib/account-activation";
import { hashPassword } from "@/lib/auth-crypto";
import { isUniqueConstraintError } from "@/lib/auth-errors";
import { registerSchema } from "@/lib/auth-validation";
import { jsonError, validationError } from "@/lib/api-response";
import { sendActivationEmail } from "@/lib/mailer";
import { getPrisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const prisma = getPrisma();
  const passwordHash = await hashPassword(parsed.data.password);

  const user = await prisma.user
    .create({
      data: {
        username: parsed.data.username,
        email: parsed.data.email,
        passwordHash
      }
    })
    .catch((error: unknown) => {
      if (isUniqueConstraintError(error)) {
        return null;
      }

      throw error;
    });

  if (!user) {
    return jsonError("Email or username is already registered.", 409);
  }

  const activation = await createEmailVerificationToken(user.id);

  try {
    await sendActivationEmail({
      activationUrl: activation.activationUrl,
      email: user.email,
      username: user.username
    });
  } catch {
    return jsonError("Failed to send activation email.", 500);
  }

  return NextResponse.json(
    {
      ok: true
    },
    { status: 201 }
  );
}
