import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import { trackUsage } from "@/app/api/usage/track";
import type { Concept, ConceptEdge, ConceptCluster } from "@/types/concept-graph";

const MIN_GRAPHS = 2;
const MAX_GRAPHS = 8;

interface CompareRequestBody {
  graphIds?: string[];
}

/**
 * Unions two arrays by element id. On collision the first-seen element wins.
 */
function unionById<T extends { id: string }>(...arrays: T[][]): T[] {
  const seen = new Map<string, T>();
  for (const arr of arrays) {
    for (const item of arr) {
      if (item && typeof item.id === "string" && !seen.has(item.id)) {
        seen.set(item.id, item);
      }
    }
  }
  return Array.from(seen.values());
}

export async function POST(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.heavy);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as CompareRequestBody;
    const { graphIds } = body;

    if (!Array.isArray(graphIds) || graphIds.length < MIN_GRAPHS) {
      return NextResponse.json(
        { error: `At least ${MIN_GRAPHS} graph IDs are required for comparison.` },
        { status: 400 }
      );
    }
    if (graphIds.length > MAX_GRAPHS) {
      return NextResponse.json(
        { error: `Cannot compare more than ${MAX_GRAPHS} graphs at once.` },
        { status: 400 }
      );
    }

    const rows = await db
      .select()
      .from(conceptGraphs)
      .where(
        and(
          inArray(conceptGraphs.id, graphIds),
          eq(conceptGraphs.userId, session.user.id)
        )
      );

    if (rows.length < MIN_GRAPHS) {
      return NextResponse.json(
        { error: "Not enough accessible graphs found for comparison." },
        { status: 404 }
      );
    }

    // Detect dominant type
    const typeCounts = new Map<string, number>();
    for (const row of rows) {
      const rt = (row.type as string) || "paper";
      typeCounts.set(rt, (typeCounts.get(rt) || 0) + 1);
    }
    let detectedType: "paper" | "code" = "paper";
    let bestCount = 0;
    for (const [t, c] of typeCounts) {
      if (c > bestCount) {
        bestCount = c;
        detectedType = t === "code" ? "code" : "paper";
      }
    }

    // Merge concepts, edges, and clusters by id (union)
    const mergedConcepts = unionById<Concept>(
      ...rows.map((r) => (r.concepts as Concept[]) || [])
    );
    const mergedEdges = unionById<ConceptEdge>(
      ...rows.map((r) => (r.edges as ConceptEdge[]) || [])
    );
    const mergedClusters = unionById<ConceptCluster>(
      ...rows.map((r) => (r.clusters as ConceptCluster[]) || [])
    );

    const title = `Comparison: ${rows
      .map((r) => r.title)
      .join(" vs ")}`.slice(0, 255);

    const [inserted] = await db
      .insert(conceptGraphs)
      .values({
        title,
        type: detectedType,
        concepts: mergedConcepts,
        edges: mergedEdges,
        clusters: mergedClusters,
        rawText: null,
        userId: session.user.id,
      })
      .returning();

    await trackUsage(session.user.id, "concept-graph-compare");

    return NextResponse.json({ graphId: inserted.id });
  } catch (error: any) {
    console.error("Concept graph compare error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
