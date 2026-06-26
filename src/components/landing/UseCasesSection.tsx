"use client";

import { useTranslation } from "react-i18next";
import { MaskReveal } from "./MaskReveal";
import { StaggerFadeUp } from "./StaggerFadeUp";

export function UseCasesSection() {
  const { t } = useTranslation();

  return (
    <section className="py-24 md:py-40 px-6 border-b border-[#1C1C1C]/10">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-16 md:mb-24">
          <MaskReveal>
            <h2 className="font-serif text-3xl md:text-5xl tracking-tight leading-tight">
              {t("cases.title1")} <br />
              <span className="italic text-[#1C1C1C]/60">
                {t("cases.title2")}
              </span>
            </h2>
          </MaskReveal>
          <p
            data-fade
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 mt-6 md:mt-0"
          >
            {t("cases.subtitle")}
          </p>
        </div>
        <StaggerFadeUp className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#1C1C1C]/10 border border-[#1C1C1C]/10">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              data-fade
              className="bg-[#F9F8F6] p-12 md:p-16 flex flex-col justify-between aspect-square md:aspect-auto group"
            >
              <div className="mb-12">
                <span className="text-[10px] font-mono text-[#1C1C1C]/30 block mb-6">
                  {t(`cases.case${i}`)}
                </span>
                <h3 className="font-serif text-3xl tracking-tight mb-4 group-hover:italic transition-all duration-300">
                  {t(`cases.case${i}_title`)}
                </h3>
                <p className="font-sans text-sm text-[#1C1C1C]/60 leading-relaxed md:max-w-sm">
                  {t(`cases.case${i}_desc`)}
                </p>
              </div>
            </div>
          ))}
        </StaggerFadeUp>
      </div>
    </section>
  );
}
