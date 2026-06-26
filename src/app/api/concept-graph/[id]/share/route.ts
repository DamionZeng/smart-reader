import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/concept-graph/[id]/share — enable public sharing
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const { id } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify ownership
    const [existing] = await db
      .select({
        id: conceptGraphs.id,
        shareId: conceptGraphs.shareId,
        isPublic: conceptGraphs.isPublic,
      })
      .from(conceptGraphs)
      .where(
        and(eq(conceptGraphs.id, id), eq(conceptGraphs.userId, session.user.id))
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Reuse existing shareId if present, otherwise generate a new one
    const shareId = existing.shareId || randomUUID();

    await db
      .update(conceptGraphs)
      .set({ isPublic: true, shareId, updatedAt: new Date() })
      .where(
        and(eq(conceptGraphs.id, id), eq(conceptGraphs.userId, session.user.id))
      );

    return NextResponse.json({ shareId });
  } catch (error: any) {
    console.error("Share concept graph error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
