"use client";

import { memo, useMemo } from "react";

export interface ClusterLegendItem {
  id: string;
  label: string;
  color: string;
  count: number;
}

interface ClusterLegendProps {
  clusters: ClusterLegendItem[];
  /**
   * Cluster node centers on the canvas (in flow coordinates). When a user
   * clicks a row, the parent will pan/zoom the view to this point.
   */
  clusterCenters: Record<string, { x: number; y: number }>;
  /**
   * IDs of clusters the user has hidden. Unlisted clusters are visible.
   * Click the checkbox to toggle. Clicking the label (or anywhere on the
   * row except the checkbox) locates the cluster in the canvas.
   */
  hiddenClusterIds: Set<string>;
  onToggle: (clusterId: string) => void;
  onLocate: (clusterId: string) => void;
}

/**
 * Compact legend showing cluster colors and labels for the knowledge graph.
 * Shown in the bottom-left corner of the board/codeboard canvas when a
 * concept-co-occurrence graph is active.
 *
 * Interactive behavior:
 *   - Each row has a checkbox (default: checked) that toggles whether the
 *     cluster (its background circle + member concept nodes + their edges)
 *     is shown on the canvas.
 *   - Clicking the label / color dot / count locates (pans + zooms) the
 *     viewport to that cluster.
 */
function ClusterLegendComponent({
  clusters,
  clusterCenters,
  hiddenClusterIds,
  onToggle,
  onLocate,
}: ClusterLegendProps) {
  const sortedClusters = useMemo(() => {
    // Dedupe by id — the KG generator occasionally emits two clusters
    // with the same id (e.g. the LLM duplicates a section header).
    // First occurrence wins so the legend never renders two rows for
    // one cluster and we never hit a duplicate-key warning.
    const seen = new Set<string>();
    const unique: ClusterLegendItem[] = [];
    for (const c of clusters) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      unique.push(c);
    }
    return unique.sort((a, b) => b.count - a.count);
  }, [clusters]);

  if (clusters.length === 0) return null;

  const visibleCount = clusters.length - hiddenClusterIds.size;

  return (
    <div className="bg-[#F9F8F6] border border-[#1C1C1C]/20 p-3 w-[260px]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-sans">
          Clusters
        </p>
        <p className="text-[9px] font-mono text-[#1C1C1C]/40">
          {visibleCount}/{clusters.length}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        {sortedClusters.map((c) => {
          const hidden = hiddenClusterIds.has(c.id);
          const canLocate = Boolean(clusterCenters[c.id]);
          return (
            <div
              key={c.id}
              className={`group flex items-center gap-2 px-1.5 py-1 -mx-1.5 rounded transition-colors duration-150 ${
                canLocate ? "cursor-pointer hover:bg-[#1C1C1C]/5" : ""
              } ${hidden ? "opacity-40" : ""}`}
              onClick={() => {
                if (canLocate) onLocate(c.id);
              }}
              title={canLocate ? "Click to locate" : undefined}
            >
              {/* Checkbox */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(c.id);
                }}
                aria-label={hidden ? `Show ${c.label}` : `Hide ${c.label}`}
                aria-pressed={!hidden}
                className={`w-3.5 h-3.5 shrink-0 border flex items-center justify-center transition-colors duration-150 ${
                  hidden
                    ? "border-[#1C1C1C]/30 bg-transparent"
                    : "border-[#1C1C1C] bg-[#1C1C1C]"
                }`}
              >
                {!hidden && (
                  <svg
                    viewBox="0 0 12 12"
                    className="w-2.5 h-2.5 text-[#F9F8F6]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="square"
                  >
                    <path d="M2 6.5L4.8 9L10 3" />
                  </svg>
                )}
              </button>

              {/* Color dot */}
              <span
                className="w-3 h-3 rounded-full shrink-0 border"
                style={{
                  backgroundColor: hidden ? "transparent" : `${c.color}30`,
                  borderColor: c.color,
                }}
              />

              {/* Label */}
              <span
                className={`text-[11px] font-sans truncate flex-1 transition-colors duration-150 ${
                  hidden
                    ? "text-[#1C1C1C]/40 line-through"
                    : "text-[#1C1C1C]/70 group-hover:text-[#1C1C1C]"
                }`}
              >
                {c.label}
              </span>

              {/* Count */}
              <span
                className={`text-[10px] font-mono ${
                  hidden ? "text-[#1C1C1C]/30" : "text-[#1C1C1C]/40"
                }`}
              >
                {c.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const ClusterLegend = memo(ClusterLegendComponent);
