import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { ConceptGraph, DocumentSection, ArgumentSkeleton } from "@/types/concept-graph";
import type { PaperMetadata } from "@/types";

interface RouteContext {
  params: Promise<{ shareId: string }>;
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
    ...(row.sections ? { sections: row.sections as DocumentSection[] } : {}),
    ...(row.skeleton ? { skeleton: row.skeleton as ArgumentSkeleton } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

// GET /api/concept-graph/share/[shareId] — public read-only access (no auth)
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { shareId } = await params;

    const [row] = await db
      .select()
      .from(conceptGraphs)
      .where(
        and(eq(conceptGraphs.shareId, shareId), eq(conceptGraphs.isPublic, true))
      )
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { error: "Shared concept graph not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ graph: toConceptGraph(row) });
  } catch (error: any) {
    console.error("Get shared concept graph error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
