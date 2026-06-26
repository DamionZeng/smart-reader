"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  addEdge,
  type Connection,
  type OnConnect,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import "@/i18n";

import { ParsedDocument, DocumentNode, DocumentEdge } from "@/types";
import { normaliseGraph } from "@/utils/graph-normalize";
import { exportAndDownload } from "@/utils/export-markdown";
import type { ExportFormat } from "@/utils/export-markdown";
import { exportGraphAsImage } from "@/utils/export-image";
import { autoLayout, applyLayoutTemplate, clusterForceDirectedLayout, simpleForceDirectedLayout, filterIsolatedNodes, markMainNode, type LayoutTemplate, type ForceParams, DEFAULT_FORCE_PARAMS } from "@/utils/auto-layout";
import { pickFirstString } from "@/utils/string";
import { buildEdge } from "@/utils/edge-style";
import {
  getProject,
  saveProject,
} from "@/api/project";
import { Sidebar } from "@/components/board/Sidebar";
import { ExplanationPanel } from "@/components/board/ExplanationPanel";
import { ConceptNode } from "@/components/Nodes/ConceptNode";
import { ConceptGraphNode } from "@/components/Nodes/ConceptGraphNode";
import { ClusterGroupNode } from "@/components/Nodes/ClusterGroupNode";
import { ShortestStraightEdge } from "@/components/Edges/ShortestStraightEdge";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SaveIndicator, SaveStatus } from "@/components/board/SaveIndicator";
import { OriginalTextPanel } from "@/components/board/OriginalTextPanel";
import { QAPanel } from "@/components/board/QAPanel";
import { AIErrorBoundary } from "@/components/errors/AIErrorBoundary";
import { HistoryPanel } from "@/components/board/HistoryPanel";
import { EdgeEditorModal } from "@/components/board/EdgeEditorModal";
import { EdgeTypeLegend } from "@/components/board/EdgeTypeLegend";
import { LayoutMenu } from "@/components/board/LayoutMenu";
import { ForceSettingsPanel } from "@/components/board/ForceSettingsPanel";
import { createVersion } from "@/api/versions";
import { conceptGraphToParsedDocument } from "@/utils/concept-graph-bridge";
import type { ConceptGraph, Concept, ConceptEdge, ConceptCluster } from "@/types/concept-graph";
import { ArrowRight, Undo2, Redo2, FileText, MessageCircle, Image as ImageIcon, History as HistoryIcon, Network } from "lucide-react";

const nodeTypes = {
  concept: ConceptNode,
  "concept-graph": ConceptGraphNode,
  "cluster-group": ClusterGroupNode,
};

const edgeTypes = {
  // Custom edge: straight line with endpoints on the source/target
  // circle perimeters (instead of a shared handle). See
  // ShortestStraightEdge.tsx for the full rationale.
  shortest: ShortestStraightEdge,
};

// Auto-save tuning
const AUTOSAVE_DEBOUNCE_MS = 800;
const PERIODIC_SAVE_INTERVAL_MS = 30_000;
// Version history tuning
const VERSION_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Module-level cache of last snapshot timestamp per project
const lastSnapshotAt = new Map<string, number>();

function maybeSnapshotVersion(
  projectId: string,
  nodes: DocumentNode[],
  edges: DocumentEdge[]
) {
  const now = Date.now();
  const last = lastSnapshotAt.get(projectId) ?? 0;
  if (now - last < VERSION_SNAPSHOT_INTERVAL_MS) return;
  lastSnapshotAt.set(projectId, now);
  // Fire-and-forget — failure to snapshot must never break the main save.
  createVersion(projectId, {
    label: "Auto snapshot",
    nodes,
    edges,
  }).catch((err) => {
    console.warn("[version snapshot] failed", err);
    // Roll back the gate so the next save can retry.
    lastSnapshotAt.delete(projectId);
  });
}

function BoardPageInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("id");
  const graphId = searchParams.get("graphId");

  // No id in the URL → this is the import screen, but the import UI
  // now lives at `/import`. Redirect there so the URL bar accurately
  // reflects what the user is looking at. The import page owns the
  // full ingest state machine.
  useEffect(() => {
    if (!projectId && !graphId) {
      router.replace("/import");
    }
  }, [projectId, graphId, router]);

  const [documentContent, setDocumentContent] = useState<ParsedDocument | null>(
    null
  );
  /** Editable title — synced from the document on load, mutated by the Sidebar input. */
  const [editableTitle, setEditableTitle] = useState<string>("");
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showOriginalText, setShowOriginalText] = useState(false);
  const [showQA, setShowQA] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // P0: Obsidian-style hover neighbor highlight. `hoveredNodeId` is the
  // node currently under the cursor; we compute its neighbor ids from
  // `edges` and inject `isHoverNeighbor` / `isFaded` into node data.
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  // P0: anchor text to highlight in OriginalTextPanel when a concept
  // node is clicked (locates the concept back in the source text).
  const [highlightText, setHighlightText] = useState<string | null>(null);
  const [editingEdge, setEditingEdge] = useState<DocumentEdge | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  // Tracks whether the *title* has unsaved changes (Sidebar's manual-save
  // button highlight is driven purely by this — canvas auto-save does not
  // count as "dirty" for the sidebar button).
  const [hasTitleChanges, setHasTitleChanges] = useState(false);

  // Knowledge-graph pipeline state. This powers the "Re-generate KG"
  // button in the toolbar; the import flow itself lives at /import and
  // is no longer driven by this page.
  const [isGeneratingKG, setIsGeneratingKG] = useState(false);
  const [kgJobId, setKgJobId] = useState<string | null>(null);
  const [kgProgress, setKgProgress] = useState<{ step: string; current: number; total: number } | null>(null);
  const [kgError, setKgError] = useState<string | null>(null);
  const [clusterLegend, setClusterLegend] = useState<{ id: string; label: string; color: string; count: number }[]>([]);

  // 当前加载的知识图谱 ID（用于保存到 conceptGraphs 表）
  const [kgGraphId, setKgGraphId] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Cluster visibility / locator state. `hiddenClusterIds` is the set of
  // cluster IDs the user has toggled off (everything else is visible by
  // default). `clusterCenters` maps clusterId -> flow-space {x,y} of the
  // cluster's bounding-circle center, used to pan/zoom the viewport when
  // a user clicks a row in the legend.
  const [hiddenClusterIds, setHiddenClusterIds] = useState<Set<string>>(new Set());
  const [clusterCenters, setClusterCenters] = useState<Record<string, { x: number; y: number }>>({});
  // P1-2: user-tunable d3-force parameters. Persisted in component state
  // only (not the DB) — they're a per-session view tweak. Re-running the
  // layout when they change is handled by `handleApplyForceParams`.
  const [forceParams, setForceParams] = useState<ForceParams>({ ...DEFAULT_FORCE_PARAMS });
  // P2-1: cluster focus mode. When set, the corresponding cluster-group
  // node is highlighted and non-member concept nodes are faded. Clicking
  // the cluster-group node again, pressing Escape, or clicking empty
  // canvas resets this to null.
  const [focusedClusterId, setFocusedClusterId] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialNodesRef = useRef<Node[]>([]);
  const initialEdgesRef = useRef<Edge[]>([]);
  const skipNextSaveRef = useRef(true);
  const projectIdRef = useRef<string | null>(projectId);
  // Set to true immediately before the isActive-only setNodes call so the
  // auto-save effect can detect and skip saves triggered purely by the
  // active-node highlight changing (M-14).
  const skipActiveStateSaveRef = useRef(false);
  // Canvas (nodes/edges) is the only thing that auto-saves.
  // The title is strictly manual-save territory and uses its own ref.
  const isCanvasDirtyRef = useRef(false);
  const isTitleDirtyRef = useRef(false);
  const isSavingRef = useRef(false);
  // Tracks whether a save was requested while another was in-flight.
  // When the current save finishes, we flush a follow-up save to pick up
  // any changes that happened during the in-flight request — this is the
  // key mechanism that prevents lost writes when the user drags quickly.
  const pendingSaveRef = useRef(false);
  // Knowledge-graph id + clusters — used by performSave to persist edits
  // back to the conceptGraphs table.
  const kgGraphIdRef = useRef<string | null>(null);
  const kgClustersRef = useRef<ConceptCluster[]>([]);
  projectIdRef.current = projectId;

  /** Resolved on every render so save callbacks see the latest values. */
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const editableTitleRef = useRef(editableTitle);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  editableTitleRef.current = editableTitle;

  // P0: set of node ids that are direct neighbors of the hovered node.
  // Recomputed whenever the hover target or the edge list changes. When
  // no node is hovered this is `null` and no fade/highlight is applied.
  const hoverNeighborIds = useMemo(() => {
    if (!hoveredNodeId) return null;
    const ids = new Set<string>([hoveredNodeId]);
    for (const e of edges) {
      if (e.source === hoveredNodeId) ids.add(e.target);
      else if (e.target === hoveredNodeId) ids.add(e.source);
    }
    return ids;
  }, [hoveredNodeId, edges]);

  // P2-1: cluster focus toggle. Clicking a cluster-group node focuses
  // it (zoom + fade non-members); clicking again unfocuses. Declared
  // before `visibleNodes` because that memo injects this callback into
  // cluster-group node data and lists it in its dependency array.
  const handleFocusCluster = useCallback(
    (clusterId: string) => {
      // Toggle: if already focused, unfocus
      setFocusedClusterId((prev) => (prev === clusterId ? null : clusterId));
      // Zoom to the cluster's bounding-circle center for emphasis
      if (rfInstance) {
        const center = clusterCenters[clusterId];
        if (center) {
          rfInstance.setCenter(center.x, center.y, { zoom: 1.0, duration: 500 });
        }
      }
    },
    [rfInstance, clusterCenters]
  );

  // ----- Cluster visibility filter -----
  // `hiddenClusterIds` carries only the IDs the user has explicitly
  // toggled off; everything else is visible. The underlying `nodes` /
  // `edges` state is untouched so undo/redo and auto-save continue to
  // see the full graph. We just project a filtered view onto ReactFlow.
  // P0: also injects `isHoverNeighbor` / `isFaded` based on the hover
  // state so ConceptGraphNode can render the Obsidian-style highlight.
  // P2-1: also injects `onFocusCluster` + `isFocused` for cluster-group
  // nodes, and fades non-members when a cluster is focused.
  const visibleNodes = useMemo(() => {
    const filtered =
      hiddenClusterIds.size === 0
        ? nodes
        : nodes.filter((n) => {
            if (n.type === "cluster-group") {
              // cluster-group node id IS the cluster id
              return !hiddenClusterIds.has(n.id);
            }
            const cid = (n.data as Record<string, unknown> | undefined)?.clusterId as
              | string
              | undefined;
            return !cid || !hiddenClusterIds.has(cid);
          });

    // P2-1: build the set of node ids that belong to the focused cluster
    // (if any). Used to fade non-members.
    const focusedMemberIds = focusedClusterId
      ? new Set(
          nodes
            .filter((n) => {
              if (n.type === "cluster-group") return n.id === focusedClusterId;
              const cid = (n.data as Record<string, unknown> | undefined)?.clusterId as
                | string
                | undefined;
              return cid === focusedClusterId;
            })
            .map((n) => n.id)
        )
      : null;

    if (!hoverNeighborIds) {
      // No hover active — strip any stale hover flags so nodes render
      // in their default state. Avoids a previously-hovered node staying
      // faded after the cursor leaves.
      return filtered.map((n) => {
        const d = n.data as Record<string, unknown> | undefined;
        // P2-1: inject focus callback + fade for cluster-group nodes
        if (n.type === "cluster-group") {
          return {
            ...n,
            data: {
              ...(d || {}),
              isHoverNeighbor: false,
              isFaded: focusedMemberIds ? !focusedMemberIds.has(n.id) : false,
              isFocused: n.id === focusedClusterId,
              onFocusCluster: handleFocusCluster,
            },
          };
        }
        // P2-1: concept node — fade if a cluster is focused AND this
        // node isn't a member of it
        const clusterFaded = focusedMemberIds ? !focusedMemberIds.has(n.id) : false;
        if (d && (d.isHoverNeighbor || d.isFaded || d.isHovered || clusterFaded)) {
          const { isHoverNeighbor: _h, isFaded: _f, isHovered: _hd, ...rest } = d;
          return {
            ...n,
            data: {
              ...rest,
              isHoverNeighbor: false,
              isFaded: clusterFaded,
              isHovered: false,
            },
          };
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
            isFaded: focusedMemberIds ? !focusedMemberIds.has(n.id) : false,
            isFocused: n.id === focusedClusterId,
            onFocusCluster: handleFocusCluster,
          },
        };
      }
      const clusterFaded = focusedMemberIds ? !focusedMemberIds.has(n.id) : false;
      return {
        ...n,
        data: {
          ...(n.data as Record<string, unknown>),
          isHovered: n.id === hoveredNodeId,
          isHoverNeighbor: hoverNeighborIds.has(n.id) && n.id !== hoveredNodeId,
          isFaded: clusterFaded || !hoverNeighborIds.has(n.id),
        },
      };
    });
  }, [nodes, hiddenClusterIds, hoverNeighborIds, hoveredNodeId, focusedClusterId, handleFocusCluster]);

  const visibleEdges = useMemo(() => {
    // First, filter out edges connected to hidden cluster nodes.
    let result = edges;
    if (hiddenClusterIds.size > 0) {
      const hiddenNodeIds = new Set<string>();
      for (const n of nodes) {
        if (n.type === "cluster-group") {
          if (hiddenClusterIds.has(n.id)) {
            hiddenNodeIds.add(n.id);
          }
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

    // Highlight edges connected to the hovered node (Obsidian-style
    // spotlight). Keep original color/opacity; nudge width by a hair
    // (1.2×, capped at 1.5px). Non-incident edges dimmed to ~8%.
    if (!hoveredNodeId) return result;
    return result.map((e) => {
      const isHighlighted = e.source === hoveredNodeId || e.target === hoveredNodeId;
      if (isHighlighted) {
        const baseW = e.style?.strokeWidth ?? 1;
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

  /**
   * Extract the cluster id from a node (cluster-group or concept).
   * Returns `null` for nodes that don't belong to a cluster.
   *
   * Note: the cluster-group node's id IS the cluster id (e.g. "cluster-0");
   * it is NOT a prefixed form. So we return `n.id` directly for
   * cluster-group nodes.
   */
  const getClusterIdForNode = useCallback(
    (n: Node | undefined): string | null => {
      if (!n) return null;
      if (n.type === "cluster-group") {
        return n.id;
      }
      return ((n.data as Record<string, unknown> | undefined)?.clusterId as
        | string
        | undefined) ?? null;
    },
    []
  );

  /**
   * Wrapped `onNodesChange` for `<ReactFlow>`. Filters out any
   * `remove` change that targets a node currently hidden by the cluster
   * filter — those removals come from the prop being re-applied (because
   * we pass `visibleNodes` to ReactFlow) and must NOT mutate the
   * underlying full `nodes` state. Without this guard the filter would
   * either permanently destroy the hidden nodes, or — more subtly —
   * fire the auto-save effect on every toggle.
   */
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      if (hiddenClusterIds.size === 0) {
        onNodesChange(changes);
        return;
      }
      const safe = changes.filter((c) => {
        if (c.type !== "remove") return true;
        const cid = getClusterIdForNode(
          nodesRef.current.find((n) => n.id === c.id)
        );
        return !cid || !hiddenClusterIds.has(cid);
      });
      if (safe.length > 0) onNodesChange(safe);
    },
    [onNodesChange, hiddenClusterIds, getClusterIdForNode]
  );

  /**
   * Wrapped `onEdgesChange` — same idea as `handleNodesChange`. Strips
   * `remove` changes for edges that connect to nodes currently hidden
   * by the cluster filter, so the prop re-application from the filter
   * never mutates `edges` state (and therefore never triggers auto-save).
   */
  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      if (hiddenClusterIds.size === 0) {
        onEdgesChange(changes);
        return;
      }
      const safe = changes.filter((c) => {
        if (c.type !== "remove") return true;
        const edge = edgesRef.current.find((e) => e.id === c.id);
        if (!edge) return true;
        const srcCid = getClusterIdForNode(
          nodesRef.current.find((n) => n.id === edge.source)
        );
        const tgtCid = getClusterIdForNode(
          nodesRef.current.find((n) => n.id === edge.target)
        );
        const hiddenSrc = srcCid !== null && hiddenClusterIds.has(srcCid);
        const hiddenTgt = tgtCid !== null && hiddenClusterIds.has(tgtCid);
        return !hiddenSrc && !hiddenTgt;
      });
      if (safe.length > 0) onEdgesChange(safe);
    },
    [onEdgesChange, hiddenClusterIds, getClusterIdForNode]
  );

  /**
   * Compute the canvas-space center of each cluster-group node, then
   * store it in `clusterCenters` state for the legend's "click to
   * locate" action. Called after every (re)layout that produced new
   * cluster-group nodes.
   */
  const syncClusterCenters = useCallback((clusterGroups: Node[]) => {
    const map: Record<string, { x: number; y: number }> = {};
    for (const g of clusterGroups) {
      const cid = g.id.replace(/^cluster-/, "");
      const radius =
        ((g.data as Record<string, unknown> | undefined)?.radius as number) ?? 0;
      map[cid] = { x: g.position.x + radius, y: g.position.y + radius };
    }
    setClusterCenters(map);
  }, []);

  // ----- Undo/Redo history -----
  // Snapshots of { nodes, edges } taken before each structural mutation
  // (drag-stop, add, delete, connect, edit, auto-layout). Position-only
  // changes during a drag are NOT snapshotted — only the pre-drag state
  // is committed via onNodeDragStart.
  const [past, setPast] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [future, setFuture] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const MAX_HISTORY = 50;

  const snapshot = useCallback((): { nodes: Node[]; edges: Edge[] } => {
    return {
      nodes: nodesRef.current.map((n) => ({
        ...n,
        position: { ...n.position },
        data: { ...n.data },
      })),
      edges: edgesRef.current.map((e) => ({ ...e })),
    };
  }, []);

  /** Push the current state to the past stack and clear redo. Call BEFORE a mutation. */
  const commit = useCallback(() => {
    setPast((prev) => [...prev.slice(-(MAX_HISTORY - 1)), snapshot()]);
    setFuture([]);
  }, [snapshot]);

  const undo = useCallback(() => {
    setPast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const previous = prevPast[prevPast.length - 1];
      const current = snapshot();
      setFuture((prevFuture) => [current, ...prevFuture].slice(0, MAX_HISTORY));
      setNodes(previous.nodes);
      setEdges(previous.edges);
      return prevPast.slice(0, -1);
    });
  }, [snapshot, setNodes, setEdges]);

  const redo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const next = prevFuture[0];
      const current = snapshot();
      setPast((prevPast) => [...prevPast, current].slice(-MAX_HISTORY));
      setNodes(next.nodes);
      setEdges(next.edges);
      return prevFuture.slice(1);
    });
  }, [snapshot, setNodes, setEdges]);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  // ----- Project load on mount -----
  // We only LOAD here. Creating a new project is deferred until the user
  // actually submits the ingestion form, so an existing empty project
  // (id in URL, no nodes yet) does not get pushed back to the import page.
  useEffect(() => {
    if (!projectId) {
      // No id in the URL → nothing to load. The full-page import UI will
      // be shown by the render branch below.
      setDocumentContent(null);
      setEditableTitle("");
      setNodes([]);
      setEdges([]);
      initialNodesRef.current = [];
      initialEdgesRef.current = [];
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    const run = async () => {
      try {
        const project = await getProject(projectId);
        if (cancelled) return;

        // Look up an existing knowledge graph for this project. The
        // board now defaults to the KG view; the document outline is
        // no longer rendered on the canvas.
        const kgResp = await fetch(`/api/concept-graph/by-document/${projectId}`);
        if (!kgResp.ok) throw new Error(`Failed to fetch KG (${kgResp.status})`);
        const { graph } = await kgResp.json();
        if (cancelled) return;

        setEditableTitle(project.title || "");
        setLastSavedAt(null);
        isCanvasDirtyRef.current = false;
        isTitleDirtyRef.current = false;
        setHasTitleChanges(false);

        if (graph) {
          // KG exists — bridge to ParsedDocument and render with
          // force-directed layout + cluster colours.
          const conceptGraph = graph as ConceptGraph;
          const parsed = conceptGraphToParsedDocument(conceptGraph);
          if (parsed.nodes.length === 0) {
            throw new Error("This knowledge graph has no concepts to display.");
          }
          setDocumentContent(parsed);
          setClusterLegend(
            (parsed as ParsedDocument & { clusters?: { id: string; label: string; colorName: string; conceptIds: string[] }[] })
              .clusters?.map((c) => ({
                id: c.id,
                label: c.label || c.id,
                color: ["slate","rust","olive","navy","plum","teal","umber","moss"].includes(c.colorName)
                  ? { slate:"#1C1C1C", rust:"#A0522D", olive:"#6B8E23", navy:"#1C2B4B", plum:"#5D3A5D", teal:"#2F5D5D", umber:"#6B4226", moss:"#4A5D23" }[c.colorName] || "#1C1C1C"
                  : "#1C1C1C",
                count: c.conceptIds.length,
              })) || []
          );
          setKgGraphId(conceptGraph.id);
          kgGraphIdRef.current = conceptGraph.id;
          kgClustersRef.current = conceptGraph.clusters || [];

          let flowNodes: Node[] = parsed.nodes.map((n) => ({
            id: n.id,
            type: "concept-graph" as const,
            position: n.position,
            data: { ...n.data, isActive: false },
          }));
          // P2-2: staggered entrance animation. Sort a copy by
          // importance (desc) and assign delays in 30ms increments so
          // high-importance nodes appear first, creating a "graph
          // builds up" timeline effect. Cap total at ~2s.
          const sortedByImportance = [...flowNodes].sort((a, b) => {
            const ia = ((a.data as Record<string, unknown>)?.importance as number) ?? 0;
            const ib = ((b.data as Record<string, unknown>)?.importance as number) ?? 0;
            return ib - ia;
          });
          const delayMap = new Map<string, number>();
          sortedByImportance.forEach((n, i) => {
            delayMap.set(n.id, Math.min(i * 30, 2000));
          });
          flowNodes = flowNodes.map((n) => ({
            ...n,
            data: {
              ...(n.data as Record<string, unknown>),
              entranceDelay: delayMap.get(n.id) ?? 0,
            },
          }));
          const flowEdges: Edge[] = parsed.edges.map((e) => buildEdge(e));
          // No cluster layer: filter isolated nodes, mark main hub,
          // run single-stage force layout (unified mesh).
          const { nodes: connectedNodes, edges: connectedEdges } = filterIsolatedNodes(flowNodes, flowEdges);
          const markedNodes = markMainNode(connectedNodes);
          const positionedNodes = simpleForceDirectedLayout(markedNodes, connectedEdges, {
            width: 1700,
            height: 1200,
          });
          initialNodesRef.current = positionedNodes;
          initialEdgesRef.current = connectedEdges;
          setNodes(positionedNodes);
          setEdges(connectedEdges);
          // Fit view after layout so the graph is centered and visible
          setTimeout(() => rfInstance?.fitView({ padding: 0.25, duration: 400 }), 100);
        } else {
          // No KG yet — set up minimal document content (rawText/title
          // for the Original Text panel) and auto-trigger generation.
          setDocumentContent({
            id: projectId,
            title: project.title || "",
            type: "paper",
            rawText: project.rawText || "",
            nodes: [],
            edges: [],
          });
          setClusterLegend([]);
          setKgGraphId(null);
          kgGraphIdRef.current = null;
          kgClustersRef.current = [];
          setNodes([]);
          setEdges([]);
          initialNodesRef.current = [];
          initialEdgesRef.current = [];
          // Fire-and-forget: the polling effect will populate the
          // canvas when the pipeline finishes.
          handleGenerateKnowledgeGraph();
        }
        // Skip the first auto-save that fires from re-mounting state.
        skipNextSaveRef.current = true;
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load project");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ----- Perform the actual save -----
  const performSave = useCallback(async (force: boolean) => {
    const id = projectIdRef.current;
    if (!id) return;
    if (!force && !isCanvasDirtyRef.current && !isTitleDirtyRef.current) return;

    // If a save is already in-flight, queue a follow-up instead of
    // dropping the request. The follow-up reads from refs, so it will
    // always persist the latest state — this is what prevents the race
    // where rapid drags cause an earlier PATCH to overwrite a later one.
    if (isSavingRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    isSavingRef.current = true;
    setSaveStatus("saving");

    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const currentTitle = editableTitleRef.current;
    const kgId = kgGraphIdRef.current;

    try {
      if (kgId) {
        // ----- Save to conceptGraphs table -----
        // Convert React Flow nodes/edges back to Concept[]/ConceptEdge[]
        // so the KG row stays canonical.
        const concepts: Concept[] = currentNodes.map((n) => {
          const data = (n.data ?? {}) as Record<string, unknown>;
          return {
            id: n.id,
            label: pickFirstString(data.title, data.label) || "",
            type: (typeof data.conceptType === "string"
              ? (data.conceptType as Concept["type"])
              : "term") as Concept["type"],
            aliases: Array.isArray(data.aliases) ? (data.aliases as string[]) : [],
            frequency: typeof data.frequency === "number" ? data.frequency : 1,
            importance: typeof data.importance === "number" ? data.importance : 0.5,
            clusterId: typeof data.clusterId === "string" ? data.clusterId : "",
            description: pickFirstString(data.description) || undefined,
            anchors: Array.isArray(data.anchors) ? (data.anchors as string[]) : [],
          };
        });
        const conceptEdges: ConceptEdge[] = currentEdges.map((e) => {
          const data = (e.data ?? {}) as Record<string, unknown>;
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            type: "co-occurs" as ConceptEdge["type"],
            weight: typeof data.weight === "number" ? data.weight : 1,
            evidence: [],
            confidence: 1,
          };
        });
        const resp = await fetch(`/api/concept-graph/${kgId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            concepts,
            edges: conceptEdges,
            clusters: kgClustersRef.current,
            title: currentTitle,
          }),
        });
        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          throw new Error(errBody.error || `Failed to save KG (${resp.status})`);
        }
      } else {
        // ----- Fallback: save to projects table -----
        const payloadNodes: DocumentNode[] = currentNodes.map((n) => {
          const data = (n.data ?? {}) as Record<string, unknown>;
          // Be defensive: if a node was authored with a non-canonical field
          // (e.g. `content` or `name`), still save the value under the
          // canonical key so the rendered output never goes blank.
          const title = pickFirstString(
            data.title,
            data.name,
            data.label
          );
          const description = pickFirstString(
            data.description,
            data.content,
            data.summary
          );
          const sourceContext = pickFirstString(data.sourceContext);
          const details = pickFirstString(data.details);
          const note = pickFirstString(data.note);
          const section =
            typeof data.section === "string" ? data.section : undefined;
          return {
            id: n.id,
            type: (n.type as DocumentNode["type"]) || "concept",
            ...(section ? { section: section as DocumentNode["section"] } : {}),
            position: n.position,
            data: {
              title,
              description,
              sourceContext: sourceContext || undefined,
              details: details || undefined,
              ...(note ? { note } : {}),
            },
          };
        });
        const payloadEdges: DocumentEdge[] = currentEdges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: typeof e.label === "string" ? e.label : undefined,
          type: e.type as string | undefined,
        }));
        await saveProject(id, {
          nodes: payloadNodes,
          edges: payloadEdges,
          title: currentTitle,
        });
        // Version history: snapshot every 10 minutes (project saves only).
        maybeSnapshotVersion(id, payloadNodes, payloadEdges);
      }
      isCanvasDirtyRef.current = false;
      isTitleDirtyRef.current = false;
      setHasTitleChanges(false);
      setLastSavedAt(new Date());
      setSaveStatus("saved");
      // Sync the canonical title in documentContent after a successful save.
      setDocumentContent((prev) =>
        prev && prev.title !== currentTitle
          ? { ...prev, title: currentTitle }
          : prev
      );
      // Auto-revert to idle so "Saved Xm ago" can take over.
      setTimeout(() => {
        setSaveStatus((prev) => (prev === "saved" ? "idle" : prev));
      }, 1500);
    } catch (err) {
      console.error("Save failed", err);
      setSaveStatus("error");
    } finally {
      isSavingRef.current = false;
      // Flush any save that was queued while we were busy. We use
      // force=true because isCanvasDirtyRef may have been cleared by
      // the save that just finished, but new changes arrived during it.
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        // Defer to the next tick to avoid deep recursion and let React
        // commit any pending state updates first.
        setTimeout(() => performSave(true), 0);
      }
    }
  }, []);

  // ----- Debounced auto-save — only triggered by canvas (nodes/edges) changes.
  // Title edits intentionally do NOT enter this effect: the Sidebar is a
  // strictly manual-save surface and the user must press the Save button
  // to persist the title.
  useEffect(() => {
    if (!projectIdRef.current) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    // M-14: When the only change was the isActive highlight (set by the
    // activeNodeId effect below), skip the auto-save entirely. We still
    // do a data comparison so that real changes batched in the same
    // render cycle are not lost.
    if (skipActiveStateSaveRef.current) {
      skipActiveStateSaveRef.current = false;
      const onlyActiveChanged =
        edges === initialEdgesRef.current &&
        nodes.length === initialNodesRef.current.length &&
        nodes.every((n, i) => {
          const prev = initialNodesRef.current[i];
          if (!prev || n.id !== prev.id) return false;
          if (n.position !== prev.position) return false;
          const { isActive: _a, ...nData } = (n.data ?? {}) as Record<string, unknown>;
          const { isActive: _b, ...prevData } = (prev.data ?? {}) as Record<string, unknown>;
          return JSON.stringify(nData) === JSON.stringify(prevData);
        });
      if (onlyActiveChanged) {
        // Sync the ref so subsequent reference-equality checks work.
        initialNodesRef.current = nodes;
        return;
      }
    }
    if (
      nodes === initialNodesRef.current &&
      edges === initialEdgesRef.current
    ) {
      return;
    }
    isCanvasDirtyRef.current = true;
    setSaveStatus("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      performSave(false);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [nodes, edges, performSave]);

  // ----- Periodic auto-save every 30s (canvas-only — never fires for title) -----
  useEffect(() => {
    const interval = setInterval(() => {
      if (
        isCanvasDirtyRef.current &&
        projectIdRef.current &&
        !isSavingRef.current
      ) {
        performSave(false);
      }
    }, PERIODIC_SAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [performSave]);

  // ----- Flush any pending save on unmount -----
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ----- Title handlers -----
  // The Sidebar is a manual-save surface: editing the title only marks
  // the document as dirty and surfaces the "Unsaved changes" indicator
  // — it does NOT schedule any debounce / periodic auto-save.
  const handleTitleChange = useCallback((next: string) => {
    setEditableTitle(next);
    isTitleDirtyRef.current = true;
    setHasTitleChanges(true);
  }, []);

  const handleTitleCommit = useCallback(() => {
    // Intentionally a no-op. The user must press the Save button
    // (or trigger any canvas change) to persist the title.
  }, []);

  // ----- Manual save handler (also used by the Save button) -----
  const handleManualSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    performSave(true);
  }, [performSave]);

  // ----- Import a previously-exported JSON graph file -----
  const handleImportJson = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.nodes || !Array.isArray(data.nodes) || !data.edges || !Array.isArray(data.edges)) {
        throw new Error("Invalid graph JSON format");
      }
      const graph = normaliseGraph(data, projectIdRef.current || "", "paper");
      setDocumentContent(graph);
      setEditableTitle(graph.title || "Imported Project");

      const flowNodes: Node[] = graph.nodes.map((n) => ({
        id: n.id,
        type: "concept-graph" as const,
        position: n.position || { x: 0, y: 0 },
        data: { ...n.data, isActive: false },
      }));
      const flowEdges: Edge[] = graph.edges.map((e) => buildEdge(e));
      setNodes(flowNodes);
      setEdges(flowEdges);
    } catch (err) {
      console.error("Import JSON failed", err);
      alert(err instanceof Error ? err.message : "Failed to import JSON");
    }
  }, [setNodes, setEdges]);

  // ----- Knowledge-graph generation -----
  // Triggers the 7-step concept-graph pipeline (async job), polls for
  // completion, then replaces the canvas with the concept-co-occurrence
  // network rendered with force-directed layout + cluster colors.
  const handleGenerateKnowledgeGraph = useCallback(async () => {
    const id = projectIdRef.current;
    if (!id) return;
    setIsGeneratingKG(true);
    setKgError(null);
    setKgProgress({ step: "queued", current: 0, total: 7 });
    try {
      // Trigger the pipeline via the concept-graph ingest API.
      // We pass the existing project's rawText by re-using the file/URL
      // the user originally submitted. Since we don't have the original
      // file handy, we send the project id and let the API fetch rawText
      // from the documents table.
      const resp = await fetch("/api/concept-graph/ingest", {
        method: "POST",
        body: (() => {
          const fd = new FormData();
          fd.append("type", "paper");
          fd.append("projectId", id);
          return fd;
        })(),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Failed to start pipeline (${resp.status})`);
      }
      const { jobId } = await resp.json();
      if (!jobId) throw new Error("No job id returned");
      setKgJobId(jobId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate knowledge graph";
      setKgError(msg);
      setIsGeneratingKG(false);
      setKgProgress(null);
    }
  }, []);

  // Poll the KG job status until done/failed
  useEffect(() => {
    if (!kgJobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/concept-graph/jobs/${kgJobId}`);
        if (!r.ok) throw new Error(`Job poll failed (${r.status})`);
        const job = await r.json();
        if (cancelled) return;
        setKgProgress(job.progress);
        if (job.status === "done" && job.graphId) {
          // Fetch the generated concept graph
          const gr = await fetch(`/api/concept-graph/${job.graphId}`);
          if (!gr.ok) throw new Error("Failed to fetch generated graph");
          const { graph } = await gr.json();
          const conceptGraph = graph as ConceptGraph;
          // Bridge to ParsedDocument
          const parsed = conceptGraphToParsedDocument(conceptGraph);
          if (parsed.nodes.length === 0) {
            throw new Error("Knowledge graph generated 0 concepts. The source text may be too short or the LLM failed to extract concepts.");
          }
          setDocumentContent(parsed);
          setClusterLegend(
            (parsed as ParsedDocument & { clusters?: { id: string; label: string; colorName: string; conceptIds: string[] }[] })
              .clusters?.map((c) => ({
                id: c.id,
                label: c.label || c.id,
                color: ["slate","rust","olive","navy","plum","teal","umber","moss"].includes(c.colorName)
                  ? { slate:"#1C1C1C", rust:"#A0522D", olive:"#6B8E23", navy:"#1C2B4B", plum:"#5D3A5D", teal:"#2F5D5D", umber:"#6B4226", moss:"#4A5D23" }[c.colorName] || "#1C1C1C"
                  : "#1C1C1C",
                count: c.conceptIds.length,
              })) || []
          );
          // Track the KG id + clusters so subsequent edits auto-save
          // back to the conceptGraphs table.
          setKgGraphId(job.graphId);
          kgGraphIdRef.current = job.graphId;
          kgClustersRef.current = conceptGraph.clusters || [];
          // Build React Flow nodes with concept-graph type + cluster layout
          let flowNodes: Node[] = parsed.nodes.map((n) => ({
            id: n.id,
            type: "concept-graph" as const,
            position: n.position,
            data: { ...n.data, isActive: false },
          }));
          // P2-2: staggered entrance animation (same as initial load)
          const sortedByImportance = [...flowNodes].sort((a, b) => {
            const ia = ((a.data as Record<string, unknown>)?.importance as number) ?? 0;
            const ib = ((b.data as Record<string, unknown>)?.importance as number) ?? 0;
            return ib - ia;
          });
          const delayMap = new Map<string, number>();
          sortedByImportance.forEach((n, i) => {
            delayMap.set(n.id, Math.min(i * 30, 2000));
          });
          flowNodes = flowNodes.map((n) => ({
            ...n,
            data: {
              ...(n.data as Record<string, unknown>),
              entranceDelay: delayMap.get(n.id) ?? 0,
            },
          }));
          const flowEdges: Edge[] = parsed.edges.map((e) => buildEdge(e));
          // No cluster layer: filter isolated, mark main, single-stage layout.
          const { nodes: connectedNodes, edges: connectedEdges } = filterIsolatedNodes(flowNodes, flowEdges);
          const markedNodes = markMainNode(connectedNodes);
          const positionedNodes = simpleForceDirectedLayout(markedNodes, connectedEdges, {
            width: 1700,
            height: 1200,
          });
          setNodes(positionedNodes);
          setEdges(connectedEdges);
          initialNodesRef.current = positionedNodes;
          initialEdgesRef.current = connectedEdges;
          syncClusterCenters([]);
          setHiddenClusterIds(new Set());
          // Fit view after layout so the graph is centered and visible
          setTimeout(() => rfInstance?.fitView({ padding: 0.25, duration: 400 }), 100);
          // The KG is now the editable surface — do NOT skip auto-save.
          // Just mark the canvas as clean so the freshly-loaded state
          // does not trigger an immediate re-save.
          isCanvasDirtyRef.current = false;
          setIsGeneratingKG(false);
          setKgJobId(null);
          // We are already on /board?id=… — the import flow happens at
          // /import and navigates here on success. There is no need to
          // re-issue router.replace; doing so would briefly unmount the
          // canvas and cause a flash of the LoadingScreen.
        } else if (job.status === "failed") {
          throw new Error(job.error || "Pipeline failed");
        } else if (job.status === "done" && !job.graphId) {
          // Job marked done but no graph was produced — treat as error
          // so the user is not left polling forever.
          throw new Error("Pipeline completed but produced no graph.");
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Pipeline error";
        setKgError(msg);
        setIsGeneratingKG(false);
        setKgJobId(null);
        setKgProgress(null);
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [kgJobId, setNodes, setEdges]);

  // ----- Auto-layout: run dagre and update node positions -----
  const handleAutoLayout = useCallback(() => {
    commit();
    const conceptNodes = nodesRef.current.filter((n) => n.type !== "cluster-group");
    const laidOut = autoLayout(conceptNodes, edgesRef.current, "TB");
    setNodes(laidOut);
    setTimeout(() => rfInstance?.fitView({ padding: 0.3, duration: 400 }), 100);
  }, [setNodes, commit, rfInstance]);

  // ----- Apply a named layout template -----
  const handleApplyTemplate = useCallback((template: LayoutTemplate) => {
    commit();
    const conceptNodes = nodesRef.current.filter((n) => n.type !== "cluster-group");
    if (template === "force") {
      const positionedNodes = simpleForceDirectedLayout(
        conceptNodes,
        edgesRef.current,
        { width: 1700, height: 1200, params: forceParams }
      );
      setNodes(positionedNodes);
      setTimeout(() => rfInstance?.fitView({ padding: 0.3, duration: 400 }), 100);
    } else {
      const laidOut = applyLayoutTemplate(conceptNodes, edgesRef.current, template);
      setNodes(laidOut);
      setTimeout(() => rfInstance?.fitView({ padding: 0.3, duration: 400 }), 100);
    }
  }, [setNodes, commit, rfInstance, forceParams]);

  // ----- Re-run the force layout with updated parameters -----
  // Called when the user drags a slider in ForceSettingsPanel. We
  // rebuild the layout from the current concept nodes + edges and let
  // the simulation run with the new params. fitView is debounced so
  // rapid slider drags don't cause visual jitter.
  const handleApplyForceParams = useCallback((next: ForceParams) => {
    setForceParams(next);
    const conceptNodes = nodesRef.current.filter((n) => n.type !== "cluster-group");
    if (conceptNodes.length === 0) return;
    const positionedNodes = simpleForceDirectedLayout(
      conceptNodes,
      edgesRef.current,
      { width: 1700, height: 1200, params: next }
    );
    setNodes(positionedNodes);
    setTimeout(() => rfInstance?.fitView({ padding: 0.3, duration: 300 }), 60);
  }, [setNodes, rfInstance]);

  // ----- Export the current graph as a PNG image -----
  const handleExportImage = useCallback(async () => {
    try {
      const safeName = (editableTitle || "project")
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      await exportGraphAsImage(safeName || "project");
    } catch (err) {
      console.error("Failed to export image", err);
      alert(t("board.exportImageError"));
    }
  }, [editableTitle, t]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent | React.TouchEvent, node: Node) => {
      setActiveNodeId(node.id);
      // P0: locate the concept back in the source text.
      //
      // We pass BOTH the title (short, high-signal — used for the
      // primary highlight match) and the first anchor (the verbatim
      // source sentence — used as a fallback + for scroll positioning).
      // The OriginalTextPanel's highlighter tries title first because
      // anchors are often long sentences split across HTML text nodes
      // by <span>/<mark> boundaries, which defeats indexOf(). Title
      // is a single noun phrase that almost always sits inside one
      // text node.
      const data = (node.data ?? {}) as Record<string, unknown>;
      const anchors = Array.isArray(data.anchors) ? (data.anchors as string[]) : [];
      const title = typeof data.title === "string" ? data.title : "";
      const aliases = Array.isArray(data.aliases) ? (data.aliases as string[]) : [];
      const firstAnchor = anchors.find((a) => typeof a === "string" && a.trim().length > 0) || "";

      // Build a composite payload: title is the primary match target,
      // aliases + firstAnchor are fallbacks the highlighter can try if
      // the title doesn't appear verbatim.
      const candidates = [title, ...aliases, firstAnchor].filter(
        (s) => typeof s === "string" && s.trim().length >= 2
      );
      if (candidates.length > 0) {
        setHighlightText(candidates.join("\u0001")); // unit separator as delimiter
        setShowOriginalText(true);
      }
    },
    []
  );

  // P0: hover neighbor highlight handlers. Reset on mouse leave so the
  // graph returns to its default state when the cursor exits the canvas.
  const handleNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "concept-graph") setHoveredNodeId(node.id);
    },
    []
  );
  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  // ----- Connect nodes: create a new edge (defaults to "relates") -----
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      commit();
      const newEdge: DocumentEdge = {
        id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
        source: connection.source ?? "",
        target: connection.target ?? "",
        edgeType: "relates",
      };
      setEdges((eds: Edge[]) => [...eds, buildEdge(newEdge)]);
    },
    [setEdges, commit]
  );

  // ----- Create a new node on pane double-click -----
  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      // Only create if we have a project to save into
      if (!projectIdRef.current) return;
      commit();
      const id = `node-new-${Date.now()}`;
      const position = rfInstance
        ? rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        : { x: event.clientX - 150, y: event.clientY - 50 };
      const newNode: Node = {
        id,
        type: "concept-graph",
        position,
        data: {
          title: t("board.newNodeTitle"),
          description: t("board.newNodeDescription"),
          isActive: false,
        },
      };
      setNodes((nds: Node[]) => [...nds, newNode]);
      setActiveNodeId(id);
    },
    [setNodes, t, commit, rfInstance]
  );

  // ----- Delete selected nodes / edges -----
  const handleDeleteSelected = useCallback(() => {
    const selectedNodeIds = nodesRef.current
      .filter((n) => n.selected)
      .map((n) => n.id);
    const selectedEdgeIds = edgesRef.current
      .filter((e) => e.selected)
      .map((e) => e.id);
    if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
    commit();
    if (selectedNodeIds.length > 0) {
      setNodes((nds: Node[]) => nds.filter((n) => !n.selected));
      setEdges((eds: Edge[]) =>
        eds.filter(
          (e) =>
            !e.selected &&
            !selectedNodeIds.includes(e.source) &&
            !selectedNodeIds.includes(e.target)
        )
      );
    } else {
      setEdges((eds: Edge[]) => eds.filter((e) => !e.selected));
    }
    if (activeNodeId && selectedNodeIds.includes(activeNodeId)) {
      setActiveNodeId(null);
    }
  }, [setNodes, setEdges, activeNodeId, commit]);

  // ----- Keyboard shortcuts: Delete/Backspace + Undo/Redo -----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Undo: Ctrl+Z (Cmd+Z on Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      // Redo: Ctrl+Shift+Z or Ctrl+Y (Cmd+Shift+Z on Mac)
      if (
        ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) ||
        ((e.ctrlKey || e.metaKey) && e.key === "y")
      ) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDeleteSelected, undo, redo]);

  // ----- Node drag start: commit pre-drag state for undo -----
  const handleNodeDragStart = useCallback(() => {
    commit();
  }, [commit]);

  // ----- Update node data (title/description/note) from ExplanationPanel -----
  const handleUpdateNodeData = useCallback(
    (nodeId: string, patch: { title?: string; description?: string; note?: string }) => {
      commit();
      setNodes((nds: Node[]) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, ...patch } }
            : n
        )
      );
      // Also update documentContent so ExplanationPanel sees fresh data
      setDocumentContent((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          nodes: prev.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, ...patch } }
              : n
          ),
        };
      });
    },
    [setNodes, commit]
  );

  React.useEffect(() => {
    // M-14: Flag that the upcoming setNodes is only updating isActive so
    // the auto-save effect can skip it.
    skipActiveStateSaveRef.current = true;
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isActive: n.id === activeNodeId,
        },
      }))
    );
  }, [activeNodeId, setNodes]);

  const activeNodeData = useMemo(() => {
    if (!activeNodeId || !documentContent) return null;
    return documentContent.nodes.find((n) => n.id === activeNodeId) || null;
  }, [activeNodeId, documentContent]);

  if (isLoading) {
    // Loading happens only on project hydration. The user is never stuck
    // on the import page here — that flow lives at /import.
    return (
      <div className="w-screen h-screen bg-[#F9F8F6] text-[#1C1C1C] flex flex-col items-center justify-center">
        <LoadingScreen message={t("board.loading")} />
      </div>
    );
  }

  // ----- No project id → redirect to /import -----
  // The useEffect at the top of the component fires `router.replace`
  // when both `projectId` and `graphId` are missing. We briefly render
  // nothing here to avoid a flash of the canvas before the redirect
  // takes effect.
  if (!projectId && !graphId) {
    return null;
  }

  // ----- Project is loaded → render the KG canvas -----

  return (
    <div className="w-screen h-screen bg-[#F9F8F6] text-[#1C1C1C] flex overflow-hidden font-sans select-none">
      <Sidebar
        document={documentContent}
        activeNodeId={activeNodeId}
        onSelectNode={setActiveNodeId}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        title={editableTitle}
        onTitleChange={handleTitleChange}
        onTitleCommit={handleTitleCommit}
        onSave={handleManualSave}
        onImport={() => {
          // Import now lives on its own route so the import state machine
          // (which is heavy with async polling + abort controllers) is
          // owned by a dedicated page instead of the canvas view.
          router.push("/import");
        }}
        onImportJson={handleImportJson}
        onExport={(format: ExportFormat) => {
          if (!documentContent) return;
          const safeName = (editableTitle || "project")
            .replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase();
          exportAndDownload(
            format,
            safeName || "project",
            editableTitle || "Untitled Project",
            documentContent.nodes,
            documentContent.edges
          );
        }}
        isSaving={saveStatus === "saving"}
        isDirty={hasTitleChanges}
      />

      <main className="flex-1 relative flex overflow-hidden bg-[#F9F8F6]">
        {showOriginalText && documentContent?.rawText && (
          <OriginalTextPanel
            rawText={documentContent.rawText}
            highlightText={highlightText}
            onClose={() => {
              setShowOriginalText(false);
              setHighlightText(null);
            }}
          />
        )}
        {showQA && projectId && (
          <AIErrorBoundary
            context="qa"
            onDismiss={() => setShowQA(false)}
            onRetry={() => window.location.reload()}
          >
            <QAPanel
              projectId={projectId}
              onClose={() => setShowQA(false)}
            />
          </AIErrorBoundary>
        )}

        <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onNodeClick={handleNodeClick}
            onNodeMouseEnter={handleNodeMouseEnter}
            onNodeMouseLeave={handleNodeMouseLeave}
            onEdgeClick={(_evt, edge) => {
              const de: DocumentEdge = {
                id: edge.id,
                source: edge.source,
                target: edge.target,
                label: typeof edge.label === "string" ? edge.label : undefined,
                type: edge.type as string | undefined,
                edgeType: (edge.data?.edgeType as DocumentEdge["edgeType"]) ?? "relates",
                note: (edge.data?.note as string) ?? undefined,
              };
              setEditingEdge(de);
            }}
            onConnect={onConnect}
            onNodeDragStart={handleNodeDragStart}
            onDoubleClick={handlePaneDoubleClick}
            onInit={setRfInstance}
            deleteKeyCode={null}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionMode={ConnectionMode.Loose}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
            minZoom={0.15}
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
              position="top-right"
            />
            <Panel position="top-left" className="!mt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={undo}
                  disabled={!canUndo}
                  className="inline-flex items-center justify-center bg-[#F9F8F6] border border-[#1C1C1C]/20 text-[#1C1C1C] font-sans text-[10px] uppercase tracking-[0.2em] px-3 py-2 transition-colors duration-200 hover:border-[#1C1C1C] disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none"
                  title={t("board.undo")}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={redo}
                  disabled={!canRedo}
                  className="inline-flex items-center justify-center bg-[#F9F8F6] border border-[#1C1C1C]/20 text-[#1C1C1C] font-sans text-[10px] uppercase tracking-[0.2em] px-3 py-2 transition-colors duration-200 hover:border-[#1C1C1C] disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none"
                  title={t("board.redo")}
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-6 bg-[#1C1C1C]/10" />
                <LayoutMenu
                  disabled={nodes.length === 0}
                  onAutoLayout={handleAutoLayout}
                  onApplyTemplate={handleApplyTemplate}
                />
                <ForceSettingsPanel
                  params={forceParams}
                  onChange={handleApplyForceParams}
                  disabled={nodes.length === 0}
                />
                <div className="w-px h-6 bg-[#1C1C1C]/10" />
                <button
                  type="button"
                  onClick={() => setShowOriginalText((v) => !v)}
                  disabled={!documentContent?.rawText}
                  className={`inline-flex items-center gap-2 bg-[#F9F8F6] border font-sans text-[10px] uppercase tracking-[0.2em] px-4 py-2 transition-colors duration-200 focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed ${
                    showOriginalText
                      ? "border-[#1C1C1C] text-[#1C1C1C]"
                      : "border-[#1C1C1C]/20 text-[#1C1C1C] hover:border-[#1C1C1C]"
                  }`}
                  title={t("board.originalText")}
                >
                  <FileText className="w-3.5 h-3.5" />
                  {t("board.originalText")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowQA((v) => !v)}
                  disabled={!projectId}
                  className={`inline-flex items-center gap-2 bg-[#F9F8F6] border font-sans text-[10px] uppercase tracking-[0.2em] px-4 py-2 transition-colors duration-200 focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed ${
                    showQA
                      ? "border-[#1C1C1C] text-[#1C1C1C]"
                      : "border-[#1C1C1C]/20 text-[#1C1C1C] hover:border-[#1C1C1C]"
                  }`}
                  title={t("board.askPaper")}
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  {t("board.askPaper")}
                </button>
                <button
                  type="button"
                  onClick={handleExportImage}
                  disabled={nodes.length === 0}
                  className="inline-flex items-center gap-2 bg-[#F9F8F6] border border-[#1C1C1C]/20 text-[#1C1C1C] font-sans text-[10px] uppercase tracking-[0.2em] px-4 py-2 transition-colors duration-200 hover:border-[#1C1C1C] disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none"
                  title={t("board.exportImage")}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  {t("board.exportImage")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowHistory(true)}
                  disabled={!projectId}
                  className="inline-flex items-center gap-2 bg-[#F9F8F6] border border-[#1C1C1C]/20 text-[#1C1C1C] font-sans text-[10px] uppercase tracking-[0.2em] px-4 py-2 transition-colors duration-200 hover:border-[#1C1C1C] disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none"
                  title={t("history.title")}
                >
                  <HistoryIcon className="w-3.5 h-3.5" />
                  {t("history.title")}
                </button>
                <div className="w-px h-6 bg-[#1C1C1C]/10" />
                <button
                  type="button"
                  onClick={handleGenerateKnowledgeGraph}
                  disabled={!projectId || isGeneratingKG}
                  className="inline-flex items-center gap-2 bg-[#1C1C1C] text-[#F9F8F6] border border-[#1C1C1C] font-sans text-[10px] uppercase tracking-[0.2em] px-4 py-2 transition-colors duration-200 hover:bg-transparent hover:text-[#1C1C1C] disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none"
                  title="Generate concept knowledge graph"
                >
                  <Network className="w-3.5 h-3.5" />
                  {isGeneratingKG ? `KG ${kgProgress?.current || 0}/${kgProgress?.total || 7}` : "Knowledge Graph"}
                </button>
                <div className="w-px h-6 bg-[#1C1C1C]/10" />
                <SaveIndicator
                  status={saveStatus}
                  lastSavedAt={lastSavedAt}
                  alwaysShow
                />
              </div>
            </Panel>
            {kgError && (
              <Panel position="top-center" className="!mt-2">
                <div className="bg-[#1C1C1C]/5 border border-[#1C1C1C] px-4 py-2 text-[10px] font-mono text-[#1C1C1C]/80">
                  KG Error: {kgError}
                </div>
              </Panel>
            )}
          </ReactFlow>

        {activeNodeData && (
          <div className="absolute top-0 right-0 h-full z-20 animate-in slide-in-from-right-8 duration-300">
            <AIErrorBoundary
              context="explain"
              onDismiss={() => setActiveNodeId(null)}
            >
              <ExplanationPanel
                node={activeNodeData}
                onClose={() => setActiveNodeId(null)}
                onUpdateNode={handleUpdateNodeData}
              />
            </AIErrorBoundary>
          </div>
        )}

        {showHistory && projectId && (
          <HistoryPanel
            projectId={projectId}
            open={showHistory}
            currentNodes={nodes as unknown as DocumentNode[]}
            currentEdges={edges as unknown as DocumentEdge[]}
            onClose={() => setShowHistory(false)}
            onRollback={(newNodes, newEdges) => {
              setNodes(
                newNodes.map((n) => ({
                  id: n.id,
                  type: n.type,
                  position: n.position,
                  data: { ...n.data, isActive: false },
                })) as unknown as Node[]
              );
              setEdges(
                newEdges.map((e) => ({
                  id: e.id,
                  source: e.source,
                  target: e.target,
                  label: e.label,
                  type: e.type,
                })) as unknown as Edge[]
              );
              initialNodesRef.current = newNodes.map((n) => ({
                id: n.id,
                type: n.type,
                position: n.position,
                data: { ...n.data, isActive: false },
              })) as unknown as Node[];
              initialEdgesRef.current = newEdges.map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                label: e.label,
                type: e.type,
              })) as unknown as Edge[];
              isCanvasDirtyRef.current = false;
              setSaveStatus("saved");
            }}
          />
        )}

        {editingEdge && (
          <EdgeEditorModal
            edge={editingEdge}
            open={!!editingEdge}
            onClose={() => setEditingEdge(null)}
            onSave={(next) => {
              // Take undo snapshot before mutating structure.
              setPast((p) => [...p, snapshot()].slice(-MAX_HISTORY));
              setFuture([]);
              setEdges((prev) =>
                prev.map((e) => {
                  if (e.id !== next.id) return e;
                  const visual = buildEdge(next);
                  return {
                    ...e,
                    label: next.label,
                    type: next.type,
                    animated: visual.animated,
                    style: visual.style,
                    labelStyle: visual.labelStyle,
                    labelBgStyle: visual.labelBgStyle,
                    data: visual.data,
                  } as Edge;
                })
              );
              isCanvasDirtyRef.current = true;
              setSaveStatus("dirty");
              if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
              saveTimerRef.current = setTimeout(() => {
                performSave(false);
              }, AUTOSAVE_DEBOUNCE_MS);
              setEditingEdge(null);
            }}
          />
        )}
      </main>
    </div>
  );
}

export default function BoardPage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen bg-[#F9F8F6] text-[#1C1C1C]">
          <LoadingScreen message="Loading..." />
        </div>
      }
    >
      <BoardPageInner />
    </Suspense>
  );
}
