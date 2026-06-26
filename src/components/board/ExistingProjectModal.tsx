"use client";

import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { X, ExternalLink, RefreshCw } from "lucide-react";
import type { IngestExistingProject } from "@/api/document";

interface ExistingProjectModalProps {
  existing: IngestExistingProject;
  onClose: () => void;
  /**
   * Called when the user picks "regenerate". The parent is expected
   * to call /api/ingest/regenerate then re-run the standard ingest
   * with projectId set.
   */
  onRegenerate: () => void;
  /**
   * Route the parent navigates to for "open existing". Defaults to
   * /board for paper, /codeboard for code — the parent picks.
   */
  openHref: string;
  busy?: boolean;
}

/**
 * Modal shown when the user pastes a URL that has already been imported.
 * Offers two actions:
 *   - "Open existing": navigate to the canvas for the existing project
 *   - "Regenerate from scratch": wipe the KG, re-fetch, re-run pipeline
 *
 * Style matches the rest of the editorial UI (cream background, thin
 * borders, monospace caps labels).
 */
export function ExistingProjectModal({
  existing,
  onClose,
  onRegenerate,
  openHref,
  busy = false,
}: ExistingProjectModalProps) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1C1C]/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-[#F9F8F6] border border-[#1C1C1C]/15 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 border-b border-[#1C1C1C]/10">
          <div>
            <div className="font-sans text-[10px] uppercase tracking-[0.25em] text-[#1C1C1C]/60">
              {t("ingest.alreadyImported", "Already imported")}
            </div>
            <h2 className="mt-2 font-serif text-lg text-[#1C1C1C] leading-tight line-clamp-2">
              {existing.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-3 text-sm text-[#1C1C1C]/80">
          <p>
            {t(
              "ingest.alreadyImportedDescription",
              "This source has already been imported into your library. What would you like to do?"
            )}
          </p>
          {existing.sourceUrl && (
            <div className="font-mono text-[10px] text-[#1C1C1C]/50 break-all">
              {existing.sourceUrl}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 p-6 pt-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => router.push(openHref)}
            className="flex-1 inline-flex items-center justify-center gap-2 border border-[#1C1C1C] bg-[#F9F8F6] hover:bg-[#1C1C1C] hover:text-[#F9F8F6] text-[#1C1C1C] font-sans text-[10px] uppercase tracking-[0.2em] px-4 py-3 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t("ingest.openExisting", "Open existing")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onRegenerate}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-[#1C1C1C] hover:bg-[#1C1C1C]/85 text-[#F9F8F6] font-sans text-[10px] uppercase tracking-[0.2em] px-4 py-3 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t("ingest.regenerate", "Regenerate")}
          </button>
        </div>
      </div>
    </div>
  );
}
