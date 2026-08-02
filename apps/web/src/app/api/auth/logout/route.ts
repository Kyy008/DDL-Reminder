import { NextResponse } from "next/server";
import { deleteCurrentSession } from "@/lib/auth-session";

export async function POST() {
  const cookie = await deleteCurrentSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookie.name, cookie.value, cookie.options);

  return response;
}
