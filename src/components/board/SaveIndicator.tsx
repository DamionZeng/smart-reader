"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Check, AlertCircle, PencilLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/cn";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

interface SaveIndicatorProps {
  status: SaveStatus;
  /** Last successful save timestamp; used to render "Saved Xm ago" when idle */
  lastSavedAt?: Date | null;
  /** When true, the indicator is always rendered even when idle and lastSavedAt is null */
  alwaysShow?: boolean;
  className?: string;
}

function formatRelative(date: Date, t: (key: string, opts?: any) => string) {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return t("board.savedJustNow");
  if (diffSec < 60) return t("board.savedSecondsAgo", { count: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("board.savedMinutesAgo", { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("board.savedHoursAgo", { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  return t("board.savedDaysAgo", { count: diffDay });
}

export function SaveIndicator({
  status,
  lastSavedAt = null,
  alwaysShow = false,
  className,
}: SaveIndicatorProps) {
  const { t, i18n } = useTranslation();
  // Re-render every 30s while idle so the "Saved Xm ago" label stays accurate.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (status !== "idle" || !lastSavedAt) return;
    const id = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(id);
  }, [status, lastSavedAt]);

  // All text nodes below are translated. We add `suppressHydrationWarning`
  // to the text-bearing spans so React will not warn when the client's
  // i18n.language differs from the server's at hydrate time. This is the
  // recommended Next.js pattern for user-preference-dependent text in
  // SSR'd client components.
  if (status === "dirty") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-sans text-[#1C1C1C]/70",
          className
        )}
      >
        <PencilLine className="w-3.5 h-3.5" aria-hidden />
        <span suppressHydrationWarning>{t("board.unsaved")}</span>
      </div>
    );
  }

  if (status === "idle") {
    if (!lastSavedAt && !alwaysShow) return null;
    if (!lastSavedAt) {
      return (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-sans text-[#1C1C1C]/30",
            className
          )}
        >
          <span aria-hidden className="w-1.5 h-1.5 bg-[#1C1C1C]/30" />
          <span suppressHydrationWarning>{t("board.unsaved")}</span>
        </div>
      );
    }
    // touch tick so React knows to re-render when interval fires
    void tick;
    return (
      <div
        role="status"
        aria-live="polite"
        title={lastSavedAt.toLocaleString(
          i18n.language.startsWith("zh") ? "zh-CN" : "en-US"
        )}
        className={cn(
          "inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-sans text-[#1C1C1C]/40",
          className
        )}
      >
        <Check className="w-3.5 h-3.5" aria-hidden />
        <span suppressHydrationWarning>
          {formatRelative(lastSavedAt, t)}
        </span>
      </div>
    );
  }

  if (status === "saving") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-sans text-[#1C1C1C]/70",
          className
        )}
      >
        <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden />
        <span suppressHydrationWarning>{t("board.saving")}</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-sans text-[#1C1C1C]",
          className
        )}
      >
        <AlertCircle className="w-3.5 h-3.5" aria-hidden />
        <span suppressHydrationWarning>{t("board.saveError")}</span>
      </div>
    );
  }

  // status === "saved" — transient confirmation
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-sans text-[#1C1C1C]",
        className
      )}
    >
      <Check className="w-3.5 h-3.5" aria-hidden />
      <span suppressHydrationWarning>{t("board.saved")}</span>
    </div>
  );
}
