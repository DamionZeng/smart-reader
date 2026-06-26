"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/errors/ErrorFallback";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard error boundary]", error);
  }, [error]);

  return (
    <ErrorFallback
      title="Dashboard unavailable"
      subtitle="We couldn't load your projects. Please retry."
      error={error}
      reset={reset}
    />
  );
}
