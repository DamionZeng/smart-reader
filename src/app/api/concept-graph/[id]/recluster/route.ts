import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import { trackUsage } from "@/app/api/usage/track";
import { getLanguageInstructionForUser } from "@/lib/ai-settings";
import { detectCommunities } from "@/lib/graph/leiden";
import { nameClusters } from "@/lib/graph/cluster-name";
import type { ConceptGraph } from "@/types/concept-graph";
import type { PaperMetadata } from "@/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function toConceptGraph(row: typeof conceptGraphs.$inferSelect): ConceptGraph {
  let metadata: PaperMetadata | undefined;
  if (row.authors || row.year != null || row.venue || row.doi || row.abstract) {
    let authors: string[] = [];
    if (row.authors) {
      try {
        const parsed = JSON.parse(row.authors);
        if (Array.isArray(parsed)) authors = parsed.map(String);
      } catch {
        // leave empty
      }
    }
    metadata = {
      authors,
      year: row.year,
      venue: row.venue || "",
      doi: row.doi || "",
      abstract: row.abstract || "",
    };
  }
  return {
    id: row.id,
    title: row.title,
    type: row.type as "paper" | "code",
    rawText: row.rawText || "",
    concepts: row.concepts as ConceptGraph["concepts"],
    edges: row.edges as ConceptGraph["edges"],
    clusters: row.clusters as ConceptGraph["clusters"],
    createdAt: row.createdAt.toISOString(),
    ...(metadata ? { metadata } : {}),
  };
}

// POST /api/concept-graph/[id]/recluster — re-detect communities + name clusters
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.heavy);
    if (blocked) return blocked;

    const { id } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [row] = await db
      .select()
      .from(conceptGraphs)
      .where(
        and(eq(conceptGraphs.id, id), eq(conceptGraphs.userId, session.user.id))
      )
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const acceptLanguage = request.headers.get("accept-language");
    const langInstruction = await getLanguageInstructionForUser(
      session.user.id,
      acceptLanguage
    );

    const graph = toConceptGraph(row);

    const clusters = detectCommunities(graph.concepts, graph.edges);
    let namedClusters;
    try {
      namedClusters = await nameClusters(clusters, graph.concepts, langInstruction);
    } catch (e: any) {
      console.error("Agnes AI error:", e);
      return NextResponse.json(
        { error: "The AI service is currently unavailable. Please try again in a moment." },
        { status: 502 }
      );
    }

    const [updated] = await db
      .update(conceptGraphs)
      .set({
        clusters: namedClusters,
        updatedAt: new Date(),
      })
      .where(
        and(eq(conceptGraphs.id, id), eq(conceptGraphs.userId, session.user.id))
      )
      .returning();

    await trackUsage(session.user.id, "concept-graph-recluster");

    return NextResponse.json({ graph: toConceptGraph(updated) });
  } catch (error: any) {
    console.error("Recluster concept graph error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
