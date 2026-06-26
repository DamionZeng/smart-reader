import type { Concept, ConceptCluster } from "@/types/concept-graph";
import { agnes, AGNES_MODEL } from "@/lib/agnes";

const SYSTEM_PROMPT = `You are an expert at naming concept clusters from an academic paper or code project.

You will receive a JSON object with multiple clusters, each containing its top concepts (sorted by importance).
For each cluster, provide:
- A concise 2-4 word label that captures the cluster's theme
- A 1 sentence description explaining what this cluster represents

Output ONLY a JSON object:
{
  "clusters": [
    { "id": "cluster-0", "label": "2-4 word title", "description": "1 sentence summary" }
  ]
}

Rules:
- The label should be descriptive and specific, not generic (e.g. "Attention Mechanisms" not "Neural Networks").
- The description should explain the common theme and why these concepts are grouped together.
- Use the same language as the concepts provided.
- If a cluster has only 1 concept, the label can be that concept's name.`;

export async function nameClusters(
  clusters: ConceptCluster[],
  concepts: Concept[],
  langInstruction: string
): Promise<ConceptCluster[]> {
  if (clusters.length === 0) return clusters;

  const conceptMap = new Map(concepts.map((c) => [c.id, c]));

  const input = {
    clusters: clusters.map((cluster) => {
      const clusterConcepts = cluster.conceptIds
        .map((id) => conceptMap.get(id))
        .filter((c): c is Concept => c !== undefined)
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 5);
      return {
        id: cluster.id,
        concepts: clusterConcepts.map((c) => c.label),
      };
    }),
  };

  try {
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
    const namedClusters = parsed.clusters;
    if (!Array.isArray(namedClusters)) {
      return fallbackNames(clusters, conceptMap);
    }

    const nameMap = new Map<string, { label: string; description?: string }>();
    for (const nc of namedClusters) {
      if (
        nc &&
        typeof nc.id === "string" &&
        typeof nc.label === "string" &&
        nc.label.trim()
      ) {
        nameMap.set(nc.id, {
          label: nc.label.trim(),
          description:
            typeof nc.description === "string" && nc.description.trim()
              ? nc.description.trim()
              : undefined,
        });
      }
    }

    return clusters.map((cluster) => {
      const named = nameMap.get(cluster.id);
      if (named) {
        return {
          ...cluster,
          label: named.label,
          description: named.description,
        };
      }
      return fallbackName(cluster, conceptMap);
    });
  } catch {
    return fallbackNames(clusters, conceptMap);
  }
}

function fallbackName(
  cluster: ConceptCluster,
  conceptMap: Map<string, Concept>
): ConceptCluster {
  if (cluster.label) return cluster;
  const clusterConcepts = cluster.conceptIds
    .map((id) => conceptMap.get(id))
    .filter((c): c is Concept => c !== undefined)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 3);
  const label =
    clusterConcepts.map((c) => c.label).join(" / ") || "Unnamed";
  return { ...cluster, label };
}

function fallbackNames(
  clusters: ConceptCluster[],
  conceptMap: Map<string, Concept>
): ConceptCluster[] {
  return clusters.map((cluster) => fallbackName(cluster, conceptMap));
}
