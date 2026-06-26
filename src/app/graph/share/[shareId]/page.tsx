"use client";

import { Suspense, useEffect, useMemo, useState, use } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import "@/i18n";

import type { ConceptGraph, Concept } from "@/types/concept-graph";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ClusterLegend } from "@/components/graph/ClusterLegend";
import { ConceptDetailPanel } from "@/components/graph/ConceptDetailPanel";
import { GraphEmpty } from "@/components/graph/GraphEmpty";

import dynamic from "next/dynamic";
const ConceptGraphCanvas = dynamic(
  () => import("@/components/graph/ConceptGraphCanvas").then((m) => m.ConceptGraphCanvas),
  { ssr: false, loading: () => <LoadingScreen message="Loading canvas..." /> }
);

function SharePageInner({ shareId }: { shareId: string }) {
  const { t } = useTranslation();
  const [graph, setGraph] = useState<ConceptGraph | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);

  // Fetch the shared graph on mount (no auth required)
  useEffect(() => {
    if (!shareId) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const run = async () => {
      try {
        const res = await fetch(`/api/concept-graph/share/${shareId}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) {
            setError("not_found");
          } else {
            setError("error");
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setGraph(data.graph as ConceptGraph);
      } catch {
        if (cancelled) return;
        setError("error");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const selectedConcept = useMemo<Concept | null>(() => {
    if (!graph || !selectedConceptId) return null;
    return graph.concepts.find((c) => c.id === selectedConceptId) ?? null;
  }, [graph, selectedConceptId]);

  const authors = useMemo(() => {
    if (!graph?.metadata?.authors) return "";
    return graph.metadata.authors.join(", ");
  }, [graph]);

  if (isLoading) {
    return (
      <div className="w-screen h-screen bg-[#F9F8F6]">
        <LoadingScreen message={t("share.loading", "Loading shared graph...")} />
      </div>
    );
  }

  if (error === "not_found") {
    return (
      <div className="w-screen min-h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col items-center justify-center px-6">
        <p className="text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 font-sans mb-4">
          404
        </p>
        <h1 className="font-serif text-3xl md:text-4xl tracking-tight text-[#1C1C1C] mb-4 text-center">
          {t("share.notFound", "Shared graph not found")}
        </h1>
        <p className="font-sans text-sm text-[#1C1C1C]/60 leading-relaxed max-w-md text-center mb-10">
          {t(
            "share.notFoundDescription",
            "This share link is invalid or has been revoked by the owner."
          )}
        </p>
        <Link
          href="/"
          className="font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors"
        >
          {t("share.poweredBy", "Powered by SmartReader")}
        </Link>
      </div>
    );
  }

  if (error || !graph) {
    return (
      <div className="w-screen min-h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col items-center justify-center px-6">
        <h1 className="font-serif text-3xl md:text-4xl tracking-tight text-[#1C1C1C] mb-4 text-center">
          {t("share.error", "Failed to load shared graph")}
        </h1>
        <Link
          href="/"
          className="mt-8 font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors"
        >
          {t("share.poweredBy", "Powered by SmartReader")}
        </Link>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col overflow-hidden font-sans">
      {/* Header — read-only badge + title + metadata */}
      <header className="border-b border-[#1C1C1C]/10 px-6 md:px-12 py-4 md:py-6 flex items-start justify-between gap-6 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/50 font-sans border border-[#1C1C1C]/20 px-2 py-0.5">
              {t("share.readOnly", "Read-only")}
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-sans">
              {graph.type === "code" ? "Code" : "Paper"}
            </span>
            {graph.metadata?.venue && (
              <span className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-sans">
                {graph.metadata.venue}
                {graph.metadata.year ? ` · ${graph.metadata.year}` : ""}
              </span>
            )}
            {!graph.metadata?.venue && graph.metadata?.year && (
              <span className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-sans">
                {graph.metadata.year}
              </span>
            )}
          </div>
          <h1 className="font-serif text-2xl md:text-3xl tracking-tight text-[#1C1C1C] leading-tight">
            {graph.title || t("share.untitled", "Untitled Graph")}
          </h1>
          {authors && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C]/60">
              {t("share.by", "by")} {authors}
            </p>
          )}
          <p className="mt-1 font-mono text-[10px] text-[#1C1C1C]/30">
            {graph.concepts.length} concepts · {graph.edges.length} edges ·{" "}
            {graph.clusters.length} clusters
          </p>
        </div>
      </header>

      {/* Canvas — read-only cytoscape */}
      <main className="flex-1 flex overflow-hidden bg-[#F9F8F6]">
        <div className="flex-1 relative">
          {graph.concepts.length === 0 ? (
            <GraphEmpty />
          ) : (
            <>
              <ConceptGraphCanvas
                graph={graph}
                onNodeSelect={setSelectedConceptId}
                onClusterSelect={(clusterId) => {
                  const cluster = graph.clusters.find((c) => c.id === clusterId);
                  if (cluster && cluster.conceptIds.length > 0) {
                    setSelectedConceptId(cluster.conceptIds[0]);
                  }
                }}
              />
              <ClusterLegend clusters={graph.clusters} />
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

      {/* Powered by footer */}
      <div className="absolute bottom-4 right-6 z-10">
        <Link
          href="/"
          className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
        >
          {t("share.poweredBy", "Powered by SmartReader")}
        </Link>
      </div>
    </div>
  );
}

function SharePageContent({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = use(params);
  return <SharePageInner shareId={shareId} />;
}

export default function SharePage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen bg-[#F9F8F6]">
          <LoadingScreen message="Loading..." />
        </div>
      }
    >
      <SharePageContent params={params} />
    </Suspense>
  );
}
