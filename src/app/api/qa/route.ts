import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/db/schema";
import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import { trackUsage } from "@/app/api/usage/track";
import { getLanguageInstructionForUser } from "@/lib/ai-settings";

const MAX_CONTEXT_CHARS = 30000;
const MAX_HISTORY = 6; // Keep last 3 Q&A pairs (6 messages)

const SYSTEM_PROMPT = `You are a research assistant helping a user understand an academic paper. You are given the paper's knowledge graph (nodes and edges) and optionally the paper's original text as context.

Answer the user's question based ONLY on the provided context. If the answer cannot be found in the context, say so clearly rather than making up information.

Keep your answers concise and precise. Use markdown formatting for structure (headers, lists, bold) when it improves readability. Quote specific passages from the source text when relevant, using ">" blockquotes.

If the user asks about a specific concept that appears in the knowledge graph, reference the relevant node title in your answer.`;

interface QAHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface QARequest {
  projectId: string;
  question: string;
  history?: QAHistoryMessage[];
  // Tier 2: optional image attachments. The client uploads to base64
  // data-URLs and we forward them as image_url content parts.
  images?: Array<{ dataUrl: string; name?: string }>;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: light AI operation
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.light);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as QARequest;
    let { projectId, question, history, images } = body;

    if (!projectId || typeof question !== "string" || !question.trim()) {
      return NextResponse.json(
        { error: "projectId and question are required." },
        { status: 400 }
      );
    }

    // Tier 2: validate image attachments. Cap to 4 images and validate
    // each is a base64 data-URL with an accepted MIME type.
    const validImages: Array<{ dataUrl: string; name?: string }> = [];
    if (Array.isArray(images)) {
      for (const img of images.slice(0, 4)) {
        if (
          img &&
          typeof img.dataUrl === "string" &&
          /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(img.dataUrl)
        ) {
          validImages.push({
            dataUrl: img.dataUrl,
            ...(typeof img.name === "string" ? { name: img.name } : {}),
          });
        }
      }
    }

    // Validate history: must be an array, filter by allowed roles,
    // limit message count and per-message content length.
    if (!Array.isArray(history)) {
      history = [];
    }
    const MAX_HISTORY_MESSAGES = 6;
    const MAX_MESSAGE_CHARS = 5000;
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

    // Limit question length to prevent oversized prompts.
    question = question.substring(0, 5000);

    // Fetch the project to build context
    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, projectId), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    // Build context from knowledge graph
    const nodes = (row.nodes as unknown[]) || [];
    const edges = (row.edges as unknown[]) || [];
    const rawText = (row.rawText as string) || "";

    const graphContext = nodes
      .map((n: any) => {
        const title = n.data?.title || n.title || "Untitled";
        const desc = n.data?.description || n.description || "";
        const section = n.section ? ` [${n.section}]` : "";
        return `- **${title}**${section}: ${desc}`;
      })
      .join("\n");

    const edgesContext = edges
      .map((e: any) => `${e.source} --${e.label || "relates to"}--> ${e.target}`)
      .join("\n");

    // Include original text (truncated) for deeper questions
    // Strip HTML tags if rawText is structured HTML (from PDF-to-HTML conversion)
    const { isHtml, stripHtml } = await import("@/utils/html-utils");
    const plainRawText = isHtml(rawText) ? stripHtml(rawText) : rawText;
    const textContext = plainRawText
      ? `\n\n=== PAPER ORIGINAL TEXT (truncated) ===\n${plainRawText.substring(0, MAX_CONTEXT_CHARS)}`
      : "";

    const contextMessage = `=== PAPER: "${row.title}" ===

=== KNOWLEDGE GRAPH NODES ===
${graphContext}

=== KNOWLEDGE GRAPH EDGES ===
${edgesContext}${textContext}`;

    // Build messages array
    const acceptLanguage = request.headers.get("accept-language");
    const langInstruction = await getLanguageInstructionForUser(session.user.id, acceptLanguage);
    // The system + context + ack + history messages stay as plain text.
    // The final user message becomes multimodal if any image is attached.
    const messages: Array<
      | { role: "system" | "user" | "assistant"; content: string }
      | {
          role: "user";
          content: Array<
            | { type: "text"; text: string }
            | { type: "image_url"; image_url: { url: string } }
          >;
        }
    > = [
      { role: "system", content: SYSTEM_PROMPT + langInstruction },
      { role: "user", content: contextMessage },
      { role: "assistant", content: "I have read the paper's knowledge graph and original text. Ask me anything about this paper." },
    ];

    // Append conversation history (limited)
    if (Array.isArray(history)) {
      const recent = history.slice(-MAX_HISTORY);
      for (const msg of recent) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    // Append the current question. If images are attached, build a
    // multimodal content array (text first, then image_url parts).
    if (validImages.length > 0) {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      > = [{ type: "text", text: question }];
      for (const img of validImages) {
        parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
      }
      messages.push({ role: "user", content: parts });
    } else {
      messages.push({ role: "user", content: question });
    }

    let stream;
    try {
      stream = await agnes.chat.completions.create({
        model: AGNES_MODEL,
        messages,
        temperature: 0.3, // Lower temperature for factual answers
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
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
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
    console.error("QA error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process question" },
      { status: 500 }
    );
  }
}
