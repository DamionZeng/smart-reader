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
import type { Concept, ConceptEdge, ConceptCluster } from "@/types/concept-graph";
import { isHtml, stripHtml } from "@/utils/html-utils";

const MAX_CONTEXT_CHARS = 30000;
const MAX_HISTORY_MESSAGES = 6;
const MAX_MESSAGE_CHARS = 5000;
const TOP_CONCEPTS = 50;
const TOP_EDGES = 100;

const SYSTEM_PROMPT = `Answer questions about this paper/code based on the concept graph.

Answer the user's question based ONLY on the provided context. If the answer cannot be found in the context, say so clearly rather than making up information.

Keep your answers concise and precise. Use markdown formatting for structure (headers, lists, bold) when it improves readability. Quote specific passages from the source text when relevant, using ">" blockquotes.

If the user asks about a specific concept that appears in the concept graph, reference the relevant concept label in your answer.`;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface QAHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface QARequestBody {
  question?: string;
  history?: QAHistoryMessage[];
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

    const body = (await request.json()) as QARequestBody;
    let { question, history } = body;

    if (!question || typeof question !== "string" || !question.trim()) {
      return NextResponse.json(
        { error: "question is required." },
        { status: 400 }
      );
    }

    // Validate + cap history
    if (!Array.isArray(history)) {
      history = [];
    }
    history = history
      .filter(
        (msg) =>
          msg &&
          (msg.role === "user" || msg.role === "assistant") &&
          typeof msg.content === "string"
      )
      .slice(-MAX_HISTORY_MESSAGES)
      .map((msg) => ({
        role: msg.role,
        content: msg.content.substring(0, MAX_MESSAGE_CHARS),
      }));

    question = question.substring(0, 5000);

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

    // Build context: top concepts by importance, top edges by weight,
    // clusters, and a slice of the original text.
    const allConcepts = (row.concepts as Concept[]) || [];
    const allEdges = (row.edges as ConceptEdge[]) || [];
    const clusters = (row.clusters as ConceptCluster[]) || [];
    const rawText = row.rawText || "";

    const topConcepts = [...allConcepts]
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .slice(0, TOP_CONCEPTS);
    const topEdges = [...allEdges]
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .slice(0, TOP_EDGES);

    const conceptsContext = topConcepts
      .map(
        (c) =>
          `- **${c.label}** [${c.type}]${c.clusterId ? ` (cluster: ${c.clusterId})` : ""}: ${c.description || ""}`
      )
      .join("\n");

    const edgesContext = topEdges
      .map(
        (e) =>
          `${e.source} --${e.type}--> ${e.target} (weight: ${e.weight || 0})`
      )
      .join("\n");

    const clustersContext = clusters
      .map(
        (cl) =>
          `- **${cl.label}** (${cl.colorName}): ${cl.conceptIds.length} concepts${cl.description ? ` — ${cl.description}` : ""}`
      )
      .join("\n");

    const plainText = isHtml(rawText) ? stripHtml(rawText) : rawText;
    const textContext = plainText
      ? `\n\n=== ORIGINAL TEXT (truncated) ===\n${plainText.substring(0, MAX_CONTEXT_CHARS)}`
      : "";

    const contextMessage = `=== ${row.type === "code" ? "CODE" : "PAPER"}: "${row.title}" ===

=== CONCEPTS (top ${topConcepts.length} of ${allConcepts.length}) ===
${conceptsContext}

=== EDGES (top ${topEdges.length} of ${allEdges.length}) ===
${edgesContext}

=== CLUSTERS ===
${clustersContext || "none"}${textContext}`;

    const acceptLanguage = request.headers.get("accept-language");
    const langInstruction = await getLanguageInstructionForUser(
      session.user.id,
      acceptLanguage
    );

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT + langInstruction },
      { role: "user", content: contextMessage },
      {
        role: "assistant",
        content:
          "I have read the concept graph and original text. Ask me anything about this source.",
      },
    ];

    for (const msg of history) {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }

    messages.push({ role: "user", content: question });

    let stream;
    try {
      stream = await agnes.chat.completions.create({
        model: AGNES_MODEL,
        messages,
        temperature: 0.3,
        stream: true,
      });
    } catch (e: any) {
      console.error("Agnes AI error:", e);
      return NextResponse.json(
        { error: "The AI service is currently unavailable. Please try again in a moment." },
        { status: 502 }
      );
    }

    // Track AI usage at the start of streaming
    await trackUsage(session.user.id, "concept-graph-qa");

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
    console.error("Concept graph QA error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process question" },
      { status: 500 }
    );
  }
}
