"use client";

import { X, Sparkles } from "lucide-react";
import type { Concept } from "@/types/concept-graph";

interface ConceptDetailPanelProps {
  concept: Concept | null;
  onClose: () => void;
  onExplain?: (conceptId: string) => void;
}

/**
 * Right-sidebar detail panel for a selected concept.
 *
 * Editorial layout:
 *   - Playfair Display 20px label
 *   - Type badge (uppercase tracking)
 *   - Description body text
 *   - Anchors rendered as blockquotes
 *   - Code snippet in monospace block
 *   - Explain + Close actions
 */
export function ConceptDetailPanel({
  concept,
  onClose,
  onExplain,
}: ConceptDetailPanelProps) {
  if (!concept) return null;

  return (
    <div className="w-[400px] shrink-0 border-l border-[#1C1C1C] bg-[#F9F8F6] flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between p-6 border-b border-[#1C1C1C]/10 shrink-0">
        <div className="flex flex-col gap-2 flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-2">
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
              Concept
            </span>
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C] border border-[#1C1C1C]/30 px-1.5 py-0.5">
              {concept.type}
            </span>
          </div>
          <h2 className="font-serif tracking-tight text-xl text-[#1C1C1C] leading-snug">
            {concept.label}
          </h2>
          {concept.aliases.length > 0 && (
            <p className="font-sans text-xs italic text-[#1C1C1C]/40">
              aka {concept.aliases.join(", ")}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors duration-200 focus:outline-none shrink-0"
          aria-label="Close detail panel"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Metrics row */}
        <div className="flex items-center gap-6 pb-4 border-b border-[#1C1C1C]/10">
          <div className="flex flex-col">
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
              Importance
            </span>
            <span className="font-mono text-sm text-[#1C1C1C] tabular-nums">
              {concept.importance.toFixed(2)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
              Frequency
            </span>
            <span className="font-mono text-sm text-[#1C1C1C] tabular-nums">
              {concept.frequency}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
              Cluster
            </span>
            <span className="font-mono text-sm text-[#1C1C1C] tabular-nums">
              {concept.clusterId}
            </span>
          </div>
        </div>

        {/* Description */}
        {concept.description && (
          <div className="space-y-3">
            <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 border-b border-[#1C1C1C]/10 pb-2">
              Description
            </div>
            <p className="font-sans text-sm leading-relaxed text-[#1C1C1C]/80">
              {concept.description}
            </p>
          </div>
        )}

        {/* Anchors as blockquotes */}
        {concept.anchors.length > 0 && (
          <div className="space-y-3">
            <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 border-b border-[#1C1C1C]/10 pb-2">
              Anchors
            </div>
            <div className="space-y-3">
              {concept.anchors.map((anchor, i) => (
                <blockquote
                  key={i}
                  className="font-serif italic text-sm leading-relaxed text-[#1C1C1C]/70 pl-4 border-l border-[#1C1C1C]/20"
                >
                  &ldquo;{anchor}&rdquo;
                </blockquote>
              ))}
            </div>
          </div>
        )}

        {/* Code snippet */}
        {concept.codeSnippet && (
          <div className="space-y-3">
            <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 border-b border-[#1C1C1C]/10 pb-2">
              Code
            </div>
            <pre className="text-[11px] text-[#1C1C1C] font-mono bg-[#1C1C1C]/5 p-4 border border-[#1C1C1C]/10 overflow-x-auto">
              <code>{concept.codeSnippet}</code>
            </pre>
          </div>
        )}

        {/* File path */}
        {concept.filePath && (
          <div className="space-y-3">
            <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 border-b border-[#1C1C1C]/10 pb-2">
              Source File
            </div>
            <p className="font-mono text-xs text-[#1C1C1C]/60 break-all">
              {concept.filePath}
            </p>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="p-6 border-t border-[#1C1C1C]/10 bg-[#F9F8F6] shrink-0">
        <button
          type="button"
          onClick={() => onExplain?.(concept.id)}
          className="w-full flex justify-center items-center gap-2 bg-[#1C1C1C] hover:bg-[#1C1C1C]/80 text-[#F9F8F6] border border-[#1C1C1C] py-3 px-6 transition-colors duration-200 text-xs font-sans tracking-wide uppercase"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Explain
        </button>
      </div>
    </div>
  );
}
