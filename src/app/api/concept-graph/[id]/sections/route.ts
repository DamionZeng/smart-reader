import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { conceptGraphs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import type { DocumentSection } from "@/types/concept-graph";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/concept-graph/[id]/sections
 *
 * 保存用户编辑后的章节大纲（思维导图数据）。
 * Body: { sections: DocumentSection[] }
 */
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const { id } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sections } = (await request.json()) as { sections: DocumentSection[] };
    if (!Array.isArray(sections)) {
      return NextResponse.json(
        { error: "Body must be { sections: DocumentSection[] }" },
        { status: 400 }
      );
    }

    // 验证 graph 所有权
    const [row] = await db
      .select({ id: conceptGraphs.id })
      .from(conceptGraphs)
      .where(
        and(eq(conceptGraphs.id, id), eq(conceptGraphs.userId, session.user.id))
      )
      .limit(1);
    if (!row) {
      return NextResponse.json({ error: "Graph not found" }, { status: 404 });
    }

    await db
      .update(conceptGraphs)
      .set({ sections, updatedAt: new Date() })
      .where(eq(conceptGraphs.id, id));

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Save sections error:", error);
    return NextResponse.json(
      { error: "Failed to save sections." },
      { status: 500 }
    );
  }
}
