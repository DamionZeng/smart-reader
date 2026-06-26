import { memo } from "react";
import { NodeProps } from "@xyflow/react";

/**
 * Large semi-transparent circle that visually groups concept nodes
 * belonging to the same cluster. Rendered behind concept nodes (zIndex 0)
 * to create a "big circle containing small circles" effect.
 *
 * P2-1 (cluster expand animation): pointer events are ENABLED on the
 * circle. Clicking it triggers the parent's `onFocusCluster` callback
 * (passed via node data), which zooms to the cluster's bounding box
 * AND fades non-member nodes. Clicking again or pressing Escape
 * resets. Hover shows a subtle ring to hint the cluster is clickable.
 */
export interface ClusterGroupNodeData {
  label: string;
  color: string;
  radius: number;
  conceptCount?: number;
  /** Parent-injected callback for "focus this cluster" interactions. */
  onFocusCluster?: (clusterId: string) => void;
  /** Whether this cluster is currently focused (drives ring highlight). */
  isFocused?: boolean;
  [key: string]: unknown;
}

function ClusterGroupNodeComponent({ data, id }: NodeProps & { data?: ClusterGroupNodeData }) {
  const label = data?.label ?? "";
  const color = data?.color ?? "#1C1C1C";
  const radius = data?.radius ?? 120;
  const size = radius * 2;
  const isFocused = data?.isFocused ?? false;

  return (
    <div
      style={{
        width: size,
        height: size,
        // pointerEvents auto so clicks land on the circle (P2-1)
        pointerEvents: "auto",
        cursor: "pointer",
        // Ensure the cluster circle is visible above the background
        // but below concept nodes (which have zIndex 10). Using
        // zIndex 1 here so the circle doesn't get hidden behind the
        // React Flow pane or background SVG.
        zIndex: 1,
      }}
      className="relative flex items-center justify-center"
      onClick={(e) => {
        e.stopPropagation();
        data?.onFocusCluster?.(id);
      }}
      role="button"
      aria-label={`Focus cluster ${label}`}
    >
      {/* Circle background — uses a slightly higher opacity than
          before so the cluster boundary is clearly visible against
          the #F9F8F6 page background. The border is the primary
          visual cue; the fill is a very subtle tint. */}
      <div
        className="absolute inset-0 rounded-full transition-all duration-500"
        style={{
          backgroundColor: `${color}14`,
          border: `2px solid ${isFocused ? color : `${color}50`}`,
          boxShadow: isFocused ? `0 0 0 4px ${color}20` : "none",
        }}
      />

      {/* Cluster label — centered, large, subtle. Becomes more opaque
          when focused so the user can clearly see which cluster is
          expanded. */}
      <span
        className="relative z-10 font-serif text-lg leading-tight tracking-tight select-none transition-opacity duration-300"
        style={{ color: isFocused ? `${color}` : `${color}60` }}
      >
        {label}
      </span>
    </div>
  );
}

export const ClusterGroupNode = memo(ClusterGroupNodeComponent);
