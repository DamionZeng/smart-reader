import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/db/schema";
import { and, eq } from "drizzle-orm";

interface RouteContext {
  params: Promise<{ shareId: string }>;
}

// GET /api/share/[shareId] — public read-only access
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { shareId } = await params;

    const [row] = await db
      .select({
        id: documents.id,
        title: documents.title,
        type: documents.type,
        nodes: documents.nodes,
        edges: documents.edges,
        isPublic: documents.isPublic,
        shareId: documents.shareId,
        authors: documents.authors,
        year: documents.year,
        venue: documents.venue,
        doi: documents.doi,
        abstract: documents.abstract,
      })
      .from(documents)
      .where(and(eq(documents.shareId, shareId), eq(documents.isPublic, true)))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Shared project not found" }, { status: 404 });
    }

    return NextResponse.json({ project: row });
  } catch (error) {
    console.error("Get shared project error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
