"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { ArrowLeft, Upload, Link2, FileText, Code2, X, Loader2 } from "lucide-react";

import type { ConceptGraph, Concept, JobProgress, JobStatus } from "@/types/concept-graph";
import { LoadingScreen } from "@/components/LoadingScreen";
import { GraphEmpty } from "@/components/graph/GraphEmpty";
import { ClusterLegend } from "@/components/graph/ClusterLegend";
import { ConceptDetailPanel } from "@/components/graph/ConceptDetailPanel";
import { GraphFilter } from "@/components/graph/GraphFilter";
import { GraphToolbar } from "@/components/graph/GraphToolbar";
import { GraphExport } from "@/components/graph/GraphExport";
import { cn } from "@/utils/cn";

// Dynamic import: cytoscape must only load in the browser.
// next/dynamic with ssr:false guarantees the canvas (and its deps)
// never reach the server bundle.
import dynamic from "next/dynamic";
const ConceptGraphCanvas = dynamic(
  () => import("@/components/graph/ConceptGraphCanvas").then((m) => m.ConceptGraphCanvas),
  { ssr: false, loading: () => <LoadingScreen message="Loading canvas..." /> }
);

// ── Job polling ─────────────────────────────────────────────────────────
const JOB_POLL_INTERVAL_MS = 1500;
const JOB_POLL_MAX_ATTEMPTS = 200; // ~5 minutes

interface JobPollState {
  status: JobStatus;
  progress: JobProgress;
  graphId?: string;
  error?: string;
}

// ── Ingest form ─────────────────────────────────────────────────────────
type IngestType = "paper" | "code";

const PAPER_ACCEPT = ".md,.markdown,.txt,.json,.pdf";
const CODE_ACCEPT =
  ".js,.jsx,.ts,.tsx,.py,.go,.java,.rb,.rs,.c,.cpp,.h,.hpp,.cs,.php,.swift,.kt,.scala,.md,.markdown,.txt,.json,.yaml,.yml,.toml";

// ── Main page ───────────────────────────────────────────────────────────
function GraphPageInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const graphId = searchParams.get("id");
  const jobId = searchParams.get("jobId");

  const [graph, setGraph] = useState<ConceptGraph | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [filteredIds, setFilteredIds] = useState<Set<string> | null>(null);

  // Toolbar state
  const [layout, setLayout] = useState("force");
  const [sizeMetric, setSizeMetric] = useState("importance");
  const [showHulls, setShowHulls] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [showLabels, setShowLabels] = useState(true);

  // ── Load graph by id ────────────────────────────────────────────────
  useEffect(() => {
    if (!graphId) {
      setGraph(null);
      return;
    }
    let cancelled = false;
    setIsLoadingGraph(true);
    setLoadError(null);

    const run = async () => {
      try {
        const res = await fetch(`/api/concept-graph/${graphId}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setLoadError(data?.error || `Failed to load graph (${res.status})`);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setGraph(data.graph as ConceptGraph);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Network error");
      } finally {
        if (!cancelled) setIsLoadingGraph(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [graphId]);

  // ── Job polling ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      if (cancelled) return;
      attempts += 1;
      if (attempts > JOB_POLL_MAX_ATTEMPTS) {
        setLoadError("Timed out waiting for the ingest job to finish.");
        return;
      }
      try {
        const res = await fetch(`/api/concept-graph/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) {
          setLoadError("Failed to poll job status.");
          return;
        }
        const data = (await res.json()) as JobPollState;
        if (cancelled) return;

        if (data.status === "done" && data.graphId) {
          // Swap URL from ?jobId=... to ?id=graphId (replaces history so
          // the back button doesn't bounce back to the polling state).
          const url = new URL(window.location.href);
          url.searchParams.delete("jobId");
          url.searchParams.set("id", data.graphId);
          router.replace(url.pathname + url.search);
          return;
        }
        if (data.status === "failed") {
          setLoadError(data.error || "Ingest job failed.");
          return;
        }
        // Still processing — schedule next poll
        setTimeout(poll, JOB_POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        setTimeout(poll, JOB_POLL_INTERVAL_MS);
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, router]);

  // ── Selected concept lookup ────────────────────────────────────────
  const selectedConcept = useMemo<Concept | null>(() => {
    if (!graph || !selectedConceptId) return null;
    return graph.concepts.find((c) => c.id === selectedConceptId) ?? null;
  }, [graph, selectedConceptId]);

  // ── Filtered graph for rendering ───────────────────────────────────
  const renderedGraph = useMemo<ConceptGraph | null>(() => {
    if (!graph) return null;
    if (!filteredIds || filteredIds.size === 0) return graph;
    const visibleConcepts = graph.concepts.filter((c) => filteredIds.has(c.id));
    const visibleIdSet = new Set(visibleConcepts.map((c) => c.id));
    const visibleEdges = graph.edges.filter(
      (e) => visibleIdSet.has(e.source) && visibleIdSet.has(e.target)
    );
    return { ...graph, concepts: visibleConcepts, edges: visibleEdges };
  }, [graph, filteredIds]);

  // ── Ingest submit ──────────────────────────────────────────────────
  const handleIngest = useCallback(
    async (type: IngestType, url: string, file: File | null) => {
      const formData = new FormData();
      formData.append("type", type);
      if (url) formData.append("url", url);
      if (file) formData.append("file", file);

      try {
        const res = await fetch("/api/concept-graph/ingest", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setLoadError(data?.error || `Ingest failed (${res.status})`);
          return;
        }
        const data = await res.json();
        // Switch to polling mode
        const next = new URL(window.location.href);
        next.search = `?jobId=${data.jobId}`;
        router.push(next.pathname + next.search);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Network error");
      }
    },
    [router]
  );

  // ── Explain concept (SSE) ─────────────────────────────────────────
  const handleExplain = useCallback(
    async (conceptId: string) => {
      if (!graph) return;
      try {
        const res = await fetch(`/api/concept-graph/${graph.id}/explain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conceptId }),
        });
        if (!res.body) return;
        // Stream the explanation into the concept's description field.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let explanation = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.delta) explanation += evt.delta;
            } catch {
              // ignore malformed chunks
            }
          }
        }
        if (explanation) {
          setGraph((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              concepts: prev.concepts.map((c) =>
                c.id === conceptId
                  ? { ...c, description: explanation }
                  : c
              ),
            };
          });
        }
      } catch {
        // Non-fatal — explain is a progressive enhancement.
      }
    },
    [graph]
  );

  // ── Render branches ────────────────────────────────────────────────

  // 1. Job polling state
  if (jobId) {
    return <JobPollingView />;
  }

  // 2. Load error
  if (loadError && !graph) {
    return (
      <div className="w-screen h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col items-center justify-center px-6">
        <p className="text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 font-sans mb-4">
          Error
        </p>
        <h1 className="font-serif text-2xl tracking-tight text-[#1C1C1C] mb-4 text-center max-w-md">
          {loadError}
        </h1>
        <Link
          href="/graph"
          className="mt-4 font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors"
        >
          {t("graph.backToIngest", "Back to Ingest")}
        </Link>
      </div>
    );
  }

  // 3. Loading existing graph
  if (isLoadingGraph) {
    return (
      <div className="w-screen h-screen bg-[#F9F8F6]">
        <LoadingScreen message={t("graph.loading", "Loading graph...")} />
      </div>
    );
  }

  // 4. No graph id → show ingest form
  if (!graphId && !graph) {
    return <IngestView onIngest={handleIngest} errorMessage={loadError} />;
  }

  // 5. Graph loaded → workbench
  if (graph && renderedGraph) {
    return (
      <div className="w-screen h-screen flex flex-col bg-[#F9F8F6] text-[#1C1C1C] overflow-hidden">
        {/* Header */}
        <header className="border-b border-[#1C1C1C]/10 px-6 py-3 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <Link
              href="/graph"
              className="p-1.5 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
              aria-label={t("graph.backToIngest", "Back to Ingest")}
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
                  {graph.type === "code" ? "Code" : "Paper"}
                </span>
                <span className="font-mono text-[10px] text-[#1C1C1C]/30">
                  {graph.concepts.length} concepts · {graph.edges.length} edges ·{" "}
                  {graph.clusters.length} clusters
                </span>
              </div>
              <h1 className="font-serif text-lg tracking-tight text-[#1C1C1C] truncate">
                {graph.title}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <GraphExport graphId={graph.id} graph={graph} />
          </div>
        </header>

        {/* Main canvas + side panel */}
        <main className="flex-1 flex overflow-hidden">
          <div className="flex-1 relative">
            {renderedGraph.concepts.length === 0 ? (
              <GraphEmpty />
            ) : (
              <>
                <ConceptGraphCanvas
                  graph={renderedGraph}
                  onNodeSelect={setSelectedConceptId}
                  onClusterSelect={(clusterId) => {
                    // Focus first concept in the cluster
                    const cluster = graph.clusters.find((c) => c.id === clusterId);
                    if (cluster && cluster.conceptIds.length > 0) {
                      setSelectedConceptId(cluster.conceptIds[0]);
                    }
                  }}
                />
                <GraphToolbar
                  layout={layout}
                  onLayoutChange={setLayout}
                  sizeMetric={sizeMetric}
                  onSizeMetricChange={setSizeMetric}
                  showHulls={showHulls}
                  onShowHullsChange={setShowHulls}
                  showEdges={showEdges}
                  onShowEdgesChange={setShowEdges}
                  showLabels={showLabels}
                  onShowLabelsChange={setShowLabels}
                  onExport={() => {
                    /* Export handled by GraphExport in header */
                  }}
                />
                <GraphFilter
                  concepts={graph.concepts}
                  clusters={graph.clusters}
                  onFilter={setFilteredIds}
                />
                <ClusterLegend
                  clusters={graph.clusters}
                  onClusterClick={(id) => {
                    const cluster = graph.clusters.find((c) => c.id === id);
                    if (cluster && cluster.conceptIds.length > 0) {
                      setSelectedConceptId(cluster.conceptIds[0]);
                    }
                  }}
                />
              </>
            )}
          </div>

          {selectedConcept && (
            <ConceptDetailPanel
              concept={selectedConcept}
              onClose={() => setSelectedConceptId(null)}
              onExplain={handleExplain}
            />
          )}
        </main>
      </div>
    );
  }

  // Fallback (should not reach)
  return null;
}

// ── Job polling view ─────────────────────────────────────────────────────
function JobPollingView() {
  const { t } = useTranslation();
  return (
    <div className="w-screen h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col items-center justify-center">
      <div className="flex items-center gap-4 mb-6">
        <Loader2 className="w-5 h-5 animate-spin text-[#1C1C1C]/60" />
        <p className="font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C]/60">
          {t("graph.processing", "Building concept graph...")}
        </p>
      </div>
      <p className="font-serif italic text-sm text-[#1C1C1C]/40 max-w-md text-center leading-relaxed">
        {t(
          "graph.processingHint",
          "This may take a minute. We're extracting concepts, building co-occurrence edges, and detecting communities."
        )}
      </p>
    </div>
  );
}

// ── Ingest view ──────────────────────────────────────────────────────────
function IngestView({
  onIngest,
  errorMessage,
}: {
  onIngest: (type: IngestType, url: string, file: File | null) => void;
  errorMessage?: string | null;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<IngestType>("paper");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setLocalError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url && !file) {
      setLocalError(t("graph.ingestErrorEmpty", "Please provide a URL or a file."));
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    await onIngest(type, url, file);
    setSubmitting(false);
  };

  const accept = type === "code" ? CODE_ACCEPT : PAPER_ACCEPT;

  return (
    <div className="w-screen min-h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl">
        {/* Eyebrow */}
        <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 mb-3 text-center">
          {t("graph.eyebrow", "Concept Graph")}
        </p>
        <h1 className="font-serif text-3xl md:text-4xl tracking-tight text-[#1C1C1C] mb-3 text-center leading-tight">
          {t("graph.ingestTitle", "Build a Concept Graph")}
        </h1>
        <p className="font-sans text-sm text-[#1C1C1C]/60 leading-relaxed mb-10 text-center max-w-md mx-auto">
          {t(
            "graph.ingestSubtitle",
            "Upload a paper or code file. We'll extract 100+ concepts, build co-occurrence edges, and detect thematic clusters."
          )}
        </p>

        {/* Type selector */}
        <div className="flex border border-[#1C1C1C] mb-6">
          <button
            type="button"
            onClick={() => setType("paper")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3 font-sans text-[10px] uppercase tracking-[0.2em] transition-colors",
              type === "paper"
                ? "bg-[#1C1C1C] text-[#F9F8F6]"
                : "bg-transparent text-[#1C1C1C]/60 hover:text-[#1C1C1C]"
            )}
          >
            <FileText className="w-3.5 h-3.5" />
            {t("graph.typePaper", "Paper")}
          </button>
          <button
            type="button"
            onClick={() => setType("code")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3 font-sans text-[10px] uppercase tracking-[0.2em] transition-colors border-l border-[#1C1C1C]",
              type === "code"
                ? "bg-[#1C1C1C] text-[#F9F8F6]"
                : "bg-transparent text-[#1C1C1C]/60 hover:text-[#1C1C1C]"
            )}
          >
            <Code2 className="w-3.5 h-3.5" />
            {t("graph.typeCode", "Code")}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* URL input */}
          <div>
            <label className="block font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 mb-2">
              {type === "code"
                ? t("graph.urlLabelCode", "GitHub Repository URL")
                : t("graph.urlLabelPaper", "Paper URL (arXiv, DOI, etc.)")}
            </label>
            <div className="flex items-center border border-[#1C1C1C]/30 focus-within:border-[#1C1C1C] transition-colors">
              <Link2 className="w-3.5 h-3.5 text-[#1C1C1C]/40 ml-3" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  type === "code"
                    ? "https://github.com/owner/repo"
                    : "https://arxiv.org/abs/2401.00001"
                }
                className="flex-1 bg-transparent px-3 py-3 font-sans text-sm text-[#1C1C1C] placeholder:text-[#1C1C1C]/30 focus:outline-none"
              />
            </div>
          </div>

          {/* OR divider */}
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-[#1C1C1C]/10" />
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/30">
              {t("graph.or", "OR")}
            </span>
            <div className="flex-1 h-px bg-[#1C1C1C]/10" />
          </div>

          {/* File upload */}
          <div>
            <label className="block font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 mb-2">
              {t("graph.fileLabel", "File Upload")}
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "w-full border border-dashed border-[#1C1C1C]/30 hover:border-[#1C1C1C] transition-colors py-6 px-4 flex flex-col items-center gap-2",
                file && "border-[#1C1C1C] bg-[#1C1C1C]/5"
              )}
            >
              <Upload className="w-4 h-4 text-[#1C1C1C]/40" />
              <span className="font-sans text-xs text-[#1C1C1C]/60">
                {file ? file.name : t("graph.fileCta", "Click to browse files")}
              </span>
              <span className="font-sans text-[10px] text-[#1C1C1C]/30">
                {type === "code"
                  ? "JS, TS, PY, GO, MD... up to 10MB"
                  : "MD, TXT, JSON, PDF up to 10MB"}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Error */}
          {(localError || errorMessage) && (
            <div className="border border-[#A0522D] bg-[#A0522D]/5 px-4 py-3 flex items-start gap-2">
              <X className="w-3.5 h-3.5 text-[#A0522D] mt-0.5 shrink-0" />
              <p className="font-sans text-xs text-[#A0522D]">
                {localError || errorMessage}
              </p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-[#1C1C1C] text-[#F9F8F6] py-4 font-sans text-xs uppercase tracking-[0.2em] hover:bg-[#1C1C1C]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t("graph.submitting", "Submitting...")}
              </>
            ) : (
              t("graph.submit", "Build Graph")
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Page export with Suspense for useSearchParams ────────────────────────
export default function GraphPage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen bg-[#F9F8F6]">
          <LoadingScreen message="Loading..." />
        </div>
      }
    >
      <GraphPageInner />
    </Suspense>
  );
}
