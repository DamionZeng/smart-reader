import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/db/schema";
import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { normaliseGraph } from "@/utils/graph-normalize";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import { trackUsage } from "@/app/api/usage/track";
import { getLanguageInstructionForUser } from "@/lib/ai-settings";

const SYSTEM_PROMPT = `You are a research analyst who compares multiple academic papers. Given the knowledge graphs of several papers, produce a unified comparison graph that highlights shared themes, unique contributions, and relationships between the papers.

Output ONLY a JSON object that strictly matches this schema (no markdown fences, no commentary):

{
  "title": "string — a comparative title, e.g. \"Comparative Analysis: Paper A vs Paper B\"",
  "nodes": [
    {
      "id": "string — unique slug, lowercase, hyphenated",
      "type": "concept",
      "section": "string — one of: \"abstract\", \"introduction\", \"method\", \"experiment\", \"result\", \"conclusion\", \"related-work\", \"background\"",
      "position": { "x": number, "y": number },
      "data": {
        "title": "string — short, human-readable concept title (max 80 chars)",
        "description": "string — 2 to 4 sentence comparison summary of this concept across papers",
        "sourceContext": "string — which paper(s) this concept appears in, e.g. \"Paper A; Paper B\" or \"Paper A only\"",
        "details": "string (optional) — deeper comparison notes"
      }
    }
  ],
  "edges": [
    {
      "id": "string — unique edge id",
      "source": "node id",
      "target": "node id",
      "label": "string — relationship verb (e.g. \"contrasts with\", \"extends\", \"complements\", \"shared by\")",
      "type": "string (optional)"
    }
  ]
}

Rules:
- 8 to 20 nodes. Group shared concepts together and keep paper-unique nodes separate.
- Every node MUST have a non-empty "title" AND a non-empty "description".
- Use "sourceContext" to tag which paper(s) each node comes from. Use the format "Paper A", "Paper B", etc. or "Paper A; Paper B" for shared concepts.
- Use comparison-oriented edge labels: "contrasts with", "extends", "complements", "shared by", "differs from", "builds on".
- Return ONLY the JSON object.`;

interface PaperSummary {
  title: string;
  nodes: Array<{
    id: string;
    data: { title: string; description: string };
    section?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    label?: string;
  }>;
}

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

    const body = await request.json();
    const { projectIds } = body as { projectIds?: string[] };

    if (!Array.isArray(projectIds) || projectIds.length < 2) {
      return NextResponse.json(
        { error: "At least 2 project IDs are required for comparison." },
        { status: 400 }
      );
    }
    if (projectIds.length > 5) {
      return NextResponse.json(
        { error: "Cannot compare more than 5 projects at once." },
        { status: 400 }
      );
    }

    // Fetch all selected projects
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
        { error: "Not enough accessible projects found for comparison." },
        { status: 404 }
      );
    }

    // Detect the dominant project type from source rows so code projects
    // are compared as code (not forced into the "paper" schema).
    const typeCounts = new Map<string, number>();
    for (const row of rows) {
      const rt = (row.type as string) || "paper";
      typeCounts.set(rt, (typeCounts.get(rt) || 0) + 1);
    }
    let detectedType: "paper" | "code" = "paper";
    let bestCount = 0;
    for (const [t, c] of typeCounts) {
      if (c > bestCount) {
        bestCount = c;
        detectedType = t === "code" ? "code" : "paper";
      }
    }

    // Build summaries for the AI prompt
    const papers: PaperSummary[] = rows.map((row, idx) => {
      const nodes = (row.nodes as unknown[]) || [];
      const edges = (row.edges as unknown[]) || [];
      return {
        title: row.title || `Paper ${String.fromCharCode(65 + idx)}`,
        nodes: nodes.map((n: any) => ({
          id: n.id,
          data: {
            title: n.data?.title || n.title || "",
            description: n.data?.description || n.description || "",
          },
          ...(n.section ? { section: n.section } : {}),
        })),
        edges: edges.map((e: any) => ({
          source: e.source,
          target: e.target,
          ...(e.label ? { label: e.label } : {}),
        })),
      };
    });

    // Build the user message with each paper's graph
    const paperLabels = papers.map((_, i) => `Paper ${String.fromCharCode(65 + i)}`);
    const userMessage = papers
      .map((paper, i) => {
        const label = paperLabels[i];
        const nodesStr = paper.nodes
          .map(
            (n) =>
              `  - [${n.id}] ${n.data.title}: ${n.data.description}${n.section ? ` (section: ${n.section})` : ""}`
          )
          .join("\n");
        const edgesStr = paper.edges
          .map((e) => `  - ${e.source} --${e.label || "relates to"}--> ${e.target}`)
          .join("\n");
        return `=== ${label}: "${paper.title}" ===\nNodes:\n${nodesStr}\nEdges:\n${edgesStr}`;
      })
      .join("\n\n");

    const instruction = `\n\nCompare these ${papers.length} papers. Create a unified comparison graph that shows shared concepts (tagged with multiple paper sources) and unique aspects of each paper. Use the paper labels (${paperLabels.join(", ")}) in the "sourceContext" field of each node.`;

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
        response_format: { type: "json_object" },
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
        let raw = "";
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              raw += content;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            }
          }

          let rawGraphData: any;
          try {
            rawGraphData = JSON.parse(raw || "{}");
          } catch {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: "The AI returned an unparseable result. Please try again." })}\n\n`)
            );
            controller.close();
            return;
          }

          if (
            !rawGraphData ||
            !Array.isArray(rawGraphData.nodes) ||
            !Array.isArray(rawGraphData.edges) ||
            rawGraphData.nodes.length === 0
          ) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: "The AI response did not contain a valid comparison graph." })}\n\n`)
            );
            controller.close();
            return;
          }

          const graphData = normaliseGraph(rawGraphData, "", detectedType);

          // Create a new project to hold the comparison result
          const comparisonTitle = graphData.title || `Comparison: ${papers.map((p) => p.title).join(" vs ")}`;
          const [inserted] = await db
            .insert(documents)
            .values({
              title: comparisonTitle.substring(0, 255),
              type: detectedType,
              originalUrl: null,
              nodes: graphData.nodes,
              edges: graphData.edges,
              userId: session.user.id,
            })
            .returning();

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ result: { id: inserted.id } })}\n\n`));
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
    console.error("Compare error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to compare projects" },
      { status: 500 }
    );
  }
}
