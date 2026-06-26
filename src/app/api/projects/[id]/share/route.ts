import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/projects/[id]/share — create or toggle share link
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    // Verify ownership
    const [existing] = await db
      .select({ id: documents.id, shareId: documents.shareId, isPublic: documents.isPublic })
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (action === "revoke") {
      // Revoke sharing
      const [updated] = await db
        .update(documents)
        .set({ isPublic: false, shareId: null, updatedAt: new Date() })
        .where(and(eq(documents.id, id), eq(documents.userId, session.user.id)))
        .returning();
      return NextResponse.json({ project: updated });
    }

    // Enable sharing — generate shareId if not exists
    const shareId = existing.shareId || randomUUID();
    const [updated] = await db
      .update(documents)
      .set({ isPublic: true, shareId, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.userId, session.user.id)))
      .returning();

    return NextResponse.json({ project: updated });
  } catch (error) {
    console.error("Share project error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
