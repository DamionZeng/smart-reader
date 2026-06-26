"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/errors/ErrorFallback";

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[settings error boundary]", error);
  }, [error]);

  return (
    <ErrorFallback
      title="Settings unavailable"
      subtitle="We couldn't load your settings."
      error={error}
      reset={reset}
    />
  );
}
