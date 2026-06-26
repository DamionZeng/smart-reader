import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verificationCodes, user } from "@/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import {
  enforceRateLimit,
  getRateLimitKey,
  type RateLimitConfig,
} from "@/lib/rate-limit";

const REGISTER_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 60 * 1000,
};

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * POST /api/auth/register-and-verify
 *
 * Body: {
 *   email: string,
 *   password: string,
 *   name: string,
 *   code: string
 * }
 *
 * The single-call version of the new "verify your email inside the
 * register form" flow. Order of operations:
 *
 *   1. Re-verify the code (the front-end already called check-code,
 *      but a determined user could POST this with a stale check —
 *      we never trust the client).
 *   2. Create the user via better-auth's signUpEmail.
 *   3. Burn the code and flip emailVerified=true on the new user.
 *   4. Sign them in via better-auth's signInEmail so they land in
 *      the dashboard with a real session cookie.
 *
 * Step 3 must come AFTER step 2 (we need the user row) and BEFORE
 * step 4 (the session will be tied to that user's emailVerified
 * state, so flip it first). If step 2 fails (e.g. duplicate email
 * from a partial previous attempt), we surface that error verbatim.
 *
 * Returns:
 *   { success: true, redirectTo: "/dashboard" } + Set-Cookie header
 *   { error: "..." } on failure
 */
export async function POST(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, REGISTER_LIMIT);
    if (blocked) return blocked;

    let body: {
      email?: unknown;
      password?: unknown;
      name?: unknown;
      code?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const email = typeof body.email === "string" ? normaliseEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";

    // --- validate inputs ---
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }
    if (name.length < 2) {
      return NextResponse.json(
        { error: "Name must be at least 2 characters." },
        { status: 400 }
      );
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Invalid verification code." }, { status: 400 });
    }

    // --- 1. re-verify the code on the server ---
    const now = new Date();
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
        { error: "No active code. Please request a new one." },
        { status: 400 }
      );
    }

    // Constant-time compare.
    const expected = record.code;
    let codeMatch = expected.length === code.length;
    for (let i = 0; i < Math.max(expected.length, code.length); i++) {
      if (expected[i] !== code[i]) codeMatch = false;
    }
    if (!codeMatch) {
      // Bump the attempt counter so an attacker can't keep guessing
      // against the same code forever. (check-code deliberately does
      // not do this, which is the trade-off — see its file header.)
      const newAttempts = record.attempts + 1;
      const consumed = newAttempts >= 5;
      await db
        .update(verificationCodes)
        .set({ attempts: newAttempts, consumed })
        .where(eq(verificationCodes.id, record.id));
      return NextResponse.json(
        {
          error: consumed
            ? "Too many incorrect attempts. Request a new code."
            : "Incorrect verification code.",
        },
        { status: 400 }
      );
    }

    // --- 2. create the user via better-auth ---
    // We use signUpEmail (not signUp.email) so we can pass the request
    // headers through — that lets better-auth read the cookies it
    // needs internally, and we can grab the response back to forward
    // its Set-Cookie later.
    let signUpResponse: Response;
    try {
      signUpResponse = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
        asResponse: true,
        headers: await headers(),
      });
    } catch (e: any) {
      // better-auth throws on duplicate email etc. We surface its
      // message as-is so the user can see "email already in use" etc.
      console.error("signUpEmail error:", e);
      return NextResponse.json(
        { error: e?.message || "Failed to create account." },
        { status: 400 }
      );
    }

    if (signUpResponse.status >= 400) {
      // Drain the response body and forward a useful error.
      let upstreamMsg = "Failed to create account.";
      try {
        const upstream = await signUpResponse.clone().json();
        upstreamMsg = upstream?.message || upstream?.error || upstreamMsg;
      } catch {
        // not JSON, keep the default
      }
      return NextResponse.json({ error: upstreamMsg }, { status: 400 });
    }

    // --- 3. burn the code and mark the user as verified ---
    // These two writes can run in parallel — they don't depend on
    // each other and both run after the signUp succeeded.
    await Promise.all([
      db
        .update(verificationCodes)
        .set({ consumed: true })
        .where(eq(verificationCodes.id, record.id)),
      db
        .update(user)
        .set({ emailVerified: true, updatedAt: now })
        .where(eq(user.email, email)),
    ]);

    // --- 4. sign them in so the browser ends up with a session ---
    const signInResponse = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
      headers: await headers(),
    });

    if (signInResponse.status >= 400) {
      // The account was created and verified, but we couldn't sign
      // them in. The user can still go to /login and sign in normally
      // — emailVerified is now true so they won't get bounced.
      return NextResponse.json(
        {
          success: true,
          redirectTo: "/login?justRegistered=1",
          warning: "Account created. Please sign in.",
        },
        { status: 200 }
      );
    }

    // Forward the Set-Cookie from better-auth so the browser stores
    // the session token.
    const setCookie = signInResponse.headers.get("set-cookie");
    const headersOut: Record<string, string> = {};
    if (setCookie) headersOut["set-cookie"] = setCookie;

    return NextResponse.json(
      { success: true, redirectTo: "/dashboard" },
      { status: 200, headers: headersOut }
    );
  } catch (error: any) {
    console.error("Register-and-verify error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create account." },
      { status: 500 }
    );
  }
}
