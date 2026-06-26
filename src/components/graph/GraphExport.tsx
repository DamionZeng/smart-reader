"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ChevronDown } from "lucide-react";
import type { ConceptGraph } from "@/types/concept-graph";
import { cn } from "@/utils/cn";

interface GraphExportProps {
  graphId: string;
  graph: ConceptGraph;
}

const EXPORT_FORMATS = [
  { value: "json", label: "JSON" },
  { value: "graphml", label: "GraphML" },
  { value: "png", label: "PNG" },
  { value: "svg", label: "SVG" },
] as const;

type ExportFormat = (typeof EXPORT_FORMATS)[number]["value"];

/**
 * Trigger a client-side file download with the given content.
 */
function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Sanitise a string for use as a filename.
 */
function safeFilename(input: string): string {
  return (
    input
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "concept-graph"
  );
}

/**
 * Build a simple GraphML XML representation of the concept graph.
 */
function buildGraphML(graph: ConceptGraph): string {
  const escapeXml = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">');
  lines.push('  <key id="label" for="node" attr.name="label" attr.type="string"/>');
  lines.push('  <key id="type" for="node" attr.name="type" attr.type="string"/>');
  lines.push('  <key id="importance" for="node" attr.name="importance" attr.type="double"/>');
  lines.push('  <key id="clusterId" for="node" attr.name="clusterId" attr.type="string"/>');
  lines.push('  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>');
  lines.push('  <key id="type" for="edge" attr.name="type" attr.type="string"/>');
  lines.push('  <graph id="' + escapeXml(graph.id) + '" edgedefault="undirected">');

  for (const concept of graph.concepts) {
    lines.push(`    <node id="${escapeXml(concept.id)}">`);
    lines.push(`      <data key="label">${escapeXml(concept.label)}</data>`);
    lines.push(`      <data key="type">${escapeXml(concept.type)}</data>`);
    lines.push(`      <data key="importance">${concept.importance}</data>`);
    lines.push(`      <data key="clusterId">${escapeXml(concept.clusterId)}</data>`);
    lines.push(`    </node>`);
  }

  for (const edge of graph.edges) {
    lines.push(
      `    <edge id="${escapeXml(edge.id)}" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}">`
    );
    lines.push(`      <data key="weight">${edge.weight}</data>`);
    lines.push(`      <data key="type">${escapeXml(edge.type)}</data>`);
    lines.push(`    </edge>`);
  }

  lines.push("  </graph>");
  lines.push("</graphml>");
  return lines.join("\n");
}

/**
 * Dropdown menu for exporting the concept graph in various formats.
 *
 * JSON and GraphML are generated client-side and downloaded immediately.
 * PNG and SVG are placeholders (they require access to the cytoscape
 * instance, which is managed by the parent canvas component).
 */
export function GraphExport({ graphId, graph }: GraphExportProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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

  const handleExport = (format: ExportFormat) => {
    const baseName = safeFilename(graph.title || graphId);

    if (format === "json") {
      const json = JSON.stringify(graph, null, 2);
      downloadFile(`${baseName}.json`, json, "application/json");
    } else if (format === "graphml") {
      const xml = buildGraphML(graph);
      downloadFile(`${baseName}.graphml`, xml, "application/xml");
    } else if (format === "png") {
      // PNG export requires the cytoscape instance — placeholder
      console.warn("PNG export requires access to the cytoscape instance.");
    } else if (format === "svg") {
      // SVG export requires the cytoscape instance — placeholder
      console.warn("SVG export requires access to the cytoscape instance.");
    }

    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Export graph"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-[#1C1C1C] bg-[#F9F8F6] text-[#1C1C1C] hover:bg-[#1C1C1C] hover:text-[#F9F8F6] transition-colors duration-200 focus:outline-none"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="font-sans text-[10px] uppercase tracking-[0.2em]">
          Export
        </span>
        <ChevronDown
          className={cn(
            "w-3 h-3 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-0.5 border border-[#1C1C1C] bg-[#F9F8F6] z-50 min-w-full animate-in fade-in duration-150"
        >
          {EXPORT_FORMATS.map((fmt) => (
            <button
              key={fmt.value}
              role="menuitem"
              onClick={() => handleExport(fmt.value)}
              className="w-full text-left px-3 py-2 font-sans text-[10px] uppercase tracking-[0.15em] text-[#1C1C1C] hover:bg-[#1C1C1C] hover:text-[#F9F8F6] transition-colors duration-200 border-b border-[#1C1C1C]/10 last:border-b-0"
            >
              {fmt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
