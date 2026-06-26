"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { SiteHeader } from "@/components/SiteHeader";
import { useSession } from "@/lib/auth-client";
import { useGSAP } from "@gsap/react";
import { ensureGsapRegistered, gsap } from "@/lib/gsap/register";
import { KnowledgeGraphBackdrop } from "./KnowledgeGraphBackdrop";
import { CharReveal } from "./CharReveal";

export function HeroSection() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: session } = useSession();
  const heroRef = useRef<HTMLElement>(null);

  const handleEnter = () => router.push("/dashboard");

  // Hero 内副标题 / 描述 / CTA 的入场编排
  useGSAP(
    () => {
      ensureGsapRegistered();
      const els = heroRef.current?.querySelectorAll<HTMLElement>("[data-hero-fade]");
      if (!els?.length) return;

      const delays: Record<string, number> = {
        subtitle: 0.3,
        desc: 1.5,
        cta: 1.75,
      };

      els.forEach((el) => {
        const key = el.dataset.heroFade || "";
        const delay = delays[key] ?? 0;
        gsap.set(el, { y: 26, opacity: 0 });
        gsap.to(el, {
          y: 0,
          opacity: 1,
          duration: 0.95,
          delay,
          ease: "power3.out",
        });
      });
    },
    { scope: heroRef },
  );

  return (
    <>
      <SiteHeader />

      <section
        ref={heroRef}
        className="min-h-[90vh] flex items-center pt-24 px-6 border-b border-[#1C1C1C]/10 relative overflow-hidden"
      >
        <KnowledgeGraphBackdrop />
        <div className="max-w-4xl mx-auto text-center relative z-10 w-full">
          <p
            data-hero-fade="subtitle"
            className="text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 mb-8 font-sans font-semibold"
          >
            {t("hero.subtitle")}
          </p>
          <h1 className="font-serif text-5xl md:text-7xl lg:text-8xl leading-[1.1] tracking-tight mb-8">
            <CharReveal text={t("hero.title1")} delay={0.55} />
            <br />
            <span className="italic text-[#1C1C1C]/60">
              <CharReveal text={t("hero.title2")} delay={1.05} />
            </span>
          </h1>
          <p
            data-hero-fade="desc"
            className="font-sans text-sm md:text-base text-[#1C1C1C]/70 max-w-lg mx-auto mb-12 leading-relaxed"
          >
            {t("hero.description")}
          </p>
          <button
            data-hero-fade="cta"
            onClick={handleEnter}
            className="inline-flex items-center justify-center bg-[#1C1C1C] text-[#F9F8F6] font-sans text-xs uppercase tracking-[0.2em] px-10 py-4 border border-[#1C1C1C] hover:bg-transparent hover:text-[#1C1C1C] transition-colors duration-300 shadow-none rounded-none focus:outline-none"
          >
            {t("hero.cta")}
          </button>
        </div>
      </section>
    </>
  );
}
