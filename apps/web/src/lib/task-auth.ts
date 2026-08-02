import { jsonError } from "@/lib/api-response";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth-error-messages";
import { getCurrentSession } from "@/lib/auth-session";

export async function requireUserSession() {
  const session = await getCurrentSession();

  if (!session) {
    return {
      session: null,
      response: jsonError(AUTH_ERROR_MESSAGES.loginRequired, 401)
    };
  }

  return {
    session,
    response: null
  };
}
