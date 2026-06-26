import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  enforceRateLimit,
  getRateLimitKey,
  type RateLimitConfig,
} from "@/lib/rate-limit";

// Password reset is a sensitive endpoint: allow 3 requests per minute per IP.
const RESET_PASSWORD_LIMIT: RateLimitConfig = {
  maxRequests: 3,
  windowMs: 60 * 1000,
};

export async function POST(request: NextRequest) {
  try {
    // Rate limit to prevent abuse / email enumeration.
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RESET_PASSWORD_LIMIT);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown;
    };

    const email =
      typeof body.email === "string" ? body.email.trim() : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    // Delegate to better-auth's native password reset. The
    // sendResetPassword handler configured in auth.ts is responsible
    // for delivering the link. Any error (e.g. unknown email) is
    // swallowed so we never leak whether an account exists.
    try {
      await auth.api.requestPasswordReset({
        body: { email },
      });
    } catch (err) {
      console.error("requestPasswordReset error:", err);
    }

    // Always return success to avoid email enumeration.
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("reset-password route error:", error);
    // Still return success to avoid leaking information.
    return NextResponse.json({ success: true });
  }
}
