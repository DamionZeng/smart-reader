"use client";

import { useEffect, useRef } from "react";
import type { Core, EventObject, LayoutOptions } from "cytoscape";
import type { ConceptGraph } from "@/types/concept-graph";
import { buildElements, buildStylesheet } from "./styles";

interface ConceptGraphCanvasProps {
  graph: ConceptGraph;
  onNodeSelect?: (id: string) => void;
  onClusterSelect?: (id: string) => void;
}

/**
 * Cytoscape.js canvas for rendering a ConceptGraph.
 *
 * The cytoscape instance is created once per `graph.id` change (full
 * teardown + re-init). A separate effect handles incremental element
 * updates when concepts / edges / clusters change without a graph-id
 * swap, so filter / highlight operations don't trigger a full layout.
 *
 * SSR safety: cytoscape + layout extensions are dynamically imported
 * inside useEffect so the component can be server-rendered without
 * touching `window`.
 */
export function ConceptGraphCanvas({
  graph,
  onNodeSelect,
  onClusterSelect,
}: ConceptGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  // Keep the latest callbacks + graph data in refs so the init effect
  // (which only re-runs on graph.id) always reads fresh values.
  const callbacksRef = useRef({ onNodeSelect, onClusterSelect });
  const graphRef = useRef(graph);

  useEffect(() => {
    callbacksRef.current = { onNodeSelect, onClusterSelect };
  }, [onNodeSelect, onClusterSelect]);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  // ── Init / destroy cytoscape — only on graph.id change ─────────
  useEffect(() => {
    let destroyed = false;
    let cy: Core | null = null;

    async function init() {
      const cytoscape = (await import("cytoscape")).default;
      const fcose = (await import("cytoscape-fcose")).default;
      const cola = (await import("cytoscape-cola")).default;

      if (destroyed || !containerRef.current) return;

      // Register layout extensions (idempotent)
      try {
        cytoscape.use(fcose);
      } catch {
        // already registered
      }
      try {
        cytoscape.use(cola);
      } catch {
        // already registered
      }

      const currentGraph = graphRef.current;

      cy = cytoscape({
        container: containerRef.current,
        elements: buildElements(currentGraph),
        style: buildStylesheet(currentGraph),
        layout: {
          name: "fcose",
          animate: true,
          animationDuration: 800,
          nodeRepulsion: 4500,
          idealEdgeLength: 100,
          edgeElasticity: 0.45,
          gravity: 0.25,
          numIter: 2500,
          padding: 40,
          randomize: true,
          tile: true,
        } as unknown as LayoutOptions,
        minZoom: 0.2,
        maxZoom: 4,
        wheelSensitivity: 0.3,
      });

      cyRef.current = cy;

      // ── Event handlers ────────────────────────────────────────

      // Tap a concept node → onNodeSelect; tap a compound parent → onClusterSelect
      cy.on("tap", "node", (evt: EventObject) => {
        const node = evt.target;
        if (node.isParent()) {
          const rawId = node.id();
          const clusterId = rawId.startsWith("cluster-")
            ? rawId.slice("cluster-".length)
            : rawId;
          callbacksRef.current.onClusterSelect?.(clusterId);
        } else {
          callbacksRef.current.onNodeSelect?.(node.id());
        }
      });

      // Zoom handler: toggle .show-label based on zoom threshold
      const updateLabels = () => {
        if (!cy) return;
        const zoom = cy.zoom();
        if (zoom > 0.5) {
          cy.nodes().addClass("show-label");
        } else {
          cy.nodes().removeClass("show-label");
        }
      };

      cy.on("zoom", updateLabels);
      cy.on("ready", updateLabels);
    }

    init();

    return () => {
      destroyed = true;
      if (cy) {
        cy.destroy();
      }
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.id]);

  // ── Incremental element updates (same graph, changed data) ─────
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.elements().remove();
    cy.add(buildElements(graph));
    cy.style(buildStylesheet(graph));

    cy.layout({
      name: "fcose",
      animate: true,
      animationDuration: 400,
      nodeRepulsion: 4500,
      idealEdgeLength: 100,
      edgeElasticity: 0.45,
      gravity: 0.25,
      numIter: 1500,
      padding: 40,
      randomize: false,
      tile: true,
    } as unknown as LayoutOptions).run();
  }, [graph.concepts, graph.edges, graph.clusters, graph]);

  return <div ref={containerRef} className="w-full h-full" />;
}
