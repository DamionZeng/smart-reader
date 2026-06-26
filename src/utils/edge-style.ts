import type { Edge } from "@xyflow/react";
import type { DocumentEdge, EdgeType } from "@/types";

/**
 * Default edge style — used for untyped/legacy edges ("relates").
 */
const RELATES_STYLE = {
  stroke: "#1C1C1C",
  strokeWidth: 1,
  strokeDasharray: undefined,
};

const EDGE_VISUAL: Record<EdgeType, { stroke: string; strokeWidth: number; strokeDasharray?: string; markerEnd?: string; animated?: boolean }> = {
  relates: { stroke: "#1C1C1C", strokeWidth: 1 },
  depends: { stroke: "#1C1C1C", strokeWidth: 1.5, strokeDasharray: "4 3", animated: true },
  extends: { stroke: "#1C1C1C", strokeWidth: 1.5 },
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
 * For co-occurrence edges (from the knowledge-graph pipeline), the stroke
 * width scales with `weight` — stronger co-occurrence = thicker line.
 */
export function buildEdge(de: DocumentEdge): Edge {
  const edgeType: EdgeType = de.edgeType ?? "relates";
  const isCooccurs = de.type === "co-occurs";

  // Co-occurrence edges: thin, semi-transparent, width scales with weight
  if (isCooccurs) {
    const weight = typeof (de as unknown as { weight?: number }).weight === "number"
      ? (de as unknown as { weight: number }).weight
      : 1;
    const strokeWidth = Math.max(0.5, Math.min(3, weight * 0.4));
    return {
      id: de.id,
      source: de.source,
      target: de.target,
      label: de.label,
      animated: false,
      zIndex: 0,
      style: {
        stroke: "#1C1C1C",
        strokeWidth,
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
    animated: !!visual.animated,
    zIndex: 0,
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
