import type { ElementDefinition, StylesheetStyle, StylesheetCSS } from "cytoscape";
import type { ConceptGraph } from "@/types/concept-graph";
import { getClusterColor } from "@/types/concept-graph";

type Stylesheet = StylesheetStyle | StylesheetCSS;

/**
 * Convert a hex color (#RRGGBB) to an rgba() string with the given alpha.
 */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Clamp a numeric value to the given range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Build the cytoscape stylesheet for a concept graph.
 *
 * Editorial design tokens:
 *   - Node fill = cluster color @ 20% alpha, border = cluster color @ 100%
 *   - Node size tiers by importance (30 / 22 / 16 px)
 *   - Labels hidden by default, shown via `.show-label`
 *   - Edges use source-cluster color @ 30% alpha, width = weight * 0.4 clamped
 *   - Compound parents: dashed border, Playfair Display italic label
 */
export function buildStylesheet(graph: ConceptGraph): Stylesheet[] {
  // Per-cluster node color overrides
  const clusterNodeStyles: Stylesheet[] = graph.clusters.map((cluster) => {
    const color = getClusterColor(cluster.colorName);
    return {
      selector: `node[clusterId = "${cluster.id}"]`,
      style: {
        "background-color": hexToRgba(color, 0.2),
        "border-color": color,
      },
    };
  });

  // Per-cluster compound-parent overrides
  const clusterParentStyles: Stylesheet[] = graph.clusters.map((cluster) => {
    const color = getClusterColor(cluster.colorName);
    return {
      selector: `node#cluster-${cluster.id}`,
      style: {
        "background-color": hexToRgba(color, 0.08),
        "border-color": hexToRgba(color, 0.3),
        "border-style": "dashed",
      },
    };
  });

  // Per-cluster edge color overrides (based on source cluster)
  const clusterEdgeStyles: Stylesheet[] = graph.clusters.map((cluster) => {
    const color = getClusterColor(cluster.colorName);
    return {
      selector: `edge[sourceClusterId = "${cluster.id}"]`,
      style: {
        "line-color": hexToRgba(color, 0.3),
      },
    };
  });

  return [
    // ── Node defaults ──────────────────────────────────────────
    {
      selector: "node",
      style: {
        width: 16,
        height: 16,
        "background-color": "#1C1C1C",
        "background-opacity": 1,
        "border-width": 1,
        "border-color": "#1C1C1C",
        "border-opacity": 1,
        label: "data(label)",
        "text-opacity": 0,
        "font-family": "Inter, sans-serif",
        "font-size": "11px",
        "color": "#1C1C1C",
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 4,
        "text-wrap": "ellipsis",
        "text-max-width": "80px",
      },
    },
    // Node size by importance — later rules override earlier ones
    {
      selector: "node[importance >= 0.5]",
      style: {
        width: 22,
        height: 22,
      },
    },
    {
      selector: "node[importance >= 0.8]",
      style: {
        width: 30,
        height: 30,
      },
    },
    // Per-cluster colors
    ...clusterNodeStyles,
    // Show-label class (toggled by zoom level)
    {
      selector: "node.show-label",
      style: {
        "text-opacity": 1,
      },
    },
    // Hover state
    {
      selector: "node:hover",
      style: {
        "border-width": 2.5,
        "z-index": 999,
      },
    },
    // Selected state
    {
      selector: "node:selected",
      style: {
        "border-width": 3,
        "background-color": "#1C1C1C",
        color: "#F9F8F6",
      },
    },
    // Highlighted state (used during focus / neighbour highlighting)
    {
      selector: "node.highlighted",
      style: {
        opacity: 1,
        "border-width": 2,
      },
    },
    // Faded state (used to dim non-neighbours)
    {
      selector: "node.faded",
      style: {
        opacity: 0.15,
      },
    },

    // ── Compound parent defaults ───────────────────────────────
    {
      selector: ":parent",
      style: {
        "background-color": "#1C1C1C",
        "background-opacity": 0.08,
        "border-width": 1,
        "border-color": "#1C1C1C",
        "border-opacity": 0.3,
        "border-style": "dashed",
        label: "data(label)",
        "font-family": "'Playfair Display', Georgia, serif",
        "font-style": "italic",
        "font-size": "14px",
        color: "#1C1C1C",
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": 8,
        "text-opacity": 1,
      },
    },
    ...clusterParentStyles,

    // ── Edge defaults ──────────────────────────────────────────
    {
      selector: "edge",
      style: {
        width: "data(displayWidth)",
        "curve-style": "bezier",
        "line-color": "#1C1C1C",
        opacity: 0.6,
        "target-arrow-shape": "none",
        "source-arrow-shape": "none",
      },
    },
    ...clusterEdgeStyles,
  ];
}

/**
 * Build cytoscape element definitions from a ConceptGraph.
 *
 * - Creates compound parent nodes for each cluster (id: `cluster-${c.id}`)
 * - Creates child nodes for each concept (parent: `cluster-${c.clusterId}`)
 * - Injects `sourceClusterId` data on each edge for styling
 * - Pre-computes `displayWidth` on edges (weight * 0.4 clamped to 0.5–4)
 */
export function buildElements(graph: ConceptGraph): ElementDefinition[] {
  const elements: ElementDefinition[] = [];

  // Compound parent nodes for each cluster
  for (const cluster of graph.clusters) {
    elements.push({
      group: "nodes",
      data: {
        id: `cluster-${cluster.id}`,
        label: cluster.label,
        clusterId: cluster.id,
      },
    });
  }

  // Child concept nodes
  for (const concept of graph.concepts) {
    const parentClusterId = concept.clusterId;
    // Only assign a compound parent if the cluster actually exists.
    // Concepts without a valid clusterId are rendered as free-floating nodes.
    const hasValidCluster =
      parentClusterId &&
      graph.clusters.some((c) => c.id === parentClusterId);
    elements.push({
      group: "nodes",
      data: {
        id: concept.id,
        label: concept.label,
        ...(hasValidCluster ? { parent: `cluster-${parentClusterId}` } : {}),
        clusterId: parentClusterId || "",
        importance: concept.importance,
        frequency: concept.frequency,
        type: concept.type,
      },
    });
  }

  // Edges with sourceClusterId injected for styling
  for (const edge of graph.edges) {
    const sourceConcept = graph.concepts.find((c) => c.id === edge.source);
    const sourceClusterId = sourceConcept?.clusterId ?? "";
    const displayWidth = clamp(edge.weight * 0.4, 0.5, 4);
    elements.push({
      group: "edges",
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        weight: edge.weight,
        type: edge.type,
        sourceClusterId,
        displayWidth,
      },
    });
  }

  return elements;
}
