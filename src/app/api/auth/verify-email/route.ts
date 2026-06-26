import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  enforceRateLimit,
  getRateLimitKey,
  type RateLimitConfig,
} from "@/lib/rate-limit";

// Email verification is sensitive: allow 5 requests per minute per IP.
const VERIFY_EMAIL_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 60 * 1000,
};

export async function GET(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, VERIFY_EMAIL_LIMIT);
    if (blocked) return blocked;

    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json(
        { error: "Verification token is required." },
        { status: 400 }
      );
    }

    // Delegate to better-auth's native email verification.
    await auth.api.verifyEmail({
      query: { token },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Email verification error:", error);
    return NextResponse.json(
      { error: "Verification failed. The link may be expired or invalid." },
      { status: 400 }
    );
  }
}
