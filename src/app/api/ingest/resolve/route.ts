/**
 * GET /api/ingest/resolve?url=...
 *
 * Pre-flight check used by the import page to detect "this URL has
 * already been imported" BEFORE the user commits to the (potentially
 * expensive) ingest pipeline. Returns:
 *   { exists: false, sourceKey, sourceType, sourceUrl }
 *   or
 *   { exists: true, documentId, title, sourceType, sourceUrl, updatedAt }
 *
 * Auth is required — we don't leak project existence to strangers.
 *
 * Rate limit: light (this is a small read).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import {
  isArxivUrl,
  isPdfUrl,
  resolveArxivUrl,
} from "@/lib/arxiv";
import {
  resolveIngestSource,
  normalizeSourceKey,
} from "@/lib/resolve-ingest";

export async function GET(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");
    if (!url) {
      return NextResponse.json(
        { error: "url parameter is required" },
        { status: 400 }
      );
    }

    // Derive the same sourceKey the ingest route would use, so the
    // resolve check matches the actual ingest decision exactly.
    let sourceKey: string | null = null;
    let sourceType: "arxiv" | "pdf-url" | "github-repo" | "web" | "file" | null = null;
    if (isArxivUrl(url)) {
      try {
        const r = resolveArxivUrl(url);
        sourceKey = r.sourceKey;
        sourceType = "arxiv";
      } catch {
        sourceType = "pdf-url";
        sourceKey = normalizeSourceKey(url);
      }
    } else if (isPdfUrl(url)) {
      sourceType = "pdf-url";
      sourceKey = normalizeSourceKey(url);
    } else {
      sourceType = "web";
      sourceKey = normalizeSourceKey(url);
    }

    if (!sourceKey) {
      return NextResponse.json(
        { error: "Could not derive a source key for this URL" },
        { status: 400 }
      );
    }

    const result = await resolveIngestSource(session.user.id, sourceKey);
    return NextResponse.json({
      ...result,
      sourceKey,
      sourceType,
      sourceUrl: url,
    });
  } catch (error: any) {
    console.error("Resolve ingest error:", error);
    return NextResponse.json(
      { error: "Failed to resolve URL" },
      { status: 500 }
    );
  }
}
