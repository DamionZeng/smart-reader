import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  documents,
  conceptGraphs,
  conceptGraphJobs,
  documentAssets,
  documentLinks,
  projectVersions,
  projectFolders,
  projectTags,
  conversations,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import {
  extractR2ImageKeys,
  deleteImagesByKeys,
  isR2Configured,
} from "@/lib/storage";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(req);
    const blocked = enforceRateLimit(req, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const { id } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ project: row });
  } catch (error: any) {
    console.error("Get project error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get project" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(req);
    const blocked = enforceRateLimit(req, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const { id } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    // Validate and sanitize input
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 255) : undefined;
    const rawText = typeof body?.rawText === "string" ? body.rawText.substring(0, 100000) : undefined;
    const nodes = Array.isArray(body?.nodes) ? body.nodes.slice(0, 500) : undefined; // Max 500 nodes
    const edges = Array.isArray(body?.edges) ? body.edges.slice(0, 1000) : undefined; // Max 1000 edges
    const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : undefined;

    const update: Record<string, unknown> = {};
    update.updatedAt = new Date();
    if (Array.isArray(nodes)) update.nodes = nodes;
    if (Array.isArray(edges)) update.edges = edges;
    if (typeof title === "string" && title.trim().length > 0) {
      update.title = title.trim();
    }
    if (typeof rawText === "string") {
      update.rawText = rawText.substring(0, 100000);
    }
    // Persist paper metadata
    if (metadata && typeof metadata === "object") {
      const m = metadata as Record<string, unknown>;
      if (Array.isArray(m.authors)) {
        const authors = m.authors
          .slice(0, 50)
          .map((a) => String(a).slice(0, 200));
        update.authors = JSON.stringify(authors);
      }
      if (typeof m.year === "number" && m.year >= 0 && m.year <= 3000) {
        update.year = m.year;
      }
      if (typeof m.venue === "string") {
        update.venue = m.venue.slice(0, 255);
      }
      if (typeof m.doi === "string") {
        update.doi = m.doi.slice(0, 255);
      }
      if (typeof m.abstract === "string") {
        update.abstract = m.abstract.slice(0, 10000);
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No updatable fields provided" },
        { status: 400 }
      );
    }

    const [row] = await db
      .update(documents)
      .set(update)
      .where(and(eq(documents.id, id), eq(documents.userId, session.user.id)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ project: row });
  } catch (error: any) {
    console.error("Update project error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(req);
    const blocked = enforceRateLimit(req, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const { id } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify ownership BEFORE doing any work — we need to fail fast
    // (404) if the project doesn't belong to this user.
    const [project] = await db
      .select({ id: documents.id, nodes: documents.nodes })
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!project) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ----- Collect R2 keys before the rows are gone -----
    // Two sources: image URLs embedded in the document's nodes, and
    // documentAssets rows (the PDF/zip/etc. that was uploaded).
    let r2Keys: string[] = [];
    if (isR2Configured()) {
      try {
        r2Keys = extractR2ImageKeys(project.nodes);
      } catch (e) {
        console.error("[project delete] Failed to extract R2 keys from nodes:", e);
      }
      try {
        const assets = await db
          .select({ storageUrl: documentAssets.storageUrl })
          .from(documentAssets)
          .where(eq(documentAssets.documentId, id));
        for (const a of assets) {
          // storageUrl looks like https://<r2-host>/<key>; extract the key
          try {
            const u = new URL(a.storageUrl);
            // strip leading "/" from the pathname
            const key = u.pathname.replace(/^\/+/, "");
            if (key) r2Keys.push(key);
          } catch {
            /* ignore malformed url */
          }
        }
      } catch (e) {
        console.error("[project delete] Failed to list documentAssets:", e);
      }
    }

    // ----- Delete all dependent rows FIRST -----
    // We do this before deleting the document so we never leave a
    // dangling concept_graphs row pointing at a deleted document (the
    // schema sets documentId to NULL on delete, which would create an
    // orphan "ghost cluster" in the global graph on the dashboard).
    //
    // Order doesn't strictly matter (we filter by documentId), but we
    // go from leaves up for clarity.
    const cleanupErrors: string[] = [];

    // concept_graph_jobs: this table has a `projectId` column (NOT a
    // foreign key) so it must be wiped manually. Without this, old
    // in-flight jobs from this deleted project linger in DB and show
    // up in any "recent jobs" list / status pages.
    try {
      await db
        .delete(conceptGraphJobs)
        .where(eq(conceptGraphJobs.projectId, id));
    } catch (e) {
      cleanupErrors.push("concept_graph_jobs");
      console.error("[project delete] concept_graph_jobs:", e);
    }

    // concept_graphs: this is the main one the user is asking about.
    // Without this delete, the global graph panel keeps showing a
    // big-circle for the deleted document (and the LLM-cluster
    // fallback labels it with whatever orphan-title the row had).
    try {
      await db
        .delete(conceptGraphs)
        .where(eq(conceptGraphs.documentId, id));
    } catch (e) {
      cleanupErrors.push("concept_graphs");
      console.error("[project delete] concept_graphs:", e);
    }

    // document_assets, document_links: cascade would clean these up
    // when the document row is deleted, but we delete explicitly so
    // the R2 cleanup below can use the rows for their storageUrl
    // (we already collected the keys above, but for symmetry).
    try {
      await db
        .delete(documentAssets)
        .where(eq(documentAssets.documentId, id));
    } catch (e) {
      cleanupErrors.push("document_assets");
      console.error("[project delete] document_assets:", e);
    }

    try {
      await db
        .delete(documentLinks)
        .where(eq(documentLinks.documentId, id));
    } catch (e) {
      cleanupErrors.push("document_links");
      console.error("[project delete] document_links:", e);
    }

    // project_versions: has onDelete cascade, but delete explicitly so
    // any future schema change doesn't surprise us.
    try {
      await db
        .delete(projectVersions)
        .where(eq(projectVersions.projectId, id));
    } catch (e) {
      cleanupErrors.push("project_versions");
      console.error("[project delete] project_versions:", e);
    }

    // project_folders / project_tags: junction tables; cascade in
    // schema but wipe explicitly to be safe.
    try {
      await db
        .delete(projectFolders)
        .where(eq(projectFolders.projectId, id));
    } catch (e) {
      cleanupErrors.push("project_folders");
      console.error("[project delete] project_folders:", e);
    }

    try {
      await db
        .delete(projectTags)
        .where(eq(projectTags.projectId, id));
    } catch (e) {
      cleanupErrors.push("project_tags");
      console.error("[project delete] project_tags:", e);
    }

    // conversations: projectId is a varchar, not a foreign key, so we
    // must clean this up manually. (The Q&A chat history per project.)
    try {
      await db
        .delete(conversations)
        .where(eq(conversations.projectId, id));
    } catch (e) {
      cleanupErrors.push("conversations");
      console.error("[project delete] conversations:", e);
    }

    // ----- Finally, delete the document itself -----
    const [row] = await db
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, session.user.id)))
      .returning();

    if (!row) {
      // The row disappeared between our check and the delete — likely
      // a concurrent request. Cleanup ran for the ID we saw; respond
      // 404 to the caller.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ----- Best-effort: free R2 objects owned by this project -----
    // Errors are logged in deleteImage — they never block the response.
    if (r2Keys.length > 0) {
      void deleteImagesByKeys(r2Keys);
    }

    return NextResponse.json({
      success: true,
      // Report any cleanup issues so the client (and tests) can see
      // them, but don't fail the request — the document is gone.
      cleanupWarnings: cleanupErrors.length > 0 ? cleanupErrors : undefined,
    });
  } catch (error: any) {
    console.error("Delete project error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete project" },
      { status: 500 }
    );
  }
}
