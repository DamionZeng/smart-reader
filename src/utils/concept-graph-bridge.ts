/**
 * Bridge layer: convert a ConceptGraph (from the 3-step knowledge-graph
 * pipeline) into a ParsedDocument (the shape board/codeboard expects).
 *
 * This lets board/codeboard render concept-co-occurrence networks on
 * their existing React Flow canvas without a separate /graph route.
 */
import type { ConceptGraph, Concept, ConceptEdge, ConceptCluster } from "@/types/concept-graph";
import { getClusterColor } from "@/types/concept-graph";
import type { ParsedDocument, DocumentNode, DocumentEdge } from "@/types";

/**
 * Convert a ConceptGraph to a ParsedDocument that board/codeboard can
 * render directly.
 *
 * - Concepts → DocumentNode (with clusterId/clusterColor/importance in data)
 * - ConceptEdges → DocumentEdge (edgeType="relates", weight in a custom field)
 * - Clusters are attached as metadata for the legend
 *
 * Node positions are left at {0,0} — the caller should run force-directed
 * layout immediately after to assign real positions.
 */
export function conceptGraphToParsedDocument(graph: ConceptGraph): ParsedDocument {
  const clusterColorMap = new Map<string, string>();
  const clusterLabelMap = new Map<string, string>();
  for (const cluster of graph.clusters) {
    clusterColorMap.set(cluster.id, getClusterColor(cluster.colorName));
    clusterLabelMap.set(cluster.id, cluster.label);
  }

  // Dedupe concepts by id. The KG generator occasionally emits two
  // concepts with the same id (e.g. the LLM returns the same name
  // twice with identical ids, or the same concept appears in two
  // cluster inputs). Duplicate React keys break rendering, and the
  // duplicate data carries no value — first occurrence wins.
  const seenConceptIds = new Set<string>();
  const uniqueConcepts = graph.concepts.filter((c) => {
    if (seenConceptIds.has(c.id)) return false;
    seenConceptIds.add(c.id);
    return true;
  });

  const nodes: DocumentNode[] = uniqueConcepts.map((concept) => ({
    id: concept.id,
    type: "concept",
    position: { x: 0, y: 0 },
    data: {
      title: concept.label,
      description: concept.description || "",
      // Knowledge-graph-specific fields carried in data for the node
      // renderer and for force-directed layout.
      clusterId: concept.clusterId,
      clusterColor: clusterColorMap.get(concept.clusterId) || "#1C1C1C",
      clusterLabel: clusterLabelMap.get(concept.clusterId) || "",
      importance: concept.importance,
      frequency: concept.frequency,
      conceptType: concept.type,
      aliases: concept.aliases,
      anchors: concept.anchors,
      ...(concept.codeSnippet ? { codeSnippet: concept.codeSnippet } : {}),
      ...(concept.filePath ? { filePath: concept.filePath } : {}),
      // P2-3: pass through source documents so the global graph can
      // navigate to the original article on node click.
      ...(concept.sourceDocuments ? { sourceDocuments: concept.sourceDocuments } : {}),
    },
  }));

  // P1-3: compute per-node degree (number of incident edges). The
  // node renderer uses both `degree` and `importance` to size the
  // circle — high-degree hubs (e.g. a central concept many others
  // relate to) should be visually larger even if the LLM marked them
  // as low importance. We dedupe edges by (source,target) pair first
  // so multi-edges don't inflate the count.
  const degreeMap = new Map<string, number>();
  for (const edge of graph.edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  }

  // Pre-compute the visual circle radius for every concept node so
  // the custom `shortest` edge type can read it from node data and
  // draw a line that stops at each circle's perimeter (instead of
  // running from a single shared handle). The radius mirrors the
  // 3-tier sizing in ConceptGraphNode.tsx:
  //   - sizeScore >= 0.7 → 14
  //   - sizeScore >= 0.4 → 11
  //   - otherwise          8
  function computeRadius(c: Concept, degree: number): number {
    const importance = c.importance ?? 0;
    const degreeWeight = Math.min(1, Math.log(1 + degree) / Math.log(1 + 20));
    const freqWeight = Math.min(1, Math.log(1 + (c.frequency ?? 0)) / Math.log(1 + 30));
    const sizeScore = Math.max(importance, degreeWeight, freqWeight);
    if (sizeScore >= 0.7) return 14;
    if (sizeScore >= 0.4) return 11;
    return 8;
  }

  for (const node of nodes) {
    const d = node.data as Record<string, unknown>;
    d.degree = degreeMap.get(node.id) ?? 0;
    d.radius = computeRadius(
      graph.concepts.find((c) => c.id === node.id) ?? ({ id: node.id } as Concept),
      d.degree as number
    );
  }

  // Drop edges that reference concepts we just dropped (or were never
  // there in the first place).
  const validNodeIds = new Set(nodes.map((n) => n.id));
  const edges: DocumentEdge[] = graph.edges
    .filter((edge) => validNodeIds.has(edge.source) && validNodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      edgeType: "relates",
      // Store weight + evidence in a serializable form. We use `type` as a
      // marker so buildEdge can detect co-occurrence edges and style them.
      type: "co-occurs",
      label: undefined,
      // weight is read by buildEdge for stroke-width scaling and by
      // forceDirectedLayout for link distance.
      weight: edge.weight,
    } as DocumentEdge & { weight: number }));

  return {
    id: graph.id,
    title: graph.title,
    type: graph.type === "code" ? "code" : "paper",
    rawText: graph.rawText,
    metadata: graph.metadata,
    nodes,
    edges,
    // LLM 整理的章节大纲（用于侧栏 outline 与思维导图视图）
    sections: graph.sections,
    // LLM 抽取的论证骨架（用于论证骨架图视图）
    skeleton: graph.skeleton,
    // Clusters attached for legend rendering (non-standard field, but
    // ParsedDocument is a loose interface and board pages read this).
    clusters: graph.clusters,
  } as ParsedDocument & { clusters: ConceptCluster[] };
}

/**
 * Extract weight from a React Flow edge's data for force-directed layout
 * and edge styling.
 */
export function getEdgeWeight(edge: { data?: Record<string, unknown> }): number {
  const w = edge?.data?.weight;
  return typeof w === "number" ? w : 1;
}

/**
 * Build a cluster legend data array from a ParsedDocument that was
 * produced by conceptGraphToParsedDocument.
 */
export function extractClusterLegend(
  doc: ParsedDocument & { clusters?: ConceptCluster[] }
): { id: string; label: string; color: string; count: number }[] {
  if (!doc.clusters) return [];
  return doc.clusters.map((c) => ({
    id: c.id,
    label: c.label || c.id,
    color: getClusterColor(c.colorName),
    count: c.conceptIds.length,
  }));
}
