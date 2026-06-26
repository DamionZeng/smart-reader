import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { usageRecords } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  try {
    // Rate limit
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Total requests
    const [totalRow] = await db
      .select({ total: count() })
      .from(usageRecords)
      .where(eq(usageRecords.userId, userId));

    // Requests by endpoint
    const byEndpointRows = await db
      .select({ endpoint: usageRecords.endpoint, count: count() })
      .from(usageRecords)
      .where(eq(usageRecords.userId, userId))
      .groupBy(usageRecords.endpoint);

    // Requests in last 24h / 7d / 30d
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [last24hRow] = await db
      .select({ count: count() })
      .from(usageRecords)
      .where(and(eq(usageRecords.userId, userId), gt(usageRecords.createdAt, last24h)));

    const [last7dRow] = await db
      .select({ count: count() })
      .from(usageRecords)
      .where(and(eq(usageRecords.userId, userId), gt(usageRecords.createdAt, last7d)));

    const [last30dRow] = await db
      .select({ count: count() })
      .from(usageRecords)
      .where(and(eq(usageRecords.userId, userId), gt(usageRecords.createdAt, last30d)));

    // Daily breakdown for the last 30 days
    const dailyRows = await db
      .select({
        date: sql<string>`DATE(${usageRecords.createdAt})`,
        count: count(),
      })
      .from(usageRecords)
      .where(and(eq(usageRecords.userId, userId), gt(usageRecords.createdAt, last30d)))
      .groupBy(sql`DATE(${usageRecords.createdAt})`)
      .orderBy(sql`DATE(${usageRecords.createdAt})`);

    const byEndpoint: Record<string, number> = {};
    for (const row of byEndpointRows) {
      byEndpoint[row.endpoint] = Number(row.count);
    }

    return NextResponse.json({
      total: Number(totalRow?.total ?? 0),
      byEndpoint,
      last24h: Number(last24hRow?.count ?? 0),
      last7d: Number(last7dRow?.count ?? 0),
      last30d: Number(last30dRow?.count ?? 0),
      daily: dailyRows.map((row) => ({
        date: row.date,
        count: Number(row.count),
      })),
    });
  } catch (error) {
    console.error("Usage stats error:", error);
    return NextResponse.json(
      { error: "Failed to load usage statistics." },
      { status: 500 }
    );
  }
}
