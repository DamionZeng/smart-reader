"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/errors/ErrorFallback";

/**
 * Global error boundary. Required at the app root — when something
 * explodes during a server render or in any nested layout, this
 * catches it and lets the user recover without reloading the app.
 *
 * Note: the global error boundary intentionally renders WITHOUT
 * the root <html> / <body> tags (Next.js requirement). It must be
 * a Client Component.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
}) {
  useEffect(() => {
    // Log the error to your monitoring service of choice.
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "#F9F8F6",
          color: "#1C1C1C",
        }}
      >
        <ErrorFallback
          title="Application error"
          subtitle="A fatal error occurred. Your work-in-progress may not be saved."
          error={error}
          reset={reset}
        />
      </body>
    </html>
  );
}
