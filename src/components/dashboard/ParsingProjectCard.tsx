"use client";

import { useTranslation } from "react-i18next";
import { X, Trash2 } from "lucide-react";
import type { ProjectSummary } from "@/api/project";

/**
 * Maps a raw KG pipeline `step` value (emitted by the Python service's
 * progress callback) to the i18n key used for the matching sub-step label
 * in IngestionFlow. Keeps the dashboard parsing card's step wording
 * identical to the import page's sub-step indicator.
 *
 * Step values come from python-parser/app/graph/workflow.py and align
 * with the front-end mapProgressStep table in IngestionUI.tsx.
 */
const STEP_LABEL_KEYS: Record<string, string> = {
  queued: "ingest.flow.step2_1",
  "extracting-concepts": "ingest.flow.step2_1",
  "resolving-entities": "ingest.flow.step2_2",
  "building-edges": "ingest.flow.step2_2",
  "building-graph": "ingest.flow.step2_2",
  "detecting-communities": "ingest.flow.step2_2",
  enriching: "ingest.flow.step2_3",
  "enriching-concepts": "ingest.flow.step2_3",
  finalizing: "ingest.flow.step2_3",
};

interface ParsingProjectCardProps {
  project: ProjectSummary;
  /** 取消正在进行的解析(更新 job 状态,保留 project) */
  onCancel: (id: string) => void;
  /** 删除项目(DELETE /api/projects/{id}) */
  onDelete: (id: string) => void;
}

/**
 * Dashboard card for projects whose KG pipeline is still running.
 *
 * Renders the project title, a live progress bar driven by
 * `parseProgress.current/total`, the current sub-step label, and a
 * cancel button (parsing 中) / delete button (failed 时)。
 *
 * Visual style follows the editorial design system: #F9F8F6 background,
 * #1C1C1C ink with opacity layers, no rounded corners, no shadows,
 * font-serif title + font-mono labels. The card is intentionally not
 * clickable (parsing projects have no board to open yet).
 */
export function ParsingProjectCard({
  project,
  onCancel,
  onDelete,
}: ParsingProjectCardProps) {
  const { t } = useTranslation();
  const progress = project.parseProgress;
  const current = progress?.current ?? 0;
  const total = progress?.total ?? 3;
  const percent = Math.min(100, Math.max(0, (current / total) * 100));
  const stepKey =
    (progress?.step && STEP_LABEL_KEYS[progress.step]) || "ingest.flow.step2_1";

  // A failed job surfaces a 'failed' jobStatus; we show an error state
  // instead of the progress bar so the user knows to cancel/delete.
  const isFailed = project.status === "failed" || progress?.jobStatus === "failed";

  return (
    <div
      className="group relative bg-[#F9F8F6] p-8 md:p-10 flex flex-col justify-between min-h-[220px]"
      data-status={project.status}
    >
      <div>
        <div className="flex items-center justify-between mb-6">
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#1C1C1C]/40">
            {isFailed ? t("dashboard.parsingFailed") : t("dashboard.parsing")}
          </span>
          <span
            className={`text-[10px] font-mono uppercase tracking-[0.15em] ${
              isFailed ? "text-[#1C1C1C]/50" : "text-[#1C1C1C]/30 animate-pulse"
            }`}
          >
            {isFailed ? "—" : `${current}/${total}`}
          </span>
        </div>
        <h3 className="font-serif text-2xl tracking-tight mb-3 line-clamp-2">
          {project.title}
        </h3>
        {project.originalUrl && (
          <p className="font-mono text-[10px] text-[#1C1C1C]/40 truncate">
            {project.originalUrl}
          </p>
        )}

        {/* Progress bar / error message */}
        <div className="mt-6">
          {isFailed ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#1C1C1C]/50">
              {t("dashboard.parsingFailed")}
            </p>
          ) : (
            <>
              <div className="h-1 bg-[#1C1C1C]/10 overflow-hidden">
                <div
                  className="h-full bg-[#1C1C1C] transition-all duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[#1C1C1C]/40">
                {t(stepKey)}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-6 pt-6 border-t border-[#1C1C1C]/10">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
          {isFailed ? t("dashboard.parsingFailed") : t("dashboard.parsing")}
        </span>
        {isFailed ? (
          // 失败状态:显示删除按钮,彻底删除项目
          <button
            type="button"
            onClick={() => onDelete(project.id)}
            className="p-2 text-[#1C1C1C]/20 hover:text-[#1C1C1C] transition-colors"
            aria-label={t("dashboard.deleteTitle")}
            title={t("dashboard.deleteTitle")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ) : (
          // 解析中:显示取消按钮(保留 project,标记为 failed)
          <button
            type="button"
            onClick={() => onCancel(project.id)}
            className="p-2 text-[#1C1C1C]/20 hover:text-[#1C1C1C] transition-colors"
            aria-label={t("dashboard.cancelParsing")}
            title={t("dashboard.cancelParsing")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
