import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import type { ConceptGraph, DocumentSection, ArgumentSkeleton } from "@/types/concept-graph";
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
    ...(row.sections ? { sections: row.sections as DocumentSection[] } : {}),
    ...(row.skeleton ? { skeleton: row.skeleton as ArgumentSkeleton } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

// GET /api/concept-graph/[id]/export?format=json|graphml|png|svg
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const { id } = await params;
    const format = (request.nextUrl.searchParams.get("format") || "json").toLowerCase();

    // Allow public share access: if a `share` query param is present, look up
    // by shareId where isPublic=true (no auth required). Otherwise require
    // auth + ownership.
    const shareId = request.nextUrl.searchParams.get("share");

    let row: typeof conceptGraphs.$inferSelect | undefined;

    if (shareId) {
      const [shared] = await db
        .select()
        .from(conceptGraphs)
        .where(
          and(eq(conceptGraphs.shareId, shareId), eq(conceptGraphs.isPublic, true))
        )
        .limit(1);
      row = shared;
    } else {
      const session = await auth.api.getSession({ headers: await headers() });
      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const [owned] = await db
        .select()
        .from(conceptGraphs)
        .where(
          and(eq(conceptGraphs.id, id), eq(conceptGraphs.userId, session.user.id))
        )
        .limit(1);
      row = owned;
    }

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const graph = toConceptGraph(row);

    if (format === "json") {
      return NextResponse.json({ graph });
    }

    if (format === "graphml") {
      // GraphML export is P2 — return JSON for now so the endpoint is usable.
      return NextResponse.json({ graph });
    }

    if (format === "png" || format === "svg") {
      return NextResponse.json(
        { error: `${format.toUpperCase()} export is not yet implemented.` },
        { status: 501 }
      );
    }

    return NextResponse.json(
      { error: `Unsupported export format: ${format}` },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("Export concept graph error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
