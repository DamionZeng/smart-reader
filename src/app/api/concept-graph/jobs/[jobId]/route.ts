import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphJobs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

// GET /api/concept-graph/jobs/[jobId] — poll job status
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(request);
    // Job status polling is a read-only status check that runs every
    // few seconds while the KG pipeline is in flight. Use the dedicated
    // `polling` quota (120/min) so it doesn't compete with the user's
    // 30/min `light` budget for QA/explain calls.
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.polling);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;

    const [row] = await db
      .select({
        id: conceptGraphJobs.id,
        status: conceptGraphJobs.status,
        progress: conceptGraphJobs.progress,
        graphId: conceptGraphJobs.graphId,
        projectId: conceptGraphJobs.projectId,
        error: conceptGraphJobs.error,
      })
      .from(conceptGraphJobs)
      .where(
        and(
          eq(conceptGraphJobs.id, jobId),
          eq(conceptGraphJobs.userId, session.user.id)
        )
      )
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: row.id,
      status: row.status,
      progress: row.progress,
      ...(row.graphId ? { graphId: row.graphId } : {}),
      ...(row.projectId ? { projectId: row.projectId } : {}),
      ...(row.error ? { error: row.error } : {}),
    });
  } catch (error: any) {
    console.error("Get concept graph job error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
