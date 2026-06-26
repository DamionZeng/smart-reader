"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw, Home, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";

type Props = {
  /** Error title override (uses i18n if not provided) */
  title?: string;
  /** Subtitle/description override */
  subtitle?: string;
  /** Error object (in production, only message is exposed via digest) */
  error?: Error & { digest?: string };
  /** Reset handler (calls Next.js reset boundary) */
  reset?: () => void;
  /** Show "Back to home" button. Default: true */
  showHome?: boolean;
  /** Variant: 'page' = full-page hero, 'panel' = compact inline */
  variant?: "page" | "panel";
};

/**
 * Editorial-styled error fallback used by route-level and global error.tsx files.
 * Avoids rounded corners / drop shadows — matches the rest of the design system.
 */
export function ErrorFallback({
  title,
  subtitle,
  error,
  reset,
  showHome = true,
  variant = "page",
}: Props) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  // Auto-collapse details when error changes
  useEffect(() => {
    setShowDetails(false);
  }, [error?.message]);

  const resolvedTitle = title ?? t("errors.title");
  const resolvedSubtitle = subtitle ?? t("errors.subtitle");
  const errorMessage = error?.message ?? t("errors.subtitle");
  const errorDigest = error?.digest;

  const handleCopy = async () => {
    const payload = [
      `Message: ${errorMessage}`,
      errorDigest ? `Digest: ${errorDigest}` : null,
      `Time: ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard might be unavailable in iframes — silently ignore.
    }
  };

  if (variant === "panel") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="border border-[#1C1C1C]/20 bg-[#F9F8F6] p-6 text-[#1C1C1C]"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5 text-[#1C1C1C]" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/60 mb-2">
              {t("errors.title")}
            </p>
            <p className="font-serif text-lg leading-snug mb-3">{resolvedSubtitle}</p>
            <div className="flex flex-wrap gap-2">
              {reset && (
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex items-center gap-2 bg-[#1C1C1C] text-[#F9F8F6] font-sans text-[10px] uppercase tracking-[0.2em] px-4 py-2 transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[#1C1C1C]/40"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t("common.retry")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-[60vh] w-full flex items-center justify-center px-6 py-16 bg-[#F9F8F6]"
    >
      <div className="max-w-lg w-full">
        {/* Eyebrow */}
        <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/60 mb-4">
          {t("errors.title")}
        </p>

        {/* Title */}
        <h1 className="font-serif text-3xl md:text-4xl tracking-tight text-[#1C1C1C] mb-3">
          {resolvedTitle}
        </h1>

        {/* Subtitle */}
        <p className="font-serif text-base text-[#1C1C1C]/80 leading-relaxed mb-8">
          {resolvedSubtitle}
        </p>

        {/* Decorative rule */}
        <div className="w-12 h-px bg-[#1C1C1C] mb-8" />

        {/* Actions */}
        <div className="flex flex-wrap gap-3 mb-10">
          {reset && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 bg-[#1C1C1C] text-[#F9F8F6] font-sans text-[10px] uppercase tracking-[0.2em] px-5 py-3 transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[#1C1C1C]/40"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t("common.retry")}
            </button>
          )}
          {showHome && (
            <a
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-[#F9F8F6] border border-[#1C1C1C] text-[#1C1C1C] font-sans text-[10px] uppercase tracking-[0.2em] px-5 py-3 transition-colors hover:bg-[#1C1C1C] hover:text-[#F9F8F6] focus:outline-none focus:ring-2 focus:ring-[#1C1C1C]/40"
            >
              <Home className="w-3.5 h-3.5" />
              {t("common.home")}
            </a>
          )}
        </div>

        {/* Details (collapsible) */}
        <div className="border-t border-[#1C1C1C]/10 pt-6">
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="inline-flex items-center gap-2 font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] focus:outline-none"
            aria-expanded={showDetails}
          >
            {showDetails ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            {t("errors.details")}
          </button>
          {showDetails && (
            <div className="mt-3 space-y-2">
              <pre className="font-mono text-xs text-[#1C1C1C]/80 whitespace-pre-wrap break-words bg-[#1C1C1C]/5 p-3">
                {errorMessage}
              </pre>
              {errorDigest && (
                <p className="font-mono text-[10px] text-[#1C1C1C]/50">
                  digest: {errorDigest}
                </p>
              )}
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-2 font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] focus:outline-none"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied ? t("common.save") : t("common.copyError")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
