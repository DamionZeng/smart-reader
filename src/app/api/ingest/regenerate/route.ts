/**
 * POST /api/ingest/regenerate
 *
 * Body: { projectId: string }
 *
 * Re-runs the full ingest pipeline for an existing project: re-fetches
 * the source (arxiv PDF / generic PDF URL), re-converts it to HTML,
 * clears the existing concept graph, and re-runs the KG pipeline. The
 * old `conceptGraphs` row is REPLACED, not kept alongside (the user
 * picked "regenerate" — keeping the old one would be confusing).
 *
 * Implementation strategy: this endpoint is a *pre-clear* — it wipes
 * the old concept_graphs row for the project and returns the existing
 * projectId. The caller (useIngestionFlow) then calls the regular
 * /api/ingest endpoint with `projectId` set so the same ingest path
 * (PDF→HTML, R2 upload, etc.) runs in UPDATE mode.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents, conceptGraphs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.heavy);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const projectId = typeof body?.projectId === "string" ? body.projectId : null;
    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 }
      );
    }

    // Verify ownership before any destructive action.
    const [row] = await db
      .select({
        id: documents.id,
        userId: documents.userId,
        sourceUrl: documents.sourceUrl,
        sourceType: documents.sourceType,
        sourceKey: documents.sourceKey,
      })
      .from(documents)
      .where(and(eq(documents.id, projectId), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!row.sourceUrl) {
      return NextResponse.json(
        { error: "This project was not imported from a URL; cannot regenerate." },
        { status: 400 }
      );
    }

    // Wipe the old concept graph so the pipeline produces a fresh one.
    try {
      await db
        .delete(conceptGraphs)
        .where(eq(conceptGraphs.documentId, projectId));
    } catch (e) {
      console.error("[regenerate] failed to wipe concept graph:", e);
      // Continue — partial cleanup is better than aborting
    }

    // Existing document_assets (the PDF blob in R2) are reused — the
    // arxiv PDF doesn't change between regenerations of the same id+ver.

    return NextResponse.json({
      ok: true,
      projectId: row.id,
      sourceUrl: row.sourceUrl,
      sourceType: row.sourceType,
    });
  } catch (error: any) {
    console.error("Regenerate error:", error);
    return NextResponse.json(
      { error: "Failed to regenerate project" },
      { status: 500 }
    );
  }
}
