export type ProjectType = 'paper' | 'code' | 'image';

/** Section classification for paper nodes */
export type PaperSection =
  | 'abstract'
  | 'introduction'
  | 'method'
  | 'experiment'
  | 'result'
  | 'conclusion'
  | 'related-work'
  | 'background';

/** Paper-level metadata extracted by AI */
export interface PaperMetadata {
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  abstract: string;
}

export interface DocumentNode {
  id: string;
  type: 'concept' | 'code' | 'diagram' | 'summary' | 'module' | 'function' | 'class';
  section?: PaperSection;
  position: { x: number; y: number };
  data: {
    title: string;
    description: string;
    sourceContext?: string;
    details?: string;
    /** User-authored annotation / note attached to this node */
    note?: string;
    // Code-specific fields (used by module/function/class nodes)
    filePath?: string;
    language?: string;
    codeSnippet?: string;
    // Vision fields (Tier 2): a data-URL or remote URL pointing at an image
    // that the AI used to produce / describe this node.
    imageUrl?: string;
    /** AI-generated description of the attached image (cached). */
    imageDescription?: string;
  };
}

/** Inline image attachment for a Q&A message. */
export interface ChatImageAttachment {
  /** data-URL (data:image/...;base64,...) — kept inline to avoid extra storage */
  dataUrl: string;
  /** Original filename, for display in the chat bubble */
  name?: string;
  /** Pre-computed approximate byte size; guards against huge uploads */
  approxBytes?: number;
}

export interface DocumentEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
  /** Typed relationship — drives visual styling & semantics */
  edgeType?:
    | "relates"
    | "depends"
    | "extends"
    | "contradicts";
  /** Optional user-authored note on the relationship */
  note?: string;
}

export type EdgeType = NonNullable<DocumentEdge["edgeType"]>;

export const EDGE_TYPES: { value: EdgeType; label: string }[] = [
  { value: "relates", label: "Relates to" },
  { value: "depends", label: "Depends on" },
  { value: "extends", label: "Extends" },
  { value: "contradicts", label: "Contradicts" },
];

export interface ParsedDocument {
  id: string;
  title: string;
  type: ProjectType;
  rawText: string;
  metadata?: PaperMetadata;
  nodes: DocumentNode[];
  edges: DocumentEdge[];
}

export interface NodeExplanation {
  analogy: string;
  simplified: string;
  codeSnippet?: string;
}
