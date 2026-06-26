import dagre from "@dagrejs/dagre";
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from "d3-force";
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";
import type { Node, Edge } from "@xyflow/react";

const DEFAULT_NODE_WIDTH = 260;
const DEFAULT_NODE_HEIGHT = 160;

export interface AutoLayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
}

export type LayoutTemplate = "tree" | "radial" | "hierarchical" | "compact" | "force";

/**
 * Runs a dagre hierarchical layout on the given nodes and edges.
 * Returns new nodes with updated positions.
 *
 * Node dimensions default to 260×160 but can be overridden via the
 * `options` parameter to match the actual rendered node size.
 */
export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
  options?: AutoLayoutOptions
): Node[] {
  const nodeWidth = options?.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const nodeHeight = options?.nodeHeight ?? DEFAULT_NODE_HEIGHT;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    if (pos) {
      return {
        ...node,
        position: {
          x: pos.x - nodeWidth / 2,
          y: pos.y - nodeHeight / 2,
        },
      };
    }
    return node;
  });
}

/**
 * Applies a named layout template to the graph and returns new nodes with
 * updated positions.
 */
export function applyLayoutTemplate(
  nodes: Node[],
  edges: Edge[],
  template: LayoutTemplate
): Node[] {
  switch (template) {
    case "tree":
      return autoLayout(nodes, edges, "TB");
    case "hierarchical":
      return autoLayout(nodes, edges, "LR");
    case "radial":
      return radialLayout(nodes, edges);
    case "compact":
      return compactLayout(nodes, edges);
    case "force":
      return forceDirectedLayout(nodes, edges);
    default:
      return autoLayout(nodes, edges, "TB");
  }
}

/**
 * Places nodes in concentric circles based on their depth from root nodes.
 * Root nodes (no incoming edges) go in the center.
 */
function radialLayout(nodes: Node[], edges: Edge[]): Node[] {
  const incoming = new Map<string, number>();
  nodes.forEach(n => incoming.set(n.id, 0));
  edges.forEach(e => {
    incoming.set(e.target, (incoming.get(e.target) || 0) + 1);
  });
  const roots = nodes.filter(n => (incoming.get(n.id) || 0) === 0);

  // BFS to assign levels
  const levels = new Map<string, number>();
  roots.forEach(r => levels.set(r.id, 0));
  let queue = [...roots];
  while (queue.length > 0) {
    const next: Node[] = [];
    for (const node of queue) {
      const level = levels.get(node.id) || 0;
      edges.filter(e => e.source === node.id).forEach(e => {
        const target = nodes.find(n => n.id === e.target);
        if (target && !levels.has(target.id)) {
          levels.set(target.id, level + 1);
          next.push(target);
        }
      });
    }
    queue = next;
  }
  // Unconnected nodes go to level 0
  nodes.forEach(n => { if (!levels.has(n.id)) levels.set(n.id, 0); });

  const centerX = 400;
  const centerY = 300;
  const radiusStep = 150;

  const nodesByLevel = new Map<number, Node[]>();
  nodes.forEach(n => {
    const lvl = levels.get(n.id) || 0;
    if (!nodesByLevel.has(lvl)) nodesByLevel.set(lvl, []);
    nodesByLevel.get(lvl)!.push(n);
  });

  const positioned: Node[] = [];
  nodesByLevel.forEach((levelNodes, level) => {
    const radius = level * radiusStep;
    if (radius === 0) {
      // Center
      levelNodes.forEach((n, i) => {
        positioned.push({
          ...n,
          position: { x: centerX + (i - levelNodes.length / 2) * 60, y: centerY },
        });
      });
    } else {
      const angleStep = (2 * Math.PI) / levelNodes.length;
      levelNodes.forEach((n, i) => {
        const angle = i * angleStep;
        positioned.push({
          ...n,
          position: {
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle),
          },
        });
      });
    }
  });
  return positioned;
}

/**
 * Grid layout — simple compact grid.
 */
function compactLayout(nodes: Node[], edges: Edge[]): Node[] {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const spacing = 200;
  return nodes.map((n, i) => ({
    ...n,
    position: {
      x: (i % cols) * spacing,
      y: Math.floor(i / cols) * spacing,
    },
  }));
}

/**
 * Force-directed layout using d3-force.
 *
 * Consumes edge `weight` (via `data.weight`) to control link distance —
 * stronger co-occurrence edges pull nodes closer. Node `data.importance`
 * scales the collision radius so important concepts take more space.
 *
 * Runs synchronously for a fixed number of ticks (300) so it can be
 * called from a non-async layout handler.
 */
export function forceDirectedLayout(
  nodes: Node[],
  edges: Edge[],
  options?: { width?: number; height?: number; ticks?: number }
): Node[] {
  if (nodes.length === 0) return nodes;

  const width = options?.width ?? 1200;
  const height = options?.height ?? 800;
  const ticks = options?.ticks ?? 300;

  // d3-force mutates node objects, so we work on shallow clones.
  interface SimNode extends SimulationNodeDatum {
    id: string;
    importance: number;
  }
  interface SimLink extends SimulationLinkDatum<SimNode> {
    distance: number;
  }

  const simNodes: SimNode[] = nodes.map((n) => ({
    id: n.id,
    x: n.position?.x ?? Math.random() * width,
    y: n.position?.y ?? Math.random() * height,
    importance: ((n.data as Record<string, unknown>)?.importance as number) ?? 0,
  }));

  const simLinks: SimLink[] = edges
    .filter((e) => e.source && e.target)
    .map((e) => {
      const weight = ((e.data as Record<string, unknown>)?.weight as number) ?? 1;
      return {
        source: e.source,
        target: e.target,
        // Higher weight → shorter distance. Clamp to [40, 200].
        distance: Math.max(40, 200 - weight * 20),
      } as SimLink;
    });

  const simulation = forceSimulation<SimNode>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((d) => d.distance)
        .strength(0.3)
    )
    .force("charge", forceManyBody().strength(-300))
    .force("center", forceCenter(width / 2, height / 2))
    .force(
      "collide",
      forceCollide<SimNode>().radius((d) => {
        // Base radius 30, +20 for high-importance nodes.
        return 30 + d.importance * 20;
      })
    )
    .stop();

  // Run synchronously
  for (let i = 0; i < ticks; i++) {
    simulation.tick();
  }

  // Map back to React Flow nodes
  const posMap = new Map<string, { x: number; y: number }>();
  for (const sn of simNodes) {
    posMap.set(sn.id, { x: sn.x ?? 0, y: sn.y ?? 0 });
  }

  return nodes.map((n) => {
    const pos = posMap.get(n.id);
    return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n;
  });
}

/**
 * Cluster-grouped force-directed layout.
 *
 * Runs in two stages so that the final image is compact and user-friendly:
 *
 *   Stage 1 — Node-level simulation
 *     Runs a regular d3-force simulation so that nodes within a cluster
 *     settle close to their centroid (link + charge + collide + cluster
 *     pull + a soft global center).
 *
 *   Stage 2 — Cluster-level simulation
 *     Treats each cluster as a single "super-node" and lays those out on
 *     the canvas with a strong center gravity and mutual repulsion, so
 *     clusters spread evenly and never drift to the corners. After this
 *     stage, every member of a cluster is translated by the cluster's
 *     delta (newCenter − oldCenter), so the intra-cluster shape is
 *     preserved.
 *
 * After both stages the cluster bounding circles are computed and the
 * whole graph is recentered so the bounding box sits at (canvasW/2,
 * canvasH/2) with the user-controlled padding.
 */
/**
 * User-tunable force parameters. Exposed via the "Force settings" panel
 * in the toolbar. All values have sensible defaults that match the
 * pre-tuning behavior, so leaving the panel untouched = same layout
 * as before.
 */
export interface ForceParams {
  /** Repulsion between nodes. More negative = more spread out. -180 default. */
  charge: number;
  /** Target distance for edges. Smaller = tighter clusters. 150 default. */
  linkDistance: number;
  /** Node collision padding. 28 default. */
  collide: number;
  /** Strength of the global centering force. 0.05 default. */
  centerStrength: number;
  /** Strength of the per-cluster pull. 0.2 default. Higher = tighter clusters. */
  clusterPull: number;
}

export const DEFAULT_FORCE_PARAMS: ForceParams = {
  charge: -180,
  linkDistance: 150,
  collide: 28,
  centerStrength: 0.05,
  clusterPull: 0.2,
};

export function clusterForceDirectedLayout(
  nodes: Node[],
  edges: Edge[],
  options?: {
    width?: number;
    height?: number;
    ticks?: number;
    params?: Partial<ForceParams>;
  }
): { nodes: Node[]; clusterGroups: Node[] } {
  if (nodes.length === 0) return { nodes, clusterGroups: [] };

  const width = options?.width ?? 2000;
  const height = options?.height ?? 1400;
  const nodeTicks = Math.floor((options?.ticks ?? 400) * 0.6);
  const clusterTicks = Math.floor((options?.ticks ?? 400) * 0.4);

  // Group nodes by clusterId
  const clusterMap = new Map<string, SimClusterNode[]>();
  interface SimClusterNode extends SimulationNodeDatum {
    id: string;
    importance: number;
    clusterId: string;
  }
  interface SimLink extends SimulationLinkDatum<SimClusterNode> {
    distance: number;
  }

  const simNodes: SimClusterNode[] = nodes.map((n) => {
    const clusterId = ((n.data as Record<string, unknown>)?.clusterId as string) ?? "default";
    return {
      id: n.id,
      x: n.position?.x ?? width / 2 + (Math.random() - 0.5) * width * 0.4,
      y: n.position?.y ?? height / 2 + (Math.random() - 0.5) * height * 0.4,
      importance: ((n.data as Record<string, unknown>)?.importance as number) ?? 0,
      clusterId,
    };
  });

  // Build cluster lookup
  for (const sn of simNodes) {
    const arr = clusterMap.get(sn.clusterId);
    if (arr) arr.push(sn);
    else clusterMap.set(sn.clusterId, [sn]);
  }

  // Compute initial cluster centroids
  const clusterCentroids = new Map<string, { x: number; y: number }>();
  for (const [cid, members] of clusterMap) {
    const cx = members.reduce((s, n) => s + (n.x ?? 0), 0) / members.length;
    const cy = members.reduce((s, n) => s + (n.y ?? 0), 0) / members.length;
    clusterCentroids.set(cid, { x: cx, y: cy });
  }

  const simLinks: SimLink[] = edges
    .filter((e) => e.source && e.target)
    .map((e) => {
      const weight = ((e.data as Record<string, unknown>)?.weight as number) ?? 1;
      const base = options?.params?.linkDistance ?? 150;
      return {
        source: e.source,
        target: e.target,
        distance: Math.max(40, base - weight * 15),
      } as SimLink;
    });

  // Resolve user-tunable params (with defaults so missing fields keep
  // the pre-tuning behavior).
  const chargeStrength = options?.params?.charge ?? -180;
  const collideRadius = options?.params?.collide ?? 28;
  const centerStrength = options?.params?.centerStrength ?? 0.05;
  const clusterPullStrength = options?.params?.clusterPull ?? 0.2;

  // Per-node attraction toward its own cluster centroid.
  function clusterPull(alpha: number) {
    for (const sn of simNodes) {
      const centroid = clusterCentroids.get(sn.clusterId);
      if (!centroid) continue;
      sn.vx = (sn.vx ?? 0) + (centroid.x - (sn.x ?? 0)) * clusterPullStrength * alpha;
      sn.vy = (sn.vy ?? 0) + (centroid.y - (sn.y ?? 0)) * clusterPullStrength * alpha;
    }
  }

  // Recompute cluster centroids from current node positions.
  function updateCentroids() {
    const newCentroids = new Map<string, { x: number; y: number; count: number }>();
    for (const sn of simNodes) {
      const c = newCentroids.get(sn.clusterId) ?? { x: 0, y: 0, count: 0 };
      c.x += sn.x ?? 0;
      c.y += sn.y ?? 0;
      c.count += 1;
      newCentroids.set(sn.clusterId, c);
    }
    for (const [cid, c] of newCentroids) {
      if (c.count > 0) {
        clusterCentroids.set(cid, { x: c.x / c.count, y: c.y / c.count });
      }
    }
  }

  // ===== Stage 1: node-level simulation =====
  const nodeSim = forceSimulation<SimClusterNode>(simNodes)
    .force(
      "link",
      forceLink<SimClusterNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((d) => d.distance)
        .strength(0.2)
    )
    .force("charge", forceManyBody().strength(chargeStrength))
    .force("center", forceCenter(width / 2, height / 2).strength(centerStrength))
    .force(
      "collide",
      forceCollide<SimClusterNode>().radius((d) => collideRadius + d.importance * 18)
    )
    .stop();

  for (let i = 0; i < nodeTicks; i++) {
    const alpha = nodeSim.alpha();
    clusterPull(alpha);
    nodeSim.tick();
    if (i % 10 === 0) updateCentroids();
  }
  updateCentroids();

  // ===== Stage 2: cluster-level simulation =====
  // Each cluster is now a single "super-node". We lay them out so the
  // final image fills the canvas evenly and stays centered.
  interface SimClusterCenter extends SimulationNodeDatum {
    cid: string;
    radius: number;
  }
  const clusterSimNodes: SimClusterCenter[] = [];
  for (const [cid, members] of clusterMap) {
    // Estimate cluster radius from spread of current node positions.
    const centroid = clusterCentroids.get(cid) ?? { x: 0, y: 0 };
    let maxDist = 0;
    for (const m of members) {
      const dx = (m.x ?? 0) - centroid.x;
      const dy = (m.y ?? 0) - centroid.y;
      maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
    }
    const radius = Math.max(maxDist + 55, 90); // padding + label space
    clusterSimNodes.push({
      cid,
      x: centroid.x,
      y: centroid.y,
      radius,
    });
  }

  // Determine a minimum distance so circles don't overlap.
  const minClusterDist =
    clusterSimNodes.reduce((s, c) => s + c.radius, 0) / Math.max(clusterSimNodes.length, 1) * 1.6 + 40;

  const clusterSim = forceSimulation<SimClusterCenter>(clusterSimNodes)
    // Mutually repel so clusters spread out.
    .force("cluster-charge", forceManyBody().strength(-minClusterDist * 6).distanceMax(minClusterDist * 2))
    // Strong center pull so clusters never drift off-canvas.
    .force("cluster-center", forceCenter(width / 2, height / 2).strength(0.25))
    // Hard collision against other clusters.
    .force(
      "cluster-collide",
      forceCollide<SimClusterCenter>().radius((d) => d.radius + 20).strength(1)
    )
    .stop();

  for (let i = 0; i < clusterTicks; i++) {
    clusterSim.tick();
  }

  // Build a map from cluster id to its final center.
  const finalCenters = new Map<string, { x: number; y: number }>();
  for (const cn of clusterSimNodes) {
    finalCenters.set(cn.cid, { x: cn.x ?? 0, y: cn.y ?? 0 });
  }

  // Translate every node by (finalCenter − oldCenter) of its cluster.
  for (const sn of simNodes) {
    const oldCenter = clusterCentroids.get(sn.clusterId);
    const newCenter = finalCenters.get(sn.clusterId);
    if (!oldCenter || !newCenter) continue;
    sn.x = (sn.x ?? 0) + (newCenter.x - oldCenter.x);
    sn.y = (sn.y ?? 0) + (newCenter.y - oldCenter.y);
  }

  // Map positions back to React Flow nodes
  const posMap = new Map<string, { x: number; y: number }>();
  for (const sn of simNodes) {
    posMap.set(sn.id, { x: sn.x ?? 0, y: sn.y ?? 0 });
  }

  const positionedNodes = nodes.map((n) => {
    const pos = posMap.get(n.id);
    return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n;
  });

  // Compute cluster group nodes (big background circles) using the
  // updated positions, then recenter the entire layout to the canvas.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const sn of simNodes) {
    minX = Math.min(minX, sn.x ?? 0);
    minY = Math.min(minY, sn.y ?? 0);
    maxX = Math.max(maxX, sn.x ?? 0);
    maxY = Math.max(maxY, sn.y ?? 0);
  }

  // Compute the radius of each cluster (re-derived after the move).
  const clusterRadius = new Map<string, number>();
  for (const [cid, members] of clusterMap) {
    const centroid = finalCenters.get(cid) ?? { x: 0, y: 0 };
    let maxDist = 0;
    for (const m of members) {
      const dx = (m.x ?? 0) - centroid.x;
      const dy = (m.y ?? 0) - centroid.y;
      maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
    }
    const radius = Math.max(maxDist + 55, 90);
    clusterRadius.set(cid, radius);
    minX = Math.min(minX, centroid.x - radius);
    minY = Math.min(minY, centroid.y - radius);
    maxX = Math.max(maxX, centroid.x + radius);
    maxY = Math.max(maxY, centroid.y + radius);
  }

  // Recenter the entire layout so the bounding box is centered on the canvas.
  const bboxCx = (minX + maxX) / 2;
  const bboxCy = (minY + maxY) / 2;
  const offsetX = width / 2 - bboxCx;
  const offsetY = height / 2 - bboxCy;

  const finalPosMap = new Map<string, { x: number; y: number }>();
  for (const [id, pos] of posMap) {
    finalPosMap.set(id, { x: pos.x + offsetX, y: pos.y + offsetY });
  }

  const finalPositionedNodes = positionedNodes.map((n) => {
    const pos = finalPosMap.get(n.id);
    return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n;
  });

  // Build cluster group nodes using the recentered positions.
  const clusterGroups: Node[] = [];
  for (const [cid, members] of clusterMap) {
    if (cid === "default" && members.length === 0) continue;

    const centroid = finalCenters.get(cid) ?? { x: 0, y: 0 };
    const recenteredCentroid = {
      x: centroid.x + offsetX,
      y: centroid.y + offsetY,
    };
    const radius = clusterRadius.get(cid) ?? 90;

    const firstMember = nodes.find((n) => n.id === members[0]?.id);
    const clusterColor =
      (firstMember?.data as Record<string, unknown>)?.clusterColor as string ?? "#1C1C1C";
    const clusterLabel = (firstMember?.data as Record<string, unknown>)?.clusterLabel as string ?? "";

    clusterGroups.push({
      // Use the cluster id directly (e.g. "cluster-0"). The pipeline
      // already produces ids in this form, so adding a "cluster-" prefix
      // here would produce "cluster-cluster-0" and desync from the
      // legend, the locator map, and the filter state.
      id: cid,
      type: "cluster-group",
      position: {
        x: recenteredCentroid.x - radius,
        y: recenteredCentroid.y - radius,
      },
      data: {
        label: clusterLabel,
        color: clusterColor,
        radius,
        conceptCount: members.length,
      },
      selectable: false,
      draggable: false,
      zIndex: 0,
    } as Node);
  }

  // Set concept nodes zIndex above cluster groups
  const nodesWithZ = finalPositionedNodes.map((n) => ({
    ...n,
    zIndex: 10,
  }));

  return { nodes: nodesWithZ, clusterGroups };
}
