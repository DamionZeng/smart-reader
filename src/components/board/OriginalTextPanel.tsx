"use client";

import { useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { isHtml } from "@/utils/html-utils";

interface OriginalTextPanelProps {
  rawText: string;
  onClose: () => void;
  /** Text to search for and highlight in the rendered content (e.g. concept anchors). null/undefined = no highlight. */
  highlightText?: string | null;
}

/**
 * Inject <mark class="kg-highlight"> tags into an HTML string by
 * matching candidate text inside text nodes (between > and <).
 *
 * This operates at the HTML-string level BEFORE React renders it via
 * dangerouslySetInnerHTML. The mark tags become part of the innerHTML,
 * so React will NOT strip them on re-render (unlike the old approach
 * of manually inserting marks into the DOM after render, which React
 * overwrote on the next reconciliation pass).
 *
 * Only text between `>` and `<` is matched — HTML tag attributes are
 * never touched. This prevents corrupting URLs in <img src="..."> etc.
 */
function injectHighlightMarks(html: string, candidates: string[]): string {
  if (!html || candidates.length === 0) return html;

  // Sort candidates by length descending so longer matches are
  // inserted first (avoids "Transformer" being marked inside
  // "Transformer-based" when both are candidates).
  const sorted = [...new Set(candidates)]
    .filter((s) => s && s.trim().length >= 2)
    .sort((a, b) => b.length - a.length);

  if (sorted.length === 0) return html;

  // Regex matches text content between > and < (i.e. text nodes)
  // We use a function replacer to inject marks only in text parts.
  let result = html;
  for (const candidate of sorted) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`>([^<]*?)(${escaped})([^<]*)<`, "gi");
    result = result.replace(re, (match, before, matchText, after) => {
      // Preserve original case of the matched text
      return `>${before}<mark class="kg-highlight" style="background:rgba(28,28,28,0.18);padding:1px 2px;border-radius:0;">${matchText}</mark>${after}<`;
    });
  }

  return result;
}

export function OriginalTextPanel({ rawText, onClose, highlightText }: OriginalTextPanelProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);

  const contentIsHtml = useMemo(() => isHtml(rawText), [rawText]);

  /**
   * Pre-compute the HTML to render. If highlightText is set, we inject
   * <mark> tags at the string level so they survive React re-renders.
   *
   * highlightText is a \u0001-delimited list of candidates (title,
   * aliases, anchor). We try all of them — longer matches first.
   */
  const renderedHtml = useMemo(() => {
    if (!contentIsHtml) return "";
    if (!highlightText) return rawText;

    const candidates = highlightText
      .split("\u0001")
      .filter((s) => s && s.trim().length >= 2);

    if (candidates.length === 0) return rawText;

    return injectHighlightMarks(rawText, candidates);
  }, [rawText, highlightText, contentIsHtml]);

  /**
   * After render, scroll to the first <mark> if present.
   * This uses a small delay to ensure the DOM is painted.
   */
  useEffect(() => {
    if (!highlightText || !contentRef.current) return;

    const timer = setTimeout(() => {
      const firstMark = contentRef.current?.querySelector("mark.kg-highlight");
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: "smooth", block: "center" });
        // Emphasize the first match
        (firstMark as HTMLElement).style.background = "rgba(28,28,28,0.35)";
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [highlightText, renderedHtml]);

  return (
    <div className="w-full md:w-[640px] lg:w-[760px] h-full bg-[#F9F8F6] border-r border-[#1C1C1C]/10 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-[#1C1C1C]/10 shrink-0">
        <div>
          <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 mb-1">
            {t("board.originalText")}
          </p>
          <h3 className="font-serif text-lg tracking-tight text-[#1C1C1C]">
            {t("board.originalText")}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors duration-200 focus:outline-none"
          aria-label={t("common.close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable content.
          For PDF HTML: pages use absolute positioning with their own
          intrinsic width, so the container should NOT cap the width —
          instead it provides a scrollable canvas with horizontal scroll
          if the page is wider than the panel. */}
      <div className="flex-1 overflow-auto" ref={contentRef}>
        {rawText.trim() ? (
          contentIsHtml ? (
            <div
              className="pdf-content py-6 px-4"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : (
            <pre className="mx-auto px-8 md:px-12 py-8 max-w-[680px] font-serif text-sm leading-relaxed text-[#1C1C1C]/85 whitespace-pre-wrap break-words">
              {rawText}
            </pre>
          )
        ) : (
          <p className="mx-auto px-8 md:px-12 py-8 max-w-[680px] font-sans text-sm text-[#1C1C1C]/40 italic">
            {t("board.originalTextEmpty")}
          </p>
        )}
      </div>

      {/* Scoped CSS for PDF HTML content. Pages are absolutely
         positioned so most styling is inline; this block handles
         the page container, marks, and fallback elements. */}
      <style jsx global>{`
        .pdf-content .pdf-page {
          background: white;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
          margin: 0 auto 24px;
          position: relative;
        }
        .pdf-content .pdf-page img {
          display: block;
        }
        .pdf-content .pdf-page span {
          font-family: "Times New Roman", Georgia, serif;
        }
        .pdf-content mark.kg-highlight {
          background: rgba(28, 28, 28, 0.18);
          padding: 1px 2px;
          border-radius: 0;
          color: inherit;
        }
        /* Fallback styles for non-PDF HTML (docx, plain HTML) */
        .pdf-content h1 {
          font-family: "Playfair Display", Georgia, serif;
          font-size: 1.75rem;
          font-weight: 700;
          color: #1c1c1c;
          margin: 1.5rem 0 0.75rem;
          line-height: 1.25;
        }
        .pdf-content h2 {
          font-family: "Playfair Display", Georgia, serif;
          font-size: 1.35rem;
          font-weight: 700;
          color: #1c1c1c;
          margin: 1.25rem 0 0.5rem;
          line-height: 1.3;
        }
        .pdf-content h3 {
          font-family: "Playfair Display", Georgia, serif;
          font-size: 1.1rem;
          font-weight: 600;
          color: #1c1c1c;
          margin: 1rem 0 0.4rem;
          line-height: 1.3;
        }
        .pdf-content p {
          font-family: Inter, -apple-system, sans-serif;
          font-size: 0.9rem;
          line-height: 1.7;
          color: rgba(28, 28, 28, 0.85);
          margin: 0 0 0.75rem;
        }
        .pdf-content figure {
          margin: 1.2rem 0;
          text-align: center;
        }
        .pdf-content figure img {
          max-width: 100%;
          height: auto;
          border: 1px solid rgba(28, 28, 28, 0.1);
          display: block;
          margin: 0 auto;
        }
        .pdf-content figcaption {
          font-family: Inter, -apple-system, sans-serif;
          font-size: 0.75rem;
          color: rgba(28, 28, 28, 0.55);
          margin-top: 0.4rem;
          font-style: italic;
          line-height: 1.5;
          text-align: center;
        }
      `}</style>
    </div>
  );
}
