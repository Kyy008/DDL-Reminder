import { NextResponse } from "next/server";
import { activateEmailVerificationToken } from "@/lib/account-activation";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await activateEmailVerificationToken(token);

  return NextResponse.json({
    result
  });
}
