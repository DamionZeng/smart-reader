import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verificationCodes, user } from "@/db/schema";
import { eq, and, desc, gt, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import {
  enforceRateLimit,
  getRateLimitKey,
  type RateLimitConfig,
} from "@/lib/rate-limit";

const VERIFY_CODE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 60 * 1000,
};

const MAX_ATTEMPTS = 5;

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * POST /api/auth/verify-code
 *
 * Body: { email: string, code: string }
 *
 * Consumes the latest unconsumed, unexpired code for the email, marks
 * the user as emailVerified, and signs them in by replaying the
 * better-auth signIn.email flow with their actual password (which we
 * never re-prompt for — they just came from the sign-up form).
 *
 * Wait, we don't have the password here. So instead of signing them in
 * from this endpoint, we return { success: true, email } and let the
 * client redirect to /login where they enter their password once.
 * That's the safer flow: the password never leaves the browser in this
 * request.
 *
 * Returns: { success: true } on success,
 *          { error: "...", code: "INVALID|EXPIRED|TOO_MANY" } on failure
 */
export async function POST(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, VERIFY_CODE_LIMIT);
    if (blocked) return blocked;

    let body: { email?: unknown; code?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const email = typeof body.email === "string" ? normaliseEmail(body.email) : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid email is required." },
        { status: 400 }
      );
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: "Code must be 6 digits.", code: "INVALID" },
        { status: 400 }
      );
    }

    const now = new Date();

    // Find the latest active code for this email. We rely on the fact
    // that send-code invalidates earlier codes on every fresh send.
    const [record] = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.email, email),
          eq(verificationCodes.consumed, false),
          gt(verificationCodes.expiresAt, now)
        )
      )
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);

    if (!record) {
      return NextResponse.json(
        { error: "No active code. Request a new one.", code: "EXPIRED" },
        { status: 400 }
      );
    }

    // Constant-time string compare to discourage timing-based code guessing.
    const expected = record.code;
    let match = expected.length === code.length;
    for (let i = 0; i < Math.max(expected.length, code.length); i++) {
      if (expected[i] !== code[i]) match = false;
    }

    if (!match) {
      const newAttempts = record.attempts + 1;
      // Burn the code once the user has run out of attempts so a
      // future correct guess doesn't unlock it after the cap.
      const consumed = newAttempts >= MAX_ATTEMPTS;
      await db
        .update(verificationCodes)
        .set({ attempts: newAttempts, consumed })
        .where(eq(verificationCodes.id, record.id));
      return NextResponse.json(
        {
          error: consumed
            ? "Too many incorrect attempts. Request a new code."
            : "Incorrect code. Please try again.",
          code: consumed ? "TOO_MANY" : "INVALID",
        },
        { status: 400 }
      );
    }

    // Code is correct — mark it consumed and flip emailVerified on the user.
    await db
      .update(verificationCodes)
      .set({ consumed: true })
      .where(eq(verificationCodes.id, record.id));

    await db
      .update(user)
      .set({ emailVerified: true, updatedAt: now })
      .where(eq(user.email, email));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Verify code error:", error);
    return NextResponse.json(
      { error: "Failed to verify code." },
      { status: 500 }
    );
  }
}
