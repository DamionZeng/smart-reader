"use client";

import { useTranslation } from "react-i18next";
import { StaggerFadeUp } from "./StaggerFadeUp";

export function FooterSection() {
  const { t } = useTranslation();

  return (
    <footer className="py-12 px-6 border-t border-[#1C1C1C]/10 bg-[#F9F8F6]">
      <StaggerFadeUp className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div
          data-fade
          className="font-serif text-2xl tracking-tight font-bold"
        >
          SmartReader.
        </div>
        <p data-fade className="font-sans text-xs text-[#1C1C1C]/40">
          {t("footer.copyright")}
        </p>
      </StaggerFadeUp>
    </footer>
  );
}
