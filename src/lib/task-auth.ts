import { jsonError } from "@/lib/api-response";
import { getCurrentSession } from "@/lib/auth-session";

export async function requireUserSession() {
  const session = await getCurrentSession();

  if (!session) {
    return {
      session: null,
      response: jsonError("Login required.", 401)
    };
  }

  return {
    session,
    response: null
  };
}
