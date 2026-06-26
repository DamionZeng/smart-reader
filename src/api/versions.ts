import type { DocumentNode, DocumentEdge } from "@/types";

export type VersionMeta = {
  id: string;
  label: string | null;
  createdAt: string;
};

export type VersionDetail = VersionMeta & {
  nodes: DocumentNode[];
  edges: DocumentEdge[];
};

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

export async function listVersions(projectId: string): Promise<VersionMeta[]> {
  const res = await fetch(`/api/projects/${projectId}/versions`, {
    credentials: "include",
  });
  const data = await jsonOrThrow<{ versions: VersionMeta[] }>(res);
  return data.versions ?? [];
}

export async function getVersion(
  projectId: string,
  versionId: string
): Promise<VersionDetail> {
  const res = await fetch(
    `/api/projects/${projectId}/versions/${versionId}`,
    { credentials: "include" }
  );
  const data = await jsonOrThrow<{ version: VersionDetail }>(res);
  return data.version;
}

export async function createVersion(
  projectId: string,
  payload: { label?: string; nodes: DocumentNode[]; edges: DocumentEdge[] }
): Promise<VersionMeta> {
  const res = await fetch(`/api/projects/${projectId}/versions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await jsonOrThrow<{ version: VersionMeta }>(res);
  return data.version;
}

export async function deleteVersion(
  projectId: string,
  versionId: string
): Promise<void> {
  const res = await fetch(
    `/api/projects/${projectId}/versions/${versionId}`,
    { method: "DELETE", credentials: "include" }
  );
  await jsonOrThrow<{ success: boolean }>(res);
}

export async function rollbackToVersion(
  projectId: string,
  versionId: string
): Promise<void> {
  const res = await fetch(
    `/api/projects/${projectId}/versions/${versionId}`,
    { method: "POST", credentials: "include" }
  );
  await jsonOrThrow<{ success: boolean }>(res);
}
