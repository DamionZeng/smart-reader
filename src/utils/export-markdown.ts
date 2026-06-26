import { jsPDF } from "jspdf";
import type { DocumentNode, DocumentEdge } from "@/types";

export type ExportFormat = "markdown" | "json" | "html" | "pdf";

/**
 * Converts a knowledge graph (nodes + edges) into a Markdown document.
 *
 * Structure:
 *   # <Project Title>
 *
 *   ## Nodes
 *   ### <Node Title>
 *   <description>
 *
 *   > Source: <sourceContext>
 *
 *   ## Relationships
 *   - <source> → <target> (<label>)
 */
export function exportGraphToMarkdown(
  title: string,
  nodes: DocumentNode[],
  edges: DocumentEdge[]
): string {
  const lines: string[] = [];

  lines.push(`# ${title || "Untitled Project"}`);
  lines.push("");
  lines.push(`> Exported from Smart Reader on ${new Date().toISOString().split("T")[0]}`);
  lines.push("");
  lines.push(`**Nodes:** ${nodes.length}  `);
  lines.push(`**Edges:** ${edges.length}`);
  lines.push("");

  // Nodes section
  lines.push("## Nodes");
  lines.push("");

  for (const node of nodes) {
    const data = node.data as {
      title?: string;
      description?: string;
      sourceContext?: string;
      details?: string;
      note?: string;
      filePath?: string;
      language?: string;
      codeSnippet?: string;
    };
    lines.push(`### ${data.title || node.id}`);
    lines.push("");
    if (node.section) {
      lines.push(`*Section: ${node.section}*`);
      lines.push("");
    }
    if (data.description) {
      lines.push(data.description);
      lines.push("");
    }
    if (data.sourceContext) {
      lines.push(`> Source: ${data.sourceContext}`);
      lines.push("");
    }
    if (data.details) {
      lines.push(data.details);
      lines.push("");
    }
    if (data.filePath) {
      lines.push(`**File:** \`${data.filePath}\``);
      lines.push("");
    }
    if (data.codeSnippet) {
      lines.push("```" + (data.language || "") );
      lines.push(data.codeSnippet);
      lines.push("```");
      lines.push("");
    }
    if (data.note) {
      lines.push(`> **Note:** ${data.note}`);
      lines.push("");
    }
  }

  // Relationships section
  if (edges.length > 0) {
    lines.push("## Relationships");
    lines.push("");

    // Build a lookup for node titles
    const titleMap = new Map<string, string>();
    for (const node of nodes) {
      const d = node.data as { title?: string };
      titleMap.set(node.id, d.title || node.id);
    }

    for (const edge of edges) {
      const sourceTitle = titleMap.get(edge.source) || edge.source;
      const targetTitle = titleMap.get(edge.target) || edge.target;
      const label = edge.label ? ` (${edge.label})` : "";
      lines.push(`- **${sourceTitle}** → **${targetTitle}**${label}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Converts a knowledge graph into a structured JSON document.
 */
export function exportGraphToJSON(
  title: string,
  nodes: DocumentNode[],
  edges: DocumentEdge[]
): string {
  return JSON.stringify(
    {
      title: title || "Untitled Project",
      exportedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes,
      edges,
    },
    null,
    2
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Converts a knowledge graph into a standalone HTML document with
 * editorial styling consistent with the Smart Reader design system.
 */
export function exportGraphToHTML(
  title: string,
  nodes: DocumentNode[],
  edges: DocumentEdge[]
): string {
  const titleMap = new Map<string, string>();
  for (const node of nodes) {
    const d = node.data as { title?: string };
    titleMap.set(node.id, d.title || node.id);
  }

  const nodeCards = nodes
    .map((node) => {
      const d = node.data as Record<string, string | undefined>;
      const parts: string[] = [];
      if (node.section) {
        parts.push(
          `<span class="section-tag">${escapeHtml(node.section)}</span>`
        );
      }
      parts.push(`<h3 class="node-title">${escapeHtml(d.title || node.id)}</h3>`);
      if (d.description) {
        parts.push(`<p class="node-desc">${escapeHtml(d.description)}</p>`);
      }
      if (d.sourceContext) {
        parts.push(`<blockquote class="node-source">${escapeHtml(d.sourceContext)}</blockquote>`);
      }
      if (d.note) {
        parts.push(`<p class="node-note"><strong>Note:</strong> ${escapeHtml(d.note)}</p>`);
      }
      return `    <article class="node-card">${parts.join("\n      ")}</article>`;
    })
    .join("\n");

  const edgeList = edges.length
    ? edges
        .map((e) => {
          const s = titleMap.get(e.source) || e.source;
          const t = titleMap.get(e.target) || e.target;
          const label = e.label ? ` <em>(${escapeHtml(e.label)})</em>` : "";
          return `      <li><strong>${escapeHtml(s)}</strong> → <strong>${escapeHtml(t)}</strong>${label}</li>`;
        })
        .join("\n")
    : '      <li class="empty">No relationships</li>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title || "Untitled Project")}</title>
<style>
  :root { --ink: #1C1C1C; --paper: #F9F8F6; --muted: rgba(28,28,28,0.6); }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--paper); color: var(--ink);
    max-width: 820px; margin: 0 auto; padding: 48px 24px 96px;
    line-height: 1.6;
  }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size: 2.2rem; margin-bottom: 8px; letter-spacing: -0.02em; }
  .meta { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.2em; color: var(--muted); margin-bottom: 48px; border-bottom: 1px solid rgba(28,28,28,0.1); padding-bottom: 16px; }
  h2 { font-family: Georgia, serif; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 0.15em; margin: 48px 0 24px; border-bottom: 1px solid rgba(28,28,28,0.1); padding-bottom: 8px; }
  .node-card { margin-bottom: 32px; }
  .section-tag { display: inline-block; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.15em; color: var(--muted); margin-bottom: 8px; }
  .node-title { font-family: Georgia, serif; font-size: 1.3rem; margin-bottom: 8px; }
  .node-desc { font-size: 0.9rem; color: rgba(28,28,28,0.8); margin-bottom: 8px; }
  .node-source { border-left: 3px solid rgba(28,28,28,0.2); padding-left: 16px; font-style: italic; font-size: 0.85rem; color: var(--muted); margin: 8px 0; }
  .node-note { font-size: 0.85rem; background: rgba(28,28,28,0.04); padding: 12px; border: 1px solid rgba(28,28,28,0.1); }
  ul { list-style: none; }
  ul li { font-size: 0.9rem; padding: 6px 0; border-bottom: 1px solid rgba(28,28,28,0.05); }
  ul li.empty { color: var(--muted); font-style: italic; }
  em { color: var(--muted); font-size: 0.8rem; }
</style>
</head>
<body>
  <h1>${escapeHtml(title || "Untitled Project")}</h1>
  <div class="meta">Exported from Smart Reader · ${new Date().toISOString().split("T")[0]} · ${nodes.length} nodes · ${edges.length} edges</div>

  <h2>Nodes</h2>
${nodeCards}

  <h2>Relationships</h2>
  <ul>
${edgeList}
  </ul>
</body>
</html>`;
}

/**
 * Exports a knowledge graph to a PDF document with editorial styling.
 * Renders title, metadata, nodes (with descriptions), and relationships.
 */
export function exportGraphToPDF(
  filename: string,
  title: string,
  nodes: DocumentNode[],
  edges: DocumentEdge[]
): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(title, margin, y);
  y += 30;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100);
  const date = new Date().toLocaleDateString();
  doc.text(`Exported: ${date} | Nodes: ${nodes.length} | Edges: ${edges.length}`, margin, y);
  y += 25;
  doc.setTextColor(0);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Nodes", margin, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const node of nodes) {
    const data = node.data;
    const nodeTitle = data.title || node.id;
    const desc = data.description || "";

    if (y > pageHeight - margin - 40) {
      doc.addPage();
      y = margin;
    }

    doc.setFont("helvetica", "bold");
    doc.text(nodeTitle, margin, y);
    y += 15;

    if (desc) {
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(desc, pageWidth - margin * 2);
      for (const line of lines) {
        if (y > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin + 10, y);
        y += 12;
      }
    }
    y += 10;
  }

  if (y > pageHeight - margin - 40) {
    doc.addPage();
    y = margin;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Relationships", margin, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const edge of edges) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    const sourceLabel = sourceNode?.data?.title || edge.source;
    const targetLabel = targetNode?.data?.title || edge.target;
    const label = edge.label ? ` --[${edge.label}]--> ` : " --> ";
    const text = sourceLabel + label + targetLabel;
    const lines = doc.splitTextToSize(text, pageWidth - margin * 2);
    for (const line of lines) {
      doc.text(line, margin, y);
      y += 12;
    }
  }

  doc.save(`${filename}.pdf`);
}

/**
 * Triggers a browser download of the given content with the specified
 * MIME type and file extension.
 */
export function downloadFile(
  filename: string,
  content: string,
  mimeType: string,
  extension: string
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(`.${extension}`) ? filename : `${filename}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Triggers a browser download of the given markdown content.
 */
export function downloadMarkdown(filename: string, content: string): void {
  downloadFile(filename, content, "text/markdown", "md");
}

/**
 * Exports a knowledge graph in the specified format and triggers a download.
 */
export function exportAndDownload(
  format: ExportFormat,
  filename: string,
  title: string,
  nodes: DocumentNode[],
  edges: DocumentEdge[]
): void {
  switch (format) {
    case "json":
      downloadFile(filename, exportGraphToJSON(title, nodes, edges), "application/json", "json");
      break;
    case "html":
      downloadFile(filename, exportGraphToHTML(title, nodes, edges), "text/html", "html");
      break;
    case "pdf":
      exportGraphToPDF(filename, title, nodes, edges);
      break;
    case "markdown":
    default:
      downloadFile(filename, exportGraphToMarkdown(title, nodes, edges), "text/markdown", "md");
      break;
  }
}
