"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw, Wifi, WifiOff } from "lucide-react";

/**
 * Hook that wraps a fetch-based AI stream call and exposes:
 *  - data: incremental stream content
 *  - error: structured error info (or null)
 *  - isStreaming: true while the stream is open
 *  - retry(): re-run the request
 *  - cancel(): abort the in-flight request
 *
 * Classifies errors into:
 *  - "rate-limit" (429)
 *  - "network" (fetch failures, navigator offline)
 *  - "timeout" (AbortError after a user-defined budget)
 *  - "auth" (401 / 403)
 *  - "empty" (stream ended with no content)
 *  - "unknown" (everything else)
 */
export type AIStreamErrorKind =
  | "rate-limit"
  | "network"
  | "timeout"
  | "auth"
  | "empty"
  | "unknown";

export type AIStreamError = {
  kind: AIStreamErrorKind;
  message: string;
  status?: number;
};

type Options = {
  url: string;
  body: unknown;
  /** Abort after this many ms with a "timeout" error. Default 60s. */
  timeoutMs?: number;
};

export function useAIStream({ url, body, timeoutMs = 60_000 }: Options) {
  const [data, setData] = useState("");
  const [error, setError] = useState<AIStreamError | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const run = useEffect(() => {
    // Don't run automatically — caller calls start() explicitly.
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const classify = (
    message: string,
    status?: number
  ): AIStreamError => {
    const m = message.toLowerCase();
    if (status === 429 || m.includes("rate limit")) {
      return { kind: "rate-limit", message, status };
    }
    if (status === 401 || status === 403 || m.includes("unauthorized")) {
      return { kind: "auth", message, status };
    }
    if (
      m.includes("network") ||
      m.includes("failed to fetch") ||
      m.includes("networkerror") ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    ) {
      return { kind: "network", message, status };
    }
    if (m.includes("aborted") || m.includes("timeout")) {
      return { kind: "timeout", message, status };
    }
    return { kind: "unknown", message, status };
  };

  const start = async () => {
    setData("");
    setError(null);
    setIsStreaming(true);
    abortRef.current = new AbortController();

    // Timeout watchdog
    const timeoutId = setTimeout(() => {
      abortRef.current?.abort();
    }, timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      if (!res.body) {
        throw new Error("Response has no body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let total = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        total += value.length;
        setData((prev) => prev + decoder.decode(value, { stream: false }));
      }

      if (total === 0) {
        setError({ kind: "empty", message: "Empty response" });
      }
    } catch (e: any) {
      const message =
        e?.message === "The user aborted a request."
          ? "Request timed out"
          : e?.message || "Unknown error";
      const status = typeof e?.status === "number" ? e.status : undefined;
      setError(classify(message, status));
    } finally {
      clearTimeout(timeoutId);
      setIsStreaming(false);
    }
  };

  const retry = () => {
    setAttempt((a) => a + 1);
    start();
  };

  const cancel = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  // We intentionally don't auto-run. Call `start()` from a button.
  // Returning the deps is enough; attempt is here so retry re-evaluates the
  // effect (in case a future caller wants to wire it differently).
  void attempt;

  return { data, error, isStreaming, start, retry, cancel };
}

/**
 * Inline UI used inside chat / streaming panels. Shows contextual error
 * info + retry + cancel actions.
 */
export function AIStreamFallback({
  error,
  onRetry,
  onCancel,
  isStreaming,
}: {
  error: AIStreamError;
  onRetry: () => void;
  onCancel?: () => void;
  isStreaming?: boolean;
}) {
  const { t } = useTranslation();

  const label = (() => {
    switch (error.kind) {
      case "rate-limit":
        return t("errors.aiRateLimit");
      case "network":
        return t("errors.aiNetworkError");
      case "timeout":
        return t("errors.aiTimeout");
      case "auth":
        return t("errors.aiAuthError");
      case "empty":
        return t("errors.aiEmpty");
      default:
        return t("errors.aiStreamSubtitle");
    }
  })();

  const Icon = error.kind === "network" ? WifiOff : AlertTriangle;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 text-xs text-[#1C1C1C]/70 py-2"
    >
      <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="font-serif leading-snug">{label}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <button
            type="button"
            onClick={onRetry}
            disabled={isStreaming}
            className="inline-flex items-center gap-1.5 text-[#1C1C1C] font-sans text-[10px] uppercase tracking-[0.2em] underline-offset-2 hover:underline focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-3 h-3" />
            {t("common.retry")}
          </button>
          {onCancel && isStreaming && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 text-[#1C1C1C]/60 font-sans text-[10px] uppercase tracking-[0.2em] underline-offset-2 hover:underline focus:outline-none"
            >
              <Wifi className="w-3 h-3" />
              {t("common.close")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
