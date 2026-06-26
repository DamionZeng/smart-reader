"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  children: ReactNode;
  /** Context label for logs (e.g. "qa-stream", "explain", "ingest") */
  context?: string;
  /** Optional callback invoked when the user clicks "Retry" */
  onRetry?: () => void;
  /** Optional callback invoked when the user dismisses the error */
  onDismiss?: () => void;
  /** Custom fallback render function */
  fallbackRender?: (args: {
    error: Error;
    reset: () => void;
  }) => ReactNode;
};

type State = {
  error: Error | null;
};

/**
 * Class-based React error boundary used to isolate AI streaming UI
 * failures from the rest of the canvas. AI streams can fail mid-flight
 * (network drops, upstream errors, malformed responses) — without a
 * boundary, they would unmount the whole board.
 */
export class AIErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const ctx = this.props.context ?? "ai";
    console.error(`[${ctx} error boundary]`, error, info);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  dismiss = () => {
    this.setState({ error: null });
    this.props.onDismiss?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallbackRender) {
      return this.props.fallbackRender({ error, reset: this.reset });
    }

    return <DefaultAIFallback error={error} reset={this.reset} dismiss={this.dismiss} />;
  }
}

function DefaultAIFallback({
  error,
  reset,
  dismiss,
}: {
  error: Error;
  reset: () => void;
  dismiss: () => void;
}) {
  const { t } = useTranslation();
  // Map known error types to friendlier messages
  const msg = (error.message || "").toLowerCase();
  let hint = t("errors.aiStreamSubtitle");
  if (msg.includes("rate") || msg.includes("429")) {
    hint = t("errors.aiRateLimit");
  } else if (msg.includes("network") || msg.includes("fetch")) {
    hint = t("errors.aiNetworkError");
  } else if (msg.includes("timeout") || msg.includes("aborted")) {
    hint = t("errors.aiTimeout");
  } else if (msg.includes("401") || msg.includes("403") || msg.includes("auth")) {
    hint = t("errors.aiAuthError");
  } else if (msg.includes("empty") || msg.includes("no content")) {
    hint = t("errors.aiEmpty");
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="border border-[#1C1C1C]/20 bg-[#F9F8F6] p-4 my-3 text-[#1C1C1C] flex items-start gap-3"
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 mb-1">
          {t("errors.aiStreamTitle")}
        </p>
        <p className="font-serif text-sm leading-relaxed mb-3">{hint}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 bg-[#1C1C1C] text-[#F9F8F6] font-sans text-[10px] uppercase tracking-[0.2em] px-3 py-1.5 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[#1C1C1C]/40"
          >
            <RefreshCw className="w-3 h-3" />
            {t("common.retry")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex items-center gap-1.5 text-[#1C1C1C]/60 font-sans text-[10px] uppercase tracking-[0.2em] px-2 py-1.5 hover:text-[#1C1C1C] focus:outline-none"
            aria-label={t("common.close")}
          >
            <X className="w-3 h-3" />
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
