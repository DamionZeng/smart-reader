"use client";

import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DocumentNode, ParsedDocument } from "@/types";
import type { DocumentSection } from "@/types/concept-graph";
import {
  AlignLeft,
  Search,
  FileDown,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeft,
  Save,
  Loader2,
  FilePlus2,
  X,
  ChevronDown,
  Upload,
  Globe,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/utils/cn";
import type { ExportFormat } from "@/utils/export-markdown";

interface SearchResult {
  id: string;
  title: string;
  type: string;
  snippet: string;
}

interface SidebarProps {
  document: ParsedDocument | null;
  activeNodeId: string | null;
  onSelectNode: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  /** Current editable title (controlled by the board) */
  title: string;
  /** Called on every keystroke in the title input */
  onTitleChange: (next: string) => void;
  /** Commit the current title (typically on blur / Enter) */
  onTitleCommit: () => void;
  /** Trigger a manual save of the whole project */
  onSave: () => void;
  /** Whether a save is currently in flight (disables the button) */
  isSaving: boolean;
  /** Whether there are pending unsaved changes (controls button emphasis) */
  isDirty: boolean;
  /** Open the import / ingestion modal */
  onImport: () => void;
  /** Import a JSON graph file */
  onImportJson?: (file: File) => void;
  /** Export the graph in the specified format */
  onExport: (format: ExportFormat) => void;
  /** 跳转到原文锚点（用于章节大纲点击跳转） */
  onJumpToAnchor?: (anchor: string) => void;
}

export function Sidebar({
  document,
  activeNodeId,
  onSelectNode,
  isOpen,
  onToggle,
  title,
  onTitleChange,
  onTitleCommit,
  onSave,
  isSaving,
  isDirty,
  onImport,
  onImportJson,
  onExport,
  onJumpToAnchor,
}: SidebarProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  // 章节大纲折叠状态：存被折叠的 section id 集合（默认全部展开）
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const exportRef = useRef<HTMLDivElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(searchQuery);

  // Global (cross-project) search state
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<SearchResult[]>([]);
  const [isGlobalSearching, setIsGlobalSearching] = useState(false);
  const globalSearchRef = useRef<HTMLDivElement>(null);
  const globalInputRef = useRef<HTMLInputElement>(null);
  const globalAbortRef = useRef<AbortController | null>(null);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    window.document.addEventListener("mousedown", handler);
    return () => window.document.removeEventListener("mousedown", handler);
  }, [exportOpen]);

  // Close export dropdown on Escape so it matches the import dropdown
  // (and standard dropdown / menu behaviour in the rest of the app).
  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportOpen(false);
    };
    window.document.addEventListener("keydown", handler);
    return () => window.document.removeEventListener("keydown", handler);
  }, [exportOpen]);

  // Import dropdown: merges "Import content" (opens the ingestion modal)
  // and "Import JSON" (file picker) into a single button. Keeping them
  // in one place stops the row from wrapping to a second line — which
  // was happening because "Import JSON" is English-only and is wider
  // than the localised "Import" label.
  //
  // The menu is rendered through a React Portal into <body> because the
  // Sidebar header has `overflow-hidden` (to clip the long title input),
  // and that would otherwise clip the absolutely-positioned menu. The
  // menu position is recomputed on open and on viewport resize so it
  // stays anchored to the trigger button.
  const [importOpen, setImportOpen] = useState(false);
  const importRef = useRef<HTMLDivElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const [importMenuPos, setImportMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!importOpen) {
      setImportMenuPos(null);
      return;
    }
    const reposition = () => {
      const btn = importButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setImportMenuPos({
        top: rect.bottom + 4, // 4px = mt-1
        left: rect.left,
        width: rect.width,
      });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [importOpen]);
  useEffect(() => {
    if (!importOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        importRef.current &&
        !importRef.current.contains(target) &&
        !(target as HTMLElement).closest?.("[data-import-menu]")
      ) {
        setImportOpen(false);
      }
    };
    window.document.addEventListener("mousedown", handler);
    return () => window.document.removeEventListener("mousedown", handler);
  }, [importOpen]);
  useEffect(() => {
    if (!importOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImportOpen(false);
    };
    window.document.addEventListener("keydown", handler);
    return () => window.document.removeEventListener("keydown", handler);
  }, [importOpen]);

  // Debounced global search (500ms)
  useEffect(() => {
    const q = globalQuery.trim();
    if (!q) {
      setGlobalResults([]);
      setIsGlobalSearching(false);
      return;
    }
    setIsGlobalSearching(true);
    const timer = setTimeout(() => {
      // Abort any in-flight search request.
      if (globalAbortRef.current) globalAbortRef.current.abort();
      const controller = new AbortController();
      globalAbortRef.current = controller;
      fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        credentials: "include",
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.results) {
            setGlobalResults(data.results as SearchResult[]);
          }
        })
        .catch(() => {
          // Ignore abort / network errors.
        })
        .finally(() => {
          setIsGlobalSearching(false);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [globalQuery]);

  // Focus the global search input when the overlay opens
  useEffect(() => {
    if (globalSearchOpen) {
      setTimeout(() => globalInputRef.current?.focus(), 50);
    } else {
      setGlobalQuery("");
      setGlobalResults([]);
    }
  }, [globalSearchOpen]);

  // Close the global search overlay on Escape
  useEffect(() => {
    if (!globalSearchOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGlobalSearchOpen(false);
    };
    window.document.addEventListener("keydown", handler);
    return () => window.document.removeEventListener("keydown", handler);
  }, [globalSearchOpen]);

  if (!document) return null;

  // Defensive dedupe: some legacy saved projects (or a buggy KG
  // generation) carry `document.nodes` entries with the same id. React
  // will throw "two children with the same key" if we render them as-is.
  // First occurrence wins — duplicate data is treated as redundant.
  const uniqueNodes = useMemo(() => {
    const seen = new Set<string>();
    const out: typeof document.nodes = [];
    for (const n of document.nodes) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
    return out;
  }, [document.nodes]);

  // Full-text search across title, description, sourceContext, details, and note
  const filteredNodes = useMemo(() => {
    if (!deferredQuery.trim()) return uniqueNodes;
    const q = deferredQuery.toLowerCase();
    return uniqueNodes.filter((node) => {
      const d = node.data as Record<string, string | undefined>;
      const haystack = [
        d.title,
        d.description,
        d.sourceContext,
        d.details,
        d.note,
        d.filePath,
        node.section,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [uniqueNodes, deferredQuery]);

  // 章节大纲：按搜索词过滤 sections（标题 + 摘要，含子章节）
  const sections = document.sections;
  const filteredSections = useMemo(() => {
    if (!sections || sections.length === 0) return [];
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter((s) => {
      const topHit =
        s.title.toLowerCase().includes(q) ||
        (s.summary || "").toLowerCase().includes(q);
      if (topHit) return true;
      return (s.children || []).some(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.summary || "").toLowerCase().includes(q)
      );
    });
  }, [sections, deferredQuery]);

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 点击章节标题：优先用 anchor 跳转原文，否则选中首个关联概念
  const handleSectionClick = useCallback(
    (section: DocumentSection) => {
      if (section.anchor && onJumpToAnchor) {
        onJumpToAnchor(section.anchor);
      } else if (section.conceptIds.length > 0) {
        onSelectNode(section.conceptIds[0]);
      }
    },
    [onJumpToAnchor, onSelectNode]
  );

  // Highlight matching text
  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    const q = query.trim();
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-[#1C1C1C]/15 text-[#1C1C1C] px-0.5">
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div
      id="sidebar-content"
      className={cn(
        "border-r border-[#1C1C1C]/10 bg-[#F9F8F6] flex flex-col h-full z-10 shrink-0 transition-all duration-300",
        isOpen ? "w-80" : "w-16"
      )}
    >
      <div
        className={cn(
          "h-auto min-h-20 border-b border-[#1C1C1C]/10 flex bg-[#F9F8F6] shrink-0 overflow-hidden",
          isOpen ? "items-stretch px-6 py-4 gap-3" : "items-center justify-center px-0 py-0"
        )}
      >
        {isOpen ? (
          <div className="flex-1 flex flex-col min-w-0 animate-in fade-in duration-300">
            <Link
              href="/dashboard"
              className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors flex items-center gap-1 mb-2"
            >
              <ArrowLeft className="w-3 h-3" />
              {t("board.backToDashboard")}
            </Link>
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              onBlur={onTitleCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === "Escape") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder={t("board.titlePlaceholder")}
              aria-label={t("board.titlePlaceholder")}
              maxLength={255}
              className="font-serif tracking-tight text-xl text-[#1C1C1C] leading-snug bg-transparent border border-transparent hover:border-[#1C1C1C]/10 focus:border-[#1C1C1C] focus:outline-none transition-colors px-2 py-1 -mx-2 w-[calc(100%+1rem)] truncate"
            />
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2">
              {onImportJson && (
                <input
                  type="file"
                  accept="application/json,.json"
                  ref={jsonInputRef}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onImportJson(file);
                      e.target.value = "";
                    }
                  }}
                />
              )}
              <div className="relative" ref={importRef}>
                <button
                  ref={importButtonRef}
                  type="button"
                  onClick={() => setImportOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[0.2em] px-3 py-1.5 border border-[#1C1C1C]/40 bg-transparent text-[#1C1C1C] hover:border-[#1C1C1C] hover:bg-[#1C1C1C] hover:text-[#F9F8F6] transition-colors duration-200 focus:outline-none"
                  aria-haspopup="menu"
                  aria-expanded={importOpen}
                  aria-label={t("board.importContent")}
                >
                  <FilePlus2 className="w-3 h-3" aria-hidden />
                  <span>{t("board.importContent")}</span>
                  <ChevronDown
                    className={cn(
                      "w-3 h-3 transition-transform duration-200",
                      importOpen && "rotate-180"
                    )}
                  />
                </button>
                {importOpen &&
                  importMenuPos &&
                  typeof window !== "undefined" &&
                  createPortal(
                    <div
                      data-import-menu
                      role="menu"
                      style={{
                        position: "fixed",
                        top: importMenuPos.top,
                        left: importMenuPos.left,
                        minWidth: importMenuPos.width,
                      }}
                      className="border border-[#1C1C1C] bg-[#F9F8F6] z-50 animate-in fade-in duration-150"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setImportOpen(false);
                          onImport();
                        }}
                        className="w-full text-left px-3 py-2 text-[10px] uppercase tracking-[0.2em] font-sans text-[#1C1C1C] hover:bg-[#1C1C1C] hover:text-[#F9F8F6] transition-colors flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <FilePlus2 className="w-3 h-3" aria-hidden />
                        <span>{t("board.importContent")}</span>
                      </button>
                      {onImportJson && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setImportOpen(false);
                            jsonInputRef.current?.click();
                          }}
                          className="w-full text-left px-3 py-2 text-[10px] uppercase tracking-[0.2em] font-sans text-[#1C1C1C] hover:bg-[#1C1C1C] hover:text-[#F9F8F6] transition-colors flex items-center gap-1.5 whitespace-nowrap border-t border-[#1C1C1C]/10"
                        >
                          <Upload className="w-3 h-3" aria-hidden />
                          <span>Import JSON</span>
                        </button>
                      )}
                    </div>,
                    window.document.body
                  )}
              </div>
            </div>
              <button
                type="button"
                onClick={onSave}
                disabled={isSaving}
                className={cn(
                  "inline-flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[0.2em] px-3 py-1.5 border transition-colors duration-200 focus:outline-none",
                  "border-[#1C1C1C]",
                  isDirty
                    ? "bg-[#1C1C1C] text-[#F9F8F6] hover:bg-transparent hover:text-[#1C1C1C]"
                    : "bg-transparent text-[#1C1C1C] hover:bg-[#1C1C1C] hover:text-[#F9F8F6]",
                  isSaving && "opacity-50 cursor-not-allowed"
                )}
                aria-label={t("board.save")}
              >
                {isSaving ? (
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                ) : (
                  <Save className="w-3 h-3" aria-hidden />
                )}
                <span>{isSaving ? t("board.saving") : t("board.save")}</span>
              </button>
            </div>
          </div>
        ) : (
          <Link
            href="/dashboard"
            className="p-2 text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors focus:outline-none"
            title={t("board.backToDashboard")}
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
        )}
        <button
          onClick={onToggle}
          className="p-2 text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors focus:outline-none shrink-0 self-start"
          aria-label={isOpen ? t("board.collapseSidebar") : t("board.expandSidebar")}
          aria-expanded={isOpen}
          aria-controls="sidebar-content"
        >
          {isOpen ? (
            <PanelLeftClose className="w-5 h-5" />
          ) : (
            <PanelLeftOpen className="w-5 h-5 mx-auto" />
          )}
        </button>
      </div>

      {isOpen ? (
        <>
          <div className="p-6 border-b border-[#1C1C1C]/10 space-y-6 shrink-0 animate-in fade-in duration-300">
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setExportOpen((v) => !v)}
                className="w-full flex justify-center items-center gap-2 bg-[#1C1C1C] hover:bg-[#1C1C1C]/80 text-[#F9F8F6] font-sans py-3 px-6 transition-colors duration-200 text-xs tracking-wide uppercase"
              >
                <FileDown className="w-4 h-4" />
                {t("board.export")}
                <ChevronDown className={cn("w-3 h-3 transition-transform", exportOpen && "rotate-180")} />
              </button>
              {exportOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 border border-[#1C1C1C] bg-[#F9F8F6] z-20 animate-in fade-in duration-150">
                  {([
                    { fmt: "markdown" as const, label: "Markdown (.md)" },
                    { fmt: "json" as const, label: "JSON (.json)" },
                    { fmt: "html" as const, label: "HTML (.html)" },
                    { fmt: "pdf" as const, label: `${t("sidebar.exportPDF")} (.pdf)` },
                  ]).map(({ fmt, label }) => (
                    <button
                      key={fmt}
                      onClick={() => {
                        onExport(fmt);
                        setExportOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-sans tracking-wide text-[#1C1C1C] hover:bg-[#1C1C1C] hover:text-[#F9F8F6] transition-colors border-b border-[#1C1C1C]/10 last:border-b-0"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative border-b border-[#1C1C1C]/10 pb-2">
              <Search className="w-4 h-4 text-[#1C1C1C]/40 absolute left-0 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("board.search")}
                className="w-full bg-transparent border-none text-[#1C1C1C] text-sm pl-8 pr-6 focus:outline-none placeholder:text-[#1C1C1C]/40 placeholder:italic placeholder:font-serif"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-0 top-1/2 -translate-y-1/2 p-0.5 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
                  aria-label={t("board.clearSearch")}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setGlobalSearchOpen(true)}
              className="inline-flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors duration-200 focus:outline-none pt-1"
              aria-label={t("sidebar.searchAllProjects")}
            >
              <Globe className="w-3 h-3" aria-hidden />
              <span>{t("sidebar.searchAllProjects")}</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 animate-in fade-in duration-300">
            <div className="text-[10px] text-[#1C1C1C]/60 uppercase font-sans tracking-[0.2em] mb-6">
              {t("board.outline")}
            </div>
            {sections && sections.length > 0 ? (
              // 章节大纲视图（LLM 整理的逻辑章节树，支持折叠/展开）
              filteredSections.length === 0 ? (
                <p className="font-sans text-xs italic text-[#1C1C1C]/40">
                  {t("board.searchNoResults")}
                </p>
              ) : (
                <nav className="space-y-3">
                  {filteredSections.map((section, i) => {
                    const hasChildren =
                      !!section.children && section.children.length > 0;
                    const isCollapsed = collapsedSections.has(section.id);
                    return (
                      <div key={section.id} className="space-y-1.5">
                        <div className="flex items-start gap-3">
                          <span className="text-[10px] font-mono text-[#1C1C1C]/30 mt-1 shrink-0">
                            {(i + 1).toString().padStart(2, "0")}
                          </span>
                          <button
                            onClick={() => handleSectionClick(section)}
                            className="flex-1 text-left group focus:outline-none"
                          >
                            <span className="block font-serif text-sm leading-snug group-hover:italic text-[#1C1C1C]/80 transition-colors">
                              {highlightMatch(section.title, deferredQuery)}
                            </span>
                            {section.summary && (
                              <span className="block font-sans text-[11px] text-[#1C1C1C]/50 leading-relaxed mt-0.5 line-clamp-2">
                                {section.summary}
                              </span>
                            )}
                          </button>
                          {hasChildren && (
                            <button
                              onClick={() => toggleSection(section.id)}
                              className="text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors p-1 mt-0.5 shrink-0 focus:outline-none"
                              aria-label={isCollapsed ? "Expand" : "Collapse"}
                            >
                              <ChevronDown
                                className={cn(
                                  "w-3 h-3 transition-transform duration-200",
                                  isCollapsed && "-rotate-90"
                                )}
                              />
                            </button>
                          )}
                        </div>
                        {hasChildren && !isCollapsed && (
                          <div className="ml-7 space-y-1.5 border-l border-[#1C1C1C]/10 pl-3">
                            {section.children!.map((child) => (
                              <button
                                key={child.id}
                                onClick={() => handleSectionClick(child)}
                                className="block w-full text-left group focus:outline-none"
                              >
                                <span className="block font-sans text-xs leading-snug group-hover:italic text-[#1C1C1C]/60 transition-colors">
                                  {highlightMatch(child.title, deferredQuery)}
                                </span>
                                {child.summary && (
                                  <span className="block font-sans text-[10px] text-[#1C1C1C]/40 leading-relaxed mt-0.5 line-clamp-1">
                                    {child.summary}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </nav>
              )
            ) : uniqueNodes.length === 0 ? (
              // 回退 1：无章节且无 KG 节点
              <p className="font-sans text-xs italic text-[#1C1C1C]/40">
                {t("board.outlineEmpty")}
              </p>
            ) : filteredNodes.length === 0 ? (
              // 回退 2：搜索无结果
              <p className="font-sans text-xs italic text-[#1C1C1C]/40">
                {t("board.searchNoResults")}
              </p>
            ) : (
              // 回退 3：KG 节点列表
              <nav className="space-y-4">
                {filteredNodes.map((node, i) => (
                  <button
                    key={node.id}
                    onClick={() => onSelectNode(node.id)}
                    className={cn(
                      "w-full text-left transition-colors flex items-start gap-4 group focus:outline-none",
                      activeNodeId === node.id
                        ? "text-[#1C1C1C]"
                        : "text-[#1C1C1C]/60"
                    )}
                  >
                    <span className="text-[10px] font-mono text-[#1C1C1C]/30 mt-1 shrink-0">
                      {(i + 1).toString().padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        "line-clamp-2 leading-relaxed text-sm group-hover:italic",
                        activeNodeId === node.id
                          ? "font-serif italic"
                          : "font-sans"
                      )}
                    >
                      {highlightMatch(node.data.title, deferredQuery)}
                    </span>
                  </button>
                ))}
              </nav>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center py-6 gap-6 overflow-y-auto overflow-x-hidden animate-in fade-in duration-300">
          <button
            onClick={onImport}
            className="p-2 text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors focus:outline-none"
            title={t("board.importContent")}
            aria-label={t("board.importContent")}
          >
            <FilePlus2 className="w-4 h-4" aria-hidden />
          </button>
          <button
            onClick={() => onExport("markdown")}
            className="p-2 bg-[#1C1C1C] hover:bg-[#1C1C1C]/80 text-[#F9F8F6] transition-colors focus:outline-none"
            title={t("board.export")}
          >
            <FileDown className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              onToggle();
              setTimeout(() => searchInputRef.current?.focus(), 300);
            }}
            className="p-2 text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors focus:outline-none"
            title={t("board.search")}
            aria-label={t("board.search")}
          >
            <Search className="w-4 h-4" />
          </button>
          <div className="w-8 border-b border-[#1C1C1C]/10 my-2"></div>
          <button
            onClick={onSave}
            disabled={isSaving}
            className={cn(
              "p-2 border transition-colors focus:outline-none",
              isDirty
                ? "border-[#1C1C1C] text-[#1C1C1C]"
                : "border-transparent text-[#1C1C1C]/40",
              isSaving && "opacity-50 cursor-not-allowed"
            )}
            title={t("board.save")}
            aria-label={t("board.save")}
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            ) : (
              <Save className="w-4 h-4" aria-hidden />
            )}
          </button>
          <nav className="flex flex-col gap-4 w-full items-center">
            {uniqueNodes.map((node, i) => (
              <button
                key={node.id}
                onClick={() => onSelectNode(node.id)}
                title={node.data.title}
                className={cn(
                  "p-2 focus:outline-none transition-colors",
                  activeNodeId === node.id
                    ? "text-[#1C1C1C] font-bold"
                    : "text-[#1C1C1C]/40 hover:text-[#1C1C1C]"
                )}
              >
                <span className="text-xs font-mono">
                  {(i + 1).toString().padStart(2, "0")}
                </span>
              </button>
            ))}
          </nav>
        </div>
      )}

      {globalSearchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-[#1C1C1C]/40 px-6 pt-[10vh]"
          onClick={(e) => {
            if (globalSearchRef.current && !globalSearchRef.current.contains(e.target as Node)) {
              setGlobalSearchOpen(false);
            }
          }}
        >
          <div
            ref={globalSearchRef}
            className="w-full max-w-2xl bg-[#F9F8F6] border border-[#1C1C1C] animate-in fade-in duration-200"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1C1C1C]/10">
              <div className="flex items-center gap-3">
                <Globe className="w-4 h-4 text-[#1C1C1C]/60" />
                <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40">
                  {t("sidebar.globalSearch")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGlobalSearchOpen(false)}
                className="text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors duration-200 focus:outline-none"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-4 border-b border-[#1C1C1C]/10">
              <input
                ref={globalInputRef}
                type="text"
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                placeholder={t("sidebar.searchPlaceholder")}
                className="w-full bg-transparent border-none text-[#1C1C1C] text-sm focus:outline-none placeholder:text-[#1C1C1C]/40 placeholder:italic placeholder:font-serif"
              />
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              {isGlobalSearching ? (
                <div className="px-6 py-8 text-center">
                  <Loader2 className="w-4 h-4 text-[#1C1C1C]/30 mx-auto mb-3 animate-spin" />
                  <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
                    {t("common.loading")}
                  </p>
                </div>
              ) : globalQuery.trim() && globalResults.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <p className="font-sans text-xs italic text-[#1C1C1C]/40">
                    {t("sidebar.noResults")}
                  </p>
                </div>
              ) : globalResults.length > 0 ? (
                <>
                  <div className="px-6 pt-4 pb-2">
                    <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
                      {t("sidebar.searchResults")}
                    </p>
                  </div>
                  <ul>
                    {globalResults.map((result) => (
                      <li key={result.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const href =
                              result.type === "code"
                                ? `/codeboard?id=${encodeURIComponent(result.id)}`
                                : `/board?id=${encodeURIComponent(result.id)}`;
                            setGlobalSearchOpen(false);
                            router.push(href);
                          }}
                          className="w-full text-left px-6 py-3 border-t border-[#1C1C1C]/10 hover:bg-[#1C1C1C]/5 transition-colors duration-200 focus:outline-none group"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-serif text-sm tracking-tight text-[#1C1C1C] group-hover:italic">
                              {result.title}
                            </span>
                            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/30">
                              {result.type}
                            </span>
                          </div>
                          {result.snippet && (
                            <p className="font-sans text-xs text-[#1C1C1C]/50 leading-relaxed line-clamp-2">
                              {result.snippet}
                            </p>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
