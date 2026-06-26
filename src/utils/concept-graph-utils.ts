import type {
  Concept,
  ConceptEdge,
  ConceptGraph,
  ConceptCluster,
  ConceptType,
} from "@/types/concept-graph";
import { CLUSTER_PALETTE } from "@/types/concept-graph";

/**
 * Generate a canonical slug from a label.
 * For English: lowercase + hyphenated.
 * For non-ASCII (Chinese, etc.): use a simple hash.
 */
export function generateConceptId(label: string): string {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (normalized) return normalized;
  // Non-ASCII label: hash it
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    const char = label.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `concept-${Math.abs(hash).toString(36)}`;
}

/**
 * Normalize edge weights using min-max normalization to 1-10 range.
 */
export function normalizeWeights(edges: ConceptEdge[]): ConceptEdge[] {
  if (edges.length === 0) return edges;
  const weights = edges.map((e) => e.weight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min || 1;
  return edges.map((e) => ({
    ...e,
    weight: Math.round((1 + ((e.weight - min) / range) * 9) * 10) / 10,
  }));
}

/**
 * Assign cluster colors from the palette, cycling with pattern fallback for >8.
 */
export function assignClusterColors(clusters: ConceptCluster[]): ConceptCluster[] {
  return clusters.map((cluster, i) => {
    const paletteIndex = i % CLUSTER_PALETTE.length;
    return {
      ...cluster,
      colorName: CLUSTER_PALETTE[paletteIndex].name,
    };
  });
}

/**
 * Build a simple hash from a string for cache keys.
 */
export function hashInput(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
 return Math.abs(hash).toString(36);
}

/**
 * Truncate text to a max length, adding ellipsis.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

/**
 * Validate a ConceptGraph structure.
 */
export function validateConceptGraph(graph: unknown): graph is ConceptGraph {
  if (!graph || typeof graph !== "object") return false;
  const g = graph as Record<string, unknown>;
  return (
    Array.isArray(g.concepts) &&
    Array.isArray(g.edges) &&
    Array.isArray(g.clusters) &&
    typeof g.title === "string" &&
    (g.type === "paper" || g.type === "code")
  );
}

/**
 * Count concepts by type.
 */
export function countByType(concepts: Concept[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of concepts) {
    counts[c.type] = (counts[c.type] || 0) + 1;
  }
  return counts;
}

/**
 * Get the top-N concepts by importance.
 */
export function getTopConcepts(concepts: Concept[], n: number): Concept[] {
  return [...concepts].sort((a, b) => b.importance - a.importance).slice(0, n);
}

/**
 * Filter edges to top-N by weight.
 */
export function getTopEdges(edges: ConceptEdge[], n: number): ConceptEdge[] {
  return [...edges].sort((a, b) => b.weight - a.weight).slice(0, n);
}

/**
 * Build a text summary of the graph for LLM context.
 */
export function buildGraphSummary(graph: ConceptGraph, maxConcepts = 50, maxEdges = 100): string {
  const topConcepts = getTopConcepts(graph.concepts, maxConcepts);
  const topEdges = getTopEdges(graph.edges, maxEdges);

  const clusterSummary = graph.clusters
    .map((c) => `- ${c.label}${c.description ? `: ${c.description}` : ""}`)
    .join("\n");

  const conceptSummary = topConcepts
    .map((c) => `- ${c.label} (${c.type})${c.description ? ` — ${c.description}` : ""}`)
    .join("\n");

  const edgeSummary = topEdges
    .map((e) => {
      const s = graph.concepts.find((c) => c.id === e.source)?.label || e.source;
      const t = graph.concepts.find((c) => c.id === e.target)?.label || e.target;
      return `- ${s} --[${e.type}]--> ${t}`;
    })
    .join("\n");

  return `Title: ${graph.title}

Clusters:
${clusterSummary}

Key Concepts:
${conceptSummary}

Key Relationships:
${edgeSummary}`;
}
