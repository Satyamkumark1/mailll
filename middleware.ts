import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, verifySessionTokenEdge } from "./lib/session-edge";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 1. Allow static assets, images, and Next.js internal files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // 2. Allow public auth API routes, the cron webhook, and the tracking
  // pixel/click-redirect/unsubscribe routes — those are hit directly by a
  // recipient's mail client, which has no session cookie.
  if (
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/cron/tick" ||
    pathname.startsWith("/api/t/")
  ) {
    return NextResponse.next();
  }

  // Check auth session cookie via Web Crypto API (Edge-safe)
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = await verifySessionTokenEdge(token);
  const isAuthenticated = !!session;

  // 3. If accessing /login while already authenticated, redirect to dashboard
  if (pathname === "/login") {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/validator/upload", request.url));
    }
    return NextResponse.next();
  }

  // 4. Protect all dashboard routes (/validator/*) and protected API endpoints
  const isProtectedPage = pathname === "/" || pathname.startsWith("/validator");
  const isProtectedApi = pathname.startsWith("/api/");

  if (!isAuthenticated) {
    if (isProtectedApi) {
      return NextResponse.json(
        { error: "Authentication required. Please log in." },
        { status: 401 }
      );
    }

    if (isProtectedPage) {
      const callbackUrl = encodeURIComponent(`${pathname}${search}`);
      const loginUrl = new URL(`/login?callbackUrl=${callbackUrl}`, request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for static files (_next/static, _next/image, favicon.ico)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
