import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq, ilike, or } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_RESULTS = 20;
const SNIPPET_LENGTH = 200;
const MAX_QUERY_LENGTH = 200;

/**
 * Build a snippet of text around the first match of `query` (case-insensitive).
 * Returns the first SNIPPET_LENGTH characters around the match.
 */
function buildSnippet(text: string, query: string): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) {
    return text.slice(0, SNIPPET_LENGTH);
  }
  const half = Math.floor(SNIPPET_LENGTH / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const snippet = text.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + snippet + suffix;
}

/**
 * GET /api/search?q=keyword
 *
 * Full-text search across the authenticated user's projects. Searches
 * document title and rawText (case-insensitive via ilike). Returns up to
 * 20 results with a snippet of the matching text.
 */
export async function GET(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const query = request.nextUrl.searchParams.get("q");
    if (!query || typeof query !== "string" || !query.trim()) {
      return NextResponse.json(
        { error: "Query parameter 'q' is required." },
        { status: 400 }
      );
    }

    const term = `%${query.trim().slice(0, MAX_QUERY_LENGTH)}%`;

    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        type: documents.type,
        rawText: documents.rawText,
      })
      .from(documents)
      .where(
        and(
          eq(documents.userId, session.user.id),
          or(
            ilike(documents.title, term),
            ilike(documents.rawText, term)
          )
        )
      )
      .limit(MAX_RESULTS);

    const trimmed = query.trim();
    const results = rows.map((row) => {
      const matchedInTitle = row.title
        .toLowerCase()
        .includes(trimmed.toLowerCase());
      const sourceText = matchedInTitle ? row.title : row.rawText ?? "";
      return {
        id: row.id,
        title: row.title,
        type: row.type,
        snippet: buildSnippet(sourceText, trimmed),
      };
    });

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
