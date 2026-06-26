import type { PaperMetadata } from "@/types";

// === 概念类型: 论文 + 代码共用 ===
export type PaperConceptType =
  | "method"
  | "model"
  | "metric"
  | "dataset"
  | "term"
  | "tool"
  | "task";

export type CodeConceptType =
  | "function"
  | "class"
  | "module"
  | "interface"
  | "variable";

export type ConceptType = PaperConceptType | CodeConceptType;

// === 概念节点 ===
export interface Concept {
  id: string;
  label: string;
  type: ConceptType;
  aliases: string[];
  frequency: number;
  importance: number;
  clusterId: string;
  description?: string;
  anchors: string[];
  filePath?: string;
  codeSnippet?: string;
  /**
   * P2-3 (global knowledge graph): the source documents this concept
   * was extracted from. Populated only by the /api/concept-graph/global
   * endpoint when merging concepts across all of a user's projects.
   * Single-project graphs leave this undefined.
   *
   * Clicking a global-graph node navigates to sourceDocuments[0]'s board
   * page so the user can read the original article.
   */
  sourceDocuments?: Array<{ id: string; title: string }>;
}

// === 边类型 ===
export type ConceptEdgeType =
  | "co-occurs"
  | "defines"
  | "uses"
  | "extends"
  | "calls"
  | "imports"
  | "implements";

export interface ConceptEdge {
  id: string;
  source: string;
  target: string;
  type: ConceptEdgeType;
  weight: number;
  evidence: string[];
  confidence: number;
}

// === 社区 ===
export interface ConceptCluster {
  id: string;
  label: string;
  description?: string;
  colorName: string;
  conceptIds: string[];
  parentClusterId?: string;
  level: number;
}

// === 完整图谱 ===
export interface ConceptGraph {
  id: string;
  title: string;
  type: "paper" | "code";
  metadata?: PaperMetadata;
  rawText: string;
  concepts: Concept[];
  edges: ConceptEdge[];
  clusters: ConceptCluster[];
  createdAt: string;
}

// === 调色板 ===
export const CLUSTER_PALETTE = [
  { name: "slate", fill: "#1C1C1C" },
  { name: "rust", fill: "#A0522D" },
  { name: "olive", fill: "#6B8E23" },
  { name: "navy", fill: "#1C2B4B" },
  { name: "plum", fill: "#5D3A5D" },
  { name: "teal", fill: "#2F5D5D" },
  { name: "umber", fill: "#6B4226" },
  { name: "moss", fill: "#4A5D23" },
] as const;

export type ClusterColorName = (typeof CLUSTER_PALETTE)[number]["name"];

export function getClusterColor(name: string): string {
  return CLUSTER_PALETTE.find((p) => p.name === name)?.fill || "#1C1C1C";
}

// === Job 状态 ===
export type JobStatus = "processing" | "done" | "failed";

export interface JobProgress {
  step: string;
  current: number;
  total: number;
}

export interface ConceptGraphJob {
  id: string;
  userId: string;
  status: JobStatus;
  progress: JobProgress;
  graphId?: string;
  error?: string;
  inputType: "paper" | "code";
  inputUrl?: string;
  inputFileName?: string;
  createdAt: string;
  updatedAt: string;
}
