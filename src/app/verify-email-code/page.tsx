"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Check, X, Loader2 } from "lucide-react";
import "@/i18n";

type Status = "sending" | "awaiting" | "verifying" | "success" | "error";

const RESEND_COOLDOWN_SEC = 60;

function VerifyEmailCodeForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";

  const [status, setStatus] = useState<Status>("sending");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Auto-trigger the first code send on mount when the user lands here.
  // If they navigated here from /register, the form already sent one;
  // either way, this guarantees an email is in flight before the
  // user starts typing.
  useEffect(() => {
    if (!email) {
      setStatus("error");
      setError("Missing email address. Please go back to sign up.");
      return;
    }
    requestCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  // Cooldown timer for the "send again" button.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function requestCode() {
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 429 = "please wait" — still let the user see the code entry UI
        if (res.status === 429 && data.retryAfter) {
          setCooldown(data.retryAfter);
          setStatus("awaiting");
          return;
        }
        setError(data.error || "Failed to send verification code.");
        setStatus("error");
        return;
      }
      setCooldown(data.cooldownSeconds || RESEND_COOLDOWN_SEC);
      setStatus("awaiting");
    } catch (e) {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  function handleCodeChange(idx: number, value: string) {
    // Only allow digits, single character per box.
    const v = value.replace(/\D/g, "").slice(0, 1);
    setCode((prev) => {
      const next = [...prev];
      next[idx] = v;
      return next;
    });
    if (v && idx < 5) {
      inputRefs.current[idx + 1]?.focus();
    }
    // Auto-submit when the last box is filled.
    if (idx === 5 && v) {
      const next = [...code];
      next[5] = v;
      const joined = next.join("");
      if (joined.length === 6) {
        // Defer to next tick so the state update lands first.
        setTimeout(() => submitCode(joined), 50);
      }
    }
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !code[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      setCode(text.split(""));
      submitCode(text);
    }
  }

  async function submitCode(joined: string) {
    setStatus("verifying");
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: joined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Verification failed.");
        setStatus("awaiting");
        // Clear the boxes so the user can retype.
        setCode(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        return;
      }
      setStatus("success");
      // Bounce to /login where the user enters their password once and
      // lands in the dashboard. We don't auto-sign-in here because
      // their password is not in scope of this page.
      setTimeout(() => {
        router.push("/login?verified=1");
      }, 1200);
    } catch (e) {
      setError("Network error. Please try again.");
      setStatus("awaiting");
    }
  }

  return (
    <div className="w-full max-w-md mx-auto text-center">
      <h1 className="font-serif text-3xl md:text-4xl tracking-tight mb-4">
        {t("verifyCode.title")}
      </h1>
      <p className="font-sans text-sm text-[#1C1C1C]/60 mb-2 leading-relaxed">
        {t("verifyCode.subtitle")}
      </p>
      <p className="font-mono text-xs text-[#1C1C1C]/80 mb-10 break-all">
        {email}
      </p>

      {status === "sending" && (
        <div className="flex items-center justify-center mb-8">
          <Loader2 className="w-6 h-6 text-[#1C1C1C]/40 animate-spin" />
        </div>
      )}

      {(status === "awaiting" || status === "verifying") && (
        <>
          <div className="flex items-center justify-center gap-2 mb-8">
            {code.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                disabled={status === "verifying"}
                value={digit}
                onChange={(e) => handleCodeChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={handlePaste}
                className="w-12 h-14 text-center font-mono text-2xl border border-[#1C1C1C]/30 focus:border-[#1C1C1C] focus:outline-none bg-transparent"
              />
            ))}
          </div>
          {status === "verifying" && (
            <div className="flex items-center justify-center mb-4">
              <Loader2 className="w-4 h-4 text-[#1C1C1C]/40 animate-spin" />
            </div>
          )}
          {error && (
            <p className="font-sans text-xs text-[#1C1C1C]/80 bg-[#1C1C1C]/5 p-3 border border-[#1C1C1C]/10 mb-6">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={requestCode}
            disabled={cooldown > 0}
            className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] hover:italic transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {cooldown > 0
              ? t("verifyCode.resendIn", { seconds: cooldown })
              : t("verifyCode.resend")}
          </button>
        </>
      )}

      {status === "success" && (
        <>
          <div className="flex items-center justify-center mb-8">
            <div className="w-12 h-12 border border-[#1C1C1C] flex items-center justify-center">
              <Check className="w-6 h-6 text-[#1C1C1C]" />
            </div>
          </div>
          <p className="font-sans text-sm text-[#1C1C1C]/60 mb-10 leading-relaxed">
            {t("verifyCode.success")}
          </p>
        </>
      )}

      {status === "error" && (
        <>
          <div className="flex items-center justify-center mb-8">
            <div className="w-12 h-12 border border-[#1C1C1C]/40 flex items-center justify-center">
              <X className="w-6 h-6 text-[#1C1C1C]/60" />
            </div>
          </div>
          <p className="font-sans text-sm text-[#1C1C1C]/60 mb-10 leading-relaxed">
            {error || t("verifyCode.error")}
          </p>
          <Link
            href="/register"
            className="inline-block w-full bg-[#1C1C1C] text-[#F9F8F6] font-sans text-xs uppercase tracking-[0.2em] px-6 py-4 border border-[#1C1C1C] hover:bg-transparent hover:text-[#1C1C1C] transition-colors duration-300"
          >
            {t("verifyCode.backToRegister")}
          </Link>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailCodePage() {
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
        <Suspense
          fallback={
            <div className="flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-[#1C1C1C]/40 animate-spin" />
            </div>
          }
        >
          <VerifyEmailCodeForm />
        </Suspense>
      </main>
    </div>
  );
}
