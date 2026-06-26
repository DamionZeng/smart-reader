"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { UserMenu } from "@/components/UserMenu";
import { useSession } from "@/lib/auth-client";

export default function LandingPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: session } = useSession();

  const handleEnter = () => {
    // Always go to the dashboard — the page itself redirects unauthenticated
    // users to /login, and authenticated users land on their project list.
    // Going straight to /board would show the import-material page instead.
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-[#F9F8F6] text-[#1C1C1C] font-sans selection:bg-[#1C1C1C] selection:text-[#F9F8F6]">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-[#F9F8F6]/90 backdrop-blur z-50 border-b border-[#1C1C1C]/10 px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="font-serif text-2xl tracking-tight font-bold"
          >
            SmartReader.
          </Link>
          <div className="flex items-center gap-6">
            <UserMenu />
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="min-h-[90vh] flex items-center pt-24 px-6 border-b border-[#1C1C1C]/10 relative overflow-hidden">
        <div className="max-w-4xl mx-auto text-center relative z-10 w-full">
          <p className="text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 mb-8 font-sans font-semibold">
            {t("hero.subtitle")}
          </p>
          <h1 className="font-serif text-5xl md:text-7xl lg:text-8xl leading-[1.1] tracking-tight mb-8">
            {t("hero.title1")} <br />
            <span className="italic text-[#1C1C1C]/60">{t("hero.title2")}</span>
          </h1>
          <p className="font-sans text-sm md:text-base text-[#1C1C1C]/70 max-w-lg mx-auto mb-12 leading-relaxed">
            {t("hero.description")}
          </p>
          <button
            onClick={handleEnter}
            className="inline-flex items-center justify-center bg-[#1C1C1C] text-[#F9F8F6] font-sans text-xs uppercase tracking-[0.2em] px-10 py-4 border border-[#1C1C1C] hover:bg-transparent hover:text-[#1C1C1C] transition-colors duration-300 shadow-none rounded-none focus:outline-none"
          >
            {t("hero.cta")}
          </button>
        </div>
      </section>

      {/* Manifesto / Statement Piece */}
      <section className="py-24 md:py-40 px-6 border-b border-[#1C1C1C]/10 bg-[#F9F8F6]">
        <div className="max-w-4xl mx-auto text-center">
          <span className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-sans block mb-12 border-b border-[#1C1C1C]/10 pb-4 max-w-xs mx-auto">
            {t("problem.subtitle")}
          </span>
          <h2 className="font-serif text-3xl md:text-5xl leading-tight text-[#1C1C1C] mb-8">
            {t("problem.quote1")}{" "}
            <span className="italic text-[#1C1C1C]/60">
              {t("problem.quote2")}
            </span>
            {t("problem.quote3")}
          </h2>
          <p className="font-sans text-sm text-[#1C1C1C]/60 max-w-2xl mx-auto leading-relaxed">
            {t("problem.description")}
          </p>
        </div>
      </section>

      {/* Featured Use Cases */}
      <section className="py-24 md:py-40 px-6 border-b border-[#1C1C1C]/10">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-16 md:mb-24">
            <h2 className="font-serif text-3xl md:text-5xl tracking-tight leading-tight">
              {t("cases.title1")} <br />
              <span className="italic text-[#1C1C1C]/60">
                {t("cases.title2")}
              </span>
            </h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 mt-6 md:mt-0">
              {t("cases.subtitle")}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#1C1C1C]/10 border border-[#1C1C1C]/10">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
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
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 md:py-40 px-6 border-b border-[#1C1C1C]/10">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-end mb-16 md:mb-24">
            <h2 className="font-serif text-3xl md:text-5xl tracking-tight">
              {t("features.title1")} <br />
              <span className="italic text-[#1C1C1C]/60">
                {t("features.title2")}
              </span>
            </h2>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 font-sans max-w-xs text-right mt-6 md:mt-0">
              {t("features.subtitle")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-l border-[#1C1C1C]/10">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
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
          </div>
        </div>
      </section>

      {/* Metrics / Quotes */}
      <section className="py-24 md:py-32 px-6 bg-[#1C1C1C] text-[#F9F8F6]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-24 items-center">
          <div>
            <h2 className="font-serif text-3xl md:text-5xl leading-tight tracking-tight mb-8">
              {t("metrics.quote1")}
              <span className="italic text-[#F9F8F6]/60">
                {t("metrics.quote2")}
              </span>
              {t("metrics.quote3")}
            </h2>
            <p className="font-mono text-xs text-[#F9F8F6]/40 uppercase tracking-widest">
              {t("metrics.source")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 border-t md:border-t-0 md:border-l border-[#F9F8F6]/10 pt-8 md:pt-0 md:pl-16">
            {[
              { value: "4x", label: t("metrics.stat1") },
              { value: "10k+", label: t("metrics.stat2") },
              { value: "60%", label: t("metrics.stat3") },
              { value: "∞", label: t("metrics.stat4") },
            ].map((stat) => (
              <div key={stat.label}>
                <span className="font-serif text-4xl md:text-6xl block mb-2">
                  {stat.value}
                </span>
                <span className="font-sans text-xs text-[#F9F8F6]/40 uppercase tracking-widest block">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-[#1C1C1C]/10 bg-[#F9F8F6]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="font-serif text-2xl tracking-tight font-bold">
            SmartReader.
          </div>
          <p className="font-sans text-xs text-[#1C1C1C]/40">
            {t("footer.copyright")}
          </p>
        </div>
      </footer>
    </div>
  );
}
