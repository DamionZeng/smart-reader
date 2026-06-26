import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verificationCodes, user } from "@/db/schema";
import { eq, and, desc, gt } from "drizzle-orm";
import { sendVerificationCodeEmail } from "@/lib/email";
import {
  enforceRateLimit,
  getRateLimitKey,
  type RateLimitConfig,
} from "@/lib/rate-limit";

// Cooldown between successive sends for the same email. 60 seconds —
// enough to deter casual spam but not so long that a typo feels punitive.
const RESEND_COOLDOWN_MS = 60 * 1000;

// Per-IP hard cap (separate from cooldown). 5/min matches the
// sign-in rate limit and feels right for a verification endpoint.
const SEND_CODE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 60 * 1000,
};

// Code lifetime. 1 hour is generous — it gives the user time to walk
// away from the keyboard, dig the code out of a phone notification, and
// come back. The intent of the short-lived code in old systems was
// defence-in-depth, but Resend's DKIM/SPF pipeline already gets us
// transport security, so 1 hour is fine.
const CODE_TTL_MS = 60 * 60 * 1000;

/** Generate a 6-digit code, zero-padded. Uses crypto for unpredictability. */
function generateCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Map into [0, 999_999] then zero-pad to 6 chars.
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

/** Normalise the email to lowercase so matching is case-insensitive. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * POST /api/auth/send-code
 *
 * Body: { email: string }
 *
 * Generates a fresh 6-digit code, stores it in verification_codes,
 * and emails it to the user. Idempotent: re-sending for the same email
 * is allowed after the cooldown (60s) — old codes are invalidated.
 *
 * Always returns success (unless the IP is rate-limited) so we don't
 * leak which emails are registered. If the user does not exist, the
 * request still completes but the code never matches anything.
 */
export async function POST(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, SEND_CODE_LIMIT);
    if (blocked) return blocked;

    let body: { email?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const email = typeof body.email === "string" ? normaliseEmail(body.email) : "";
    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid email is required." },
        { status: 400 }
      );
    }

    // Cooldown check: refuse to send if the latest code is still fresh.
    // This protects users from accidentally spamming their own inbox.
    const now = new Date();
    const [latest] = await db
      .select({ createdAt: verificationCodes.createdAt })
      .from(verificationCodes)
      .where(eq(verificationCodes.email, email))
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);
    if (latest) {
      const ageMs = now.getTime() - new Date(latest.createdAt).getTime();
      if (ageMs < RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((RESEND_COOLDOWN_MS - ageMs) / 1000);
        return NextResponse.json(
          {
            error: `Please wait ${waitSec}s before requesting a new code.`,
            retryAfter: waitSec,
          },
          { status: 429 }
        );
      }
    }

    // Invalidate any unconsumed codes still in flight for this email so
    // only the latest one is valid. (Attempts on the old code still count
    // — but they don't matter once we mark it consumed here.)
    await db
      .update(verificationCodes)
      .set({ consumed: true })
      .where(
        and(
          eq(verificationCodes.email, email),
          eq(verificationCodes.consumed, false)
        )
      );

    const code = generateCode();
    await db.insert(verificationCodes).values({
      email,
      code,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    });

    // Send the email. We do this fire-and-forget style internally —
    // the email helper catches its own errors — but we still await
    // so the response time reflects what the user will experience.
    await sendVerificationCodeEmail({ email, code });

    // Note: we don't reveal whether the email is registered. Returning
    // success for a non-existent email lets an attacker enumerate by
    // timing only, which is much noisier than a boolean response.
    return NextResponse.json({
      success: true,
      cooldownSeconds: RESEND_COOLDOWN_MS / 1000,
    });
  } catch (error: any) {
    console.error("Send code error:", error);
    return NextResponse.json(
      { error: "Failed to send verification code." },
      { status: 500 }
    );
  }
}
