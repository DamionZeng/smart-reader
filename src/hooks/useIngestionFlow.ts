"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseDocument, type IngestExistingProject } from "@/api/document";
import type { ProjectType } from "@/types";

export type IngestionStage = "preparing" | "generating" | "done" | "error";

export interface KgProgress {
  step: string;
  current: number;
  total: number;
}

export interface IngestionFlowResult {
  /** Project id created by the ingest endpoint. */
  projectId: string;
  /** Title returned by the API (post-slug cleanup). */
  title: string;
  /** Type of project. */
  type: ProjectType;
  /** Extracted rawText. */
  rawText: string;
}

export interface UseIngestionFlowOptions {
  /** Project type, used both for the ingest endpoint and the success route. */
  type: ProjectType;
  /** Route to navigate to once the KG pipeline finishes. */
  successRoute: string;
  /**
   * Optional hook called whenever the underlying projectId changes
   * (e.g. for augmenting an existing project). Receives the freshly
   * minted id so the caller can update refs/state.
   */
  onProjectId?: (id: string) => void;
  /**
   * Optional hook called when the pipeline completes successfully but
   * *before* navigation happens. Useful for components that want to
   * pre-seed a canvas.
   */
  onComplete?: (result: IngestionFlowResult) => void;
}

export interface UseIngestionFlow {
  isIngesting: boolean;
  ingestStage: IngestionStage;
  ingestError: string | null;
  kgProgress: KgProgress | null;
  kgError: string | null;
  isGeneratingKG: boolean;
  /** Set when the URL has already been imported before. The caller is
   *  expected to show a modal offering "open existing / regenerate".
   *  `startIngest` short-circuits when this is set. */
  existingProject: IngestExistingProject | null;
  /** Reset the `existingProject` flag, e.g. after the user dismisses
   *  the modal. */
  clearExistingProject: () => void;
  /** Start the full ingest flow. Resolves when navigation has been triggered. */
  startIngest: (
    name: string,
    url: string,
    file: File | null,
    existingProjectId?: string | null
  ) => Promise<void>;
  cancelIngest: () => void;
  reset: () => void;
}

const KG_POLL_INTERVAL_MS = 3000;
const KG_DONE_RAPID_INTERVAL_MS = 500;

/**
 * Shared ingest flow for the import pages.
 *
 * Lifecycle:
 *   preparing → generating → done  (navigates to successRoute)
 *                     ↘ error      (stays on import page, errorMessage set)
 *
 * Responsibilities:
 *   1. Calls `parseDocument` to extract text + create/augment a project
 *      shell via `/api/ingest`.
 *   2. Triggers the 7-step KG pipeline via `/api/concept-graph/ingest`.
 *   3. Polls the job status every 3s.
 *   4. On success, navigates to `successRoute` with the new project id.
 *   5. On failure, exposes the error and resets the loading flags.
 */
export function useIngestionFlow(
  options: UseIngestionFlowOptions
): UseIngestionFlow {
  const { type, successRoute, onProjectId, onComplete } = options;
  const router = useRouter();

  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestStage, setIngestStage] = useState<IngestionStage>("preparing");
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [kgProgress, setKgProgress] = useState<KgProgress | null>(null);
  const [kgError, setKgError] = useState<string | null>(null);
  const [isGeneratingKG, setIsGeneratingKG] = useState(false);
  const [kgJobId, setKgJobId] = useState<string | null>(null);
  const [existingProject, setExistingProject] = useState<IngestExistingProject | null>(null);
  const projectIdRef = useRef<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Dedicated controller for the KG-pipeline POST (/api/concept-graph/ingest).
  // The first controller (`abortRef`) is only attached to the parseDocument
  // request; once that returns we move into the polling phase and need a
  // fresh controller that can be aborted independently by the Cancel button.
  const kgAbortRef = useRef<AbortController | null>(null);
  // Controller for the per-poll GET (/api/concept-graph/jobs/[id]).
  const pollAbortRef = useRef<AbortController | null>(null);
  // Tracks the jobId that the polling effect has already picked up,
  // so React StrictMode's double-invocation in dev doesn't kick off
  // two parallel poll loops for the same job. This ref is ONLY set
  // inside the polling effect — never pre-seeded elsewhere.
  const polledJobIdRef = useRef<string | null>(null);
  // Separate ref holding the active job id for the Cancel button.
  // Decoupled from `polledJobIdRef` so that pre-seeding the cancel
  // target doesn't short-circuit the polling effect's dedupe check.
  const cancelJobIdRef = useRef<string | null>(null);
  // Track whether the user explicitly cancelled so the polling effect
  // can exit without surfacing a misleading "Pipeline failed" error.
  const cancelledRef = useRef<boolean>(false);

  // ----- Cancel an in-flight ingest -----
  //
  // Two-phase cancel:
  //   1. Locally abort any in-flight HTTP requests (parseDocument,
  //      the KG POST, the per-poll GET). Without this, the client
  //      would keep hammering the API after the user has already
  //      walked away from the import page.
  //   2. Tell the server the job is cancelled. The background
  //      `runPipeline` polls the job status at every substep
  //      boundary and bails out the next time `onProgress` is
  //      awaited (see /api/concept-graph/ingest). This is the
  //      only way to stop a 7-step LLM pipeline mid-flight.
  const cancelIngest = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    kgAbortRef.current?.abort();
    pollAbortRef.current?.abort();
    const jobId = cancelJobIdRef.current;
    if (jobId) {
      // Fire-and-forget: best-effort. We don't await because the
      // user has already clicked Cancel — we shouldn't make them
      // wait for a network round-trip before the UI clears.
      fetch(`/api/concept-graph/jobs/${jobId}/cancel`, {
        method: "POST",
      }).catch((e) => {
        console.warn("[useIngestionFlow] cancel job request failed", e);
      });
    }
    // Reset UI state immediately so the form re-appears.
    setIsIngesting(false);
    setIsGeneratingKG(false);
    setKgJobId(null);
    setKgProgress(null);
    setKgError(null);
    setIngestStage("preparing");
    setIngestError(null);
    projectIdRef.current = null;
    cancelJobIdRef.current = null;
  }, []);

  const clearExistingProject = useCallback(() => {
    setExistingProject(null);
  }, []);

  const reset = useCallback(() => {
    setIngestError(null);
    setKgError(null);
    setKgProgress(null);
    setIsIngesting(false);
    setIsGeneratingKG(false);
    setIngestStage("preparing");
    setKgJobId(null);
    setExistingProject(null);
    projectIdRef.current = null;
    cancelJobIdRef.current = null;
  }, []);

  // ----- Poll the KG job status until done/failed/cancelled -----
  useEffect(() => {
    if (!kgJobId) return;
    // Avoid double-polling if React fires the effect twice in dev.
    if (polledJobIdRef.current === kgJobId) return;
    polledJobIdRef.current = kgJobId;

    // Each poll cycle gets its own AbortController so the Cancel
    // button (which calls `pollAbortRef.current?.abort()`) can
    // terminate the in-flight GET immediately rather than waiting
    // for the server to time out.
    const pollController = new AbortController();
    pollAbortRef.current = pollController;

    let cancelled = false;
    let interval = setTimeout(poll, KG_POLL_INTERVAL_MS);

    async function poll() {
      // Skip a scheduled tick if the user already cancelled — the
      // cleanup function will have set the local flag and aborted
      // the controller. Defence-in-depth against the timer firing
      // a millisecond before the effect cleanup runs.
      if (cancelled || cancelledRef.current) return;
      try {
        const r = await fetch(`/api/concept-graph/jobs/${kgJobId}`, {
          signal: pollController.signal,
        });
        // 429 means the polling rate limit kicked in. Wait the
        // server-provided cooldown then retry — do NOT bubble this
        // up as a fatal job error or the user will see "Job poll
        // failed (429)" on the import page even though the pipeline
        // itself is still running fine in the background.
        if (r.status === 429) {
          const data = await r.json().catch(() => ({}));
          const retryAfter =
            typeof data?.retryAfter === "number"
              ? data.retryAfter
              : 3;
          interval = setTimeout(poll, Math.max(retryAfter, 1) * 1000);
          return;
        }
        if (!r.ok) throw new Error(`Job poll failed (${r.status})`);
        const job = await r.json();
        if (cancelled) return;
        if (job.progress) setKgProgress(job.progress);

        if (job.status === "done" && job.graphId) {
          const gr = await fetch(`/api/concept-graph/${job.graphId}`, {
            signal: pollController.signal,
          });
          if (!gr.ok) throw new Error("Failed to fetch generated graph");
          const { graph } = await gr.json();
          if (cancelled) return;

          // The job row stores the project id it was run against.
          // Fall back to the local ref for existing-project flows where
          // the job may not have a projectId column yet.
          const finalProjectId = job.projectId || projectIdRef.current;
          if (!finalProjectId) {
            throw new Error(
              "Pipeline finished but no project id was associated with this job."
            );
          }

          // Hand off to the caller (e.g. the import page) so it can
          // decide what to do with the freshly generated graph.
          onComplete?.({
            projectId: finalProjectId,
            title: graph?.title || "",
            type,
            rawText: graph?.rawText || "",
          });
          // Navigate to the canvas. We use `push` (not `replace`) so
          // the user can hit the browser Back button to return to the
          // import page if they want to start over.
          router.push(`${successRoute}?id=${finalProjectId}`);
          setIngestStage("done");
          return;
        } else if (job.status === "failed") {
          throw new Error(job.error || "Pipeline failed");
        } else if (job.status === "done" && !job.graphId) {
          throw new Error("Pipeline completed but produced no graph.");
        } else if (job.status === "cancelled") {
          // User cancelled mid-pipeline. The cancel endpoint set
          // the job row to "cancelled" and the server-side
          // runPipeline bailed out. We just silently stop polling
          // — `cancelIngest` has already reset the UI state.
          return;
        }

        // Still running: keep polling, but switch to a faster cadence
        // once the last sub-step is reached so the transition feels
        // immediate when the server finishes.
        const isNearDone = job.progress?.current === job.progress?.total;
        interval = setTimeout(poll, isNearDone ? KG_DONE_RAPID_INTERVAL_MS : KG_POLL_INTERVAL_MS);
      } catch (err: any) {
        if (cancelled) return;
        // AbortError is expected when the user cancels — exit
        // quietly without surfacing it as a "Pipeline failed" error.
        if (err?.name === "AbortError") return;
        if (cancelledRef.current) return;
        console.error("[useIngestionFlow] poll failed", err);
        const msg = err instanceof Error ? err.message : "Pipeline error";
        setKgError(msg);
        setIngestError(msg);
        setIsGeneratingKG(false);
        setKgJobId(null);
        setKgProgress(null);
        setIsIngesting(false);
        setIngestStage("error");
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(interval);
      pollController.abort();
      // Clear the ref so a future job can wire up a new controller
      // without the cancel handler aborting a stale request.
      if (pollAbortRef.current === pollController) {
        pollAbortRef.current = null;
      }
    };
  }, [kgJobId, onComplete, router, successRoute, type]);

  // ----- Trigger the KG pipeline for a known project id -----
  const startKnowledgeGraph = useCallback(
    async (projectId: string) => {
      setIsGeneratingKG(true);
      setKgError(null);
      setKgProgress({ step: "queued", current: 0, total: 7 });
      // Fresh AbortController for the KG POST. A previous run may
      // have left an aborted controller hanging in the ref; replace
      // it here so the new request is cancellable independently.
      const kgController = new AbortController();
      kgAbortRef.current = kgController;
      try {
        const fd = new FormData();
        fd.append("type", type);
        fd.append("projectId", projectId);
        const resp = await fetch("/api/concept-graph/ingest", {
          method: "POST",
          body: fd,
          signal: kgController.signal,
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || `Failed to start pipeline (${resp.status})`);
        }
        const { jobId } = await resp.json();
        if (!jobId) throw new Error("No job id returned");
        setKgJobId(jobId);
        // Pre-seed the cancel target so the Cancel button can call
        // /api/concept-graph/jobs/<id>/cancel even if the polling
        // effect hasn't run yet (race window between the POST
        // returning and the effect firing).
        //
        // NOTE: do NOT write to `polledJobIdRef` here — that ref is
        // the polling effect's dedupe flag and pre-seeding it would
        // cause the effect to skip polling entirely, leaving the UI
        // stuck on "extracting text" forever.
        cancelJobIdRef.current = jobId;
      } catch (err: any) {
        // User cancelled before/during the POST — the cancel
        // handler has already reset UI state, just bail out.
        if (err?.name === "AbortError") return;
        const msg =
          err instanceof Error ? err.message : "Failed to generate knowledge graph";
        setKgError(msg);
        setIngestError(msg);
        setIsGeneratingKG(false);
        setKgProgress(null);
        setIsIngesting(false);
        setIngestStage("error");
      }
    },
    [type]
  );

  // ----- Public entry: submit URL/file, create project, kick off KG pipeline -----
  const startIngest = useCallback(
    async (
      name: string,
      url: string,
      file: File | null,
      existingProjectId?: string | null
    ) => {
      setIngestError(null);
      setIngestStage("preparing");
      // Clear any leftover cancel flag / job id from a previous
      // run so a fresh ingest isn't immediately treated as
      // cancelled by the polling effect.
      cancelledRef.current = false;
      polledJobIdRef.current = null;
      cancelJobIdRef.current = null;

      const abortController = new AbortController();
      abortRef.current = abortController;
      setIsIngesting(true);

      try {
        // Step 1: extract text + create/augment project shell.
        const result = await parseDocument(
          url,
          file,
          existingProjectId ?? null,
          type,
          abortController.signal
        );

        // Idempotency hit: the server says this URL was already imported.
        // Surface the existing project to the UI via state and bail
        // out — the user gets to choose "open" vs "regenerate" next.
        if (result.existing) {
          setExistingProject(result.existing);
          setIsIngesting(false);
          setIngestStage("preparing");
          return;
        }

        const workingId = result.id || existingProjectId;
        if (!workingId) {
          throw new Error("The server did not return a project id.");
        }
        projectIdRef.current = workingId;
        onProjectId?.(workingId);

        setIngestStage("generating");

        // Step 2: kick off the 7-step KG pipeline. The polling effect
        // picks up `kgJobId`, watches the job, and navigates to
        // `successRoute` once the graph is ready.
        await startKnowledgeGraph(workingId);
      } catch (err: any) {
        if (err?.status === 499 || err?.name === "AbortError") {
          // User cancelled — silently reset.
          setIsIngesting(false);
          setIngestStage("preparing");
          return;
        }
        console.error("Failed to ingest document", err);
        const message =
          err instanceof Error ? err.message : "Failed to load document";
        setIngestError(message);
        setIsIngesting(false);
        setIngestStage("error");
      }
    },
    [onProjectId, startKnowledgeGraph, type]
  );

  return {
    isIngesting,
    ingestStage,
    ingestError,
    kgProgress,
    kgError,
    isGeneratingKG,
    existingProject,
    clearExistingProject,
    startIngest,
    cancelIngest,
    reset,
  };
}
