"use client";

import { useTranslation } from "react-i18next";
import { MaskReveal } from "./MaskReveal";
import { StaggerFadeUp } from "./StaggerFadeUp";

export function ManifestoSection() {
  const { t } = useTranslation();

  return (
    <section className="py-24 md:py-40 px-6 border-b border-[#1C1C1C]/10 bg-[#F9F8F6]">
      <StaggerFadeUp className="max-w-4xl mx-auto text-center">
        <MaskReveal
          className="block mb-12 border-b border-[#1C1C1C]/10 pb-4 max-w-xs mx-auto"
          duration={0.9}
        >
          <span className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-sans block">
            {t("problem.subtitle")}
          </span>
        </MaskReveal>

        <div data-fade>
          <h2 className="font-serif text-3xl md:text-5xl leading-tight text-[#1C1C1C] mb-8">
            {t("problem.quote1")}{" "}
            <span className="italic text-[#1C1C1C]/60">
              {t("problem.quote2")}
            </span>
            {t("problem.quote3")}
          </h2>
        </div>

        <p
          data-fade
          className="font-sans text-sm text-[#1C1C1C]/60 max-w-2xl mx-auto leading-relaxed"
        >
          {t("problem.description")}
        </p>
      </StaggerFadeUp>
    </section>
  );
}
