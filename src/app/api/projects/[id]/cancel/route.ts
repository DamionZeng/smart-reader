import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents, conceptGraphJobs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/projects/[id]/cancel
 *
 * 取消正在解析的项目。只更新数据库状态:
 *   - concept_graph_jobs.status = 'cancelled'(Python 后台任务在下一个
 *     onProgress 边界检测到此标志后静默退出)
 *   - documents.status = 'failed'(取消不算成功,保留 project 让用户
 *     可以重新解析或删除)
 *
 * 幂等:对已完成的 job 调用是 no-op(只匹配 status='processing' 的 job)。
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(req);
    const blocked = enforceRateLimit(req, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // 只取消属于当前用户、仍在 processing 的 job
    await db
      .update(conceptGraphJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(conceptGraphJobs.projectId, id),
          eq(conceptGraphJobs.userId, session.user.id),
          eq(conceptGraphJobs.status, "processing"),
        ),
      );

    // 项目状态标记为 failed(保留 project,用户可重新解析或删除)
    await db
      .update(documents)
      .set({ status: "failed", updatedAt: new Date() })
      .where(
        and(
          eq(documents.id, id),
          eq(documents.userId, session.user.id),
        ),
      );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Cancel parsing project error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 },
    );
  }
}
