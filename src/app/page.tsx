"use client";

import "@/i18n";
import { LandingExperience } from "@/components/landing/LandingExperience";
import { HeroSection } from "@/components/landing/HeroSection";
import { ManifestoSection } from "@/components/landing/ManifestoSection";
import { UseCasesSection } from "@/components/landing/UseCasesSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { MetricsSection } from "@/components/landing/MetricsSection";
import { FooterSection } from "@/components/landing/FooterSection";

export default function LandingPage() {
  return (
    <LandingExperience>
      <div className="min-h-screen bg-[#F9F8F6] text-[#1C1C1C] font-sans selection:bg-[#1C1C1C] selection:text-[#F9F8F6]">
        <HeroSection />
        <ManifestoSection />
        <UseCasesSection />
        <FeaturesSection />
        <MetricsSection />
        <FooterSection />
      </div>
    </LandingExperience>
  );
}
