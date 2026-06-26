"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, History, RotateCcw, Trash2, Loader2 } from "lucide-react";
import {
  listVersions,
  rollbackToVersion,
  deleteVersion,
  type VersionMeta,
} from "@/api/versions";
import type { DocumentNode, DocumentEdge } from "@/types";

type Props = {
  projectId: string;
  open: boolean;
  currentNodes: DocumentNode[];
  currentEdges: DocumentEdge[];
  onClose: () => void;
  onRollback: (nodes: DocumentNode[], edges: DocumentEdge[]) => void;
};

export function HistoryPanel({
  projectId,
  open,
  currentNodes,
  currentEdges,
  onClose,
  onRollback,
}: Props) {
  const { t, i18n } = useTranslation();
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    listVersions(projectId)
      .then(setVersions)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  if (!open) return null;

  const handleSnapshotNow = async () => {
    setBusy("__new__");
    setError(null);
    try {
      const { createVersion } = await import("@/api/versions");
      const v = await createVersion(projectId, {
        label: "Manual snapshot",
        nodes: currentNodes,
        edges: currentEdges,
      });
      setVersions((prev) => [v, ...prev]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleRollback = async (vid: string) => {
    if (!confirm(t("history.confirmRollback"))) return;
    setBusy(vid);
    setError(null);
    try {
      const { getVersion } = await import("@/api/versions");
      const v = await getVersion(projectId, vid);
      await rollbackToVersion(projectId, vid);
      onRollback(v.nodes, v.edges);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (vid: string) => {
    if (!confirm(t("history.confirmDelete"))) return;
    setBusy(vid);
    setError(null);
    try {
      await deleteVersion(projectId, vid);
      setVersions((prev) => prev.filter((v) => v.id !== vid));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#1C1C1C]/30"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("history.title")}
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-border bg-[#F9F8F6]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
              {t("history.subtitle")}
            </div>
            <h2 className="mt-1 font-serif text-2xl tracking-tight">
              {t("history.title")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#1C1C1C]/60 hover:text-[#1C1C1C]"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Snapshot button */}
        <div className="border-b border-border p-6">
          <button
            onClick={handleSnapshotNow}
            disabled={busy === "__new__"}
            className="flex w-full items-center justify-center gap-2 border border-[#1C1C1C] px-6 py-3 text-sm tracking-wide transition-colors hover:bg-[#1C1C1C] hover:text-[#F9F8F6] disabled:opacity-50"
          >
            {busy === "__new__" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <History className="h-3 w-3" />
            )}
            {t("history.snapshotNow")}
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 border border-[#1C1C1C] bg-[#1C1C1C]/5 p-3 text-sm">
            {error}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-4 w-4 animate-spin text-[#1C1C1C]/40" />
            </div>
          ) : versions.length === 0 ? (
            <div className="py-12 text-center">
              <History className="mx-auto mb-3 h-6 w-6 text-[#1C1C1C]/30" />
              <p className="font-sans text-sm text-[#1C1C1C]/60">
                {t("history.empty")}
              </p>
              <p className="mt-1 text-xs text-[#1C1C1C]/40">
                {t("history.emptyHint")}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => {
                const date = new Date(v.createdAt);
                const dateStr = date.toLocaleString(
                  i18n.language.startsWith("zh") ? "zh-CN" : "en-US",
                  {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }
                );
                return (
                  <li
                    key={v.id}
                    className="group border border-border bg-[#F9F8F6] p-4 transition-colors hover:border-[#1C1C1C]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#1C1C1C]/40">
                          {dateStr}
                        </div>
                        <div className="mt-1 truncate font-sans text-sm">
                          {v.label ?? t("history.autoLabel")}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => handleRollback(v.id)}
                          disabled={busy === v.id}
                          className="p-1.5 text-[#1C1C1C]/50 hover:text-[#1C1C1C] disabled:opacity-30"
                          title={t("history.rollback")}
                          aria-label={t("history.rollback")}
                        >
                          {busy === v.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(v.id)}
                          disabled={busy === v.id}
                          className="p-1.5 text-[#1C1C1C]/50 hover:text-[#1C1C1C] disabled:opacity-30"
                          title={t("history.delete")}
                          aria-label={t("history.delete")}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
