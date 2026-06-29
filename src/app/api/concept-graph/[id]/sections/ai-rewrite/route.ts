import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { conceptGraphs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import { getLanguageInstructionForUser, SOURCE_LANGUAGE_INSTRUCTION } from "@/lib/ai-settings";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/concept-graph/[id]/sections/ai-rewrite
 *
 * 用户在思维导图上选中节点后请求 AI 润色。
 * 输入：当前 title / summary / contextHint（可选：节点在树中的路径）
 * 输出：润色后的 title / summary
 *
 * 失败时返回 5xx，调用方负责 fallback 到原值。
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.heavy);
    if (blocked) return blocked;

    const { id } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { nodeId, title, summary, contextHint } = (await request.json()) as {
      nodeId: string;
      title: string;
      summary: string;
      contextHint?: string;
    };

    if (!nodeId || typeof title !== "string") {
      return NextResponse.json(
        { error: "Missing required fields: nodeId, title" },
        { status: 400 }
      );
    }

    // 验证 graph 所有权
    const [row] = await db
      .select({ id: conceptGraphs.id })
      .from(conceptGraphs)
      .where(
        and(eq(conceptGraphs.id, id), eq(conceptGraphs.userId, session.user.id))
      )
      .limit(1);
    if (!row) {
      return NextResponse.json({ error: "Graph not found" }, { status: 404 });
    }

    const acceptLanguage = request.headers.get("accept-language");
    const langInstruction = await getLanguageInstructionForUser(
      session.user.id,
      acceptLanguage
    );

    const systemPrompt = `You are an expert editor polishing mind-map node titles and summaries in a research paper knowledge graph.

Goal: rewrite the given node's title and summary to be:
  - clearer and more informative
  - same language as the source
  - concise (title <= 12 words, summary 1-2 sentences)
  - preserves the original meaning

Context hint: where this node sits in the document outline (e.g. "Section 3 / Subsection 3.2 / Topic: ..."). Use it to keep topical consistency.

Output ONLY a JSON object:
{ "title": "...", "summary": "..." }
${langInstruction}`;

    const userContent = `Node to polish:
Title: ${title}
${summary ? `Summary: ${summary}` : "(no summary)"}
${contextHint ? `Context: ${contextHint}` : ""}

Return the polished JSON.`;

    const completion = await agnes.chat.completions.create({
      model: AGNES_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const newTitle =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 200)
        : title;
    const newSummary =
      typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 500) : summary;

    return NextResponse.json({
      title: newTitle,
      summary: newSummary,
    });
  } catch (error: any) {
    console.error("AI rewrite section error:", error);
    return NextResponse.json(
      { error: "AI rewrite failed. Please try again." },
      { status: 502 }
    );
  }
}
