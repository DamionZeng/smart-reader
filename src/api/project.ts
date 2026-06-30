import { DocumentNode, DocumentEdge, ProjectType } from "@/types";

export interface ProjectSummary {
  id: string;
  title: string;
  type: ProjectType;
  originalUrl: string | null;
  createdAt: string | Date;
  isPublic?: boolean;
  folder?: { id: string; name: string; color: string } | null;
  tags?: Array<{ id: string; name: string }>;
  /** Tier 2: data-URL thumbnail of the source image (only set for image-type projects) */
  thumbnail?: string | null;
  /** Python backend parse status. Defaults to 'ready' for legacy rows / nextjs backend. */
  status?: "parsing" | "ready" | "failed";
  /** Real-time KG pipeline progress; only present when status === 'parsing'. */
  parseProgress?: {
    step: string;
    current: number;
    total: number;
    jobStatus?: string;
  } | null;
}

export interface ProjectDetail {
  id: string;
  title: string;
  type: ProjectType;
  originalUrl: string | null;
  nodes: DocumentNode[];
  edges: DocumentEdge[];
  createdAt: string | Date;
  rawText?: string;
  // Raw metadata fields as stored in the DB (authors is a JSON string)
  authors?: string;
  year?: number | null;
  venue?: string;
  doi?: string;
  abstract?: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = "Request failed";
    try {
      const data = await res.json();
      message = data?.error || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch("/api/projects", { credentials: "include" });
  const data = await jsonOrThrow<{ projects: ProjectSummary[] }>(res);
  return data.projects;
}

export async function getProject(id: string): Promise<ProjectDetail> {
  const res = await fetch(`/api/projects/${id}`, { credentials: "include" });
  const data = await jsonOrThrow<{ project: ProjectDetail }>(res);
  return data.project;
}

export async function saveProject(
  id: string,
  payload: { nodes?: DocumentNode[]; edges?: DocumentEdge[]; title?: string }
): Promise<ProjectDetail> {
  const res = await fetch(`/api/projects/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await jsonOrThrow<{ project: ProjectDetail }>(res);
  return data.project;
}

/**
 * Creates an empty project shell owned by the current user.
 * Returns the freshly-created project detail (id, title, ...).
 */
export async function createProject(title?: string, type: ProjectType = 'paper'): Promise<ProjectDetail> {
  const res = await fetch("/api/projects", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, type }),
  });
  const data = await jsonOrThrow<{ project: ProjectDetail }>(res);
  return data.project;
}

/**
 * Permanently deletes a project and all its data.
 */
export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  await jsonOrThrow<{ success: boolean }>(res);
}

/**
 * Compares 2-5 paper projects and returns a new project ID + graph
 * containing the AI-generated comparison knowledge graph.
 */
export async function compareProjects(
  projectIds: string[]
): Promise<{ id: string }> {
  const res = await fetch("/api/compare", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectIds }),
  });
  const data = await jsonOrThrow<{ id: string }>(res);
  return { id: data.id };
}

/**
 * Generates a literature review markdown document synthesizing
 * 2-8 paper projects. Returns the review text.
 */
export async function generateReview(
  projectIds: string[]
): Promise<string> {
  const res = await fetch("/api/review", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectIds }),
  });
  const data = await jsonOrThrow<{ review: string }>(res);
  return data.review;
}
