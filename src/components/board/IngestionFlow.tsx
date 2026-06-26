"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/cn";

/**
 * High-level ingestion stages.
 *
 * The pipeline is intentionally short:
 *   - "preparing": the source text is being fetched / extracted.
 *   - "generating": the 7-step knowledge-graph pipeline is running.
 *   - "done": graph is rendered.
 *   - "error": terminal failure (the active stage when errorMessage is set).
 */
export type IngestionStage =
  | "preparing"
  | "generating"
  | "done"
  | "error";

interface SubStepDef {
  /** Stable key used to drive the auto-advance animation. */
  key: string;
  /** i18n key (no namespace prefix). */
  labelKey: string;
}

interface StageDef {
  key: Exclude<IngestionStage, "done" | "error">;
  number: string;
  titleKey: string;
  /**
   * Localised status label per status. `pending` shows a generic
   * "waiting" hint; `active` is shown on the active node; `done` is
   * the success state label.
   */
  statusKey: { pending: string; active: string; done: string };
  subSteps: SubStepDef[];
}

/**
 * Stage definitions. The order here defines the left-to-right order in
 * the flow chart. Sub-step keys are stable so the rotating indicator
 * can cycle through them.
 */
const STAGES: StageDef[] = [
  {
    key: "preparing",
    number: "01",
    titleKey: "ingest.flow.stage1Title",
    statusKey: {
      pending: "ingest.flow.statusPending",
      active: "ingest.flow.stage1Active",
      done: "ingest.flow.stage1Done",
    },
    subSteps: [
      { key: "fetchSource", labelKey: "ingest.flow.step1_1" },
    ],
  },
  {
    key: "generating",
    number: "02",
    titleKey: "ingest.flow.stage2Title",
    statusKey: {
      pending: "ingest.flow.statusPending",
      active: "ingest.flow.stage2Active",
      done: "ingest.flow.stage2Done",
    },
    subSteps: [
      { key: "extractText", labelKey: "ingest.flow.step2_1" },
      { key: "splitSentences", labelKey: "ingest.flow.step2_2" },
      { key: "extractConcepts", labelKey: "ingest.flow.step2_3" },
      { key: "resolveEntities", labelKey: "ingest.flow.step2_4" },
      { key: "buildEdges", labelKey: "ingest.flow.step2_5" },
      { key: "detectClusters", labelKey: "ingest.flow.step2_6" },
      { key: "enrichConcepts", labelKey: "ingest.flow.step2_7" },
    ],
  },
];

interface IngestionFlowProps {
  /**
   * The currently active stage. On error, the parent should still pass
   * the *original* active stage (e.g. "parsing") and additionally set
   * `errorMessage`. The component will render the failed node with an
   * error indicator.
   */
  activeStage: IngestionStage;
  /** Shown beneath the flow chart. When set, the active node is marked failed. */
  errorMessage?: string | null;
  /** Cancel button — only rendered when provided and stage is not done. */
  onCancel?: () => void;
  /** i18n key for the cancel button label. */
  cancelLabelKey?: string;
  /**
   * Optional sub-step override. When a parent knows the real active
   * sub-step (e.g. via API progress events) it can pass the sub-step
   * key here. When omitted, the component cycles sub-steps on a timer
   * to give a sense of progress.
   */
  activeSubStep?: string;
}

export function IngestionFlow({
  activeStage,
  errorMessage,
  onCancel,
  cancelLabelKey = "ingest.cancel",
  activeSubStep,
}: IngestionFlowProps) {
  const { t } = useTranslation();
  const isFailed = !!errorMessage;
  const activeIndex = STAGES.findIndex((s) => s.key === activeStage);

  // The stage to display as currently active/failed. Falls back to the
  // first stage when the active stage is "done" or unmapped.
  const focusStage: Exclude<IngestionStage, "done" | "error"> | null =
    activeIndex >= 0
      ? STAGES[activeIndex].key
      : activeStage === "done"
      ? null
      : "preparing";

  /**
   * Pick the sub-step to highlight for the active stage.
   *
   * The parent (IngestionUI) is the source of truth for the active
   * sub-step — it forwards the latest KG pipeline progress. When the
   * parent has not provided a sub-step yet (e.g. the API has not
   * started emitting progress, or the job is in the brief "queued"
   * state), we **do not cycle through the sub-steps on a timer**.
   * Doing so causes the indicator to visibly hop between all 7
   * sub-steps every ~1.6s, which looks like a stuck / looping
   * pipeline. Instead we highlight the first sub-step so the user
   * sees a stable, in-progress indicator that updates as soon as the
   * real progress arrives.
   */
  function getActiveSubStepKey(stage: StageDef): string | null {
    if (stage.key !== focusStage) return null;
    if (activeSubStep) {
      const match = stage.subSteps.find((s) => s.key === activeSubStep);
      if (match) return match.key;
    }
    // No real progress yet — fall back to the first sub-step rather
    // than cycling, so the indicator is stable.
    return stage.subSteps[0]?.key || null;
  }

  function getStageState(stage: StageDef): "done" | "active" | "pending" | "error" {
    if (isFailed && stage.key === focusStage) return "error";
    if (activeStage === "done") return "done";
    if (stage.key === focusStage) return "active";
    const stageIdx = STAGES.findIndex((s) => s.key === stage.key);
    if (focusStage && stageIdx < activeIndex) return "done";
    return "pending";
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full max-w-4xl px-6 py-10 flex flex-col items-stretch gap-8"
    >
      {/* Flow chart: 2 nodes + 1 connector, single row on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch gap-y-6 md:gap-y-0">
        {STAGES.map((stage, idx) => {
          const state = getStageState(stage);
          const statusLabel = t(stage.statusKey[state === "error" ? "active" : state]);
          return (
            <React.Fragment key={stage.key}>
              <StageNode
                stage={stage}
                state={state}
                statusLabel={statusLabel}
                title={t(stage.titleKey)}
              />
              {idx < STAGES.length - 1 ? (
                <Connector
                  state={
                    state === "done"
                      ? "done"
                      : state === "active" || state === "error"
                      ? "active"
                      : "pending"
                  }
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>

      {/* Sub-step list — only shown when there is an active or failed stage */}
      {focusStage && activeIndex >= 0 ? (
        <SubStepList
          stage={STAGES[activeIndex]}
          activeSubKey={getActiveSubStepKey(STAGES[activeIndex])}
        />
      ) : null}

      {/* Error message */}
      {isFailed && errorMessage ? (
        <div
          role="alert"
          className="border border-[#1C1C1C] bg-[#1C1C1C]/5 p-4 font-sans text-xs text-[#1C1C1C] leading-relaxed"
        >
          <span className="block text-[10px] uppercase tracking-widest text-[#1C1C1C]/60 font-mono mb-1">
            {t("ingest.errorTitle")}
          </span>
          <span>{errorMessage}</span>
        </div>
      ) : null}

      {/* Cancel button */}
      {onCancel && activeStage !== "done" ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onCancel}
            className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] border border-[#1C1C1C]/30 px-6 py-2 transition-colors hover:bg-[#1C1C1C]/5 focus:outline-none"
          >
            {t(cancelLabelKey)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface StageNodeProps {
  stage: StageDef;
  state: "done" | "active" | "pending" | "error";
  statusLabel: string;
  title: string;
}

function StageNode({ stage, state, statusLabel, title }: StageNodeProps) {
  return (
    <div
      className={cn(
        "relative border bg-[#F9F8F6] px-6 py-5 min-h-[112px] flex flex-col justify-between transition-colors",
        state === "pending" && "border-[#1C1C1C]/10",
        state === "active" && "border-[#1C1C1C]",
        state === "done" && "border-[#1C1C1C]/40",
        state === "error" && "border-[#1C1C1C] bg-[#1C1C1C]/5"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
          {stage.number}
        </span>
        <StatusDot state={state} />
      </div>
      <div className="mt-4">
        <h3 className="font-serif text-lg leading-tight text-[#1C1C1C]">
          {title}
        </h3>
        <p
          className={cn(
            "mt-1 font-sans text-[11px] uppercase tracking-[0.2em]",
            state === "pending" && "text-[#1C1C1C]/30",
            state === "active" && "text-[#1C1C1C]/70",
            state === "done" && "text-[#1C1C1C]/60",
            state === "error" && "text-[#1C1C1C]"
          )}
        >
          {statusLabel}
        </p>
      </div>
    </div>
  );
}

function StatusDot({ state }: { state: "done" | "active" | "pending" | "error" }) {
  if (state === "pending") {
    return (
      <span
        aria-hidden
        className="w-2 h-2 border border-[#1C1C1C]/20 bg-transparent"
      />
    );
  }
  if (state === "active") {
    return (
      <span
        aria-hidden
        className="w-2 h-2 bg-[#1C1C1C] animate-pulse"
      />
    );
  }
  if (state === "error") {
    return (
      <span
        aria-hidden
        className="w-2 h-2 bg-[#1C1C1C] relative"
      >
        <span className="absolute inset-0 flex items-center justify-center text-[#F9F8F6] text-[8px] leading-none">
          ×
        </span>
      </span>
    );
  }
  // done
  return (
    <span
      aria-hidden
      className="w-2 h-2 bg-[#1C1C1C] relative"
    >
      <span className="absolute inset-0 flex items-center justify-center text-[#F9F8F6] text-[8px] leading-none font-bold">
        ✓
      </span>
    </span>
  );
}

function Connector({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <div
        aria-hidden
        className="hidden md:flex items-center justify-center self-center px-2"
      >
        <div className="w-16 h-px bg-[#1C1C1C]/60" />
      </div>
    );
  }
  if (state === "active") {
    return (
      <div
        aria-hidden
        className="hidden md:flex items-center justify-center self-center px-2 relative w-16 h-px bg-[#1C1C1C] overflow-hidden"
      >
        <div className="absolute w-4 h-px bg-[#F9F8F6] ingest-flow-streak" />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="hidden md:flex items-center justify-center self-center px-2"
    >
      <div className="w-16 h-px border-t border-dashed border-[#1C1C1C]/20" />
    </div>
  );
}

interface SubStepListProps {
  stage: StageDef;
  activeSubKey: string | null;
}

function SubStepList({ stage, activeSubKey }: SubStepListProps) {
  const { t } = useTranslation();
  return (
    <div className="border-t border-[#1C1C1C]/10 pt-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 mb-3">
        {t("ingest.flow.subStepsLabel")}
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2">
        {stage.subSteps.map((sub) => {
          const isActive = sub.key === activeSubKey;
          return (
            <li
              key={sub.key}
              className="flex items-center gap-3 font-sans text-xs"
            >
              <SubStepIndicator isActive={isActive} />
              <span
                className={cn(isActive ? "text-[#1C1C1C]" : "text-[#1C1C1C]/50")}
              >
                {t(sub.labelKey)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SubStepIndicator({ isActive }: { isActive: boolean }) {
  if (isActive) {
    return (
      <span
        aria-hidden
        className="w-1.5 h-1.5 bg-[#1C1C1C] animate-pulse shrink-0"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="w-1.5 h-1.5 border border-[#1C1C1C]/30 bg-transparent shrink-0"
    />
  );
}
