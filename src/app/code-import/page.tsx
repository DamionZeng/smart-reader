"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { CodeIngestionUI } from "@/components/board/CodeIngestionUI";
import { useIngestionFlow } from "@/hooks/useIngestionFlow";

/**
 * Standalone code-project import page.
 *
 * Mirror of `/import` for source-code projects. On success, navigates
 * to `/codeboard?id=<projectId>`.
 */
export default function CodeImportPage() {
  const { t } = useTranslation();
  const flow = useIngestionFlow({
    type: "code",
    successRoute: "/codeboard",
  });

  return (
    <div className="w-screen min-h-screen bg-[#F9F8F6] text-[#1C1C1C] overflow-y-auto">
      <CodeIngestionUI
        onIngest={(name, url, file) => flow.startIngest(name, url, file)}
        loading={flow.isIngesting}
        stage={flow.ingestStage}
        kgProgress={flow.kgProgress}
        errorMessage={flow.ingestError ?? flow.kgError}
        onCancel={flow.cancelIngest}
        headerExtra={
          <Link
            href="/dashboard"
            className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] transition-colors"
          >
            {t("board.backToDashboard")}
          </Link>
        }
      />
    </div>
  );
}
