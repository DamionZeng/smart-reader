import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  documents,
  folders,
  tags,
  projectFolders,
  projectTags,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { desc, eq, inArray } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        type: documents.type,
        originalUrl: documents.originalUrl,
        createdAt: documents.createdAt,
        isPublic: documents.isPublic,
      })
      .from(documents)
      .where(eq(documents.userId, session.user.id))
      .orderBy(desc(documents.createdAt));

    // Enrich with folder + tags
    const projectIds = rows.map((r) => r.id);
    let folderMap = new Map<string, { id: string; name: string; color: string }>();
    let tagsMap = new Map<string, Array<{ id: string; name: string }>>();

    if (projectIds.length > 0) {
      const folderRows = await db
        .select({
          projectId: projectFolders.projectId,
          folderId: folders.id,
          folderName: folders.name,
          folderColor: folders.color,
        })
        .from(projectFolders)
        .innerJoin(folders, eq(projectFolders.folderId, folders.id))
        .where(inArray(projectFolders.projectId, projectIds));

      for (const r of folderRows) {
        folderMap.set(r.projectId, {
          id: r.folderId,
          name: r.folderName,
          color: r.folderColor,
        });
      }

      const tagRows = await db
        .select({
          projectId: projectTags.projectId,
          tagId: tags.id,
          tagName: tags.name,
        })
        .from(projectTags)
        .innerJoin(tags, eq(projectTags.tagId, tags.id))
        .where(inArray(projectTags.projectId, projectIds));

      for (const r of tagRows) {
        const arr = tagsMap.get(r.projectId) ?? [];
        arr.push({ id: r.tagId, name: r.tagName });
        tagsMap.set(r.projectId, arr);
      }
    }

    // Tier 2: also fetch image thumbnails for image-type projects.
    // We pull the full `nodes` jsonb and extract the first node's
    // `imageUrl` field. Capped at a small subset so the list query
    // stays light.
    const thumbMap = new Map<string, string | null>();
    const imageProjectIds = rows
      .filter((r) => r.type === "image")
      .map((r) => r.id);
    if (imageProjectIds.length > 0) {
      const thumbRows = await db
        .select({ id: documents.id, nodes: documents.nodes })
        .from(documents)
        .where(inArray(documents.id, imageProjectIds));
      for (const r of thumbRows) {
        const nodes = (r.nodes as any[]) || [];
        const firstImage = nodes.find(
          (n) => n?.data?.imageUrl && typeof n.data.imageUrl === "string"
        );
        thumbMap.set(r.id, firstImage?.data?.imageUrl ?? null);
      }
    }

    const enriched = rows.map((r) => ({
      ...r,
      folder: folderMap.get(r.id) ?? null,
      tags: tagsMap.get(r.id) ?? [],
      // Only attach thumbnail for image-type projects; saves bytes on others
      thumbnail: r.type === "image" ? thumbMap.get(r.id) ?? null : null,
    }));

    return NextResponse.json({ projects: enriched });
  } catch (error: any) {
    console.error("List projects error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects
 *
 * Creates an empty project shell bound to the authenticated user.
 * Used when the user lands on /board without a project id, so the
 * URL can be immediately updated with a real id (which is the
 * canonical handle for the rest of the session).
 */
export async function POST(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let title = "Untitled Project";
    let projectType = "paper";
    try {
      const body = await request.json();
      if (
        body &&
        typeof body.title === "string" &&
        body.title.trim().length > 0
      ) {
        title = body.title.trim().slice(0, 255);
      }
      if (
        body &&
        typeof body.type === "string" &&
        (body.type === "paper" || body.type === "code" || body.type === "image")
      ) {
        projectType = body.type;
      }
    } catch {
      // Empty body is acceptable — fall back to defaults.
    }

    const [row] = await db
      .insert(documents)
      .values({
        title,
        type: projectType,
        originalUrl: null,
        // Empty project starts with no nodes/edges.
        nodes: [],
        edges: [],
        userId: session.user.id,
      })
      .returning();

    return NextResponse.json({ project: row });
  } catch (error: any) {
    console.error("Create project error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
