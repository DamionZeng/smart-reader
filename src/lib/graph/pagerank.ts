import type { Concept, ConceptEdge } from "@/types/concept-graph";
import Graph from "graphology";

export function calculateImportance(
  concepts: Concept[],
  edges: ConceptEdge[]
): Concept[] {
  if (concepts.length === 0) return concepts;

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
      const existing =
        (graph.getEdgeAttribute(
          graph.edge(edge.source, edge.target),
          "weight"
        ) as number) || 0;
      graph.setEdgeAttribute(
        graph.edge(edge.source, edge.target),
        "weight",
        existing + edge.weight
      );
    } else {
      graph.addEdge(edge.source, edge.target, { weight: edge.weight });
    }
  }

  const pagerank = computePageRank(graph, 0.85, 20);

  const prValues = Object.values(pagerank);
  const prMax = prValues.length > 0 ? Math.max(...prValues) : 0;
  const prMin = prValues.length > 0 ? Math.min(...prValues) : 0;
  const prRange = prMax - prMin || 1;

  const freqValues = concepts.map((c) => c.frequency);
  const freqMax = freqValues.length > 0 ? Math.max(...freqValues) : 1;
  const freqMin = freqValues.length > 0 ? Math.min(...freqValues) : 0;
  const freqRange = freqMax - freqMin || 1;

  return concepts.map((concept) => {
    const pr = pagerank[concept.id] ?? 0;
    const prNorm = (pr - prMin) / prRange;
    const freqNorm = (concept.frequency - freqMin) / freqRange;
    const importance = 0.7 * prNorm + 0.3 * freqNorm;
    return {
      ...concept,
      importance: Math.round(importance * 1000) / 1000,
    };
  });
}

function computePageRank(
  graph: Graph,
  damping: number,
  iterations: number
): Record<string, number> {
  const nodes = graph.nodes();
  const N = nodes.length;
  if (N === 0) return {};

  const adjacency = new Map<string, { neighbor: string; weight: number }[]>();
  const totalWeights = new Map<string, number>();

  for (const node of nodes) {
    adjacency.set(node, []);
    totalWeights.set(node, 0);
  }

  for (const edgeKey of graph.edges()) {
    const [source, target] = graph.extremities(edgeKey);
    const weight =
      (graph.getEdgeAttribute(edgeKey, "weight") as number) || 1;
    adjacency.get(source)!.push({ neighbor: target, weight });
    adjacency.get(target)!.push({ neighbor: source, weight });
    totalWeights.set(source, (totalWeights.get(source) || 0) + weight);
    totalWeights.set(target, (totalWeights.get(target) || 0) + weight);
  }

  let rank: Record<string, number> = {};
  for (const node of nodes) {
    rank[node] = 1 / N;
  }

  for (let i = 0; i < iterations; i++) {
    const newRank: Record<string, number> = {};
    let danglingSum = 0;
    for (const node of nodes) {
      if ((totalWeights.get(node) || 0) === 0) {
        danglingSum += rank[node];
      }
    }

    for (const node of nodes) {
      let sum = 0;
      const neighbors = adjacency.get(node) || [];
      for (const { neighbor, weight } of neighbors) {
        const neighborTotal = totalWeights.get(neighbor) || 0;
        if (neighborTotal > 0) {
          sum += (rank[neighbor] * weight) / neighborTotal;
        }
      }
      newRank[node] =
        (1 - damping) / N + damping * (sum + danglingSum / N);
    }
    rank = newRank;
  }

  return rank;
}
