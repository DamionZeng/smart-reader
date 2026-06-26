"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { SiteHeader } from "@/components/SiteHeader";
import { useSession } from "@/lib/auth-client";
import { Check } from "lucide-react";
import {
  SUPPORTED_LANGUAGES,
  detectBrowserLanguage,
  type SupportedLanguage,
} from "@/lib/i18n-config";

/**
 * Resolve the default language at first paint.
 *
 * Runs on the client only — `window` is referenced inside the lazy
 * initialiser so this is safe under SSR (Next.js will use the
 * fallback to "en" for the server render, then the gate re-checks
 * after hydration). Doing it lazily in useState also avoids the
 * "language flips after first paint" flash you would get from a
 * top-level module-level call.
 */
function detectInitialLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return "en";
  return detectBrowserLanguage(window.navigator.language);
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { data: session, isPending } = useSession();

  // We deliberately start with the browser language — not the literal
  // "en" — so a user landing on the settings page for the first time
  // sees their own language pre-selected. They can still override.
  const [language, setLanguage] = useState<SupportedLanguage>(
    detectInitialLanguage
  );
  const [aiOutputLanguage, setAiOutputLanguage] = useState<SupportedLanguage>(
    detectInitialLanguage
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState("");

  // Auth guard
  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      router.replace("/login");
    }
  }, [session, isPending, router]);

  // Load settings from API. The server now distinguishes "user has
  // never set anything" (null) from "user explicitly picked English"
  // (a real row containing "en"), so we can:
  //  - keep the browser-language default when the row is missing, and
  //  - never silently overwrite an explicit user choice.
  useEffect(() => {
    if (!session?.user) return;
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (typeof data.language === "string") {
          setLanguage(data.language);
        }
        if (typeof data.aiOutputLanguage === "string") {
          setAiOutputLanguage(data.aiOutputLanguage);
        }
        // Onboarding: when the user has never set anything, persist
        // the browser-language default to the DB so subsequent AI
        // calls (which read from the DB) match what the UI displays.
        // Without this, a brand-new account whose browser is in
        // Chinese would see "Chinese" in the settings page but get
        // English back from the AI — the inconsistency the user
        // reported. The save is best-effort: if it fails we still
        // render the right UI value.
        if (data.hasSettingsRow === false) {
          const initLang = detectInitialLanguage();
          fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              language: initLang,
              aiOutputLanguage: initLang,
            }),
          }).catch(() => {
            // Non-fatal — the next save will retry.
          });
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSavedMessage("");

    try {
      // Save UI language to localStorage and apply immediately — this
      // works regardless of DB state so the UI reacts instantly.
      localStorage.setItem("i18nextLng", language);
      await i18n.changeLanguage(language);

      // Persist to database (best-effort). If the table is missing
      // (pending migration) we still keep the LocalStorage change.
      try {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language, aiOutputLanguage }),
        });
        if (!res.ok) {
          const data = await res.json();
          console.warn("Settings DB save skipped:", data.error);
        }
      } catch (dbErr) {
        console.warn("Settings DB save failed:", dbErr);
      }

      setSavedMessage(t("settings.saved"));
      setTimeout(() => setSavedMessage(""), 3000);
    } catch (e: any) {
      setError(e.message || t("settings.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9F8F6] text-[#1C1C1C] flex items-center justify-center">
        <p className="font-sans text-sm text-[#1C1C1C]/40">{t("settings.loading")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9F8F6] text-[#1C1C1C] font-sans selection:bg-[#1C1C1C] selection:text-[#F9F8F6]">
      {/* Navigation */}
      <SiteHeader />

      <main className="pt-32 pb-24 px-6">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="mb-12">
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#1C1C1C]/40 mb-4 font-sans font-semibold">
              {t("settings.subtitle")}
            </p>
            <h1 className="font-serif text-4xl md:text-5xl tracking-tight leading-[1.05]">
              {t("settings.title")}
            </h1>
          </div>

          {/* Interface Language */}
          <section className="mb-12 border-b border-[#1C1C1C]/10 pb-12">
            <div className="mb-6">
              <h2 className="font-serif text-xl mb-2">{t("settings.language")}</h2>
              <p className="font-sans text-sm text-[#1C1C1C]/60">
                {t("settings.languageDescription")}
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={`relative px-4 py-3 text-sm font-sans border transition-all duration-200 ${
                    language === lang
                      ? "border-[#1C1C1C] bg-[#1C1C1C] text-[#F9F8F6]"
                      : "border-[#1C1C1C]/20 hover:border-[#1C1C1C]/60 text-[#1C1C1C]"
                  }`}
                >
                  {language === lang && (
                    <Check className="w-3 h-3 absolute top-2 right-2" />
                  )}
                  {t(`settings.languages.${lang}`)}
                </button>
              ))}
            </div>
          </section>

          {/* AI Output Language */}
          <section className="mb-12 border-b border-[#1C1C1C]/10 pb-12">
            <div className="mb-6">
              <h2 className="font-serif text-xl mb-2">{t("settings.aiOutputLanguage")}</h2>
              <p className="font-sans text-sm text-[#1C1C1C]/60">
                {t("settings.aiOutputLanguageDescription")}
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  key={lang}
                  onClick={() => setAiOutputLanguage(lang)}
                  className={`relative px-4 py-3 text-sm font-sans border transition-all duration-200 ${
                    aiOutputLanguage === lang
                      ? "border-[#1C1C1C] bg-[#1C1C1C] text-[#F9F8F6]"
                      : "border-[#1C1C1C]/20 hover:border-[#1C1C1C]/60 text-[#1C1C1C]"
                  }`}
                >
                  {aiOutputLanguage === lang && (
                    <Check className="w-3 h-3 absolute top-2 right-2" />
                  )}
                  {t(`settings.languages.${lang}`)}
                </button>
              ))}
            </div>
          </section>

          {/* Save Button */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-8 py-3 bg-[#1C1C1C] text-[#F9F8F6] font-sans text-sm uppercase tracking-[0.2em] font-semibold hover:bg-[#1C1C1C]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? t("settings.saving") : t("settings.save")}
            </button>
            {savedMessage && (
              <p className="font-sans text-sm text-[#1C1C1C]/60">{savedMessage}</p>
            )}
            {error && (
              <p className="font-sans text-sm text-red-600">{error}</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
