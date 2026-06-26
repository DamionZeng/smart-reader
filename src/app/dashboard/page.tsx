"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Plus, ArrowRight, FileText, Globe, BookOpen, Code2, X, Trash2, GitCompare, Check, FileStack, Download, Copy, FolderPlus, Tag as TagIcon, Image as ImageIcon } from "lucide-react";
import Markdown from "markdown-to-jsx";
import { SiteHeader } from "@/components/SiteHeader";
import { LoadingScreen } from "@/components/LoadingScreen";
import { listProjects, deleteProject, ProjectSummary } from "@/api/project";
import { useSession } from "@/lib/auth-client";
import { ProjectType } from "@/types";
import { ProjectOrganizationDialog } from "@/components/dashboard/ProjectOrganizationDialog";
import { GlobalKnowledgeGraph } from "@/components/dashboard/GlobalKnowledgeGraph";
import type { Folder, Tag } from "@/api/organization";
import { cn } from "@/utils/cn";
import "@/i18n";

function useModalA11y(isOpen: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;

    if (container) {
      const focusable = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && container) {
        const focusable = container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return containerRef;
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Incremented after mutations that change the global graph (e.g.
  // project deletion) so <GlobalKnowledgeGraph> re-fetches without a
  // full-page reload.
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isComparing, setIsComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewContent, setReviewContent] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [orgTarget, setOrgTarget] = useState<ProjectSummary | null>(null);
  const [filterFolderId, setFilterFolderId] = useState<string | null>(null);
  const [filterTagId, setFilterTagId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isReviewStreaming, setIsReviewStreaming] = useState(false);
  const reviewAbortRef = useRef<AbortController | null>(null);
  const handleCloseReview = () => {
    if (reviewAbortRef.current) reviewAbortRef.current.abort();
    setReviewContent(null);
    setIsReviewStreaming(false);
  };
  const reviewModalRef = useModalA11y(!!reviewContent, handleCloseReview);
  const deleteModalRef = useModalA11y(!!deleteTarget, () => {
    if (!isDeleting) setDeleteTarget(null);
  });

  useEffect(() => {
    if (sessionPending) return;
    if (!session?.user) {
      router.replace("/login");
      return;
    }
  }, [session, sessionPending, router]);

  useEffect(() => {
    if (!session?.user) return;
    let cancelled = false;
    listProjects()
      .then((data) => {
        if (!cancelled) setProjects(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || "Failed to load projects");
          setProjects([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user]);

  if (sessionPending || !session?.user) {
    return (
      <div className="min-h-screen bg-[#F9F8F6] text-[#1C1C1C] flex items-center justify-center">
        <LoadingScreen message={t("common.loading")} />
      </div>
    );
  }

  const handleSelectType = (type: ProjectType) => {
    setShowTypeSelector(false);
    // Send the user straight to the dedicated import page so the import
    // state machine (which owns parsing + the 7-step KG pipeline + job
    // polling) has its own URL. The board/codeboard pages no longer host
    // the import UI; they redirect to /import or /code-import when no
    // project id is present.
    router.push(type === "code" ? "/code-import" : "/import");
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteProject(deleteTarget.id);
      setProjects((prev) =>
        prev ? prev.filter((p) => p.id !== deleteTarget.id) : prev
      );
      setDeleteTarget(null);
      // Trigger a re-fetch of the global knowledge graph so the
      // deleted project's concepts disappear from the merged view.
      // Only the graph panel re-renders — the rest of the page
      // (project list, filters, etc.) is untouched.
      setGraphRefreshKey((k) => k + 1);
    } catch (err: any) {
      setError(err.message || "Failed to delete project");
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 5) {
        next.add(id);
      }
      return next;
    });
  };

  const handleEnterCompare = () => {
    setCompareMode(true);
    setSelectedIds(new Set());
    setCompareError(null);
  };

  const handleExitCompare = () => {
    setCompareMode(false);
    setSelectedIds(new Set());
    setCompareError(null);
  };

  const handleCompare = async () => {
    if (selectedIds.size < 2) return;
    setIsComparing(true);
    setCompareError(null);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("dashboard.compareError"));
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let resultId: string | null = null;
      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                if (parsed.result?.id) {
                  resultId = parsed.result.id;
                }
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
              } catch (err: any) {
                if (err instanceof SyntaxError) continue;
                throw err;
              }
            }
          }
        }
      }
      if (!resultId) {
        throw new Error(t("dashboard.compareError"));
      }
      router.push(`/board?id=${resultId}`);
    } catch (err: any) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setCompareError(err.message || t("dashboard.compareError"));
    } finally {
      setIsComparing(false);
    }
  };

  const handleReview = async () => {
    if (selectedIds.size < 2) return;
    setIsReviewing(true);
    setIsReviewStreaming(true);
    setReviewError(null);
    setReviewContent("");
    if (reviewAbortRef.current) reviewAbortRef.current.abort();
    const controller = new AbortController();
    reviewAbortRef.current = controller;
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: Array.from(selectedIds) }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("dashboard.reviewError"));
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  setReviewContent((prev) => (prev || "") + parsed.content);
                }
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
              } catch (err: any) {
                if (err instanceof SyntaxError) continue;
                throw err;
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setReviewError(err.message || t("dashboard.reviewError"));
      setReviewContent(null);
    } finally {
      setIsReviewing(false);
      setIsReviewStreaming(false);
    }
  };

  const handleDownloadReview = () => {
    if (!reviewContent) return;
    const blob = new Blob([reviewContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `literature-review-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyReview = async () => {
    if (!reviewContent) return;
    try {
      await navigator.clipboard.writeText(reviewContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  };

  return (
    <div className="min-h-screen bg-[#F9F8F6] text-[#1C1C1C] font-sans">
      {/* Navigation */}
      <SiteHeader />

      <main className="pt-32 pb-24 px-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 mb-4 font-sans font-semibold">
                {t("dashboard.subtitle")}
              </p>
              <h1 className="font-serif text-4xl md:text-6xl tracking-tight leading-[1.05]">
                {t("dashboard.title1")}{" "}
                <span className="italic text-[#1C1C1C]/60">
                  {t("dashboard.title2")}
                </span>
              </h1>
              <p className="font-sans text-sm md:text-base text-[#1C1C1C]/60 max-w-lg mt-4 leading-relaxed">
                {t("dashboard.description")}
              </p>
            </div>
            <div className="flex items-center gap-3 self-start md:self-auto">
              {compareMode ? (
                <button
                  onClick={handleExitCompare}
                  disabled={isComparing}
                  className="inline-flex items-center justify-center gap-2 font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] border border-[#1C1C1C]/30 px-6 py-4 transition-colors duration-300 focus:outline-none disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  {t("dashboard.exitCompare")}
                </button>
              ) : (
                <button
                  onClick={handleEnterCompare}
                  className="inline-flex items-center justify-center gap-2 font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] border border-[#1C1C1C]/30 px-6 py-4 transition-colors duration-300 focus:outline-none"
                >
                  <GitCompare className="w-4 h-4" />
                  {t("dashboard.compare")}
                </button>
              )}
              <button
                onClick={() => setShowTypeSelector(true)}
                className="inline-flex items-center justify-center gap-2 bg-[#1C1C1C] text-[#F9F8F6] font-sans text-xs uppercase tracking-[0.2em] px-8 py-4 border border-[#1C1C1C] hover:bg-transparent hover:text-[#1C1C1C] transition-colors duration-300 focus:outline-none"
              >
                <Plus className="w-4 h-4" />
                {t("dashboard.create")}
              </button>
            </div>
          </div>

          {/* P2-3: Global Knowledge Graph — aggregates all projects'
              concept graphs into one Obsidian-style view. Clicking a
              node navigates to that concept's source article.
              `refreshKey` bumps after a project is deleted so the
              merged view drops that project's concepts. */}
          <GlobalKnowledgeGraph refreshKey={graphRefreshKey} />

          {/* Content */}
          {projects === null ? (
            <div className="border border-[#1C1C1C]/10 p-12 text-center">
              <LoadingScreen message={t("dashboard.loading")} />
            </div>
          ) : error ? (
            <div className="border border-[#1C1C1C]/20 p-8 text-center">
              <p className="font-sans text-sm text-[#1C1C1C]/80">{error}</p>
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onCreate={() => setShowTypeSelector(true)} />
          ) : (
            <ProjectContent
              projects={projects}
              filterFolderId={filterFolderId}
              filterTagId={filterTagId}
              onSetFolderFilter={setFilterFolderId}
              onSetTagFilter={setFilterTagId}
              onClearFilters={() => {
                setFilterFolderId(null);
                setFilterTagId(null);
              }}
              onDelete={(p) => setDeleteTarget(p)}
              onOrganize={(p) => setOrgTarget(p)}
              compareMode={compareMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
          )}
        </div>
      </main>

      {/* Floating Compare Action Bar */}
      {compareMode && !isComparing && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#F9F8F6] border-t border-[#1C1C1C]/10 px-6 py-4 animate-in slide-in-from-bottom-4 duration-300">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <GitCompare className="w-4 h-4 text-[#1C1C1C]/60" />
              <span className="font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C]/60">
                {selectedIds.size < 2
                  ? t("dashboard.compareMinSelect")
                  : t("dashboard.compareSelected", { count: selectedIds.size })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCompare}
                disabled={selectedIds.size < 2}
                className="inline-flex items-center justify-center gap-2 bg-transparent text-[#1C1C1C] font-sans text-xs uppercase tracking-[0.2em] px-6 py-3 border border-[#1C1C1C]/30 hover:border-[#1C1C1C] transition-colors duration-300 focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <GitCompare className="w-4 h-4" />
                {t("dashboard.compare")}
              </button>
              <button
                onClick={handleReview}
                disabled={selectedIds.size < 2}
                className="inline-flex items-center justify-center gap-2 bg-[#1C1C1C] text-[#F9F8F6] font-sans text-xs uppercase tracking-[0.2em] px-8 py-3 border border-[#1C1C1C] hover:bg-transparent hover:text-[#1C1C1C] transition-colors duration-300 focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <FileStack className="w-4 h-4" />
                {t("dashboard.review")}
              </button>
            </div>
          </div>
          {compareError && (
            <p className="max-w-7xl mx-auto mt-2 font-sans text-xs text-[#1C1C1C]/80">
              {compareError}
            </p>
          )}
        </div>
      )}

      {/* Comparing Overlay */}
      {isComparing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#F9F8F6]/90 backdrop-blur-sm">
          <LoadingScreen message={t("dashboard.comparing")} />
        </div>
      )}

      {/* Reviewing Overlay */}
      {isReviewing && !reviewContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#F9F8F6]/90 backdrop-blur-sm">
          <LoadingScreen message={t("dashboard.reviewing")} />
        </div>
      )}

      {/* Review Result Modal */}
      {reviewContent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10 bg-[#1C1C1C]/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={handleCloseReview}
        >
          <div
            ref={reviewModalRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("dashboard.reviewTitle")}
            className="w-full max-w-3xl max-h-[85vh] bg-[#F9F8F6] border border-[#1C1C1C]/10 flex flex-col animate-in zoom-in duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-[#1C1C1C]/10">
              <div className="flex items-center gap-3">
                <FileStack className="w-5 h-5 text-[#1C1C1C]/60" />
                <h2 className="font-serif text-xl tracking-tight text-[#1C1C1C]">
                  {t("dashboard.reviewTitle")}
                </h2>
              </div>
              <button
                onClick={handleCloseReview}
                className="p-2 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors focus:outline-none"
                aria-label={t("dashboard.reviewClose")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <Markdown
                options={{
                  disableParsingRawHTML: true,
                  forceBlock: true,
                }}
                className="prose prose-sm max-w-none font-sans text-[#1C1C1C]/80 leading-relaxed
                  [&_h1]:font-serif [&_h1]:text-2xl [&_h1]:tracking-tight [&_h1]:mb-4 [&_h1]:mt-6
                  [&_h2]:font-serif [&_h2]:text-xl [&_h2]:tracking-tight [&_h2]:mb-3 [&_h2]:mt-6
                  [&_h3]:font-serif [&_h3]:text-lg [&_h3]:tracking-tight [&_h3]:mb-2 [&_h3]:mt-4
                  [&_p]:mb-3 [&_p]:leading-relaxed
                  [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5
                  [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5
                  [&_li]:mb-1
                  [&_blockquote]:border-l-2 [&_blockquote]:border-[#1C1C1C]/20 [&_blockquote]:pl-4 [&_blockquote]:text-[#1C1C1C]/60 [&_blockquote]:italic
                  [&_code]:font-mono [&_code]:text-xs [&_code]:bg-[#1C1C1C]/5 [&_code]:px-1
                  [&_strong]:text-[#1C1C1C] [&_strong]:font-semibold"
              >
                {reviewContent}
              </Markdown>
              {isReviewStreaming && (
                <span className="inline-block w-1.5 h-3.5 bg-[#1C1C1C]/40 ml-0.5 align-middle animate-pulse" />
              )}
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-end gap-3 px-8 py-4 border-t border-[#1C1C1C]/10">
              <button
                onClick={handleCopyReview}
                className="inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C] border border-[#1C1C1C]/30 px-5 py-2.5 hover:bg-[#1C1C1C]/5 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? t("dashboard.reviewCopied") : t("dashboard.reviewCopy")}
              </button>
              <button
                onClick={handleDownloadReview}
                className="inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.2em] text-[#F9F8F6] bg-[#1C1C1C] border border-[#1C1C1C] px-5 py-2.5 hover:bg-[#1C1C1C]/80 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {t("dashboard.reviewDownload")}
              </button>
            </div>
          </div>
        </div>
      )}
      {reviewError && !reviewContent && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#1C1C1C] text-[#F9F8F6] px-6 py-3 font-sans text-xs">
          {reviewError}
        </div>
      )}

      {/* Type Selector Modal */}
      {showTypeSelector && (
        <TypeSelectorModal
          onSelect={handleSelectType}
          onClose={() => setShowTypeSelector(false)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6 bg-[#1C1C1C]/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => !isDeleting && setDeleteTarget(null)}
        >
          <div
            ref={deleteModalRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("dashboard.deleteTitle")}
            className="w-full max-w-md bg-[#F9F8F6] border border-[#1C1C1C]/10 p-8 animate-in zoom-in duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 border border-[#1C1C1C]/20 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4 text-[#1C1C1C]/60" />
              </div>
              <h2 className="font-serif text-xl tracking-tight text-[#1C1C1C]">
                {t("dashboard.deleteTitle")}
              </h2>
            </div>
            <p className="font-sans text-sm text-[#1C1C1C]/60 leading-relaxed mb-8">
              {t("dashboard.deleteConfirm", { title: deleteTarget.title })}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="flex-1 font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C] border border-[#1C1C1C]/30 py-3 hover:bg-[#1C1C1C]/5 transition-colors disabled:opacity-50"
              >
                {t("dashboard.deleteCancel")}
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 font-sans text-xs uppercase tracking-[0.2em] text-[#F9F8F6] bg-[#1C1C1C] border border-[#1C1C1C] py-3 hover:bg-[#1C1C1C]/80 transition-colors disabled:opacity-50"
              >
                {isDeleting ? t("dashboard.deleting") : t("dashboard.deleteConfirmBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project Organization Dialog */}
      {orgTarget && (
        <ProjectOrganizationDialog
          projectId={orgTarget.id}
          initialFolder={orgTarget.folder ?? null}
          initialTags={orgTarget.tags ?? []}
          open={!!orgTarget}
          onClose={() => setOrgTarget(null)}
          onUpdated={(folder, tags) => {
            setProjects((prev) =>
              prev
                ? prev.map((p) =>
                    p.id === orgTarget.id ? { ...p, folder, tags } : p
                  )
                : prev
            );
            setOrgTarget(null);
          }}
        />
      )}
    </div>
  );
}

function TypeSelectorModal({
  onSelect,
  onClose,
}: {
  onSelect: (type: ProjectType) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const modalRef = useModalA11y(true, onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10 bg-[#1C1C1C]/40 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("projectType.title")}
        className="w-full max-w-3xl bg-[#F9F8F6] border border-[#1C1C1C]/10 p-8 md:p-12 animate-in zoom-in duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-8">
          <div className="text-center flex-1">
            <h2 className="font-serif text-3xl md:text-4xl tracking-tight text-[#1C1C1C] mb-2">
              {t("projectType.title")}
            </h2>
            <p className="font-sans text-sm text-[#1C1C1C]/60">
              {t("projectType.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-2 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors focus:outline-none shrink-0 -mt-1 -mr-1"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#1C1C1C]/10 border border-[#1C1C1C]/10">
          {/* Paper Research */}
          <button
            type="button"
            onClick={() => onSelect("paper")}
            className="group bg-[#F9F8F6] p-8 md:p-10 text-left flex flex-col justify-between min-h-[240px] hover:bg-[#1C1C1C]/5 transition-colors duration-300"
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#1C1C1C]/40">
                  {t("projectType.paperIcon")}
                </span>
                <BookOpen className="w-5 h-5 text-[#1C1C1C]/30 group-hover:text-[#1C1C1C]/60 transition-colors" />
              </div>
              <h3 className="font-serif text-2xl tracking-tight mb-3 group-hover:italic transition-all duration-300">
                {t("projectType.paper")}
              </h3>
              <p className="font-sans text-sm text-[#1C1C1C]/60 leading-relaxed">
                {t("projectType.paperDesc")}
              </p>
            </div>
            <div className="flex items-center gap-2 mt-6 pt-6 border-t border-[#1C1C1C]/10">
              <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 group-hover:text-[#1C1C1C] transition-colors">
                {t("projectType.continue")}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-[#1C1C1C]/40 group-hover:text-[#1C1C1C] group-hover:translate-x-1 transition-all" />
            </div>
          </button>

          {/* Code Project */}
          <button
            type="button"
            onClick={() => onSelect("code")}
            className="group bg-[#F9F8F6] p-8 md:p-10 text-left flex flex-col justify-between min-h-[240px] hover:bg-[#1C1C1C]/5 transition-colors duration-300"
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#1C1C1C]/40">
                  {t("projectType.codeIcon")}
                </span>
                <Code2 className="w-5 h-5 text-[#1C1C1C]/30 group-hover:text-[#1C1C1C]/60 transition-colors" />
              </div>
              <h3 className="font-serif text-2xl tracking-tight mb-3 group-hover:italic transition-all duration-300">
                {t("projectType.code")}
              </h3>
              <p className="font-sans text-sm text-[#1C1C1C]/60 leading-relaxed">
                {t("projectType.codeDesc")}
              </p>
            </div>
            <div className="flex items-center gap-2 mt-6 pt-6 border-t border-[#1C1C1C]/10">
              <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 group-hover:text-[#1C1C1C] transition-colors">
                {t("projectType.continue")}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-[#1C1C1C]/40 group-hover:text-[#1C1C1C] group-hover:translate-x-1 transition-all" />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectContent({
  projects,
  filterFolderId,
  filterTagId,
  onSetFolderFilter,
  onSetTagFilter,
  onClearFilters,
  onDelete,
  onOrganize,
  compareMode,
  selectedIds,
  onToggleSelect,
}: {
  projects: ProjectSummary[];
  filterFolderId: string | null;
  filterTagId: string | null;
  onSetFolderFilter: (id: string | null) => void;
  onSetTagFilter: (id: string | null) => void;
  onClearFilters: () => void;
  onDelete: (p: ProjectSummary) => void;
  onOrganize: (p: ProjectSummary) => void;
  compareMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const hasFilter = filterFolderId !== null || filterTagId !== null;

  // Defensive dedupe: a duplicate project id from the API or a buggy
  // local state update will crash React's keyed rendering. First
  // occurrence wins.
  const seenIds = new Set<string>();
  const uniqueProjects = projects.filter((p) => {
    if (seenIds.has(p.id)) return false;
    seenIds.add(p.id);
    return true;
  });

  const filtered = uniqueProjects.filter((p) => {
    if (filterFolderId && p.folder?.id !== filterFolderId) return false;
    if (filterTagId && !(p.tags ?? []).some((tag) => tag.id === filterTagId))
      return false;
    return true;
  });

  // Derive unique folders and tags from projects for the filter bar
  const folders = Array.from(
    new Map(
      projects
        .filter((p) => p.folder)
        .map((p) => [p.folder!.id, p.folder!])
    ).values()
  );
  const tags = Array.from(
    new Map(
      projects
        .flatMap((p) => p.tags ?? [])
        .map((tag) => [tag.id, tag])
    ).values()
  );

  return (
    <div>
      {/* Filter Bar */}
      {(folders.length > 0 || tags.length > 0) && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() =>
                onSetFolderFilter(filterFolderId === f.id ? null : f.id)
              }
              className={cn(
                "flex items-center gap-1.5 border px-3 py-1.5 text-xs transition-colors",
                filterFolderId === f.id
                  ? "border-[#1C1C1C] bg-[#1C1C1C] text-[#F9F8F6]"
                  : "border-border hover:border-[#1C1C1C]"
              )}
            >
              <span
                className="h-2 w-2"
                style={{ backgroundColor: f.color }}
              />
              {f.name}
            </button>
          ))}
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() =>
                onSetTagFilter(filterTagId === tag.id ? null : tag.id)
              }
              className={cn(
                "border px-3 py-1.5 text-xs transition-colors",
                filterTagId === tag.id
                  ? "border-[#1C1C1C] bg-[#1C1C1C] text-[#F9F8F6]"
                  : "border-border hover:border-[#1C1C1C]"
              )}
            >
              {tag.name}
            </button>
          ))}
          {hasFilter && (
            <button
              onClick={onClearFilters}
              className="text-[10px] uppercase tracking-[0.15em] text-[#1C1C1C]/50 hover:text-[#1C1C1C] transition-colors"
            >
              {t("organization.clearFilter")}
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="border border-[#1C1C1C]/10 p-12 text-center">
          <p className="font-sans text-sm text-[#1C1C1C]/60">
            {t("organization.noMatch")}
          </p>
        </div>
      ) : (
        <ProjectGrid
          projects={filtered}
          onDelete={onDelete}
          onOrganize={onOrganize}
          compareMode={compareMode}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
        />
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="border border-[#1C1C1C]/10 p-12 md:p-20 text-center">
      <div className="w-12 h-12 border border-[#1C1C1C]/20 mx-auto mb-8 flex items-center justify-center">
        <FileText className="w-5 h-5 text-[#1C1C1C]/40" />
      </div>
      <h2 className="font-serif text-2xl md:text-3xl tracking-tight mb-3">
        {t("dashboard.empty.title")}
      </h2>
      <p className="font-sans text-sm text-[#1C1C1C]/60 max-w-md mx-auto leading-relaxed mb-8">
        {t("dashboard.empty.description")}
      </p>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 font-sans text-xs uppercase tracking-[0.2em] text-[#1C1C1C] border-b border-[#1C1C1C] pb-1 hover:italic transition-all"
      >
        {t("dashboard.empty.cta")}
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function ProjectGrid({
  projects,
  onDelete,
  onOrganize,
  compareMode,
  selectedIds,
  onToggleSelect,
}: {
  projects: ProjectSummary[];
  onDelete: (p: ProjectSummary) => void;
  onOrganize: (p: ProjectSummary) => void;
  compareMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();

  // Defensive dedupe: a duplicate project id would crash React's keyed
  // rendering below. First occurrence wins.
  const seenIds = new Set<string>();
  const uniqueProjects = projects.filter((p) => {
    if (seenIds.has(p.id)) return false;
    seenIds.add(p.id);
    return true;
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-[#1C1C1C]/10 border border-[#1C1C1C]/10">
      {uniqueProjects.map((p, i) => {
        const date = new Date(p.createdAt);
        const dateStr = date.toLocaleDateString(
          i18n.language.startsWith("zh") ? "zh-CN" : "en-US",
          { year: "numeric", month: "short", day: "numeric" }
        );
        const isUrl = !!p.originalUrl;
        const isCode = p.type === "code";
        const boardHref = isCode ? `/codeboard?id=${p.id}` : `/board?id=${p.id}`;
        const isSelected = selectedIds?.has(p.id);
        const isSelectable = compareMode;
        return (
          <div
            key={p.id}
            className={`group relative bg-[#F9F8F6] transition-colors duration-300 ${
              isSelected ? "bg-[#1C1C1C]/5" : "hover:bg-[#1C1C1C]/5"
            }`}
          >
            {isSelectable ? (
              <button
                onClick={() => onToggleSelect?.(p.id)}
                className="block w-full text-left p-8 md:p-10 flex flex-col justify-between min-h-[220px]"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#1C1C1C]/40">
                      {t("dashboard.project", { index: i + 1 })}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[#1C1C1C]/30">
                        {isCode ? t("projectType.codeIcon") : t("projectType.paperIcon")}
                      </span>
                      {isSelected ? (
                        <div className="w-5 h-5 border border-[#1C1C1C] bg-[#1C1C1C] flex items-center justify-center">
                          <Check className="w-3 h-3 text-[#F9F8F6]" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 border border-[#1C1C1C]/30" />
                      )}
                    </div>
                  </div>
                  <h3 className="font-serif text-2xl tracking-tight mb-3 line-clamp-2">
                    {p.title}
                  </h3>
                  {p.originalUrl && (
                    <p className="font-mono text-[10px] text-[#1C1C1C]/40 truncate">
                      {p.originalUrl}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between mt-6 pt-6 border-t border-[#1C1C1C]/10">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
                    {dateStr}
                  </span>
                </div>
              </button>
            ) : (
              <>
                <Link
                  href={boardHref}
                  className="block p-8 md:p-10 flex flex-col justify-between min-h-[220px]"
                >
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#1C1C1C]/40">
                        {t("dashboard.project", { index: i + 1 })}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[#1C1C1C]/30 group-hover:text-[#1C1C1C]/60 transition-colors">
                          {isCode
                            ? t("projectType.codeIcon")
                            : p.type === "image"
                            ? t("projectType.imageIcon", "Image")
                            : t("projectType.paperIcon")}
                        </span>
                        {isUrl ? (
                          <Globe className="w-4 h-4 text-[#1C1C1C]/30 group-hover:text-[#1C1C1C]/60 transition-colors" />
                        ) : isCode ? (
                          <Code2 className="w-4 h-4 text-[#1C1C1C]/30 group-hover:text-[#1C1C1C]/60 transition-colors" />
                        ) : p.type === "image" ? (
                          <ImageIcon className="w-4 h-4 text-[#1C1C1C]/30 group-hover:text-[#1C1C1C]/60 transition-colors" />
                        ) : (
                          <FileText className="w-4 h-4 text-[#1C1C1C]/30 group-hover:text-[#1C1C1C]/60 transition-colors" />
                        )}
                      </div>
                    </div>
                    {/* Tier 2: cover image for image-type projects */}
                    {p.thumbnail ? (
                      <div className="mb-4 border border-[#1C1C1C]/10 bg-[#1C1C1C]/5 aspect-[4/3] overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.thumbnail}
                          alt={p.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : null}
                    <h3 className="font-serif text-2xl tracking-tight mb-3 group-hover:italic transition-all duration-300 line-clamp-2">
                      {p.title}
                    </h3>
                    {p.originalUrl && (
                      <p className="font-mono text-[10px] text-[#1C1C1C]/40 truncate">
                        {p.originalUrl}
                      </p>
                    )}
                    {(p.folder || (p.tags && p.tags.length > 0)) && (
                      <div className="mt-4 flex flex-wrap items-center gap-1.5">
                        {p.folder && (
                          <span
                            className="inline-flex items-center gap-1 border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[#1C1C1C]/70"
                            title={`Folder: ${p.folder.name}`}
                          >
                            <span
                              className="h-1.5 w-1.5"
                              style={{ backgroundColor: p.folder.color }}
                            />
                            {p.folder.name}
                          </span>
                        )}
                        {(p.tags ?? []).slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[#1C1C1C]/60"
                          >
                            {tag.name}
                          </span>
                        ))}
                        {(p.tags?.length ?? 0) > 3 && (
                          <span className="text-[10px] text-[#1C1C1C]/40">
                            +{p.tags!.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-6 pt-6 border-t border-[#1C1C1C]/10">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
                      {dateStr}
                    </span>
                    <ArrowRight className="w-4 h-4 text-[#1C1C1C]/40 group-hover:text-[#1C1C1C] group-hover:translate-x-1 transition-all" />
                  </div>
                </Link>
                {!compareMode && (
                  <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onOrganize(p);
                      }}
                      className="p-2 text-[#1C1C1C]/20 hover:text-[#1C1C1C] hover:bg-[#1C1C1C]/10 transition-all"
                      title={t("organization.organizeTitle")}
                      aria-label={t("organization.organizeTitle")}
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete(p);
                      }}
                      className="p-2 text-[#1C1C1C]/20 hover:text-[#1C1C1C] hover:bg-[#1C1C1C]/10 transition-all"
                      title={t("dashboard.deleteTitle")}
                      aria-label={t("dashboard.deleteTitle")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
