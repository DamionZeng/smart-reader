"use client";

import type { ConceptCluster } from "@/types/concept-graph";
import { getClusterColor } from "@/types/concept-graph";

interface ClusterLegendProps {
  clusters: ConceptCluster[];
  onClusterClick?: (id: string) => void;
}

/**
 * Bottom-left overlay listing all clusters with their color dots.
 * Clicking a cluster calls `onClusterClick` with the cluster id.
 */
export function ClusterLegend({ clusters, onClusterClick }: ClusterLegendProps) {
  if (clusters.length === 0) return null;

  // Dedupe by id before rendering — the KG generator occasionally
  // emits two clusters with the same id, which would crash React with
  // a duplicate-key warning. First occurrence wins.
  const seen = new Set<string>();
  const uniqueClusters = clusters.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  return (
    <div className="absolute bottom-4 left-4 z-20 bg-[#F9F8F6] border border-[#1C1C1C] p-3 max-w-xs">
      <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 mb-2 pb-2 border-b border-[#1C1C1C]/10">
        Clusters
      </div>
      <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
        {uniqueClusters.map((cluster) => {
          const color = getClusterColor(cluster.colorName);
          return (
            <button
              key={cluster.id}
              type="button"
              onClick={() => onClusterClick?.(cluster.id)}
              className="flex items-center gap-2 text-left hover:bg-[#1C1C1C]/5 transition-colors duration-200 px-1 py-0.5 focus:outline-none group"
            >
              <span
                className="w-2.5 h-2.5 shrink-0 border border-[#1C1C1C]/20"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <span className="font-sans text-xs text-[#1C1C1C]/70 group-hover:text-[#1C1C1C] transition-colors truncate">
                {cluster.label}
              </span>
              <span className="font-mono text-[10px] text-[#1C1C1C]/30 ml-auto shrink-0">
                {cluster.conceptIds.length}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
