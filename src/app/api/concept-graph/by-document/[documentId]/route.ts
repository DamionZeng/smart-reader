import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq, desc } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import type { ConceptGraph } from "@/types/concept-graph";
import type { PaperMetadata } from "@/types";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

/**
 * Maps a concept_graphs DB row to the ConceptGraph shape returned to clients.
 */
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

/**
 * GET /api/concept-graph/by-document/[documentId]
 *
 * Returns the most recent concept graph associated with a document (project).
 * This lets board/codeboard load the KG directly when a user opens a project.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { documentId } = await params;

    const [row] = await db
      .select()
      .from(conceptGraphs)
      .where(
        and(
          eq(conceptGraphs.documentId, documentId),
          eq(conceptGraphs.userId, session.user.id)
        )
      )
      .orderBy(desc(conceptGraphs.createdAt))
      .limit(1);

    if (!row) {
      return NextResponse.json({ graph: null });
    }

    return NextResponse.json({ graph: toConceptGraph(row) });
  } catch (error: any) {
    console.error("Get concept graph by document error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
