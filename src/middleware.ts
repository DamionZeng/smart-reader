import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Check for better-auth session cookie presence.
  // Full session validation happens in each API route via auth.api.getSession.
  // This middleware only does a fast cookie-existence check to avoid
  // the expensive internal fetch round-trip.
  const sessionCookie = request.cookies.get("better-auth.session_token");
  const hasSession = !!sessionCookie?.value;

  // Note: /graph is NOT in protectedPrefixes because that would also match
  // the public /graph/share/[shareId] route. The /graph and /graph/compare
  // pages are protected via the explicit isGraphPage check below, which
  // excludes /graph/share.
  const protectedPrefixes = ["/board", "/codeboard", "/dashboard"];
  const protectedApiPrefixes = [
    "/api/projects",
    "/api/ingest",
    "/api/compare",
    "/api/review",
    "/api/qa",
    "/api/explain",
  ];

  const pathname = request.nextUrl.pathname;

  // Concept graph API routes are protected EXCEPT the public share endpoint
  // (/api/concept-graph/share/[shareId]) which must be readable without auth.
  const isConceptGraphApi = pathname.startsWith("/api/concept-graph");
  const isConceptGraphShare = pathname.startsWith("/api/concept-graph/share");
  const isProtectedConceptGraphApi = isConceptGraphApi && !isConceptGraphShare;

  // The /graph page and /graph/compare page are protected, but
  // /graph/share/[shareId] is public (read-only shared view).
  const isGraphPage = pathname === "/graph" || pathname.startsWith("/graph/compare");
  const isGraphShare = pathname.startsWith("/graph/share");

  if (
    !hasSession &&
    (protectedPrefixes.some((p) => pathname.startsWith(p)) ||
      protectedApiPrefixes.some((p) => pathname.startsWith(p)) ||
      isProtectedConceptGraphApi ||
      (isGraphPage && !isGraphShare))
  ) {
    // For API routes, return JSON error instead of redirect
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/board/:path*",
    "/codeboard/:path*",
    "/dashboard/:path*",
    "/graph/:path*",
    "/api/projects/:path*",
    "/api/ingest",
    "/api/compare",
    "/api/review",
    "/api/qa",
    "/api/explain",
    "/api/concept-graph/:path*",
  ],
};
