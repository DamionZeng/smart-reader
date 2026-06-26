import type { Concept, ConceptEdge, ConceptCluster } from "@/types/concept-graph";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { assignClusterColors } from "@/utils/concept-graph-utils";

export function detectCommunities(
  concepts: Concept[],
  edges: ConceptEdge[]
): ConceptCluster[] {
  if (concepts.length === 0) return [];

  const graph = new Graph({ type: "undirected" });
  for (const concept of concepts) {
    if (!graph.hasNode(concept.id)) {
      graph.addNode(concept.id);
    }
  }
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    if (graph.hasEdge(edge.source, edge.target)) {
      const edgeKey = graph.edge(edge.source, edge.target);
      const existing =
        (graph.getEdgeAttribute(edgeKey, "weight") as number) || 0;
      graph.setEdgeAttribute(edgeKey, "weight", existing + edge.weight);
    } else {
      graph.addEdge(edge.source, edge.target, { weight: edge.weight });
    }
  }

  let resolution = 1.0;
  let communities = runLouvain(graph, resolution);
  let clusterCount = countCommunities(communities);

  if (clusterCount < 5 && concepts.length > 10) {
    const higher = runLouvain(graph, 1.5);
    const higherCount = countCommunities(higher);
    if (higherCount > clusterCount) {
      communities = higher;
      clusterCount = higherCount;
    }
  }
  if (clusterCount > 20) {
    const lower = runLouvain(graph, 0.5);
    const lowerCount = countCommunities(lower);
    if (lowerCount < clusterCount && lowerCount >= 5) {
      communities = lower;
      clusterCount = lowerCount;
    }
  }

  const clusterMap = new Map<number, string[]>();
  for (const [node, community] of Object.entries(communities)) {
    const arr = clusterMap.get(community) || [];
    arr.push(node);
    clusterMap.set(community, arr);
  }

  let clusters: ConceptCluster[] = [];
  let idx = 0;
  for (const [, nodeIds] of clusterMap) {
    const clusterId = `cluster-${idx}`;
    clusters.push({
      id: clusterId,
      label: "",
      colorName: "slate",
      conceptIds: nodeIds,
      level: 0,
    });
    idx++;
  }

  clusters = assignClusterColors(clusters);

  const conceptClusterMap = new Map<string, string>();
  for (const cluster of clusters) {
    for (const conceptId of cluster.conceptIds) {
      conceptClusterMap.set(conceptId, cluster.id);
    }
  }
  // Ensure every concept has a clusterId. Concepts that louvain dropped
  // (e.g. isolated nodes with no edges) get assigned to a fallback cluster.
  let fallbackClusterId: string | null = null;
  for (const concept of concepts) {
    if (!conceptClusterMap.has(concept.id)) {
      if (!fallbackClusterId) {
        fallbackClusterId = `cluster-${clusters.length}`;
        clusters.push({
          id: fallbackClusterId,
          label: "",
          colorName: "slate",
          conceptIds: [],
          level: 0,
        });
        clusters = assignClusterColors(clusters);
      }
      conceptClusterMap.set(concept.id, fallbackClusterId);
      const fallbackCluster = clusters.find((c) => c.id === fallbackClusterId);
      fallbackCluster?.conceptIds.push(concept.id);
    }
    concept.clusterId = conceptClusterMap.get(concept.id) || "";
  }

  return clusters;
}

function runLouvain(graph: Graph, resolution: number): Record<string, number> {
  try {
    return louvain(graph, { resolution }) as Record<string, number>;
  } catch {
    try {
      return louvain(graph) as Record<string, number>;
    } catch {
      const fallback: Record<string, number> = {};
      let i = 0;
      for (const node of graph.nodes()) {
        fallback[node] = i;
        i++;
      }
      return fallback;
    }
  }
}

function countCommunities(communities: Record<string, number>): number {
  return new Set(Object.values(communities)).size;
}
