"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IngestionUI } from "@/components/board/IngestionUI";
import { ExistingProjectModal } from "@/components/board/ExistingProjectModal";
import { useIngestionFlow } from "@/hooks/useIngestionFlow";

/**
 * Standalone paper import page.
 *
 * Flow:
 *   1. User submits a URL or file via the IngestionUI.
 *   2. `useIngestionFlow` calls `/api/ingest` to extract text + create
 *      a project shell.
 *   3. Same hook triggers the 7-step KG pipeline and polls for
 *      completion.
 *   4. On success, the hook navigates to `/board?id=<projectId>` —
 *      this page is unmounted and the canvas takes over.
 *
 * Idempotency:
 *   If the URL has already been imported, step 2 short-circuits and
 *   the page shows <ExistingProjectModal> with "open existing" vs
 *   "regenerate" actions. The regenerate path clears the old concept
 *   graph and re-runs the pipeline against the existing project id.
 *
 * Errors stay on this page so the user can retry without losing state.
 */
export default function ImportPage() {
  const { t } = useTranslation();
  const flow = useIngestionFlow({
    type: "paper",
    successRoute: "/board",
  });

  // Last URL the user submitted, kept around so "regenerate" can
  // re-submit it with `existingProjectId` set.
  const [lastUrl, setLastUrl] = useState<string>("");

  const handleRegenerate = async () => {
    if (!flow.existingProject) return;
    const projectId = flow.existingProject.id;
    flow.clearExistingProject();
    // Step 1: clear the existing concept_graphs row.
    try {
      const r = await fetch("/api/ingest/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Regenerate failed (${r.status})`);
      }
    } catch (e) {
      console.error("Regenerate pre-clear failed:", e);
      // Fall through; the regular /api/ingest update path will at
      // least re-fetch + re-run, even if the wipe failed.
    }
    // Step 2: re-run the standard ingest with projectId set.
    await flow.startIngest("", lastUrl, null, projectId);
  };

  return (
    <div className="w-screen min-h-screen bg-[#F9F8F6] text-[#1C1C1C] overflow-y-auto">
      <IngestionUI
        onIngest={(name, url, file) => {
          setLastUrl(url);
          return flow.startIngest(name, url, file);
        }}
        loading={flow.isIngesting}
        stage={flow.ingestStage}
        kgProgress={flow.kgProgress}
        errorMessage={flow.ingestError ?? flow.kgError}
        onCancel={flow.cancelIngest}
        headerExtra={
          <Link
            href="/dashboard"
            className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors"
          >
            {t("board.backToDashboard")}
          </Link>
        }
      />

      {flow.existingProject && (
        <ExistingProjectModal
          existing={flow.existingProject}
          onClose={() => flow.clearExistingProject()}
          onRegenerate={handleRegenerate}
          openHref={`/board?id=${flow.existingProject.id}`}
          busy={flow.isIngesting}
        />
      )}
    </div>
  );
}
