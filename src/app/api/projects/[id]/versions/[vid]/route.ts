import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectVersions, documents } from "@/db/schema";
import type { DocumentNode, DocumentEdge } from "@/types";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; vid: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const { id: projectId, vid } = await params;

    const [version] = await db
      .select()
      .from(projectVersions)
      .where(
        and(
          eq(projectVersions.id, vid),
          eq(projectVersions.projectId, projectId),
          eq(projectVersions.userId, userId)
        )
      )
      .limit(1);
    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    return NextResponse.json({ version });
  } catch (error) {
    console.error("[version] GET error", error);
    return NextResponse.json(
      { error: "Failed to load version" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; vid: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const limited = enforceRateLimit(request, userId, RATE_LIMITS.light);
    if (limited) return limited;

    const { id: projectId, vid } = await params;

    const result = await db
      .delete(projectVersions)
      .where(
        and(
          eq(projectVersions.id, vid),
          eq(projectVersions.projectId, projectId),
          eq(projectVersions.userId, userId)
        )
      )
      .returning();
    if (result.length === 0) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[version] DELETE error", error);
    return NextResponse.json(
      { error: "Failed to delete version" },
      { status: 500 }
    );
  }
}

// Rollback = restore a version into the live document.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; vid: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const limited = enforceRateLimit(request, userId, RATE_LIMITS.light);
    if (limited) return limited;

    const { id: projectId, vid } = await params;

    const [version] = await db
      .select()
      .from(projectVersions)
      .where(
        and(
          eq(projectVersions.id, vid),
          eq(projectVersions.projectId, projectId),
          eq(projectVersions.userId, userId)
        )
      )
      .limit(1);
    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Verify project ownership
    const [project] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, projectId), eq(documents.userId, userId)))
      .limit(1);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Snapshot current state BEFORE rollback
    const [current] = await db
      .select({ nodes: documents.nodes, edges: documents.edges })
      .from(documents)
      .where(eq(documents.id, projectId))
      .limit(1);
    if (current) {
      await db.insert(projectVersions).values({
        projectId,
        userId,
        label: "Pre-rollback snapshot",
        nodes: current.nodes as DocumentNode[],
        edges: current.edges as DocumentEdge[],
      });
    }

    // Apply version into documents
    await db
      .update(documents)
      .set({
        nodes: version.nodes as DocumentNode[],
        edges: version.edges as DocumentEdge[],
        updatedAt: new Date(),
      })
      .where(eq(documents.id, projectId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[version] POST (rollback) error", error);
    return NextResponse.json(
      { error: "Failed to rollback to version" },
      { status: 500 }
    );
  }
}
