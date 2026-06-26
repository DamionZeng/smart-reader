// Client-side organization API (folders + tags)

export type Folder = {
  id: string;
  userId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type Tag = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function listFolders(): Promise<Folder[]> {
  const data = await jsonOrThrow<{ folders: Folder[] }>(
    await fetch("/api/folders", { credentials: "include" })
  );
  return data.folders ?? [];
}

export async function listTags(): Promise<Tag[]> {
  const data = await jsonOrThrow<{ tags: Tag[] }>(
    await fetch("/api/folders?type=tags", { credentials: "include" })
  );
  return data.tags ?? [];
}

export async function createFolder(name: string, color?: string): Promise<Folder> {
  const data = await jsonOrThrow<{ folder: Folder }>(
    await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, color }),
    })
  );
  return data.folder;
}

export async function createTag(name: string): Promise<Tag> {
  const data = await jsonOrThrow<{ tag: Tag }>(
    await fetch("/api/folders?type=tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name }),
    })
  );
  return data.tag;
}

export async function deleteFolder(id: string): Promise<void> {
  await jsonOrThrow<{ success: true }>(
    await fetch(`/api/folders/${id}`, {
      method: "DELETE",
      credentials: "include",
    })
  );
}

export async function deleteTag(id: string): Promise<void> {
  await jsonOrThrow<{ success: true }>(
    await fetch(`/api/folders/${id}?type=tags`, {
      method: "DELETE",
      credentials: "include",
    })
  );
}

export async function setProjectOrganization(
  projectId: string,
  payload: { folderId?: string | null; tagIds?: string[] }
): Promise<void> {
  await jsonOrThrow<{ success: true }>(
    await fetch(`/api/projects/${projectId}/organization`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    })
  );
}
