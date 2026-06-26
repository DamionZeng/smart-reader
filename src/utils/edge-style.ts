import type { Edge } from "@xyflow/react";
import type { DocumentEdge, EdgeType } from "@/types";

/**
 * Default edge style — used for untyped/legacy edges ("relates").
 *
 * All edges share the same baseline 1px stroke so the canvas reads as
 * a uniform mesh. The "thickness" of an edge is a hover-time concern
 * handled by the page's `visibleEdges` memo (slight bump when an
 * incident edge is highlighted), not a property of the data.
 */
const RELATES_STYLE = {
  stroke: "#1C1C1C",
  strokeWidth: 1,
  strokeDasharray: undefined,
};

const EDGE_VISUAL: Record<EdgeType, { stroke: string; strokeWidth: number; strokeDasharray?: string; markerEnd?: string; animated?: boolean }> = {
  relates: { stroke: "#1C1C1C", strokeWidth: 1 },
  depends: { stroke: "#1C1C1C", strokeWidth: 1, strokeDasharray: "4 3", animated: true },
  extends: { stroke: "#1C1C1C", strokeWidth: 1 },
  contradicts: { stroke: "#1C1C1C", strokeWidth: 1, strokeDasharray: "1 4" },
};

export const EDGE_LABEL_STYLE = {
  fill: "#1C1C1C",
  fontFamily: "Inter, sans-serif",
  fontSize: 10,
  fontWeight: 500,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
};

export const EDGE_LABEL_BG_STYLE = {
  fill: "#F9F8F6",
  fillOpacity: 1,
  stroke: "#1C1C1C",
  strokeWidth: 1,
};

/**
 * Build a React Flow Edge from a DocumentEdge, applying type-specific visual
 * treatment so users can distinguish relationship semantics at a glance.
 *
 * All edges share the same baseline 1px stroke. The previous version
 * scaled co-occurrence width with `weight` (Math.max(0.5, Math.min(3,
 * weight * 0.4))), which made some lines look much thicker than
 * others and broke the uniform-mesh aesthetic. Weight is now stored
 * on the edge data for future use (e.g. a hover tooltip) but no
 * longer affects rendering.
 */
export function buildEdge(de: DocumentEdge): Edge {
  const edgeType: EdgeType = de.edgeType ?? "relates";
  const isCooccurs = de.type === "co-occurs";

  // Co-occurrence edges: uniform 1px stroke, semi-transparent.
  if (isCooccurs) {
    const weight = typeof (de as unknown as { weight?: number }).weight === "number"
      ? (de as unknown as { weight: number }).weight
      : 1;
    return {
      id: de.id,
      source: de.source,
      target: de.target,
      label: de.label,
      // Custom "shortest" edge type — draws a straight line whose
      // endpoints sit on the source/target circle perimeters (not
      // at a shared handle). This is what produces the Obsidian
      // "each connection from the closest point" look on hub nodes.
      type: "shortest",
      animated: false,
      // NOTE: do NOT set `zIndex` on edges. React Flow renders edges
      // with an explicit zIndex on top of nodes, which causes lines
      // to cover the node circles. Leaving it unset keeps edges in
      // their default layer (below nodes).
      style: {
        stroke: "#1C1C1C",
        strokeWidth: 1,
        strokeOpacity: 0.3,
      },
      labelStyle: EDGE_LABEL_STYLE,
      labelBgStyle: EDGE_LABEL_BG_STYLE,
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 0,
      data: {
        edgeType,
        note: de.note ?? "",
        weight,
        cooccurs: true,
      },
    };
  }

  const visual = EDGE_VISUAL[edgeType] ?? RELATES_STYLE;
  return {
    id: de.id,
    source: de.source,
    target: de.target,
    label: de.label,
    type: "shortest",
    animated: !!visual.animated,
    style: {
      stroke: visual.stroke,
      strokeWidth: visual.strokeWidth,
      strokeDasharray: visual.strokeDasharray,
    },
    labelStyle: EDGE_LABEL_STYLE,
    labelBgStyle: EDGE_LABEL_BG_STYLE,
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 0,
    data: {
      edgeType,
      note: de.note ?? "",
    },
  };
}

/**
 * Backwards-compat default style export used in a few places.
 */
export const EDGE_STYLE = {
  animated: false,
  style: { stroke: "#1C1C1C", strokeWidth: 1 },
  labelStyle: EDGE_LABEL_STYLE,
  labelBgStyle: EDGE_LABEL_BG_STYLE,
  labelBgPadding: [6, 3] as [number, number],
  labelBgBorderRadius: 0,
};
