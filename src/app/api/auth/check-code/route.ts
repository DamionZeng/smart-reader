import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verificationCodes } from "@/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import {
  enforceRateLimit,
  getRateLimitKey,
  type RateLimitConfig,
} from "@/lib/rate-limit";

// Slightly looser than verify-code: this is the path the register form
// uses to ask "is this 6-digit code the user just typed actually a
// valid code for this email?". So we expect a healthy amount of
// re-tries (typos, refreshes), and we don't want to trip our own
// rate-limit when a user fat-fingers their inbox code once or twice.
const CHECK_CODE_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowMs: 60 * 1000,
};

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * POST /api/auth/check-code
 *
 * Body: { email: string, code: string }
 *
 * Dry-run check: "is this code currently valid for this email?"
 * Does NOT consume the code, increment attempts, or write to the DB.
 * The register form uses this on every keystroke (well, on blur or
 * after the 6th digit) to decide whether the user can submit.
 *
 * Returns:
 *   { valid: true, expiresInSeconds: number }
 *   { valid: false, reason: "EXPIRED" | "INVALID" | "MISSING" }
 *
 * Note: we don't expose "TOO_MANY" here — the register flow lets the
 * user re-request a code if they keep mistyping, and verify-code
 * (not check-code) is the one that burns the attempt counter.
 */
export async function POST(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, CHECK_CODE_LIMIT);
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
        { valid: false, reason: "MISSING" },
        { status: 400 }
      );
    }
    if (!/^\d{6}$/.test(code)) {
      // Not an error — the user is mid-typing. Treat as "not yet valid"
      // so the form can render its "type the 6 digits" hint.
      return NextResponse.json({ valid: false, reason: "MISSING" }, { status: 200 });
    }

    const now = new Date();

    // Find the most recent active code. We don't care how many wrong
    // guesses have happened — check-code never bumps that counter.
    const [record] = await db
      .select({
        code: verificationCodes.code,
        expiresAt: verificationCodes.expiresAt,
      })
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
      return NextResponse.json({ valid: false, reason: "EXPIRED" }, { status: 200 });
    }

    // Constant-time compare — same care as verify-code.
    const expected = record.code;
    let match = expected.length === code.length;
    for (let i = 0; i < Math.max(expected.length, code.length); i++) {
      if (expected[i] !== code[i]) match = false;
    }

    if (!match) {
      return NextResponse.json({ valid: false, reason: "INVALID" }, { status: 200 });
    }

    const expiresInSeconds = Math.max(
      0,
      Math.floor((record.expiresAt.getTime() - now.getTime()) / 1000)
    );
    return NextResponse.json({ valid: true, expiresInSeconds });
  } catch (error: any) {
    console.error("Check code error:", error);
    return NextResponse.json(
      { valid: false, reason: "MISSING" },
      { status: 500 }
    );
  }
}
