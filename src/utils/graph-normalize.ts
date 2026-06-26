import type { DocumentNode, DocumentEdge, ParsedDocument, ProjectType, PaperMetadata, PaperSection } from "@/types";
import { pickFirstString } from "@/utils/string";

/**
 * The AI prompt explicitly asks for this schema, but real-world LLM
 * output varies. This module normalises whatever the model returns into
 * the shape the UI expects (`{ id, type, position, data: { title, description } }`).
 *
 * It is shared between the ingest API route (server) and the board pages
 * (client) so both layers agree on what a "node" looks like.
 */

interface RawNode {
  id?: unknown;
  type?: unknown;
  section?: unknown;
  position?: unknown;
  data?: unknown;
  // Common flat-shape alternatives some models prefer:
  title?: unknown;
  name?: unknown;
  label?: unknown;
  description?: unknown;
  content?: unknown;
  summary?: unknown;
  sourceContext?: unknown;
  details?: unknown;
  filePath?: unknown;
  language?: unknown;
  codeSnippet?: unknown;
  note?: unknown;
  // Tier 2: vision fields
  imageUrl?: unknown;
  imageDescription?: unknown;
}

interface RawEdge {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  label?: unknown;
  type?: unknown;
}

interface RawMetadata {
  authors?: unknown;
  year?: unknown;
  venue?: unknown;
  doi?: unknown;
  abstract?: unknown;
}

interface RawGraph {
  id?: unknown;
  title?: unknown;
  rawText?: unknown;
  metadata?: unknown;
  nodes?: unknown;
  edges?: unknown;
}

function pickPosition(input: unknown): { x: number; y: number } {
  if (
    input &&
    typeof input === "object" &&
    "x" in input &&
    "y" in input &&
    typeof (input as { x: unknown }).x === "number" &&
    typeof (input as { y: unknown }).y === "number"
  ) {
    return { x: (input as { x: number }).x, y: (input as { y: number }).y };
  }
  return { x: 0, y: 0 };
}

function pickType(input: unknown): DocumentNode["type"] {
  if (typeof input === "string") {
    const allowed: DocumentNode["type"][] = [
      "concept",
      "code",
      "diagram",
      "summary",
      "module",
      "function",
      "class",
    ];
    if ((allowed as string[]).includes(input)) {
      return input as DocumentNode["type"];
    }
  }
  return "concept";
}

const VALID_SECTIONS: PaperSection[] = [
  "abstract",
  "introduction",
  "method",
  "experiment",
  "result",
  "conclusion",
  "related-work",
  "background",
];

function pickSection(input: unknown): PaperSection | undefined {
  if (typeof input === "string") {
    const lower = input.trim().toLowerCase();
    if ((VALID_SECTIONS as string[]).includes(lower)) {
      return lower as PaperSection;
    }
  }
  return undefined;
}

function normaliseMetadata(raw: unknown): PaperMetadata | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as RawMetadata;

  // authors: accept string[] or comma-separated string
  let authors: string[] = [];
  if (Array.isArray(r.authors)) {
    authors = r.authors.filter(
      (a): a is string => typeof a === "string" && a.trim().length > 0
    );
  } else if (typeof r.authors === "string" && r.authors.trim()) {
    authors = r.authors.split(",").map((a) => a.trim()).filter(Boolean);
  }

  const year =
    typeof r.year === "number"
      ? r.year
      : typeof r.year === "string" && /^\d{4}$/.test(r.year.trim())
        ? parseInt(r.year.trim(), 10)
        : null;

  const venue = pickFirstString(r.venue);
  const doi = pickFirstString(r.doi);
  const abstract = pickFirstString(r.abstract);

  // Only return metadata if at least one field is non-empty
  if (
    authors.length === 0 &&
    year === null &&
    !venue &&
    !doi &&
    !abstract
  ) {
    return undefined;
  }

  return { authors, year, venue, doi, abstract };
}

function normaliseNode(raw: unknown, index: number): DocumentNode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawNode;

  // Accept both string and numeric IDs — LLMs sometimes return numbers.
  const rawId = r.id;
  const id =
    (typeof rawId === "string" && rawId.trim())
      ? rawId.trim()
      : (typeof rawId === "number" && Number.isFinite(rawId))
        ? String(rawId)
        : `node-${index + 1}`;

  const dataObj =
    r.data && typeof r.data === "object" ? (r.data as RawNode) : ({} as RawNode);

  const title = pickFirstString(
    dataObj.title,
    dataObj.name,
    dataObj.label,
    r.title,
    r.name,
    r.label
  );
  const description = pickFirstString(
    dataObj.description,
    dataObj.content,
    dataObj.summary,
    r.description,
    r.content,
    r.summary
  );
  const sourceContext = pickFirstString(dataObj.sourceContext);
  const details = pickFirstString(dataObj.details);
  const filePath = pickFirstString(dataObj.filePath);
  const language = pickFirstString(dataObj.language);
  const codeSnippet = pickFirstString(dataObj.codeSnippet);
  const note = pickFirstString(dataObj.note);
  const imageUrl = pickFirstString(dataObj.imageUrl, r.imageUrl);
  const imageDescription = pickFirstString(
    dataObj.imageDescription,
    r.imageDescription
  );
  const section = pickSection(r.section ?? dataObj.section);

  return {
    id,
    type: pickType(r.type ?? dataObj.type),
    ...(section ? { section } : {}),
    position: pickPosition(r.position),
    data: {
      title,
      description,
      ...(sourceContext ? { sourceContext } : {}),
      ...(details ? { details } : {}),
      ...(filePath ? { filePath } : {}),
      ...(language ? { language } : {}),
      ...(codeSnippet ? { codeSnippet } : {}),
      ...(note ? { note } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(imageDescription ? { imageDescription } : {}),
    },
  };
}

function normaliseEdge(raw: unknown, index: number): DocumentEdge | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawEdge;
  // Accept both string and numeric source/target — convert numbers to strings
  // so they can match normalised node IDs.
  const source =
    typeof r.source === "string" ? r.source.trim()
      : (typeof r.source === "number" && Number.isFinite(r.source)) ? String(r.source)
      : null;
  const target =
    typeof r.target === "string" ? r.target.trim()
      : (typeof r.target === "number" && Number.isFinite(r.target)) ? String(r.target)
      : null;
  if (!source || !target) return null;
  // Skip self-loops which break dagre layout
  if (source === target) return null;
  const id =
    typeof r.id === "string" && r.id.trim()
      ? r.id.trim()
      : `edge-${source}-${target}-${index + 1}`;
  return {
    id,
    source,
    target,
    ...(typeof r.label === "string" && r.label.trim()
      ? { label: r.label.trim() }
      : {}),
    ...(typeof r.type === "string" && r.type.trim()
      ? { type: r.type.trim() }
      : {}),
  };
}

export function normaliseGraph(
  raw: unknown,
  fallbackId: string = "",
  projectType: ProjectType = "paper"
): ParsedDocument {
  const r = (raw && typeof raw === "object" ? raw : {}) as RawGraph;

  const rawNodes = Array.isArray(r.nodes) ? r.nodes : [];
  const rawEdges = Array.isArray(r.edges) ? r.edges : [];

  const nodes: DocumentNode[] = rawNodes
    .map((n, i) => normaliseNode(n, i))
    .filter((n): n is DocumentNode => n !== null);
  const edges: DocumentEdge[] = rawEdges
    .map((e, i) => normaliseEdge(e, i))
    .filter((e): e is DocumentEdge => e !== null);

  // Dedupe nodes by id. The LLM sometimes emits two nodes with the same
  // id (or one with a manually-set id and one falling back to the
  // `node-${index+1}` generator). Duplicate keys crash React rendering
  // and the duplicate data has no value — first occurrence wins.
  const seenNodeIds = new Set<string>();
  const uniqueNodes: DocumentNode[] = [];
  for (const n of nodes) {
    if (seenNodeIds.has(n.id)) continue;
    seenNodeIds.add(n.id);
    uniqueNodes.push(n);
  }

  // Filter out edges that reference non-existent node IDs. This keeps
  // the graph consistent when the LLM hallucinates source/target values
  // that don't match any normalised node.
  const nodeIds = new Set(uniqueNodes.map((n) => n.id));
  const validEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  const metadata = normaliseMetadata(r.metadata);

  return {
    id:
      typeof r.id === "string" && r.id.trim() ? r.id.trim() : fallbackId,
    title: pickFirstString(r.title) || "Untitled",
    type: projectType,
    rawText: typeof r.rawText === "string" ? r.rawText : "",
    ...(metadata ? { metadata } : {}),
    nodes: uniqueNodes,
    edges: validEdges,
  };
}
