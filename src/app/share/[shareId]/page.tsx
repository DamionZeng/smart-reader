"use client";

import { Suspense, useEffect, useState, useMemo, use } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { ParsedDocument } from "@/types";
import { normaliseGraph } from "@/utils/graph-normalize";
import { EDGE_STYLE } from "@/utils/edge-style";
import { ConceptNode } from "@/components/Nodes/ConceptNode";
import { CodeNode } from "@/components/Nodes/CodeNode";
import { LoadingScreen } from "@/components/LoadingScreen";

const nodeTypes = {
  module: CodeNode,
  function: CodeNode,
  class: CodeNode,
  concept: ConceptNode,
};

interface SharedProject {
  id: string;
  title: string;
  type: string;
  nodes: unknown;
  edges: unknown;
  authors: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  abstract: string | null;
}

function SharePageInner({ shareId }: { shareId: string }) {
  const { t } = useTranslation();
  const [project, setProject] = useState<SharedProject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Fetch the shared project on mount
  useEffect(() => {
    if (!shareId) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const run = async () => {
      try {
        const res = await fetch(`/api/share/${shareId}`);
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
        setProject(data.project as SharedProject);
      } catch (err) {
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

  // Normalise and build flow nodes/edges when project loads
  useEffect(() => {
    if (!project) return;

    const parsed: ParsedDocument = normaliseGraph(
      {
        title: project.title,
        nodes: project.nodes,
        edges: project.edges,
        metadata:
          project.authors ||
          project.year ||
          project.venue ||
          project.doi ||
          project.abstract
            ? {
                authors: project.authors
                  ? (() => {
                      try {
                        return JSON.parse(project.authors);
                      } catch {
                        return [];
                      }
                    })()
                  : [],
                year: project.year ?? null,
                venue: project.venue || "",
                doi: project.doi || "",
                abstract: project.abstract || "",
              }
            : undefined,
      },
      project.id,
      (project.type as "paper" | "code") || "paper"
    );

    const flowNodes: Node[] = parsed.nodes.map((n) => {
      // Map type for rendering: module/function/class → CodeNode, else → ConceptNode
      const isCodeType =
        n.type === "module" || n.type === "function" || n.type === "class";
      return {
        id: n.id,
        type: isCodeType ? n.type : "concept",
        position: n.position || { x: 0, y: 0 },
        data: {
          ...n.data,
          isActive: false,
          ...(n.section ? { section: n.section } : {}),
        },
      };
    });

    const flowEdges: Edge[] = parsed.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      ...EDGE_STYLE,
    }));

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [project, setNodes, setEdges]);

  const authors = useMemo(() => {
    if (!project?.authors) return "";
    try {
      const arr = JSON.parse(project.authors);
      if (Array.isArray(arr)) {
        return arr.filter((a) => typeof a === "string").join(", ");
      }
    } catch {
      // ignore parse errors
    }
    return "";
  }, [project]);

  if (isLoading) {
    return (
      <div className="w-screen h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col items-center justify-center">
        <LoadingScreen message={t("share.loading")} />
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
          {t("share.notFound")}
        </h1>
        <p className="font-sans text-sm text-[#1C1C1C]/60 leading-relaxed max-w-md text-center mb-10">
          {t("share.notFoundDescription")}
        </p>
        <Link
          href="/"
          className="font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors"
        >
          {t("share.poweredBy")}
        </Link>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="w-screen min-h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col items-center justify-center px-6">
        <h1 className="font-serif text-3xl md:text-4xl tracking-tight text-[#1C1C1C] mb-4 text-center">
          {t("share.error")}
        </h1>
        <Link
          href="/"
          className="mt-8 font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors"
        >
          {t("share.poweredBy")}
        </Link>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col overflow-hidden font-sans">
      {/* Header — project title + metadata */}
      <header className="border-b border-[#1C1C1C]/10 px-6 md:px-12 py-4 md:py-6 flex items-start justify-between gap-6 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/50 font-sans border border-[#1C1C1C]/20 px-2 py-0.5">
              {t("share.readOnly")}
            </span>
            {project.venue && (
              <span className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-sans">
                {project.venue}
                {project.year ? ` · ${project.year}` : ""}
              </span>
            )}
            {!project.venue && project.year && (
              <span className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-sans">
                {project.year}
              </span>
            )}
          </div>
          <h1 className="font-serif text-2xl md:text-3xl tracking-tight text-[#1C1C1C] leading-tight">
            {project.title || t("share.untitled")}
          </h1>
          {authors && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C]/60">
              {t("share.by")} {authors}
            </p>
          )}
        </div>
      </header>

      {/* Canvas — read-only React Flow */}
      <main className="flex-1 relative overflow-hidden bg-[#F9F8F6]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          className="bg-[#F9F8F6]"
        >
          <Background
            color="#1C1C1C"
            gap={24}
            size={1}
            className="opacity-10"
          />
          <Controls
            className="!bg-[#F9F8F6] !border-[#1C1C1C]/10 !fill-[#1C1C1C] !shadow-none !rounded-none"
            showInteractive={false}
          />
        </ReactFlow>

        {/* Powered by Cosmos */}
        <div className="absolute bottom-4 right-6 z-10">
          <Link
            href="/"
            className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
          >
            {t("share.poweredBy")}
          </Link>
        </div>
      </main>
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
        <div className="w-screen h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col items-center justify-center">
          <LoadingScreen message="Loading..." />
        </div>
      }
    >
      <SharePageContent params={params} />
    </Suspense>
  );
}
