"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/errors/ErrorFallback";

/**
 * Root-level error boundary. Catches errors that bubble up from
 * any nested route. Renders inside the root layout (so it inherits
 * fonts, theme, etc.) and offers the user a chance to recover.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[root error boundary]", error);
  }, [error]);

  return (
    <ErrorFallback
      title="Application error"
      subtitle="A fatal error occurred. Your work-in-progress may not be saved."
      error={error}
      reset={reset}
    />
  );
}
