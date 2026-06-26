import { NextRequest, NextResponse } from "next/server";
import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import { trackUsage } from "@/app/api/usage/track";
import { getLanguageInstructionForUser } from "@/lib/ai-settings";

const EXPLAIN_PROMPT = `You are an expert academic editor. Given a concept node from a research paper knowledge graph, produce a clear explanation that helps a reader deeply understand it.

Respond using EXACTLY this format with two labelled sections (no markdown fences, no extra commentary):

[EXPLANATION]
A 2-3 sentence plain-language explanation of what this concept means and why it matters in the paper.

[ANALOGY]
An intuitive analogy that makes the concept click for a non-expert. 1-2 sentences.

Rules:
- The [EXPLANATION] must be factual and grounded in the node's description and source context.
- The [ANALOGY] must be creative but accurate — do not mislead.
- Always include both the [EXPLANATION] and [ANALOGY] sections, in that order.`;

interface ExplainRequestBody {
  nodeTitle?: string;
  nodeDescription?: string;
  sourceContext?: string;
  // Tier 2: optional image attached to the node. The model can use it
  // to give a richer explanation.
  imageUrl?: string;
  imageDescription?: string;
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

    // Track AI usage at the start
    await trackUsage(session.user.id, "explain");

    const body: ExplainRequestBody = await request.json();
    let { nodeTitle, nodeDescription, sourceContext, imageUrl, imageDescription } = body;

    // Truncate inputs to bound prompt size and mitigate oversized payloads.
    const MAX_INPUT_CHARS = 5000;
    if (typeof nodeTitle === "string") {
      nodeTitle = nodeTitle.substring(0, MAX_INPUT_CHARS);
    }
    if (typeof nodeDescription === "string") {
      nodeDescription = nodeDescription.substring(0, MAX_INPUT_CHARS);
    }
    if (typeof sourceContext === "string") {
      sourceContext = sourceContext.substring(0, MAX_INPUT_CHARS);
    }
    if (typeof imageDescription === "string") {
      imageDescription = imageDescription.substring(0, MAX_INPUT_CHARS);
    }

    if (!nodeTitle && !nodeDescription) {
      return NextResponse.json(
        { error: "nodeTitle or nodeDescription is required" },
        { status: 400 }
      );
    }

    // Tier 2: only forward image URLs that look safe (data-URL or http(s)).
    const safeImage =
      typeof imageUrl === "string" &&
      (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(imageUrl) ||
        /^https?:\/\//i.test(imageUrl))
        ? imageUrl.substring(0, 8_000_000) // hard cap
        : null;

    const userContentParts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      {
        type: "text" as const,
        text: `Node Title: ${nodeTitle || "Untitled"}
Node Description: ${nodeDescription || "No description provided."}
Source Context: ${sourceContext || "No source context available."}${
          imageDescription
            ? `\nImage Description: ${imageDescription}`
            : ""
        }

Please explain this concept.`,
      },
    ];
    if (safeImage) {
      userContentParts.push({
        type: "image_url" as const,
        image_url: { url: safeImage },
      });
    }

    let stream;
    try {
      const acceptLanguage = request.headers.get("accept-language");
      const langInstruction = await getLanguageInstructionForUser(session.user.id, acceptLanguage);
      stream = await agnes.chat.completions.create({
        model: AGNES_MODEL,
        messages: [
          { role: "system", content: EXPLAIN_PROMPT + langInstruction },
          { role: "user", content: userContentParts as any },
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
    console.error("Explain error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate explanation" },
      { status: 500 }
    );
  }
}
