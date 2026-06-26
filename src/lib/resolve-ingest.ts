/**
 * Idempotency for URL-based ingest.
 *
 * The user can paste the same arxiv/PDF URL multiple times. We want to
 * detect that, surface the existing project, and let the user choose
 * "open the existing one" vs "re-generate from scratch" — instead of
 * silently creating duplicate documents with overlapping KG data.
 *
 * The check is keyed on (userId, sourceKey), where `sourceKey` is:
 *   - arxiv:  "{arxivId}-v{version}"   (e.g. "1706.03762-v7")
 *   - pdf-url: the input URL itself (normalized)
 *   - file:   "file:{sha1-of-content}"  (set by the upload path)
 *   - github: "{owner}/{repo}@{ref}"   (next round)
 *
 * For uploaded files `sourceKey` is null (legacy) or a sha1; the
 * `findExistingBySourceKey` helper returns null in that case, so the
 * old "always create new" flow is preserved.
 */

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, documentAssets } from "@/db/schema";

export interface ExistingProject {
  documentId: string;
  title: string;
  type: "paper" | "code";
  sourceType: string | null;
  sourceUrl: string | null;
  sourceKey: string | null;
  updatedAt: Date;
  hasPdfAsset: boolean;
}

interface ExistingRow {
  id: string;
  title: string;
  type: string;
  sourceType: string | null;
  sourceUrl: string | null;
  sourceKey: string | null;
  updatedAt: Date;
}

/**
 * Look up an existing project for a given (userId, sourceKey). Returns
 * null if no match. Does NOT throw — this is called from the pre-flight
 * "already imported?" check.
 */
export async function findExistingBySourceKey(
  userId: string,
  sourceKey: string | null
): Promise<ExistingProject | null> {
  if (!sourceKey) return null;
  const [row] = (await db
    .select({
      id: documents.id,
      title: documents.title,
      type: documents.type,
      sourceType: documents.sourceType,
      sourceUrl: documents.sourceUrl,
      sourceKey: documents.sourceKey,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.sourceKey, sourceKey)))
    .limit(1)) as ExistingRow[];

  if (!row) return null;

  // Quick check: does the project have a PDF asset? Used by the UI to
  // hint "重生成将重新下载 PDF" vs "纯 KG 重建".
  const pdfAssets = await db
    .select({ id: documentAssets.id })
    .from(documentAssets)
    .where(
      and(
        eq(documentAssets.documentId, row.id),
        eq(documentAssets.kind, "pdf")
      )
    )
    .limit(1);

  return {
    documentId: row.id,
    title: row.title,
    type: row.type as "paper" | "code",
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    sourceKey: row.sourceKey,
    updatedAt: row.updatedAt,
    hasPdfAsset: pdfAssets.length > 0,
  };
}

/**
 * Light-weight existence check used by `/api/ingest/resolve`. Only
 * fields the pre-flight modal needs — the full row comes later when
 * the user actually opens the project.
 */
export interface ResolveResult {
  exists: boolean;
  documentId?: string;
  title?: string;
  sourceType?: string | null;
  sourceUrl?: string | null;
  updatedAt?: string;
}

export async function resolveIngestSource(
  userId: string,
  sourceKey: string | null
): Promise<ResolveResult> {
  const existing = await findExistingBySourceKey(userId, sourceKey);
  if (!existing) return { exists: false };
  return {
    exists: true,
    documentId: existing.documentId,
    title: existing.title,
    sourceType: existing.sourceType,
    sourceUrl: existing.sourceUrl,
    updatedAt: existing.updatedAt.toISOString(),
  };
}

/**
 * Normalize a user-pasted URL into a stable sourceKey. Strips trailing
 * slashes, lowercases host, removes common tracking params. Returns
 * null for URLs that don't look resolvable (caller should reject).
 */
export function normalizeSourceKey(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.replace(/\/+$/, "");
    // Drop common tracking params; keep rest (arxiv ids etc.)
    const dropParams = ["utm_source", "utm_medium", "utm_campaign", "ref", "source"];
    const params: string[] = [];
    u.searchParams.forEach((v, k) => {
      if (!dropParams.includes(k.toLowerCase())) params.push(`${k}=${v}`);
    });
    params.sort();
    const qs = params.length ? `?${params.join("&")}` : "";
    return `${host}${path}${qs}`;
  } catch {
    return null;
  }
}
