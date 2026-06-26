import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphs } from "@/db/schema";
import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import { trackUsage } from "@/app/api/usage/track";
import { getLanguageInstructionForUser } from "@/lib/ai-settings";
import type { Concept } from "@/types/concept-graph";

const SYSTEM_PROMPT = `Explain this technical concept in simple terms. Provide: 1) A simplified explanation, 2) An analogy.

Respond using EXACTLY this format with two labelled sections (no markdown fences, no extra commentary):

[EXPLANATION]
A clear, plain-language explanation of what this concept means and why it matters.

[ANALOGY]
An intuitive analogy that makes the concept click for a non-expert.

Rules:
- The [EXPLANATION] must be factual and grounded in the concept's description and source anchors.
- The [ANALOGY] must be creative but accurate — do not mislead.
- Always include both sections, in that order.`;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ExplainRequestBody {
  conceptId?: string;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const { id } = await params;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: ExplainRequestBody = await request.json();
    const { conceptId } = body;

    if (!conceptId || typeof conceptId !== "string") {
      return NextResponse.json(
        { error: "conceptId is required." },
        { status: 400 }
      );
    }

    const [row] = await db
      .select()
      .from(conceptGraphs)
      .where(
        and(eq(conceptGraphs.id, id), eq(conceptGraphs.userId, session.user.id))
      )
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const concepts = (row.concepts as Concept[]) || [];
    const concept = concepts.find((c) => c.id === conceptId);
    if (!concept) {
      return NextResponse.json(
        { error: "Concept not found in this graph." },
        { status: 404 }
      );
    }

    // Track AI usage at the start
    await trackUsage(session.user.id, "concept-graph-explain");

    const acceptLanguage = request.headers.get("accept-language");
    const langInstruction = await getLanguageInstructionForUser(
      session.user.id,
      acceptLanguage
    );

    const anchors = Array.isArray(concept.anchors)
      ? concept.anchors.slice(0, 5).join("\n- ")
      : "";

    const userMessage = `Concept Label: ${concept.label || "Untitled"}
Concept Type: ${concept.type || "concept"}
Description: ${concept.description || "No description provided."}
Aliases: ${Array.isArray(concept.aliases) ? concept.aliases.join(", ") : "none"}
Source Anchors:${anchors ? "\n- " + anchors : " none"}
${concept.codeSnippet ? `\nCode Snippet:\n${concept.codeSnippet.slice(0, 2000)}` : ""}

Please explain this concept.`;

    let stream;
    try {
      stream = await agnes.chat.completions.create({
        model: AGNES_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + langInstruction },
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 600,
        stream: true,
      });
    } catch (e: any) {
      console.error("Agnes AI error:", e);
      return NextResponse.json(
        { error: "The AI service is currently unavailable. Please try again in a moment." },
        { status: 502 }
      );
    }

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
              );
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("Concept graph explain error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate explanation" },
      { status: 500 }
    );
  }
}
