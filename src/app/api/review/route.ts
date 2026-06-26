import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/db/schema";
import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import { trackUsage } from "@/app/api/usage/track";
import { getLanguageInstructionForUser } from "@/lib/ai-settings";

const SYSTEM_PROMPT = `You are an expert academic researcher writing a literature review. Given the knowledge graphs of several papers, synthesize them into a well-structured literature review outline in markdown.

Your review MUST include these sections:
1. **Overview** — A brief introduction to the research area covered by these papers.
2. **Common Themes** — Concepts and approaches shared across multiple papers.
3. **Methodological Approaches** — How different papers approach the problem (methods, datasets, tools).
4. **Key Findings** — The main results and contributions of each paper.
5. **Contradictions and Debates** — Where the papers disagree or offer competing perspectives.
6. **Research Gaps** — What remains unaddressed or underexplored across the papers.
7. **Conclusion** — A synthesis of the state of the field and potential future directions.

Format the output as clean markdown with:
- ## headers for each section
- **Bold** for paper names when referencing them
- Bullet points for listing findings
- > blockquotes for direct quotes from paper descriptions
- Numbered citations like [1], [2] referring to papers in order

Write in a formal academic tone. Be specific and reference individual papers by their titles.`;

export async function POST(request: NextRequest) {
  try {
    // Rate limit: heavy AI operation
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.heavy);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Track AI usage at the start
    await trackUsage(session.user.id, "review");

    const body = await request.json();
    const { projectIds } = body as { projectIds?: string[] };

    if (!Array.isArray(projectIds) || projectIds.length < 2) {
      return NextResponse.json(
        { error: "At least 2 project IDs are required for a literature review." },
        { status: 400 }
      );
    }
    if (projectIds.length > 8) {
      return NextResponse.json(
        { error: "Cannot review more than 8 projects at once." },
        { status: 400 }
      );
    }

    const rows = await db
      .select()
      .from(documents)
      .where(
        and(
          inArray(documents.id, projectIds),
          eq(documents.userId, session.user.id)
        )
      );

    if (rows.length < 2) {
      return NextResponse.json(
        { error: "Not enough accessible projects found for review." },
        { status: 404 }
      );
    }

    // Build paper summaries for the AI
    const papers = rows.map((row, idx) => {
      const nodes = (row.nodes as unknown[]) || [];
      const edges = (row.edges as unknown[]) || [];
      const nodeSummaries = nodes
        .map((n: any) => {
          const title = n.data?.title || n.title || "";
          const desc = n.data?.description || n.description || "";
          const section = n.section ? ` [${n.section}]` : "";
          return `  - ${title}${section}: ${desc}`;
        })
        .join("\n");
      const edgeSummaries = edges
        .map((e: any) => `  ${e.source} --${e.label || "relates to"}--> ${e.target}`)
        .join("\n");
      return {
        citation: `[${idx + 1}]`,
        title: row.title || `Paper ${idx + 1}`,
        abstract: (row.abstract as string) || "",
        nodes: nodeSummaries,
        edges: edgeSummaries,
      };
    });

    const userMessage = papers
      .map(
        (p) =>
          `=== Paper ${p.citation}: "${p.title}" ===\n${p.abstract ? `Abstract: ${p.abstract}\n` : ""}Nodes:\n${p.nodes}\nEdges:\n${p.edges}`
      )
      .join("\n\n");

    const instruction = `\n\nWrite a comprehensive literature review synthesizing these ${papers.length} papers. Use citation numbers [1] through [${papers.length}] to reference specific papers. The papers are:\n${papers.map((p) => `${p.citation} ${p.title}`).join("\n")}`;

    let stream;
    try {
      const acceptLanguage = request.headers.get("accept-language");
      const langInstruction = await getLanguageInstructionForUser(session.user.id, acceptLanguage);
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
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
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
    console.error("Review error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate review" },
      { status: 500 }
    );
  }
}
