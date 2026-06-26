import { useEffect, useRef, useState } from "react";
import { X, Download, Pencil, Check, StickyNote } from "lucide-react";
import { NodeExplanation, DocumentNode } from "@/types";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useTranslation } from "react-i18next";
import { downloadMarkdown } from "@/utils/export-markdown";

interface ExplanationPanelProps {
  node: DocumentNode;
  onClose: () => void;
  onUpdateNode?: (
    nodeId: string,
    patch: { title?: string; description?: string; note?: string }
  ) => void;
}

// The explain route streams text using [EXPLANATION] / [ANALOGY] delimiters.
// Parse the accumulated raw text into a structured explanation. Tolerates
// partial content while streaming (e.g. before the [ANALOGY] marker arrives).
function parseStreamedExplanation(raw: string): NodeExplanation {
  let simplified = "";
  let analogy = "";

  const analogyIdx = raw.indexOf("[ANALOGY]");
  if (analogyIdx >= 0) {
    simplified = raw.slice(0, analogyIdx);
    analogy = raw.slice(analogyIdx + "[ANALOGY]".length);
  } else {
    simplified = raw;
  }

  simplified = simplified.replace(/\[EXPLANATION\]/g, "").trim();
  analogy = analogy.trim();

  return { simplified, analogy };
}

export function ExplanationPanel({ node, onClose, onUpdateNode }: ExplanationPanelProps) {
  const { t } = useTranslation();
  const [explanation, setExplanation] = useState<NodeExplanation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.data.title);
  const [editDescription, setEditDescription] = useState(
    node.data.description || ""
  );
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editNote, setEditNote] = useState(node.data.note || "");
  // Tier 2: full-size image preview when clicking the attached source image
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const lastFetchedNodeId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Only trigger AI explanation when the node ID changes, not on data edits
    if (lastFetchedNodeId.current === node.id) return;
    lastFetchedNodeId.current = node.id;

    async function fetchExplanation() {
      // Abort any in-flight explanation request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setExplanation(null);
      try {
        const res = await fetch("/api/explain", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: node.id,
            nodeTitle: node.data.title,
            nodeDescription: node.data.description,
            sourceContext: node.data.sourceContext,
            // Tier 2: forward the attached image so the model can ground its
            // explanation in the actual pixels.
            imageUrl: node.data.imageUrl,
            imageDescription: node.data.imageDescription,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          console.error("Failed to fetch explanation:", res.status);
          return;
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let raw = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") {
                  break;
                }
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.content) {
                    raw += parsed.content;
                    setExplanation(parseStreamedExplanation(raw));
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }
        }

        // Final parse in case the last chunk did not end on a newline
        if (raw) {
          setExplanation(parseStreamedExplanation(raw));
        }
      } catch (err: any) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to fetch explanation", err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchExplanation();
  }, [node.id, node.data.title, node.data.description, node.data.sourceContext]);

  // Sync edit fields when node changes
  useEffect(() => {
    setEditTitle(node.data.title);
    setEditDescription(node.data.description || "");
    setEditNote(node.data.note || "");
  }, [node.id, node.data.title, node.data.description, node.data.note]);

  const handleSaveEdit = () => {
    if (onUpdateNode) {
      onUpdateNode(node.id, {
        title: editTitle.trim() || node.data.title,
        description: editDescription,
      });
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditTitle(node.data.title);
    setEditDescription(node.data.description || "");
    setIsEditing(false);
  };

  const handleSaveNote = () => {
    if (onUpdateNode) {
      onUpdateNode(node.id, { note: editNote.trim() || undefined });
    }
    setIsEditingNote(false);
  };

  const handleCancelNote = () => {
    setEditNote(node.data.note || "");
    setIsEditingNote(false);
  };

  const handleExportNote = () => {
    const title = node.data.title || node.id;
    const note = node.data.note?.trim();
    if (!note) return;

    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push("");
    if (node.data.description) {
      lines.push(`> ${node.data.description}`);
      lines.push("");
    }
    if (node.data.sourceContext) {
      lines.push(`**Source:** ${node.data.sourceContext}`);
      lines.push("");
    }
    lines.push("## Note");
    lines.push("");
    lines.push(note);
    lines.push("");

    const safeName = title
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "node";
    downloadMarkdown(`note-${safeName}`, lines.join("\n"));
  };

  return (
    <div className="w-80 lg:w-96 border-l border-[#1C1C1C]/10 bg-[#F9F8F6] flex flex-col h-full shadow-none overflow-hidden rounded-none">
      <div className="flex items-start justify-between p-6 border-b border-[#1C1C1C]/10 shrink-0">
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-[#1C1C1C]/60 uppercase tracking-[0.2em] font-sans">
              {t("board.activeThread")}
            </div>
            {onUpdateNode && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="p-1 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
                title={t("board.editNode")}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {isEditing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="font-serif tracking-tight text-2xl text-[#1C1C1C] leading-snug bg-transparent border-b border-[#1C1C1C]/30 focus:border-[#1C1C1C] focus:outline-none pb-1"
              autoFocus
            />
          ) : (
            <h2 className="font-serif tracking-tight text-2xl text-[#1C1C1C] leading-snug pr-4">
              {node.data.title}
            </h2>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors rounded-none shadow-none focus:outline-none shrink-0 ml-2"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-10">
        {/* Tier 2: attached source image (lightbox on click) */}
        {node.data.imageUrl && (
          <div className="space-y-3">
            <div className="text-[10px] text-[#1C1C1C]/60 uppercase tracking-[0.2em] font-sans border-b border-[#1C1C1C]/10 pb-2">
              {t("board.attachedImage")}
            </div>
            <button
              type="button"
              onClick={() => setLightboxImage(node.data.imageUrl!)}
              className="block w-full focus:outline-none focus:ring-2 focus:ring-[#1C1C1C]/30"
              aria-label={t("board.viewImage")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={node.data.imageUrl}
                alt={node.data.title}
                className="w-full max-h-64 object-contain border border-[#1C1C1C]/10 bg-[#F9F8F6]"
              />
            </button>
            {node.data.imageDescription && (
              <p className="font-sans text-xs italic text-[#1C1C1C]/60 leading-relaxed">
                {node.data.imageDescription}
              </p>
            )}
          </div>
        )}

        {/* Description (editable) */}
        {isEditing ? (
          <div className="space-y-4">
            <div className="text-[10px] text-[#1C1C1C]/60 uppercase tracking-[0.2em] font-sans border-b border-[#1C1C1C]/10 pb-2">
              {t("board.description")}
            </div>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full text-sm leading-relaxed text-[#1C1C1C]/80 font-sans bg-transparent border border-[#1C1C1C]/20 focus:border-[#1C1C1C] focus:outline-none p-3 resize-none min-h-[120px]"
              placeholder={t("board.descriptionPlaceholder")}
            />
          </div>
        ) : (
          node.data.description && (
            <div className="space-y-4">
              <div className="text-[10px] text-[#1C1C1C]/60 uppercase tracking-[0.2em] font-sans border-b border-[#1C1C1C]/10 pb-2">
                {t("board.description")}
              </div>
              <p className="text-sm leading-relaxed text-[#1C1C1C]/80 font-sans">
                {node.data.description}
              </p>
            </div>
          )
        )}

        {/* Source Context */}
        {!isEditing && node.data.sourceContext && (
          <div className="space-y-4">
            <div className="text-[10px] text-[#1C1C1C]/60 uppercase tracking-[0.2em] font-sans border-b border-[#1C1C1C]/10 pb-2">
              {t("board.sourceContext")}
            </div>
            <div className="text-sm leading-relaxed text-[#1C1C1C]/80 font-serif italic pl-4 border-l border-[#1C1C1C]/20">
              &ldquo;{node.data.sourceContext}&rdquo;
            </div>
          </div>
        )}

        {isEditing ? (
          <div className="flex gap-3">
            <button
              onClick={handleSaveEdit}
              className="flex-1 flex justify-center items-center gap-2 bg-[#1C1C1C] text-[#F9F8F6] border border-[#1C1C1C] py-3 px-6 transition-colors duration-200 text-xs font-sans tracking-wide uppercase rounded-none shadow-none hover:bg-[#1C1C1C]/90"
            >
              <Check className="w-4 h-4" />
              {t("board.save")}
            </button>
            <button
              onClick={handleCancelEdit}
              className="flex-1 flex justify-center items-center gap-2 bg-transparent hover:bg-[#1C1C1C]/5 text-[#1C1C1C] border border-[#1C1C1C]/30 py-3 px-6 transition-colors duration-200 text-xs font-sans tracking-wide uppercase rounded-none shadow-none"
            >
              {t("board.cancel")}
            </button>
          </div>
        ) : explanation && (explanation.simplified || explanation.analogy) ? (
          <div className="space-y-10 animate-in fade-in duration-500">
            {/* AI Simplified Translation */}
            <div className="space-y-4">
              <div className="text-[10px] text-[#1C1C1C]/60 uppercase tracking-[0.2em] font-sans border-b border-[#1C1C1C]/10 pb-2">
                {t("board.editorialInsight")}
              </div>
              <p className="text-[#1C1C1C]/80 text-sm leading-relaxed font-sans">
                {explanation.simplified}
                {isLoading && explanation.simplified && (
                  <span className="inline-block w-1.5 h-3.5 bg-[#1C1C1C]/40 ml-0.5 align-middle animate-pulse" />
                )}
              </p>
            </div>

            {/* Analogy */}
            {explanation.analogy && (
              <div className="space-y-4">
                <div className="text-[10px] text-[#1C1C1C]/60 uppercase tracking-[0.2em] font-sans border-b border-[#1C1C1C]/10 pb-2">
                  {t("board.theAnalogy")}
                </div>
                <div className="text-sm leading-relaxed text-[#1C1C1C] bg-[#1C1C1C]/5 p-5 rounded-none font-sans">
                  {explanation.analogy}
                  {isLoading && (
                    <span className="inline-block w-1.5 h-3.5 bg-[#1C1C1C]/40 ml-0.5 align-middle animate-pulse" />
                  )}
                </div>
              </div>
            )}

            {/* Code Snippet */}
            {explanation.codeSnippet && (
              <div className="space-y-4">
                <div className="text-[10px] text-[#1C1C1C]/60 uppercase tracking-[0.2em] font-sans border-b border-[#1C1C1C]/10 pb-2">
                  {t("board.codeReference")}
                </div>
                <pre className="text-[11px] text-[#1C1C1C] font-mono bg-[#1C1C1C]/5 p-5 rounded-none border border-[#1C1C1C]/10 overflow-x-auto shadow-none">
                  <code>{explanation.codeSnippet}</code>
                </pre>
              </div>
            )}
          </div>
        ) : isLoading ? (
          <div className="h-48 pt-6 border-t border-[#1C1C1C]/10 mt-10">
            <LoadingScreen message={t("board.curatingInsights")} />
          </div>
        ) : (
          <div className="text-center text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 py-8 font-sans">
            {t("board.noFurtherExplanation")}
          </div>
        )}

        {/* User Note Section */}
        {!isEditing && (
          <div className="space-y-4 pt-6 border-t border-[#1C1C1C]/10">
            <div className="flex items-center justify-between border-b border-[#1C1C1C]/10 pb-2">
              <div className="flex items-center gap-2 text-[10px] text-[#1C1C1C]/60 uppercase tracking-[0.2em] font-sans">
                <StickyNote className="w-3 h-3" />
                {t("board.nodeNote")}
              </div>
              {!isEditingNote && (
                <button
                  onClick={() => setIsEditingNote(true)}
                  className="p-1 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
                  title={node.data.note ? t("board.editNote") : t("board.addNote")}
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>

            {isEditingNote ? (
              <div className="space-y-3">
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="w-full text-sm leading-relaxed text-[#1C1C1C]/80 font-sans bg-transparent border border-[#1C1C1C]/20 focus:border-[#1C1C1C] focus:outline-none p-3 resize-none min-h-[100px]"
                  placeholder={t("board.notePlaceholder")}
                  autoFocus
                />
                <div className="flex gap-3">
                  <button
                    onClick={handleSaveNote}
                    className="flex-1 flex justify-center items-center gap-2 bg-[#1C1C1C] text-[#F9F8F6] border border-[#1C1C1C] py-2 px-4 transition-colors duration-200 text-[10px] font-sans tracking-wide uppercase rounded-none shadow-none hover:bg-[#1C1C1C]/90"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {t("board.save")}
                  </button>
                  <button
                    onClick={handleCancelNote}
                    className="flex-1 flex justify-center items-center gap-2 bg-transparent hover:bg-[#1C1C1C]/5 text-[#1C1C1C] border border-[#1C1C1C]/30 py-2 px-4 transition-colors duration-200 text-[10px] font-sans tracking-wide uppercase rounded-none shadow-none"
                  >
                    {t("board.cancel")}
                  </button>
                </div>
              </div>
            ) : node.data.note ? (
              <p className="text-sm leading-relaxed text-[#1C1C1C]/80 font-sans whitespace-pre-wrap">
                {node.data.note}
              </p>
            ) : (
              <button
                onClick={() => setIsEditingNote(true)}
                className="text-xs text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors font-sans italic"
              >
                {t("board.addNote")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tier 2: image lightbox */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 bg-[#1C1C1C]/90 flex items-center justify-center p-6 cursor-zoom-out"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxImage}
            alt={node.data.title}
            className="max-w-full max-h-full object-contain"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxImage(null);
            }}
            className="absolute top-4 right-4 text-[#F9F8F6] hover:opacity-80 focus:outline-none"
            aria-label={t("common.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Export Action */}
      {!isEditing && (
        <div className="p-6 border-t border-[#1C1C1C]/10 bg-[#F9F8F6] shrink-0">
          <button
            onClick={handleExportNote}
            disabled={!node.data.note?.trim()}
            className="w-full flex justify-center items-center gap-2 bg-transparent hover:bg-[#1C1C1C] text-[#1C1C1C] hover:text-[#F9F8F6] border border-[#1C1C1C] py-3 px-6 transition-colors duration-200 text-xs font-sans tracking-wide uppercase rounded-none shadow-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#1C1C1C]"
          >
            <Download className="w-4 h-4" />
            {t("board.saveNoteToBoard")}
          </button>
        </div>
      )}
    </div>
  );
}
