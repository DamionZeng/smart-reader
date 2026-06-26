import { BaseEdge, EdgeLabelRenderer, getStraightPath, useInternalNode, type EdgeProps } from "@xyflow/react";

/**
 * Custom edge type that draws a straight line whose endpoints sit on
 * the source/target circle perimeters, NOT at the handle position.
 *
 * Motivation: with React Flow's built-in "straight" edge, a node with
 * N connections all share the same handle anchor, so N lines leave
 * from a single point on the circle. We want each line to leave the
 * circle at the CLOSEST point on the perimeter to its specific
 * target — that's what "shortest distance" means in the user's
 * mental model.
 *
 * For two circles, the shortest external tangent is the line
 * connecting the two closest perimeter points along the line that
 * passes through both centers. We simply use the line through the
 * two centers and step back from each center by `radius` to land on
 * the perimeter. This gives:
 *  - start: source center + (target - source) normalized × sourceRadius
 *  - end:   target center + (source - target) normalized × targetRadius
 *
 * The line is therefore the visible portion of the center-to-center
 * segment, and naturally stops at each circle's edge so the two
 * circles do not overlap into the line. This matches the Obsidian
 * "each connection from the closest point" look exactly.
 */
const DEFAULT_RADIUS = 8;

function readNodeRadius(node: ReturnType<typeof useInternalNode> | null): number {
  if (!node) return DEFAULT_RADIUS;
  // ConceptGraphNode writes the circle's radius (in flow-space units)
  // onto its inner div via `data-node-radius` and ALSO into the node
  // data via the `radius` field. The data field is the cleanest path
  // because it's synchronously available.
  const dataRadius = (node.data as { radius?: number } | undefined)?.radius;
  if (typeof dataRadius === "number" && dataRadius > 0) return dataRadius;
  // Fallback: use the measured DOM width of the node box.
  const w = node.measured?.width ?? 0;
  if (w > 0) return w / 2;
  return DEFAULT_RADIUS;
}

function perimeterPoint(
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  r: number
): [number, number] {
  const dx = tx - cx;
  const dy = ty - cy;
  const d = Math.hypot(dx, dy) || 1;
  return [cx + (dx / d) * r, cy + (dy / d) * r];
}

export function ShortestStraightEdge(props: EdgeProps) {
  const {
    id,
    source,
    target,
    style = {},
    markerEnd,
    label,
    labelStyle,
    labelBgStyle,
    labelBgPadding,
    labelBgBorderRadius,
    interactionWidth,
  } = props;

  // Use the internal node lookup so we get the LIVE position (handles
  // pan/zoom and force-layout moves) and the data fields we set on
  // the node. `useInternalNode` is a hook so it must be called at
  // the top level of the edge component.
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  // Node "position" is the top-left of the node box. The circle lives
  // inside the box; ConceptGraphNode has a 90px wide column with the
  // circle sized 16/22/28px. So the circle's center is offset from
  // the box top-left by half the box width on X, and by `radius` on
  // Y (the circle is at the TOP of the column so the label can sit
  // below it without shifting the center).
  const sourceR = readNodeRadius(sourceNode);
  const targetR = readNodeRadius(targetNode);

  const sourceBox = sourceNode?.internals.positionAbsolute ?? { x: 0, y: 0 };
  const targetBox = targetNode?.internals.positionAbsolute ?? { x: 0, y: 0 };
  // The node box width is `measured.width` (from useInternalNode);
  // use it to find the circle center, otherwise fall back to a small
  // default of 45 (half of 90px column width) when not measured.
  const sourceBoxW = sourceNode?.measured?.width ?? 90;
  const targetBoxW = targetNode?.measured?.width ?? 90;
  const sourceCx = sourceBox.x + sourceBoxW / 2;
  const sourceCy = sourceBox.y + sourceR;
  const targetCx = targetBox.x + targetBoxW / 2;
  const targetCy = targetBox.y + targetR;

  const [sx, sy] = perimeterPoint(sourceCx, sourceCy, targetCx, targetCy, sourceR);
  const [tx, ty] = perimeterPoint(targetCx, targetCy, sourceCx, sourceCy, targetR);

  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
        style={style}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              ...labelStyle,
              ...(labelBgStyle
                ? {
                    background: labelBgStyle.fill,
                    padding: `${labelBgPadding?.[1] ?? 3}px ${labelBgPadding?.[0] ?? 6}px`,
                    borderRadius: labelBgBorderRadius ?? 0,
                    border: labelBgStyle.stroke
                      ? `${labelBgStyle.strokeWidth ?? 1}px solid ${labelBgStyle.stroke}`
                      : undefined,
                  }
                : {}),
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
