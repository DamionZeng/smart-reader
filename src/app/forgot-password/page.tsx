"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { SiteHeader } from "@/components/SiteHeader";

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok && res.status !== 429) {
        // The endpoint always returns success (except when rate limited),
        // but guard against unexpected failures regardless.
        throw new Error("Request failed");
      }

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Too many attempts. Please try again later.");
        setIsLoading(false);
        return;
      }

      setSubmitted(true);
    } catch (err) {
      console.error("Forgot password error:", err);
      setError(t("auth.resetError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9F8F6] text-[#1C1C1C] font-sans">
      <SiteHeader />

      <main className="min-h-screen flex items-center justify-center px-6 py-32">
        <div className="w-full max-w-md mx-auto">
          <div className="text-center mb-12">
            <h1 className="font-serif text-4xl md:text-5xl tracking-tight mb-4">
              {t("auth.forgotPasswordTitle")}
            </h1>
            <p className="font-sans text-sm text-[#1C1C1C]/60">
              {t("auth.forgotPasswordDescription")}
            </p>
          </div>

          {submitted ? (
            <div className="space-y-10">
              <p className="font-sans text-sm text-[#1C1C1C]/80 bg-[#1C1C1C]/5 p-4 border border-[#1C1C1C]/10">
                {t("auth.resetEmailSent")}
              </p>
              <Link
                href="/login"
                className="block w-full text-center bg-[#1C1C1C] text-[#F9F8F6] font-sans text-xs uppercase tracking-[0.2em] px-6 py-4 border border-[#1C1C1C] hover:bg-transparent hover:text-[#1C1C1C] transition-colors duration-300"
              >
                {t("auth.backToLogin")}
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-6">
              <div>
                <label
                  htmlFor="email"
                  className="block font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 mb-2"
                >
                  {t("auth.email")}
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  disabled={isLoading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full border border-[#1C1C1C]/20 text-sm focus:outline-none focus:border-[#1C1C1C] transition-colors placeholder:text-[#1C1C1C]/30 px-4 py-3 bg-transparent"
                  placeholder="you@example.com"
                />
              </div>

              {error && (
                <p className="font-sans text-xs text-[#1C1C1C]/80 bg-[#1C1C1C]/5 p-3 border border-[#1C1C1C]/10">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#1C1C1C] text-[#F9F8F6] font-sans text-xs uppercase tracking-[0.2em] px-6 py-4 border border-[#1C1C1C] hover:bg-transparent hover:text-[#1C1C1C] transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading
                  ? t("auth.sendingResetLink")
                  : t("auth.sendResetLink")}
              </button>
            </form>
          )}

          {!submitted && (
            <p className="mt-10 text-center font-sans text-xs text-[#1C1C1C]/60">
              <Link
                href="/login"
                className="text-[#1C1C1C] underline underline-offset-4 hover:text-[#1C1C1C]/60 transition-colors"
              >
                {t("auth.backToLogin")}
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
