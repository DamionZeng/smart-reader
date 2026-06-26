"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/errors/ErrorFallback";

export default function BoardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[board error boundary]", error);
  }, [error]);

  return (
    <ErrorFallback
      title="Canvas unavailable"
      subtitle="The graph canvas hit an unexpected error. Your work has been auto-saved."
      error={error}
      reset={reset}
    />
  );
}
