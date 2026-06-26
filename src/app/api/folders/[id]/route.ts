import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { folders, tags } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const updateFolderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const updateTagSchema = z.object({
  name: z.string().min(1).max(50),
});

export async function PATCH(
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

    const { id } = await params;
    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "folders";

    if (type === "tags") {
      const parsed = updateTagSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid input" }, { status: 400 });
      }
      const [row] = await db
        .update(tags)
        .set({ name: parsed.data.name.trim() })
        .where(and(eq(tags.id, id), eq(tags.userId, userId)))
        .returning();
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ tag: row });
    }

    const parsed = updateFolderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const update: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name.trim();
    if (parsed.data.color !== undefined) update.color = parsed.data.color;
    update.updatedAt = new Date();

    const [row] = await db
      .update(folders)
      .set(update)
      .where(and(eq(folders.id, id), eq(folders.userId, userId)))
      .returning();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ folder: row });
  } catch (error) {
    console.error("[folders/tags] PATCH error", error);
    return NextResponse.json(
      { error: "Failed to update organization item" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "folders";

    if (type === "tags") {
      const result = await db
        .delete(tags)
        .where(and(eq(tags.id, id), eq(tags.userId, userId)))
        .returning();
      if (result.length === 0) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    const result = await db
      .delete(folders)
      .where(and(eq(folders.id, id), eq(folders.userId, userId)))
      .returning();
    if (result.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[folders/tags] DELETE error", error);
    return NextResponse.json(
      { error: "Failed to delete organization item" },
      { status: 500 }
    );
  }
}
