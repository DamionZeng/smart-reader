"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Check, X, Loader2 } from "lucide-react";
import "@/i18n";

type Status = "verifying" | "success" | "error";

function VerifyEmailInner() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("verifying");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
          { method: "GET" }
        );

        if (cancelled) return;

        if (res.ok) {
          setStatus("success");
        } else {
          setStatus("error");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-[#F9F8F6] text-[#1C1C1C] font-sans">
      <nav className="fixed top-0 w-full bg-[#F9F8F6]/90 backdrop-blur z-50 border-b border-[#1C1C1C]/10 px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="font-serif text-2xl tracking-tight font-bold"
          >
            SmartReader.
          </Link>
        </div>
      </nav>

      <main className="min-h-screen flex items-center justify-center px-6 py-32">
        <div className="w-full max-w-md mx-auto text-center">
          {status === "verifying" && (
            <>
              <div className="flex items-center justify-center mb-8">
                <Loader2 className="w-8 h-8 text-[#1C1C1C]/40 animate-spin" />
              </div>
              <h1 className="font-serif text-3xl md:text-4xl tracking-tight mb-4">
                {t("verifyEmail.title")}
              </h1>
              <p className="font-sans text-sm text-[#1C1C1C]/60">
                {t("verifyEmail.verifying")}
              </p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="flex items-center justify-center mb-8">
                <div className="w-12 h-12 border border-[#1C1C1C] flex items-center justify-center">
                  <Check className="w-6 h-6 text-[#1C1C1C]" />
                </div>
              </div>
              <h1 className="font-serif text-3xl md:text-4xl tracking-tight mb-4">
                {t("verifyEmail.title")}
              </h1>
              <p className="font-sans text-sm text-[#1C1C1C]/60 mb-10 leading-relaxed">
                {t("verifyEmail.success")}
              </p>
              <Link
                href="/login"
                className="inline-block w-full bg-[#1C1C1C] text-[#F9F8F6] font-sans text-xs uppercase tracking-[0.2em] px-6 py-4 border border-[#1C1C1C] hover:bg-transparent hover:text-[#1C1C1C] transition-colors duration-300"
              >
                {t("verifyEmail.backToLogin")}
              </Link>
            </>
          )}

          {status === "error" && (
            <>
              <div className="flex items-center justify-center mb-8">
                <div className="w-12 h-12 border border-[#1C1C1C]/40 flex items-center justify-center">
                  <X className="w-6 h-6 text-[#1C1C1C]/60" />
                </div>
              </div>
              <h1 className="font-serif text-3xl md:text-4xl tracking-tight mb-4">
                {t("verifyEmail.title")}
              </h1>
              <p className="font-sans text-sm text-[#1C1C1C]/60 mb-10 leading-relaxed">
                {t("verifyEmail.error")}
              </p>
              <Link
                href="/login"
                className="inline-block w-full bg-[#1C1C1C] text-[#F9F8F6] font-sans text-xs uppercase tracking-[0.2em] px-6 py-4 border border-[#1C1C1C] hover:bg-transparent hover:text-[#1C1C1C] transition-colors duration-300"
              >
                {t("verifyEmail.backToLogin")}
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F9F8F6] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-[#1C1C1C]/40 animate-spin" />
        </div>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}
