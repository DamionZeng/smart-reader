import React, { useEffect, useState, useRef } from "react";
import { Upload, Github, ArrowRight, X, FileCode } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/cn";
import { IngestionFlow, IngestionStage } from "@/components/board/IngestionFlow";

interface CodeIngestionProps {
  /** Called when the user submits the form with a name, URL, and/or file. */
  onIngest: (name: string, url: string, file: File | null) => void;
  /** Optional header content rendered on the left of the eyebrow row. */
  headerExtra?: React.ReactNode;
  /**
   * When provided, the component renders as a modal with a backdrop and
   * a close button. The form behaves identically otherwise.
   */
  onClose?: () => void;
  /** Default value for the name input. */
  initialName?: string;
  /** Server / network error from the most recent submission. */
  errorMessage?: string | null;
  /** When true, disables all inputs and the submit button. */
  loading?: boolean;
  /**
   * Current ingestion stage. When `loading` is true the form is replaced
   * by an inline progress card so the user never sees a separate
   * full-page flow.
   */
  stage?: IngestionStage;
  /** Optional numeric progress for the knowledge-graph sub-steps. */
  kgProgress?: { step: string; current: number; total: number } | null;
  /** Cancel button — only rendered when loading and onCancel is set. */
  onCancel?: () => void;
  /** i18n key for the cancel button label. */
  cancelLabelKey?: string;
}

/**
 * Map the backend KG pipeline step name to the IngestionFlow sub-step key.
 */
function mapProgressStep(step?: string): string | undefined {
  const map: Record<string, string> = {
    "extracting-text": "extractText",
    "splitting-sentences": "splitSentences",
    "extracting-concepts": "extractConcepts",
    "resolving-entities": "resolveEntities",
    "building-edges": "buildEdges",
    "detecting-communities": "detectClusters",
    "enriching-concepts": "enrichConcepts",
  };
  return step ? map[step] : undefined;
}

const ALLOWED_FILE_EXTENSIONS = [
  ".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".rs",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".swift", ".kt", ".scala",
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml",
];
const ALLOWED_FILE_MIME_PREFIXES = ["text/", "application/json", "application/x-yaml"];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function generateUniqueProjectName(now: Date = new Date()): string {
  return `Code Project ${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function CodeIngestionUI({
  onIngest,
  headerExtra,
  onClose,
  initialName,
  errorMessage,
  loading = false,
  stage = "preparing",
  kgProgress = null,
  onCancel,
  cancelLabelKey = "ingest.cancel",
}: CodeIngestionProps) {
  const { t } = useTranslation();
  const [name, setName] = useState<string>(initialName ?? generateUniqueProjectName());
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [localFileError, setLocalFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof initialName === "string" && initialName.length > 0) {
      setName(initialName);
    }
  }, [initialName]);

  useEffect(() => {
    if (file) setLocalFileError(null);
  }, [file]);

  const handleFileSelect = (next: File | null) => {
    if (!next) {
      setFile(null);
      return;
    }
    const lowerName = next.name.toLowerCase();
    const okExt = ALLOWED_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    const lowerType = (next.type || "").toLowerCase();
    const okType = ALLOWED_FILE_MIME_PREFIXES.some((p) => lowerType.startsWith(p));
    if (!okExt && !okType) {
      setLocalFileError(t("codeIngest.fileTypeError"));
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setLocalFileError(null);
    setFile(next);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (loading || url) return;
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (loading || url) return;
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const handleUploadKeyDown = (e: React.KeyboardEvent) => {
    if (loading || url) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!url && !file) return;
    const trimmed = name.trim();
    onIngest(trimmed.length > 0 ? trimmed : generateUniqueProjectName(), url, file);
  };

  const isModal = typeof onClose === "function";

  const form = (
    <div
      className={cn(
        "w-full p-8 bg-white/50 backdrop-blur border border-[#1C1C1C]/10 animate-in fade-in zoom-in duration-500",
        isModal ? "max-w-xl" : "max-w-2xl"
      )}
    >
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="text-center flex-1">
          <h2 className="font-serif text-3xl mb-2 text-[#1C1C1C] tracking-tight">
            {t(isModal ? "codeIngest.modalTitle" : "codeIngest.title")}
          </h2>
          <p className="font-sans text-sm text-[#1C1C1C]/60">
            {t("codeIngest.subtitle")}
          </p>
        </div>
        {isModal && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-2 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors focus:outline-none shrink-0 -mt-1 -mr-1"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name input */}
        <div className="space-y-2">
          <label
            htmlFor="code-ingest-name"
            className="block text-[10px] uppercase tracking-widest text-[#1C1C1C]/40 font-mono"
          >
            {t("codeIngest.nameLabel")}
          </label>
          <div className="relative">
            <FileCode className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1C1C1C]/40" />
            <input
              id="code-ingest-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("codeIngest.namePlaceholder")}
              maxLength={255}
              disabled={loading}
              className="w-full bg-[#F9F8F6] border border-[#1C1C1C]/10 py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-[#1C1C1C]/40 transition-colors placeholder:text-[#1C1C1C]/30"
            />
          </div>
        </div>

        {/* GitHub URL input */}
        <div className="space-y-2">
          <label
            htmlFor="code-ingest-url"
            className="block text-[10px] uppercase tracking-widest text-[#1C1C1C]/40 font-mono"
          >
            {t("codeIngest.urlLabel")}
          </label>
          <div className="relative">
            <Github className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1C1C1C]/40" />
            <input
              id="code-ingest-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("codeIngest.urlPlaceholder")}
              disabled={!!file || loading}
              className="w-full bg-[#F9F8F6] border border-[#1C1C1C]/10 py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-[#1C1C1C]/40 transition-colors placeholder:text-[#1C1C1C]/30 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="relative flex items-center py-2">
          <div className="flex-grow border-t border-[#1C1C1C]/10"></div>
          <span className="flex-shrink-0 mx-4 text-[10px] uppercase tracking-widest text-[#1C1C1C]/40 font-mono">
            {t("codeIngest.or")}
          </span>
          <div className="flex-grow border-t border-[#1C1C1C]/10"></div>
        </div>

        {/* File upload */}
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-widest text-[#1C1C1C]/40 font-mono">
            {t("codeIngest.fileLabel")}
          </label>
          <div
            role="button"
            tabIndex={0}
            aria-label={file ? file.name : t("codeIngest.fileCta")}
            onClick={() => !loading && fileInputRef.current?.click()}
            onKeyDown={handleUploadKeyDown}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "cursor-pointer border border-dashed border-[#1C1C1C]/10 bg-[#F9F8F6] hover:bg-[#1C1C1C]/5 transition-colors p-8 text-center flex flex-col items-center justify-center gap-4 focus:outline-none focus:border-[#1C1C1C]/40",
              file ? "border-[#1C1C1C]/40 bg-[#1C1C1C]/5" : "",
              isDragOver && "border-[#1C1C1C] bg-[#1C1C1C]/10",
              loading && "opacity-50 cursor-not-allowed"
            )}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
              className="hidden"
              disabled={!!url || loading}
            />
            {file ? (
              <div className="font-sans text-sm text-[#1C1C1C] flex items-center gap-2">
                <span className="w-2 h-2 bg-[#1C1C1C]" aria-hidden />
                {file.name}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFileSelect(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="ml-2 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors focus:outline-none"
                  aria-label={t("common.close")}
                >
                  <X className="w-3.5 h-3.5" aria-hidden />
                </button>
              </div>
            ) : (
              <>
                <Upload className="w-6 h-6 text-[#1C1C1C]/40" />
                <div>
                  <span className="font-sans text-sm text-[#1C1C1C]/60 block mb-1">
                    {t("codeIngest.fileCta")}
                  </span>
                  <span className="font-mono text-[10px] text-[#1C1C1C]/40 uppercase">
                    {t("codeIngest.fileHint")}
                  </span>
                </div>
              </>
            )}
          </div>
          {localFileError && (
            <p className="font-sans text-xs text-[#1C1C1C]/80 mt-2">
              {localFileError}
            </p>
          )}
        </div>

        {/* Error banner */}
        {errorMessage && (
          <div
            role="alert"
            className="border border-[#1C1C1C] bg-[#1C1C1C]/5 p-4 font-sans text-xs text-[#1C1C1C] leading-relaxed"
          >
            <span className="block text-[10px] uppercase tracking-widest text-[#1C1C1C]/60 font-mono mb-1">
              {t("codeIngest.errorTitle")}
            </span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Action */}
        <button
          type="submit"
          disabled={(!url && !file) || loading}
          className="w-full flex items-center justify-center gap-2 py-4 bg-[#1C1C1C] text-[#F9F8F6] text-xs uppercase tracking-widest hover:bg-[#1C1C1C]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300"
        >
          {t("codeIngest.submit")} <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </div>
  );

  /**
   * Loading view — rendered inline inside the same card (modal) or the
   * same full-page layout so the user never sees a separate route. The
   * flow chart shows the current stage + active sub-step, with a cancel
   * button beneath it.
   */
  const loadingView = (
    <div
      className={cn(
        "w-full p-8 bg-white/50 backdrop-blur border border-[#1C1C1C]/10 animate-in fade-in zoom-in duration-500",
        isModal ? "max-w-xl" : "max-w-2xl"
      )}
    >
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="text-center flex-1">
          <h2 className="font-serif text-3xl mb-2 text-[#1C1C1C] tracking-tight">
            {t("codeIngest.title")}
          </h2>
          <p className="font-sans text-sm text-[#1C1C1C]/60">
            {t("codeIngest.subtitle")}
          </p>
        </div>
        {isModal && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-2 text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors focus:outline-none shrink-0 -mt-1 -mr-1"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        )}
      </div>

      <IngestionFlow
        activeStage={stage}
        errorMessage={errorMessage}
        activeSubStep={mapProgressStep(kgProgress?.step ?? undefined)}
        onCancel={onCancel}
        cancelLabelKey={cancelLabelKey}
      />

      {kgProgress && stage === "generating" ? (
        <div className="mt-6 border-t border-[#1C1C1C]/10 pt-4 flex items-center gap-3">
          <div className="flex-1 h-1 bg-[#1C1C1C]/10">
            <div
              className="h-full bg-[#1C1C1C] transition-all duration-300"
              style={{ width: `${(kgProgress.current / kgProgress.total) * 100}%` }}
            />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#1C1C1C]/60">
            {kgProgress.step} {kgProgress.current}/{kgProgress.total}
          </span>
        </div>
      ) : null}
    </div>
  );

  if (isModal) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10 bg-[#1C1C1C]/40 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto"
        onClick={loading ? undefined : onClose}
      >
        <div onClick={(e) => e.stopPropagation()}>{loading ? loadingView : form}</div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen flex flex-col items-center px-6 pt-28 pb-16">
      {headerExtra && (
        <div className="w-full max-w-2xl mb-10 flex items-center justify-between">
          {headerExtra}
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
            {t("codeIngest.eyebrow")}
          </span>
        </div>
      )}
      {loading ? loadingView : form}
    </div>
  );
}
