"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTranslation } from "react-i18next";
import "@/i18n";

import { ConceptGraphNode } from "@/components/Nodes/ConceptGraphNode";
import { ClusterGroupNode } from "@/components/Nodes/ClusterGroupNode";
import { ShortestStraightEdge } from "@/components/Edges/ShortestStraightEdge";
import { LoadingScreen } from "@/components/LoadingScreen";
import { conceptGraphToParsedDocument, extractClusterLegend } from "@/utils/concept-graph-bridge";
import { clusterForceDirectedLayout, filterIsolatedNodes, markMainNode } from "@/utils/auto-layout";
import { buildEdge } from "@/utils/edge-style";
import type { ConceptGraph } from "@/types/concept-graph";
import type { DocumentEdge } from "@/types";
import { Network, ArrowRight } from "lucide-react";

const nodeTypes = {
  "concept-graph": ConceptGraphNode,
  "cluster-group": ClusterGroupNode,
};

const edgeTypes = {
  // Custom edge: straight line with endpoints on the source/target
  // circle perimeters (instead of a shared handle). See
  // ShortestStraightEdge.tsx for the full rationale.
  shortest: ShortestStraightEdge,
};

/**
 * P2-3: Global knowledge graph panel for the dashboard.
 *
 * Aggregates every concept graph the user has generated across all
 * projects into a single merged view. Concepts with the same label
 * across different articles collapse into one node (Obsidian-style),
 * so the graph literally "builds up" as the user imports more papers.
 *
 * Interactions:
 *  - Hover a node → neighbors highlight, everything else fades to 20%
 *  - Click a node → navigate to that concept's source article (/board?id=...)
 *  - Click a cluster circle → focus that cluster (zoom + fade non-members)
 *  - Legend at bottom-left → toggle cluster visibility / locate cluster
 *
 * This is a read-only view: no editing, no auto-save, no force-param
 * tuning. Those live on the board page.
 */
function GlobalKnowledgeGraphInner({ refreshKey }: { refreshKey: number }) {
  const { t } = useTranslation();
  const router = useRouter();

  const [graph, setGraph] = useState<ConceptGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [clusterLegend, setClusterLegend] = useState<
    { id: string; label: string; color: string; count: number }[]
  >([]);
  const [clusterCenters, setClusterCenters] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [hiddenClusterIds, setHiddenClusterIds] = useState<Set<string>>(new Set());
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  // ----- Fetch the global graph on mount and when refreshKey changes -----
  // `refreshKey` lets the parent (dashboard) trigger a re-fetch after
  // mutations that change the underlying data (e.g. deleting a project)
  // without forcing a full-page reload. The whole panel re-renders
  // from a single network round-trip.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/concept-graph/global")
      .then(async (res) => {
        if (!res.ok) {
          // Surface non-OK responses instead of silently returning null
          // so the user sees an error message instead of an empty panel.
          const text = await res.text().catch(() => "");
          console.error(
            `[global-kg] fetch returned ${res.status} ${res.statusText}`,
            text
          );
          throw new Error(
            res.status === 401
              ? "Authentication required"
              : `Failed to load global graph (${res.status})`
          );
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data?.graph && Array.isArray(data.graph.concepts) && data.graph.concepts.length > 0) {
          setGraph(data.graph as ConceptGraph);
        } else {
          // No concept graphs in DB — set null so the render branch
          // shows the "import your first article" hint instead of
          // silently disappearing.
          setGraph(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[global-kg] fetch failed:", err);
          setError(err.message || "Failed to load global graph");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // ----- Layout: run force-directed layout when graph arrives -----
  useEffect(() => {
    if (!graph) return;

    // Bridge: ConceptGraph → ParsedDocument
    const parsed = conceptGraphToParsedDocument(graph);

    // Dedupe nodes by id (the KG generator + the global merge can both
    // emit duplicates — first occurrence wins, per project memory).
    const seenIds = new Set<string>();
    const uniqueNodes = parsed.nodes.filter((n) => {
      if (seenIds.has(n.id)) return false;
      seenIds.add(n.id);
      return true;
    });

    // Convert to React Flow node shape + apply edge styling.
    const flowNodes: Node[] = uniqueNodes.map((n) => ({
      id: n.id,
      type: "concept-graph",
      position: n.position,
      data: n.data,
      draggable: false,
      selectable: true,
    }));
    const flowEdges: Edge[] = parsed.edges.map((e) => buildEdge(e as DocumentEdge));

    // Drop isolated nodes (degree 0), then mark the single highest-
    // degree node as the "main" hub so the renderer can apply a
    // distinct accent color. Then run the two-stage cluster layout:
    // each document becomes a big background circle containing its
    // concepts, matching the Obsidian "one circle per note" look.
    const { nodes: connectedNodes, edges: connectedEdges } = filterIsolatedNodes(flowNodes, flowEdges);
    const markedNodes = markMainNode(connectedNodes);
    const { nodes: positionedNodes, clusterGroups } = clusterForceDirectedLayout(markedNodes, connectedEdges, {
      width: 1700,
      height: 1200,
    });

    // P2-2: inject staggered entrance delay by importance rank so
    // high-importance nodes appear first (timeline animation).
    const sortedByImportance = [...positionedNodes].sort(
      (a, b) =>
        ((b.data as Record<string, unknown>)?.importance as number ?? 0) -
        ((a.data as Record<string, unknown>)?.importance as number ?? 0)
    );
    const delayMap = new Map<string, number>();
    sortedByImportance.forEach((n, idx) => {
      delayMap.set(n.id, Math.min(idx * 30, 2000));
    });
    const withDelay = positionedNodes.map((n) => ({
      ...n,
      data: {
        ...(n.data as Record<string, unknown>),
        entranceDelay: delayMap.get(n.id) ?? 0,
      },
    }));

    // Cluster-group nodes (document big circles) render below concept
    // nodes. Their zIndex is set inside clusterForceDirectedLayout.
    setNodes([...clusterGroups, ...withDelay]);
    setEdges(connectedEdges);
    setClusterLegend(extractClusterLegend(parsed));

    // Derive cluster centers from the cluster-group node positions
    // so the legend's "pan to cluster" still works.
    const centers: Record<string, { x: number; y: number }> = {};
    for (const cg of clusterGroups) {
      const radius = (cg.data as Record<string, unknown>)?.radius as number ?? 90;
      centers[cg.id] = {
        x: cg.position.x + radius,
        y: cg.position.y + radius,
      };
    }
    setClusterCenters(centers);
  }, [graph]);

  // ----- Hover neighbor set (Obsidian-style) -----
  const hoverNeighborIds = useMemo(() => {
    if (!hoveredNodeId) return null;
    const ids = new Set<string>([hoveredNodeId]);
    for (const e of edges) {
      if (e.source === hoveredNodeId) ids.add(e.target);
      else if (e.target === hoveredNodeId) ids.add(e.source);
    }
    return ids;
  }, [hoveredNodeId, edges]);

  // ----- Derived visible nodes (filter + hover + cluster hide) -----
  const visibleNodes = useMemo(() => {
    const filtered =
      hiddenClusterIds.size === 0
        ? nodes
        : nodes.filter((n) => {
            if (n.type === "cluster-group") {
              return !hiddenClusterIds.has(n.id);
            }
            const cid = (n.data as Record<string, unknown> | undefined)?.clusterId as
              | string
              | undefined;
            return !cid || !hiddenClusterIds.has(cid);
          });

    if (!hoverNeighborIds) {
      // Strip stale hover flags when no node is hovered.
      return filtered.map((n) => {
        const d = n.data as Record<string, unknown> | undefined;
        if (d && (d.isHoverNeighbor || d.isFaded || d.isHovered)) {
          const { isHoverNeighbor: _h, isFaded: _f, isHovered: _hd, ...rest } = d;
          return { ...n, data: { ...rest, isHoverNeighbor: false, isFaded: false, isHovered: false } };
        }
        return n;
      });
    }

    return filtered.map((n) => {
      if (n.type === "cluster-group") {
        return {
          ...n,
          data: {
            ...(n.data as Record<string, unknown>),
            isHoverNeighbor: false,
            isFaded: false,
            isHovered: false,
          },
        };
      }
      return {
        ...n,
        data: {
          ...(n.data as Record<string, unknown>),
          isHovered: n.id === hoveredNodeId,
          isHoverNeighbor: hoverNeighborIds.has(n.id) && n.id !== hoveredNodeId,
          isFaded: !hoverNeighborIds.has(n.id),
        },
      };
    });
  }, [nodes, hiddenClusterIds, hoverNeighborIds, hoveredNodeId]);

  const visibleEdges = useMemo(() => {
    // First, filter out edges connected to hidden cluster nodes.
    let result = edges;
    if (hiddenClusterIds.size > 0) {
      const hiddenNodeIds = new Set<string>();
      for (const n of nodes) {
        if (n.type === "cluster-group") {
          if (hiddenClusterIds.has(n.id)) hiddenNodeIds.add(n.id);
          continue;
        }
        const cid = (n.data as Record<string, unknown> | undefined)?.clusterId as
          | string
          | undefined;
        if (cid && hiddenClusterIds.has(cid)) hiddenNodeIds.add(n.id);
      }
      result = edges.filter(
        (e) => !hiddenNodeIds.has(e.source) && !hiddenNodeIds.has(e.target)
      );
    }

    // Then, highlight edges connected to the hovered node. We do NOT
    // change the stroke color or boost opacity to 0.9 — that would
    // make hovered edges look like a different "type" of edge.
    // Instead we keep the original color/opacity and nudge the width
    // up by a hair (1.2×, capped at 1.5px). The contrast comes mostly
    // from dimming non-incident edges to 8% opacity, not from making
    // highlighted edges very thick.
    if (!hoveredNodeId) return result;
    return result.map((e) => {
      const isHighlighted = e.source === hoveredNodeId || e.target === hoveredNodeId;
      if (isHighlighted) {
        const baseW = typeof e.style?.strokeWidth === "number" ? e.style.strokeWidth : 1;
        return {
          ...e,
          style: {
            ...e.style,
            strokeWidth: Math.min(baseW * 1.2, 1.5),
          },
        };
      }
      return {
        ...e,
        style: {
          ...e.style,
          strokeOpacity: 0.08,
        },
      };
    });
  }, [nodes, edges, hiddenClusterIds, hoveredNodeId]);

  // ----- Handlers -----
  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      // P2-3: clicking a concept node navigates to its source article.
      // Cluster-group nodes are not clickable here (they're decorative).
      if (node.type === "cluster-group") return;
      const sourceDocs = (node.data as Record<string, unknown> | undefined)
        ?.sourceDocuments as Array<{ id: string; title: string }> | undefined;
      if (sourceDocs && sourceDocs.length > 0) {
        router.push(`/board?id=${sourceDocs[0].id}`);
      }
    },
    [router]
  );

  const handleToggleCluster = useCallback((clusterId: string) => {
    setHiddenClusterIds((prev) => {
      const next = new Set(prev);
      if (next.has(clusterId)) next.delete(clusterId);
      else next.add(clusterId);
      return next;
    });
  }, []);

  const handleLocateCluster = useCallback(
    (clusterId: string) => {
      if (!rfInstance) return;
      const center = clusterCenters[clusterId];
      if (!center) return;
      rfInstance.setCenter(center.x, center.y, { zoom: 1.2, duration: 500 });
    },
    [rfInstance, clusterCenters]
  );

  // ----- Render -----
  if (loading) {
    return (
      <section className="mb-12 border-t border-[#1C1C1C]/10 pt-8">
        <p className="text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 font-sans font-semibold mb-6">
          {t("dashboard.globalGraph")}
        </p>
        <div className="h-[480px] border border-[#1C1C1C]/10 bg-[#F9F8F6]">
          <LoadingScreen message={t("dashboard.globalGraphLoading")} />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mb-12 border-t border-[#1C1C1C]/10 pt-8">
        <p className="text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 font-sans font-semibold mb-6">
          {t("dashboard.globalGraph")}
        </p>
        <div className="h-[480px] border border-[#1C1C1C]/10 p-8 text-center flex items-center justify-center">
          <p className="font-sans text-sm text-[#1C1C1C]/60">{error}</p>
        </div>
      </section>
    );
  }

  if (!graph) {
    // No concept graphs exist yet — show a hint card explaining the
    // user needs to import an article and run the KG pipeline first.
    // Returning null here would make the panel silently disappear,
    // which looks like a bug (or like mock data is missing).
    return (
      <section className="mb-12 border-t border-[#1C1C1C]/10 pt-8">
        <p className="text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 font-sans font-semibold mb-6">
          {t("dashboard.globalGraph")}
        </p>
        <div className="h-[240px] border border-[#1C1C1C]/10 bg-[#F9F8F6] flex items-center justify-center px-8">
          <div className="text-center">
            <Network className="w-6 h-6 mx-auto mb-3 text-[#1C1C1C]/30" />
            <p className="font-sans text-sm text-[#1C1C1C]/60 mb-1">
              {t("dashboard.globalGraphEmpty")}
            </p>
            <p className="font-sans text-xs text-[#1C1C1C]/40">
              {t("dashboard.globalGraphEmptyHint")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-12 border-t border-[#1C1C1C]/10 pt-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 font-sans font-semibold mb-2">
            {t("dashboard.globalGraph")}
          </p>
          <p className="font-sans text-sm text-[#1C1C1C]/60 flex items-center gap-2">
            <Network className="w-3.5 h-3.5" />
            {t("dashboard.globalGraphHint")}
            <ArrowRight className="w-3 h-3 opacity-40" />
          </p>
        </div>
        <div className="font-mono text-[10px] text-[#1C1C1C]/40 uppercase tracking-wider">
          {graph.concepts.length} {t("dashboard.concepts")} ·{" "}
          {graph.edges.length} {t("dashboard.links")}
        </div>
      </div>

      {/* Canvas */}
      <div className="h-[480px] border border-[#1C1C1C]/10 bg-[#F9F8F6] relative overflow-hidden">
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onNodeMouseEnter={(_e, node) => {
            if (node.type !== "cluster-group") setHoveredNodeId(node.id);
          }}
          onNodeMouseLeave={() => setHoveredNodeId(null)}
          onInit={setRfInstance}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.15}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
        >
          <Background color="#1C1C1C" gap={24} size={1} className="!opacity-[0.04]" />
          <Controls
            className="!bg-[#F9F8F6] !border-[#1C1C1C]/20 !shadow-none"
            showInteractive={false}
          />
        </ReactFlow>
      </div>
    </section>
  );
}

/**
 * Exported wrapper that mounts the ReactFlowProvider so the inner
 * component (and ConceptGraphNode's `useViewport()` call) have access
 * to the flow context.
 *
 * `refreshKey`: increment this to trigger a re-fetch of the global
 * graph without remounting the panel (e.g. after deleting a project).
 */
export function GlobalKnowledgeGraph({ refreshKey = 0 }: { refreshKey?: number }) {
  return (
    <ReactFlowProvider>
      <GlobalKnowledgeGraphInner refreshKey={refreshKey} />
    </ReactFlowProvider>
  );
}
