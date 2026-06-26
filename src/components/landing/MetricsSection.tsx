"use client";

import { useTranslation } from "react-i18next";
import { MaskReveal } from "./MaskReveal";
import { StaggerFadeUp } from "./StaggerFadeUp";

export function MetricsSection() {
  const { t } = useTranslation();

  return (
    <section className="py-24 md:py-32 px-6 bg-[#1C1C1C] text-[#F9F8F6]">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-24 items-center">
        <div>
          <MaskReveal>
            <h2 className="font-serif text-3xl md:text-5xl leading-tight tracking-tight mb-8">
              {t("metrics.quote1")}
              <span className="italic text-[#F9F8F6]/60">
                {t("metrics.quote2")}
              </span>
              {t("metrics.quote3")}
            </h2>
          </MaskReveal>
          <p
            data-fade
            className="font-mono text-xs text-[#F9F8F6]/40 uppercase tracking-widest"
          >
            {t("metrics.source")}
          </p>
        </div>
        <StaggerFadeUp className="grid grid-cols-2 gap-8 border-t md:border-t-0 md:border-l border-[#F9F8F6]/10 pt-8 md:pt-0 md:pl-16">
          {[
            { value: "4x", label: t("metrics.stat1") },
            { value: "10k+", label: t("metrics.stat2") },
            { value: "60%", label: t("metrics.stat3") },
            { value: "∞", label: t("metrics.stat4") },
          ].map((stat) => (
            <div key={stat.label} data-fade>
              <span className="font-serif text-4xl md:text-6xl block mb-2">
                {stat.value}
              </span>
              <span className="font-sans text-xs text-[#F9F8F6]/40 uppercase tracking-widest block">
                {stat.label}
              </span>
            </div>
          ))}
        </StaggerFadeUp>
      </div>
    </section>
  );
}
