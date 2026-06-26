import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { folders, tags } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// Folders CRUD
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // "folders" | "tags"

    const userId = session.user.id;
    if (type === "tags") {
      const rows = await db
        .select()
        .from(tags)
        .where(eq(tags.userId, userId))
        .orderBy(tags.name);
      return NextResponse.json({ tags: rows });
    }

    const rows = await db
      .select()
      .from(folders)
      .where(eq(folders.userId, userId))
      .orderBy(folders.name);
    return NextResponse.json({ folders: rows });
  } catch (error) {
    console.error("[folders] GET error", error);
    return NextResponse.json(
      { error: "Failed to load organization data" },
      { status: 500 }
    );
  }
}

const createFolderSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const createTagSchema = z.object({
  name: z.string().min(1).max(50),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const limited = enforceRateLimit(request, userId, RATE_LIMITS.light);
    if (limited) return limited;

    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "folders";

    if (type === "tags") {
      const parsed = createTagSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid input" }, { status: 400 });
      }
      const [row] = await db
        .insert(tags)
        .values({ userId, name: parsed.data.name.trim() })
        .returning();
      return NextResponse.json({ tag: row }, { status: 201 });
    }

    const parsed = createFolderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const [row] = await db
      .insert(folders)
      .values({
        userId,
        name: parsed.data.name.trim(),
        color: parsed.data.color ?? "#1C1C1C",
      })
      .returning();
    return NextResponse.json({ folder: row }, { status: 201 });
  } catch (error) {
    console.error("[folders] POST error", error);
    return NextResponse.json(
      { error: "Failed to create organization item" },
      { status: 500 }
    );
  }
}
