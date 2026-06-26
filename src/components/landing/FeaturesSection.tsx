"use client";

import { useTranslation } from "react-i18next";
import { MaskReveal } from "./MaskReveal";
import { StaggerFadeUp } from "./StaggerFadeUp";

export function FeaturesSection() {
  const { t } = useTranslation();

  return (
    <section className="py-24 md:py-40 px-6 border-b border-[#1C1C1C]/10">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-end mb-16 md:mb-24">
          <MaskReveal>
            <h2 className="font-serif text-3xl md:text-5xl tracking-tight">
              {t("features.title1")} <br />
              <span className="italic text-[#1C1C1C]/60">
                {t("features.title2")}
              </span>
            </h2>
          </MaskReveal>
          <p
            data-fade
            className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-sans max-w-xs text-right mt-6 md:mt-0"
          >
            {t("features.subtitle")}
          </p>
        </div>

        <StaggerFadeUp className="grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-l border-[#1C1C1C]/10">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              data-fade
              className="p-8 md:p-12 border-r border-b border-[#1C1C1C]/10 group hover:bg-[#1C1C1C]/5 transition-colors duration-300"
            >
              <span className="text-[10px] font-mono text-[#1C1C1C]/30 mb-16 block">
                0{i}
              </span>
              <h3 className="font-serif text-2xl mb-4 group-hover:italic transition-all duration-300">
                {t(`features.feat${i}_title`)}
              </h3>
              <p className="font-sans text-sm text-[#1C1C1C]/60 leading-relaxed">
                {t(`features.feat${i}_desc`)}
              </p>
            </div>
          ))}
        </StaggerFadeUp>
      </div>
    </section>
  );
}
