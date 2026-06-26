import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { projectVersions, documents } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_VERSIONS_PER_PROJECT = 50;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const { id: projectId } = await params;

    // Verify ownership
    const [project] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, projectId), eq(documents.userId, userId)))
      .limit(1);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const versions = await db
      .select({
        id: projectVersions.id,
        label: projectVersions.label,
        createdAt: projectVersions.createdAt,
      })
      .from(projectVersions)
      .where(eq(projectVersions.projectId, projectId))
      .orderBy(desc(projectVersions.createdAt))
      .limit(MAX_VERSIONS_PER_PROJECT);

    return NextResponse.json({ versions });
  } catch (error) {
    console.error("[versions] GET error", error);
    return NextResponse.json(
      { error: "Failed to load versions" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  label: z.string().max(200).optional(),
  nodes: z.array(z.any()).max(500),
  edges: z.array(z.any()).max(1000),
});

export async function POST(
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
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    // Verify ownership
    const [project] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, projectId), eq(documents.userId, userId)))
      .limit(1);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Insert version
    const [row] = await db
      .insert(projectVersions)
      .values({
        projectId,
        userId,
        label: parsed.data.label ?? null,
        nodes: parsed.data.nodes,
        edges: parsed.data.edges,
      })
      .returning({
        id: projectVersions.id,
        createdAt: projectVersions.createdAt,
      });

    // Cleanup: keep only the most recent N versions
    const allVersions = await db
      .select({ id: projectVersions.id })
      .from(projectVersions)
      .where(eq(projectVersions.projectId, projectId))
      .orderBy(desc(projectVersions.createdAt));

    if (allVersions.length > MAX_VERSIONS_PER_PROJECT) {
      const toDelete = allVersions
        .slice(MAX_VERSIONS_PER_PROJECT)
        .map((v) => v.id);
      await db
        .delete(projectVersions)
        .where(inArray(projectVersions.id, toDelete));
    }

    return NextResponse.json({ version: row }, { status: 201 });
  } catch (error) {
    console.error("[versions] POST error", error);
    return NextResponse.json(
      { error: "Failed to create version" },
      { status: 500 }
    );
  }
}
