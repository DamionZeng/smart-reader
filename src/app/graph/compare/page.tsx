"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { ArrowLeft, Loader2, X } from "lucide-react";

import type { ConceptGraph } from "@/types/concept-graph";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ClusterLegend } from "@/components/graph/ClusterLegend";
import { ConceptDetailPanel } from "@/components/graph/ConceptDetailPanel";
import { GraphEmpty } from "@/components/graph/GraphEmpty";
import { cn } from "@/utils/cn";

import dynamic from "next/dynamic";
const ConceptGraphCanvas = dynamic(
  () => import("@/components/graph/ConceptGraphCanvas").then((m) => m.ConceptGraphCanvas),
  { ssr: false, loading: () => <LoadingScreen message="Loading canvas..." /> }
);

const MIN_GRAPHS = 2;
const MAX_GRAPHS = 8;

interface GraphListItem {
  id: string;
  title: string;
  type: string;
  createdAt: string;
  conceptCount: number;
}

function ComparePageInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mergedId = searchParams.get("id");

  const [availableGraphs, setAvailableGraphs] = useState<GraphListItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const [mergedGraph, setMergedGraph] = useState<ConceptGraph | null>(null);
  const [isLoadingMerged, setIsLoadingMerged] = useState(false);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);

  // ── Load user's graph list ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoadingList(true);

    const run = async () => {
      try {
        const res = await fetch("/api/concept-graph/list", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setMergeError("Failed to load graph list.");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setAvailableGraphs(data.graphs || []);
      } catch {
        if (!cancelled) setMergeError("Network error loading graphs.");
      } finally {
        if (!cancelled) setIsLoadingList(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load merged graph when id is present ────────────────────────────
  useEffect(() => {
    if (!mergedId) {
      setMergedGraph(null);
      return;
    }
    let cancelled = false;
    setIsLoadingMerged(true);

    const run = async () => {
      try {
        const res = await fetch(`/api/concept-graph/${mergedId}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setMergeError(`Failed to load merged graph (${res.status}).`);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setMergedGraph(data.graph as ConceptGraph);
      } catch {
        if (!cancelled) setMergeError("Network error loading merged graph.");
      } finally {
        if (!cancelled) setIsLoadingMerged(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [mergedId]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_GRAPHS) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const handleMerge = async () => {
    if (selectedIds.size < MIN_GRAPHS) return;
    setIsMerging(true);
    setMergeError(null);
    try {
      const res = await fetch("/api/concept-graph/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graphIds: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMergeError(data?.error || `Merge failed (${res.status})`);
        return;
      }
      const data = await res.json();
      const url = new URL(window.location.href);
      url.search = `?id=${data.graphId}`;
      router.push(url.pathname + url.search);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "Network error");
    } finally {
      setIsMerging(false);
    }
  };

  const selectedConcept = useMemo(() => {
    if (!mergedGraph || !selectedConceptId) return null;
    return (
      mergedGraph.concepts.find((c) => c.id === selectedConceptId) ?? null
    );
  }, [mergedGraph, selectedConceptId]);

  // Defensive dedupe of the graph list. Duplicate ids in the source
  // (DB / LLM output) would crash React's keyed rendering of the
  // selection grid below. First occurrence wins.
  const uniqueGraphs = useMemo(() => {
    const seen = new Set<string>();
    return availableGraphs.filter((g) => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
  }, [availableGraphs]);

  // ── Render: merged graph view ───────────────────────────────────────
  if (mergedId) {
    if (isLoadingMerged) {
      return (
        <div className="w-screen h-screen bg-[#F9F8F6]">
          <LoadingScreen message="Loading comparison..." />
        </div>
      );
    }
    if (mergeError && !mergedGraph) {
      return (
        <div className="w-screen h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col items-center justify-center px-6">
          <p className="font-serif text-2xl mb-4">{mergeError}</p>
          <Link
            href="/graph/compare"
            className="font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C]"
          >
            {t("graph.backToCompare", "Back to Compare")}
          </Link>
        </div>
      );
    }
    if (mergedGraph) {
      return (
        <div className="w-screen h-screen flex flex-col bg-[#F9F8F6] text-[#1C1C1C] overflow-hidden">
          <header className="border-b border-[#1C1C1C]/10 px-6 py-3 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              <Link
                href="/graph/compare"
                className="p-1.5 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
                aria-label="Back to compare"
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <div className="min-w-0">
                <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 block mb-0.5">
                  {t("graph.comparison", "Comparison")}
                </span>
                <h1 className="font-serif text-lg tracking-tight text-[#1C1C1C] truncate">
                  {mergedGraph.title}
                </h1>
              </div>
            </div>
            <span className="font-mono text-[10px] text-[#1C1C1C]/30">
              {mergedGraph.concepts.length} concepts · {mergedGraph.edges.length} edges
            </span>
          </header>
          <main className="flex-1 flex overflow-hidden">
            <div className="flex-1 relative">
              {mergedGraph.concepts.length === 0 ? (
                <GraphEmpty />
              ) : (
                <>
                  <ConceptGraphCanvas
                    graph={mergedGraph}
                    onNodeSelect={setSelectedConceptId}
                  />
                  <ClusterLegend clusters={mergedGraph.clusters} />
                </>
              )}
            </div>
            {selectedConcept && (
              <ConceptDetailPanel
                concept={selectedConcept}
                onClose={() => setSelectedConceptId(null)}
              />
            )}
          </main>
        </div>
      );
    }
  }

  // ── Render: selection view ──────────────────────────────────────────
  return (
    <div className="w-screen min-h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col">
      <header className="border-b border-[#1C1C1C]/10 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/graph"
            className="p-1.5 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 mb-0.5">
              {t("graph.compareEyebrow", "Compare")}
            </p>
            <h1 className="font-serif text-xl tracking-tight text-[#1C1C1C]">
              {t("graph.compareTitle", "Compare Concept Graphs")}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-[#1C1C1C]/40">
            {selectedIds.size}/{MAX_GRAPHS}
          </span>
          <button
            type="button"
            onClick={handleMerge}
            disabled={selectedIds.size < MIN_GRAPHS || isMerging}
            className="bg-[#1C1C1C] text-[#F9F8F6] px-4 py-2 font-sans text-[10px] uppercase tracking-[0.2em] hover:bg-[#1C1C1C]/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isMerging ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                {t("graph.merging", "Merging...")}
              </>
            ) : (
              t("graph.merge", "Merge & Compare")
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <p className="font-sans text-sm text-[#1C1C1C]/60 leading-relaxed max-w-2xl mb-8">
          {t(
            "graph.compareDescription",
            "Select 2–8 concept graphs to merge into a single comparison view. Concepts and edges are unioned by id; clusters are preserved."
          )}
        </p>

        {mergeError && (
          <div className="border border-[#A0522D] bg-[#A0522D]/5 px-4 py-3 mb-6 flex items-start gap-2 max-w-2xl">
            <X className="w-3.5 h-3.5 text-[#A0522D] mt-0.5 shrink-0" />
            <p className="font-sans text-xs text-[#A0522D]">{mergeError}</p>
          </div>
        )}

        {isLoadingList ? (
          <div className="flex items-center gap-3 text-[#1C1C1C]/40">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="font-sans text-xs uppercase tracking-[0.2em]">
              {t("graph.loadingList", "Loading graphs...")}
            </span>
          </div>
        ) : availableGraphs.length === 0 ? (
          <div className="border border-dashed border-[#1C1C1C]/20 p-12 text-center max-w-2xl">
            <p className="font-serif italic text-[#1C1C1C]/40">
              {t(
                "graph.compareEmpty",
                "No concept graphs yet. Build one first from the graph workbench."
              )}
            </p>
            <Link
              href="/graph"
              className="inline-block mt-6 font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C] border border-[#1C1C1C] px-4 py-2 hover:bg-[#1C1C1C] hover:text-[#F9F8F6] transition-colors"
            >
              {t("graph.buildFirst", "Build a Graph")}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
            {availableGraphs.map((g) => {
              const isSelected = selectedIds.has(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleSelect(g.id)}
                  className={cn(
                    "border p-4 text-left transition-colors flex flex-col gap-2",
                    isSelected
                      ? "border-[#1C1C1C] bg-[#1C1C1C] text-[#F9F8F6]"
                      : "border-[#1C1C1C]/20 hover:border-[#1C1C1C] bg-[#F9F8F6] text-[#1C1C1C]"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "font-sans text-[10px] uppercase tracking-[0.2em]",
                        isSelected ? "text-[#F9F8F6]/60" : "text-[#1C1C1C]/40"
                      )}
                    >
                      {g.type === "code" ? "Code" : "Paper"}
                    </span>
                    <span
                      className={cn(
                        "w-3 h-3 border flex items-center justify-center",
                        isSelected
                          ? "border-[#F9F8F6] bg-[#F9F8F6]"
                          : "border-[#1C1C1C]/30"
                      )}
                    >
                      {isSelected && (
                        <span className="w-1.5 h-1.5 bg-[#1C1C1C]" />
                      )}
                    </span>
                  </div>
                  <h3 className="font-serif text-base leading-snug line-clamp-2">
                    {g.title}
                  </h3>
                  <div
                    className={cn(
                      "font-mono text-[10px]",
                      isSelected ? "text-[#F9F8F6]/40" : "text-[#1C1C1C]/30"
                    )}
                  >
                    {g.conceptCount} concepts
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen bg-[#F9F8F6]">
          <LoadingScreen message="Loading..." />
        </div>
      }
    >
      <ComparePageInner />
    </Suspense>
  );
}
