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

const MAX_CONCEPTS = 1000;
const MAX_EDGES = 3000;

/**
 * Maps a concept_graphs DB row to the ConceptGraph shape returned to clients.
 * 包含 sections（思维导图）和 skeleton（论证骨架）字段。
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
    // 从 DB 读取思维导图和论证骨架数据（可能为 null）
    ...(row.sections ? { sections: row.sections as DocumentSection[] } : {}),
    ...(row.skeleton ? { skeleton: row.skeleton as ArgumentSkeleton } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
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

    return NextResponse.json({ graph: toConceptGraph(row) });
  } catch (error: any) {
    console.error("Get concept graph error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const { id } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const concepts = Array.isArray(body?.concepts)
      ? body.concepts.slice(0, MAX_CONCEPTS)
      : undefined;
    const edges = Array.isArray(body?.edges)
      ? body.edges.slice(0, MAX_EDGES)
      : undefined;
    const clusters = Array.isArray(body?.clusters)
      ? body.clusters.slice(0, MAX_CONCEPTS)
      : undefined;
    const title =
      typeof body?.title === "string" ? body.title.trim().slice(0, 255) : undefined;

    if (concepts && concepts.length > MAX_CONCEPTS) {
      return NextResponse.json(
        { error: `Concepts exceed the limit of ${MAX_CONCEPTS}.` },
        { status: 400 }
      );
    }
    if (edges && edges.length > MAX_EDGES) {
      return NextResponse.json(
        { error: `Edges exceed the limit of ${MAX_EDGES}.` },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (Array.isArray(concepts)) update.concepts = concepts;
    if (Array.isArray(edges)) update.edges = edges;
    if (Array.isArray(clusters)) update.clusters = clusters;
    if (typeof title === "string" && title.length > 0) update.title = title;

    if (Object.keys(update).length === 1) {
      return NextResponse.json(
        { error: "No updatable fields provided" },
        { status: 400 }
      );
    }

    const [row] = await db
      .update(conceptGraphs)
      .set(update)
      .where(
        and(eq(conceptGraphs.id, id), eq(conceptGraphs.userId, session.user.id))
      )
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ graph: toConceptGraph(row) });
  } catch (error: any) {
    console.error("Update concept graph error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const { id } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [row] = await db
      .delete(conceptGraphs)
      .where(
        and(eq(conceptGraphs.id, id), eq(conceptGraphs.userId, session.user.id))
      )
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete concept graph error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
