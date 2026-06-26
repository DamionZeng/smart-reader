import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { projectFolders, projectTags, folders, tags, documents } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const assignSchema = z.object({
  folderId: z.string().uuid().nullable().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const limited = enforceRateLimit(request, userId, RATE_LIMITS.light);
    if (limited) return limited;

    const { id: projectId } = await params;
    const body = await request.json();
    const parsed = assignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    // Ownership check
    const [project] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, projectId), eq(documents.userId, userId)))
      .limit(1);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Folder: replace
    if (parsed.data.folderId !== undefined) {
      await db.delete(projectFolders).where(eq(projectFolders.projectId, projectId));
      if (parsed.data.folderId) {
        // Verify folder ownership
        const [f] = await db
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.id, parsed.data.folderId), eq(folders.userId, userId)))
          .limit(1);
        if (f) {
          await db.insert(projectFolders).values({ projectId, folderId: f.id });
        }
      }
    }

    // Tags: replace
    if (parsed.data.tagIds !== undefined) {
      await db.delete(projectTags).where(eq(projectTags.projectId, projectId));
      if (parsed.data.tagIds.length > 0) {
        // Verify tag ownership
        const validTags = await db
          .select({ id: tags.id })
          .from(tags)
          .where(eq(tags.userId, userId));
        const validIds = new Set(validTags.map((t) => t.id));
        const toInsert = parsed.data.tagIds.filter((tid) => validIds.has(tid));
        if (toInsert.length > 0) {
          await db
            .insert(projectTags)
            .values(toInsert.map((tagId) => ({ projectId, tagId })));
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[project organization] PUT error", error);
    return NextResponse.json(
      { error: "Failed to update project organization" },
      { status: 500 }
    );
  }
}
