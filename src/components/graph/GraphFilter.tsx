"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, ChevronDown, X } from "lucide-react";
import type { Concept, ConceptCluster, ConceptType } from "@/types/concept-graph";
import { cn } from "@/utils/cn";

interface GraphFilterProps {
  concepts: Concept[];
  clusters: ConceptCluster[];
  onFilter: (filteredConceptIds: Set<string>) => void;
}

/**
 * Top-right overlay panel for filtering the concept graph.
 *
 * Filters:
 *   - Type (checkboxes — derived from the concepts present)
 *   - Cluster (checkboxes — derived from the clusters present)
 *   - Importance threshold (slider 0–1)
 *
 * On every change the panel builds a Set of visible concept IDs and
 * calls `onFilter`. An empty set means "nothing visible".
 */
export function GraphFilter({ concepts, clusters, onFilter }: GraphFilterProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Derive the available types from the concepts
  const availableTypes = useMemo(() => {
    const types = new Set<ConceptType>();
    for (const c of concepts) types.add(c.type);
    return Array.from(types).sort();
  }, [concepts]);

  // Selected types (all on by default)
  const [selectedTypes, setSelectedTypes] = useState<Set<ConceptType>>(
    new Set(availableTypes)
  );

  // Selected clusters (all on by default)
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(
    new Set(clusters.map((c) => c.id))
  );

  // Importance threshold (0 = show everything)
  const [importanceThreshold, setImportanceThreshold] = useState(0);

  // Reset selections when the upstream data changes
  useEffect(() => {
    setSelectedTypes(new Set(availableTypes));
  }, [availableTypes]);

  useEffect(() => {
    setSelectedClusters(new Set(clusters.map((c) => c.id)));
  }, [clusters]);

  // Apply filter whenever a selection changes
  useEffect(() => {
    const visible = new Set<string>();
    for (const concept of concepts) {
      if (!selectedTypes.has(concept.type)) continue;
      if (!selectedClusters.has(concept.clusterId)) continue;
      if (concept.importance < importanceThreshold) continue;
      visible.add(concept.id);
    }
    onFilter(visible);
  }, [concepts, selectedTypes, selectedClusters, importanceThreshold, onFilter]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [open]);

  const toggleType = (type: ConceptType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const toggleCluster = (id: string) => {
    setSelectedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetAll = () => {
    setSelectedTypes(new Set(availableTypes));
    setSelectedClusters(new Set(clusters.map((c) => c.id)));
    setImportanceThreshold(0);
  };

  const activeFilterCount =
    (availableTypes.length - selectedTypes.size) +
    (clusters.length - selectedClusters.size) +
    (importanceThreshold > 0 ? 1 : 0);

  return (
    <div className="absolute top-4 right-4 z-20" ref={panelRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Filter graph"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 border transition-colors duration-200 focus:outline-none",
          open || activeFilterCount > 0
            ? "border-[#1C1C1C] bg-[#1C1C1C] text-[#F9F8F6]"
            : "border-[#1C1C1C] bg-[#F9F8F6] text-[#1C1C1C] hover:bg-[#1C1C1C]/5"
        )}
      >
        <Filter className="w-3.5 h-3.5" />
        <span className="font-sans text-[10px] uppercase tracking-[0.2em]">
          Filter
        </span>
        {activeFilterCount > 0 && (
          <span className="font-mono text-[10px] tabular-nums">
            {activeFilterCount}
          </span>
        )}
        <ChevronDown
          className={cn(
            "w-3 h-3 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute top-full right-0 mt-0.5 w-72 bg-[#F9F8F6] border border-[#1C1C1C] animate-in fade-in duration-150 max-h-[70vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1C1C1C]/10">
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60">
              Filters
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetAll}
                className="font-sans text-[10px] uppercase tracking-[0.15em] text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
                aria-label="Close filter panel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Type filter */}
          <div className="px-4 py-3 border-b border-[#1C1C1C]/10">
            <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 mb-2">
              Type
            </div>
            <div className="flex flex-col gap-1.5">
              {availableTypes.map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-2 cursor-pointer group"
                >
                  <span
                    className={cn(
                      "w-3 h-3 border flex items-center justify-center transition-colors",
                      selectedTypes.has(type)
                        ? "bg-[#1C1C1C] border-[#1C1C1C]"
                        : "bg-transparent border-[#1C1C1C]/30 group-hover:border-[#1C1C1C]/60"
                    )}
                  >
                    {selectedTypes.has(type) && (
                      <span className="w-1.5 h-1.5 bg-[#F9F8F6]" />
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={selectedTypes.has(type)}
                    onChange={() => toggleType(type)}
                    className="sr-only"
                  />
                  <span className="font-sans text-xs text-[#1C1C1C]/70 group-hover:text-[#1C1C1C] transition-colors capitalize">
                    {type}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Cluster filter */}
          <div className="px-4 py-3 border-b border-[#1C1C1C]/10">
            <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 mb-2">
              Cluster
            </div>
            <div className="flex flex-col gap-1.5">
              {clusters.map((cluster) => (
                <label
                  key={cluster.id}
                  className="flex items-center gap-2 cursor-pointer group"
                >
                  <span
                    className={cn(
                      "w-3 h-3 border flex items-center justify-center transition-colors",
                      selectedClusters.has(cluster.id)
                        ? "bg-[#1C1C1C] border-[#1C1C1C]"
                        : "bg-transparent border-[#1C1C1C]/30 group-hover:border-[#1C1C1C]/60"
                    )}
                  >
                    {selectedClusters.has(cluster.id) && (
                      <span className="w-1.5 h-1.5 bg-[#F9F8F6]" />
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={selectedClusters.has(cluster.id)}
                    onChange={() => toggleCluster(cluster.id)}
                    className="sr-only"
                  />
                  <span className="font-sans text-xs text-[#1C1C1C]/70 group-hover:text-[#1C1C1C] transition-colors truncate">
                    {cluster.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Importance threshold */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60">
                Min Importance
              </span>
              <span className="font-mono text-xs text-[#1C1C1C] tabular-nums">
                {importanceThreshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={importanceThreshold}
              onChange={(e) => setImportanceThreshold(Number(e.target.value))}
              className="editorial-slider w-full"
              aria-label="Minimum importance threshold"
            />
          </div>
        </div>
      )}
    </div>
  );
}
