"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, Tag as TagIcon, Trash2, ChevronRight, X } from "lucide-react";
import { cn } from "@/utils/cn";
import {
  listFolders,
  listTags,
  createFolder,
  createTag,
  deleteFolder,
  deleteTag,
  setProjectOrganization,
  type Folder,
  type Tag,
} from "@/api/organization";

/** Subset of Folder / Tag that's safe to use as initial state. */
export type FolderRef = Pick<Folder, "id" | "name" | "color">;
export type TagRef = Pick<Tag, "id" | "name">;

type Props = {
  projectId: string;
  initialFolder: FolderRef | null;
  initialTags: TagRef[];
  open: boolean;
  onClose: () => void;
  onUpdated: (folder: FolderRef | null, tags: TagRef[]) => void;
};

export function ProjectOrganizationDialog({
  projectId,
  initialFolder,
  initialTags,
  open,
  onClose,
  onUpdated,
}: Props) {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    initialFolder?.id ?? null
  );
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(
    new Set(initialTags.map((tag) => tag.id))
  );
  const [newFolderName, setNewFolderName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [f, tg] = await Promise.all([listFolders(), listTags()]);
        setFolders(f);
        setTags(tg);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [open]);

  if (!open) return null;

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const f = await createFolder(newFolderName.trim());
      setFolders((prev) => [...prev, f].sort((a, b) => a.name.localeCompare(b.name)));
      setNewFolderName("");
      setSelectedFolderId(f.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const tag = await createTag(newTagName.trim());
      setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTagName("");
      setSelectedTagIds((prev) => new Set(prev).add(tag.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    setBusy(true);
    try {
      await deleteFolder(id);
      setFolders((prev) => prev.filter((f) => f.id !== id));
      if (selectedFolderId === id) setSelectedFolderId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteTag = async (id: string) => {
    setBusy(true);
    try {
      await deleteTag(id);
      setTags((prev) => prev.filter((tag) => tag.id !== id));
      setSelectedTagIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await setProjectOrganization(projectId, {
        folderId: selectedFolderId,
        tagIds: Array.from(selectedTagIds),
      });
      const newFolder =
        folders.find((f) => f.id === selectedFolderId) ?? null;
      const newTags = tags.filter((tag) => selectedTagIds.has(tag.id));
      onUpdated(newFolder, newTags);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1C1C]/30 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-2xl border border-border bg-[#F9F8F6] p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-[#1C1C1C]/60 hover:text-[#1C1C1C]"
          aria-label={t("common.close")}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
          {t("organization.subtitle")}
        </div>
        <h2 className="font-serif text-3xl tracking-tight">
          {t("organization.title")}
        </h2>

        {error && (
          <div className="mt-4 border border-[#1C1C1C] bg-[#1C1C1C]/5 p-3 text-sm">
            {error}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-6">
          {/* Folders */}
          <div>
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <FolderPlus className="h-3 w-3" />
              <span className="text-[10px] uppercase tracking-[0.2em]">
                {t("organization.folders")}
              </span>
            </div>

            <ul className="mt-3 max-h-48 overflow-y-auto">
              {folders.length === 0 && (
                <li className="py-2 text-xs text-[#1C1C1C]/40">
                  {t("organization.noFolders")}
                </li>
              )}
              {folders.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between border-b border-border/40 py-2"
                >
                  <button
                    onClick={() =>
                      setSelectedFolderId(selectedFolderId === f.id ? null : f.id)
                    }
                    className={cn(
                      "flex flex-1 items-center gap-2 text-left text-sm transition-colors",
                      selectedFolderId === f.id
                        ? "italic text-[#1C1C1C]"
                        : "text-[#1C1C1C]/70 hover:text-[#1C1C1C]"
                    )}
                  >
                    <span
                      className="h-2 w-2"
                      style={{ backgroundColor: f.color }}
                    />
                    {f.name}
                  </button>
                  <button
                    onClick={() => handleDeleteFolder(f.id)}
                    disabled={busy}
                    className="text-[#1C1C1C]/30 hover:text-[#1C1C1C]"
                    aria-label="Delete folder"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex gap-2">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={t("organization.newFolder")}
                className="flex-1 border border-border bg-transparent px-3 py-2 text-sm focus:border-[#1C1C1C] focus:outline-none placeholder:text-[#1C1C1C]/30"
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                maxLength={100}
              />
              <button
                onClick={handleCreateFolder}
                disabled={busy || !newFolderName.trim()}
                className="border border-[#1C1C1C] px-3 py-2 text-sm transition-colors hover:bg-[#1C1C1C] hover:text-[#F9F8F6] disabled:opacity-30"
              >
                {t("common.add")}
              </button>
            </div>
          </div>

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <TagIcon className="h-3 w-3" />
              <span className="text-[10px] uppercase tracking-[0.2em]">
                {t("organization.tags")}
              </span>
            </div>

            <div className="mt-3 flex max-h-48 flex-wrap gap-1 overflow-y-auto">
              {tags.length === 0 && (
                <span className="py-2 text-xs text-[#1C1C1C]/40">
                  {t("organization.noTags")}
                </span>
              )}
              {tags.map((tag) => {
                const active = selectedTagIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className={cn(
                      "group flex items-center gap-1 border px-2 py-1 text-xs transition-colors",
                      active
                        ? "border-[#1C1C1C] bg-[#1C1C1C] text-[#F9F8F6]"
                        : "border-border hover:border-[#1C1C1C]"
                    )}
                  >
                    {tag.name}
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTag(tag.id);
                      }}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" />
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder={t("organization.newTag")}
                className="flex-1 border border-border bg-transparent px-3 py-2 text-sm focus:border-[#1C1C1C] focus:outline-none placeholder:text-[#1C1C1C]/30"
                onKeyDown={(e) => e.key === "Enter" && handleCreateTag()}
                maxLength={50}
              />
              <button
                onClick={handleCreateTag}
                disabled={busy || !newTagName.trim()}
                className="border border-[#1C1C1C] px-3 py-2 text-sm transition-colors hover:bg-[#1C1C1C] hover:text-[#F9F8F6] disabled:opacity-30"
              >
                {t("common.add")}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-end gap-3 border-t border-border pt-6">
          <button
            onClick={onClose}
            className="px-6 py-3 text-sm tracking-wide transition-colors hover:underline"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className="bg-[#1C1C1C] px-6 py-3 text-sm tracking-wide text-[#F9F8F6] transition-colors hover:bg-[#1C1C1C]/90 disabled:opacity-50"
          >
            {t("common.save")}
            <ChevronRight className="ml-2 inline h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
