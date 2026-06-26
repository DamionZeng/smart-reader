import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 10000;

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

interface ConversationBody {
  projectId?: string;
  messages?: unknown;
}

/**
 * GET /api/qa/conversations?projectId=xxx
 *
 * Returns the latest conversation for the given project owned by the
 * authenticated user. Responds 404 when no conversation exists yet.
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

    const projectId = request.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    const [row] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.projectId, projectId),
          eq(conversations.userId, session.user.id)
        )
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { error: "No conversation found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ conversation: row });
  } catch (error: any) {
    console.error("Get conversation error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/qa/conversations
 *
 * Creates or updates the conversation for { projectId } owned by the
 * authenticated user. One conversation per project per user — if a row
 * already exists it is updated, otherwise a new row is inserted.
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

    const body = (await request.json()) as ConversationBody;
    const { projectId } = body;

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    // Validate and sanitize messages: must be an array of
    // { role: 'user' | 'assistant', content: string }.
    let messages: ConversationMessage[] = [];
    if (Array.isArray(body.messages)) {
      messages = body.messages
        .filter(
          (msg: any) =>
            msg &&
            (msg.role === "user" || msg.role === "assistant") &&
            typeof msg.content === "string"
        )
        .slice(0, MAX_MESSAGES)
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content.substring(0, MAX_MESSAGE_CHARS),
          ...(typeof msg.timestamp === "string"
            ? { timestamp: msg.timestamp }
            : {}),
        }));
    }

    // Look for an existing conversation for this project + user.
    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.projectId, projectId),
          eq(conversations.userId, session.user.id)
        )
      )
      .limit(1);

    if (existing) {
      const [row] = await db
        .update(conversations)
        .set({
          messages,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, existing.id))
        .returning();

      return NextResponse.json({ conversation: row });
    }

    const [row] = await db
      .insert(conversations)
      .values({
        userId: session.user.id,
        projectId,
        messages,
      })
      .returning();

    return NextResponse.json({ conversation: row });
  } catch (error: any) {
    console.error("Save conversation error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
