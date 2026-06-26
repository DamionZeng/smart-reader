"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/errors/ErrorFallback";

export default function CodeBoardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[codeboard error boundary]", error);
  }, [error]);

  return (
    <ErrorFallback
      title="Code canvas unavailable"
      subtitle="The code graph canvas hit an unexpected error. Your work has been auto-saved."
      error={error}
      reset={reset}
    />
  );
}
