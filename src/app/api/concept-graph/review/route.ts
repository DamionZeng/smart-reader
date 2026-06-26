import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphs } from "@/db/schema";
import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import { trackUsage } from "@/app/api/usage/track";
import { getLanguageInstructionForUser } from "@/lib/ai-settings";
import type { Concept, ConceptEdge, ConceptCluster } from "@/types/concept-graph";

const MIN_GRAPHS = 2;
const MAX_GRAPHS = 8;
const MAX_CONCEPTS_PER_GRAPH = 30;

const SYSTEM_PROMPT = `You are an expert academic researcher writing a literature review. Given the concept graphs of several papers or code repositories, synthesize them into a well-structured literature review in markdown.

Your review MUST include these 7 sections, in order:
1. **Introduction** — A brief introduction to the research area covered by these sources.
2. **Common Themes** — Concepts and approaches shared across multiple sources.
3. **Methodological Patterns** — How different sources approach the problem (methods, datasets, tools, architectures).
4. **Key Differences** — Where the sources diverge in approach, scope, or findings.
5. **Emerging Trends** — Directions that appear to be gaining traction across the field.
6. **Gaps & Opportunities** — What remains unaddressed or underexplored across the sources.
7. **Conclusion** — A synthesis of the state of the field and potential future directions.

Format the output as clean markdown with:
- ## headers for each section
- **Bold** for source names when referencing them
- Bullet points for listing findings
- > blockquotes for direct quotes from concept descriptions
- Numbered citations like [1], [2] referring to sources in order

Write in a formal academic tone. Be specific and reference individual sources by their titles.`;

interface ReviewRequestBody {
  graphIds?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.heavy);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as ReviewRequestBody;
    const { graphIds } = body;

    if (!Array.isArray(graphIds) || graphIds.length < MIN_GRAPHS) {
      return NextResponse.json(
        { error: `At least ${MIN_GRAPHS} graph IDs are required for a literature review.` },
        { status: 400 }
      );
    }
    if (graphIds.length > MAX_GRAPHS) {
      return NextResponse.json(
        { error: `Cannot review more than ${MAX_GRAPHS} graphs at once.` },
        { status: 400 }
      );
    }

    const rows = await db
      .select()
      .from(conceptGraphs)
      .where(
        and(
          inArray(conceptGraphs.id, graphIds),
          eq(conceptGraphs.userId, session.user.id)
        )
      );

    if (rows.length < MIN_GRAPHS) {
      return NextResponse.json(
        { error: "Not enough accessible graphs found for review." },
        { status: 404 }
      );
    }

    // Track AI usage at the start
    await trackUsage(session.user.id, "concept-graph-review");

    // Build aggregated context from each graph
    const sources = rows.map((row, idx) => {
      const concepts = ((row.concepts as Concept[]) || [])
        .sort((a, b) => (b.importance || 0) - (a.importance || 0))
        .slice(0, MAX_CONCEPTS_PER_GRAPH);
      const edges = (row.edges as ConceptEdge[]) || [];
      const clusters = (row.clusters as ConceptCluster[]) || [];

      const conceptsStr = concepts
        .map(
          (c) =>
            `  - **${c.label}** [${c.type}]${c.description ? `: ${c.description}` : ""}`
        )
        .join("\n");
      const edgesStr = edges
        .slice(0, 50)
        .map((e) => `  ${e.source} --${e.type}--> ${e.target}`)
        .join("\n");
      const clustersStr = clusters
        .map((cl) => `  - **${cl.label}** (${cl.conceptIds.length} concepts)`)
        .join("\n");

      return {
        citation: `[${idx + 1}]`,
        title: row.title || `Source ${idx + 1}`,
        type: row.type,
        abstract: row.abstract || "",
        concepts: conceptsStr,
        edges: edgesStr,
        clusters: clustersStr,
      };
    });

    const userMessage = sources
      .map(
        (s) =>
          `=== Source ${s.citation}: "${s.title}" (${s.type}) ===\n${s.abstract ? `Abstract: ${s.abstract}\n` : ""}Concepts:\n${s.concepts}\nEdges:\n${s.edges}\nClusters:\n${s.clusters || "none"}`
      )
      .join("\n\n");

    const instruction = `\n\nWrite a comprehensive literature review synthesizing these ${sources.length} sources. Use citation numbers [1] through [${sources.length}] to reference specific sources. The sources are:\n${sources.map((s) => `${s.citation} ${s.title}`).join("\n")}`;

    const acceptLanguage = request.headers.get("accept-language");
    const langInstruction = await getLanguageInstructionForUser(
      session.user.id,
      acceptLanguage
    );

    let stream;
    try {
      stream = await agnes.chat.completions.create({
        model: AGNES_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + langInstruction },
          { role: "user", content: userMessage + instruction },
        ],
        temperature: 0.4,
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
        let hasContent = false;
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              hasContent = true;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
              );
            }
          }
          if (!hasContent) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: "The AI returned an empty review. Please try again." })}\n\n`)
            );
          } else {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
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
    console.error("Concept graph review error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate review" },
      { status: 500 }
    );
  }
}
