import type { ConceptGraph, JobProgress } from "@/types/concept-graph";
import { splitSentences } from "@/lib/graph/sentence-split";
import { extractConcepts } from "@/lib/graph/concept-extract";
import { resolveEntities } from "@/lib/graph/entity-resolve";
import { buildCooccurrenceEdges } from "@/lib/graph/cooccurrence";
import { calculateImportance } from "@/lib/graph/pagerank";
import { detectCommunities } from "@/lib/graph/leiden";
import { nameClusters } from "@/lib/graph/cluster-name";
import { enrichConcepts } from "@/lib/graph/enrich";
import { hashInput } from "@/utils/concept-graph-utils";

const TOTAL_STEPS = 7;

export async function ingestPaper(
  rawText: string,
  title: string | null,
  langInstruction: string,
  onProgress?: (progress: JobProgress) => void | Promise<void>
): Promise<ConceptGraph> {
  const resolvedTitle = title || "Untitled";
  // IMPORTANT: `onProgress` is fire-and-forget by default, but the DB
  // writes themselves can race against each other when several
  // progress() calls happen back-to-back (e.g. the first three steps
  // before the first LLM call). Awaiting the callback serialises the
  // progress updates so the polling client never sees a stale or
  // out-of-order step, and the indicator advances monotonically.
  const progress = async (step: string, current: number) => {
    await onProgress?.({ step, current, total: TOTAL_STEPS });
  };

  await progress("extracting-text", 1);

  await progress("splitting-sentences", 2);
  const sentences = splitSentences(rawText);

  await progress("extracting-concepts", 3);
  const rawConcepts = await extractConcepts(rawText, langInstruction);

  await progress("resolving-entities", 4);
  let concepts = resolveEntities(rawConcepts, rawText);

  await progress("building-edges", 5);
  const edges = buildCooccurrenceEdges(concepts, sentences);

  concepts = calculateImportance(concepts, edges);

  await progress("detecting-communities", 6);
  const clusters = detectCommunities(concepts, edges);
  const namedClusters = await nameClusters(clusters, concepts, langInstruction);

  await progress("enriching-concepts", 7);
  const graph: ConceptGraph = {
    id: hashInput(rawText + resolvedTitle),
    title: resolvedTitle,
    type: "paper",
    rawText,
    concepts,
    edges,
    clusters: namedClusters,
    createdAt: new Date().toISOString(),
  };
  return enrichConcepts(graph, langInstruction);
}
