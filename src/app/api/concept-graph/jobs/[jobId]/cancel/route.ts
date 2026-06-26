import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphJobs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

/**
 * POST /api/concept-graph/jobs/[jobId]/cancel
 *
 * Mark a running KG pipeline job as "cancelled". The background
 * `runPipeline()` in /api/concept-graph/ingest checks the job status
 * at every progress boundary and bails out cleanly (no graph row,
 * no "failed" status — just a quiet exit) when it sees this flag.
 *
 * Idempotent: hitting this endpoint for an already-cancelled or
 * already-done job is a no-op (200 OK). Only the job's owner can
 * cancel it.
 *
 * The client uses this from the cancel button in the import flow
 * (see `useIngestionFlow.cancelIngest`).
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;

    // Only flip the status when the job is still in flight. If it's
    // already done / failed / cancelled, there's nothing for the
    // server-side pipeline to abort, so leave the existing terminal
    // status alone.
    await db
      .update(conceptGraphJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(conceptGraphJobs.id, jobId),
          eq(conceptGraphJobs.userId, session.user.id),
          eq(conceptGraphJobs.status, "processing"),
        ),
      );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Cancel concept graph job error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
