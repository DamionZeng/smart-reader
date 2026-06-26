import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { eq, desc } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";

interface GraphListItem {
  id: string;
  title: string;
  type: string;
  createdAt: string;
  conceptCount: number;
}

/**
 * GET /api/concept-graph/list — list the current user's concept graphs.
 *
 * Returns a lightweight summary (id, title, type, createdAt, conceptCount)
 * suitable for the compare-page picker and dashboard listings. The full
 * graph payload (concepts / edges / clusters) is NOT returned here —
 * clients should hit GET /api/concept-graph/[id] for that.
 */
export async function GET(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await db
      .select({
        id: conceptGraphs.id,
        title: conceptGraphs.title,
        type: conceptGraphs.type,
        createdAt: conceptGraphs.createdAt,
        concepts: conceptGraphs.concepts,
      })
      .from(conceptGraphs)
      .where(eq(conceptGraphs.userId, session.user.id))
      .orderBy(desc(conceptGraphs.createdAt));

    const graphs: GraphListItem[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      createdAt: r.createdAt.toISOString(),
      conceptCount: Array.isArray(r.concepts) ? (r.concepts as unknown[]).length : 0,
    }));

    return NextResponse.json({ graphs });
  } catch (error: any) {
    console.error("List concept graphs error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
