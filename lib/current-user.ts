import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, verifySessionToken, type SessionPayload } from "./auth.ts";

// Separate from lib/auth.ts because next/headers' cookies() only resolves
// inside a Next.js request context — lib/auth.ts is imported directly by
// lib/__tests__/auth.test.ts under plain `node --test`, where next/headers
// can't even be resolved, let alone called.
//
// Reads and verifies the session cookie for the current request in a Node
// route handler. Middleware already blanket-gates /api/* on a valid cookie,
// so this should practically never return null there — still nullable so a
// caller can't assume it.
export async function getCurrentUser(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}
