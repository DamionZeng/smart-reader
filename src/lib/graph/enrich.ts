import type { Concept, ConceptGraph } from "@/types/concept-graph";
import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { truncate, getTopConcepts } from "@/utils/concept-graph-utils";

const MAX_SOURCE_CHARS = 50000;
const BATCH_SIZE = 15;
const TOP_N = 60;

const SYSTEM_PROMPT = `You are an expert at enriching technical concepts from a source text.

For each concept, provide a clear 1-2 sentence description explaining what it is and why it matters in the context of the source text. Also identify 1-3 representative sentences from the source text that best illustrate the concept.

Output ONLY a JSON object:
{
  "concepts": [
    {
      "id": "concept-id",
      "description": "1-2 sentence explanation of what the concept is and its significance",
      "anchors": ["verbatim sentence 1 from the source", "sentence 2"]
    }
  ]
}

Rules:
- The description should be precise and informative, explaining the concept's role in the work.
- The anchors MUST be verbatim sentences from the source text (copy them exactly).
- Choose anchors that best define or demonstrate the concept, not just any mention.
- If you cannot find a good anchor, provide an empty array.
- Write descriptions in the same language as the source text.`;

export async function enrichConcepts(
  graph: ConceptGraph,
  langInstruction: string
): Promise<ConceptGraph> {
  const concepts = graph.concepts;
  if (concepts.length === 0) return graph;

  const topConcepts = getTopConcepts(concepts, TOP_N);
  const sourceText = truncate(graph.rawText, MAX_SOURCE_CHARS);

  const batches: Concept[][] = [];
  for (let i = 0; i < topConcepts.length; i += BATCH_SIZE) {
    batches.push(topConcepts.slice(i, i + BATCH_SIZE));
  }

  const enrichments = new Map<
    string,
    { description: string; anchors: string[] }
  >();

  await Promise.all(
    batches.map(async (batch) => {
      try {
        const input = {
          concepts: batch.map((c) => ({ id: c.id, label: c.label })),
          source_text: sourceText,
        };
        const completion = await agnes.chat.completions.create({
          model: AGNES_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT + langInstruction },
            { role: "user", content: JSON.stringify(input) },
          ],
          response_format: { type: "json_object" },
        });
        const content = completion.choices[0]?.message?.content || "{}";
        const parsed = JSON.parse(content);
        const resultConcepts = parsed.concepts;
        if (!Array.isArray(resultConcepts)) return;
        for (const rc of resultConcepts) {
          if (rc && typeof rc.id === "string") {
            enrichments.set(rc.id, {
              description:
                typeof rc.description === "string"
                  ? rc.description.trim()
                  : "",
              anchors: Array.isArray(rc.anchors)
                ? rc.anchors
                    .filter(
                      (a: unknown) =>
                        typeof a === "string" && a.trim().length > 0
                    )
                    .map((a: unknown) => String(a).trim())
                : [],
            });
          }
        }
      } catch {
        // LLM failure: leave this batch unchanged
      }
    })
  );

  const enrichedConcepts = concepts.map((concept) => {
    const enrichment = enrichments.get(concept.id);
    if (!enrichment) return concept;
    return {
      ...concept,
      description: enrichment.description || concept.description,
      anchors:
        enrichment.anchors.length > 0
          ? enrichment.anchors
          : concept.anchors,
    };
  });

  return { ...graph, concepts: enrichedConcepts };
}
