"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "@/lib/auth-client";
import { useTranslation } from "react-i18next";
import { Check, Loader2 } from "lucide-react";

// We no longer collect a username on sign-up — the only handle a user
// has is their email. (The `user.username` column still exists in the
// database so historical rows are not orphaned, but it is no longer
// surfaced in the UI or login flow.)
const registerSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters."),
    email: z.string().email("Please enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(8, "Password must be at least 8 characters."),
    // The 6-digit code the user reads from their inbox.
    code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code we sent."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

type CodeStatus = "idle" | "verifying" | "valid" | "invalid";
type SendStatus = "idle" | "sending" | "cooldown" | "sent" | "error";

const RESEND_COOLDOWN_SEC = 60;

export function RegisterForm() {
  const router = useRouter();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // --- email-send state ---
  // `sendStatus` is the OUTBOUND state (sending, cooldown, etc).
  // `codeStatus` is the INBOUND state (typed, valid, etc).
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [codeStatus, setCodeStatus] = useState<CodeStatus>("idle");
  const [codeHint, setCodeHint] = useState<string | null>(null);

  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [codeDigits, setCodeDigits] = useState(["", "", "", "", "", ""]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    mode: "onTouched",
  });

  // We need to react to email field changes so we can reset the code
  // block if the user changes the email after sending.
  const watchedEmail = watch("email");

  // Tick the cooldown timer down.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // If the user edits the email after sending, invalidate the code
  // block — the 6-digit code is tied to the email it was sent to.
  useEffect(() => {
    if (sendStatus === "sent" || codeStatus === "valid") {
      setSendStatus("idle");
      setCodeStatus("idle");
      setCodeHint(null);
      setCodeDigits(["", "", "", "", "", ""]);
      setValue("code", "", { shouldValidate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedEmail]);

  // --- send-code handler ---
  async function handleSendCode() {
    setSendError(null);
    if (!watchedEmail || !watchedEmail.includes("@")) {
      setSendError(t("auth.emailInvalidFirst"));
      return;
    }
    setSendStatus("sending");
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: watchedEmail.trim().toLowerCase() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429 && data.retryAfter) {
          setCooldown(data.retryAfter);
          setSendStatus("cooldown");
          return;
        }
        setSendError(data.error || t("auth.sendCodeError"));
        setSendStatus("error");
        return;
      }
      setCooldown(data.cooldownSeconds || RESEND_COOLDOWN_SEC);
      setSendStatus("sent");
      setCodeStatus("idle");
      setCodeHint(t("auth.codeSentHint"));
      // Focus the first code box so the user can type immediately.
      setTimeout(() => codeRefs.current[0]?.focus(), 50);
    } catch (e) {
      setSendError(t("auth.networkError"));
      setSendStatus("error");
    }
  }

  // --- 6-digit code input handlers ---
  function handleCodeChange(idx: number, value: string) {
    const v = value.replace(/\D/g, "").slice(0, 1);
    setCodeDigits((prev) => {
      const next = [...prev];
      next[idx] = v;
      return next;
    });
    if (v && idx < 5) {
      codeRefs.current[idx + 1]?.focus();
    }
    // Clear the validation state while the user is editing.
    if (codeStatus === "valid" || codeStatus === "invalid") {
      setCodeStatus("idle");
      setCodeHint(null);
    }
  }

  function handleCodeKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !codeDigits[idx] && idx > 0) {
      codeRefs.current[idx - 1]?.focus();
    }
  }

  function handleCodePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      setCodeDigits(text.split(""));
      setValue("code", text, { shouldValidate: true });
      // Auto-validate on paste.
      runCodeCheck(text);
    }
  }

  // When all 6 boxes are filled, ask the server "is this a valid
  // code for this email?". We don't burn the code on this dry-run —
  // register-and-verify is the one that consumes it.
  useEffect(() => {
    const joined = codeDigits.join("");
    if (joined.length === 6) {
      setValue("code", joined, { shouldValidate: true });
      runCodeCheck(joined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeDigits]);

  async function runCodeCheck(code: string) {
    if (!watchedEmail) return;
    setCodeStatus("verifying");
    try {
      const res = await fetch("/api/auth/check-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: watchedEmail.trim().toLowerCase(),
          code,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.valid) {
        setCodeStatus("valid");
        setCodeHint(t("auth.codeValidHint"));
      } else if (data.reason === "EXPIRED") {
        setCodeStatus("invalid");
        setCodeHint(t("auth.codeExpired"));
      } else if (data.reason === "INVALID") {
        setCodeStatus("invalid");
        setCodeHint(t("auth.codeIncorrect"));
      } else {
        setCodeStatus("invalid");
        setCodeHint(t("auth.codeGenericError"));
      }
    } catch {
      setCodeStatus("invalid");
      setCodeHint(t("auth.networkError"));
    }
  }

  // --- submit ---
  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    setError(null);

    // The front-end already did a dry-run check via check-code, but we
    // never trust the client — register-and-verify re-validates the
    // code on the server before creating the user.
    try {
      const res = await fetch("/api/auth/register-and-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email.trim().toLowerCase(),
          password: data.password,
          name: data.name,
          code: data.code,
        }),
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(payload.error || t("auth.createAccountError"));
        setIsLoading(false);
        return;
      }

      // If the server sign-in step failed, fall back to the login page
      // with a banner; the account was still created.
      if (payload.warning) {
        router.push(payload.redirectTo || "/login");
        return;
      }

      router.push(payload.redirectTo || "/dashboard");
      router.refresh();
    } catch (err: any) {
      console.error("Register error:", err);
      setError(err?.message || t("auth.createAccountError"));
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn.social({
        provider: "google",
        callbackURL: "/dashboard",
      });
    } catch (err) {
      console.error("Social sign-in error:", err);
      setError(t("auth.googleSignInError"));
      setIsLoading(false);
    }
  };

  const codeCompleted = codeStatus === "valid";
  const sendLabel =
    sendStatus === "sending"
      ? t("auth.sending")
      : sendStatus === "sent" || sendStatus === "cooldown"
      ? cooldown > 0
        ? t("auth.resendIn", { seconds: cooldown })
        : t("auth.resendCode")
      : t("auth.sendCode");

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="text-center mb-12">
        <h1 className="font-serif text-4xl md:text-5xl tracking-tight mb-4">
          {t("auth.createAccount")}
        </h1>
        <p className="font-sans text-sm text-[#1C1C1C]/60">
          {t("auth.createAccountSubtitle")}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div>
          <label
            htmlFor="name"
            className="block font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 mb-2"
          >
            {t("auth.name")}
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            disabled={isLoading}
            className="w-full border border-[#1C1C1C]/20 text-sm focus:outline-none focus:border-[#1C1C1C] transition-colors placeholder:text-[#1C1C1C]/30 px-4 py-3 bg-transparent"
            placeholder={t("auth.namePlaceholder")}
            {...register("name")}
          />
          {errors.name && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C]/60">
              {errors.name.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="email"
            className="block font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 mb-2"
          >
            {t("auth.email")}
          </label>
          <div className="flex gap-2">
            <input
              id="email"
              type="email"
              autoComplete="email"
              disabled={isLoading}
              className="flex-1 border border-[#1C1C1C]/20 text-sm focus:outline-none focus:border-[#1C1C1C] transition-colors placeholder:text-[#1C1C1C]/30 px-4 py-3 bg-transparent"
              placeholder={t("auth.emailPlaceholder")}
              {...register("email")}
            />
            <button
              type="button"
              onClick={handleSendCode}
              disabled={
                isLoading ||
                sendStatus === "sending" ||
                (cooldown > 0 && sendStatus !== "idle")
              }
              className="shrink-0 border border-[#1C1C1C] text-[#1C1C1C] font-sans text-[10px] uppercase tracking-[0.2em] px-4 py-3 hover:bg-[#1C1C1C] hover:text-[#F9F8F6] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {sendStatus === "sending" ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t("auth.sending")}
                </span>
              ) : (
                sendLabel
              )}
            </button>
          </div>
          {errors.email && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C]/60">
              {errors.email.message}
            </p>
          )}
          {sendError && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C]/60">
              {sendError}
            </p>
          )}
        </div>

        {/* Code field — only meaningful once a code has been sent, but
            we still render the 6 boxes (disabled) so the layout is
            stable. The hint line above the boxes shows progress. */}
        <div>
          <label className="block font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 mb-2">
            {t("auth.verificationCode")}
          </label>
          <div className="flex items-center gap-2">
            {codeDigits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  codeRefs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                disabled={isLoading || sendStatus === "idle" || sendStatus === "sending"}
                value={digit}
                onChange={(e) => handleCodeChange(i, e.target.value)}
                onKeyDown={(e) => handleCodeKeyDown(i, e)}
                onPaste={handleCodePaste}
                className={`w-full h-12 text-center font-mono text-lg border bg-transparent transition-colors ${
                  codeStatus === "valid"
                    ? "border-[#1C1C1C] bg-[#1C1C1C]/5"
                    : codeStatus === "invalid"
                    ? "border-[#1C1C1C]/60"
                    : "border-[#1C1C1C]/20 focus:border-[#1C1C1C] focus:outline-none"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              />
            ))}
          </div>
          {codeStatus === "verifying" && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C]/60 inline-flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t("auth.verifying")}
            </p>
          )}
          {codeStatus === "valid" && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C] inline-flex items-center gap-2">
              <Check className="w-3 h-3" />
              {codeHint}
            </p>
          )}
          {(codeStatus === "invalid" || codeStatus === "idle") && codeHint && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C]/60">{codeHint}</p>
          )}
          {errors.code && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C]/60">
              {errors.code.message}
            </p>
          )}
          <input type="hidden" {...register("code")} />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 mb-2"
          >
            {t("auth.password")}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            disabled={isLoading}
            className="w-full border border-[#1C1C1C]/20 text-sm focus:outline-none focus:border-[#1C1C1C] transition-colors placeholder:text-[#1C1C1C]/30 px-4 py-3 bg-transparent"
            placeholder="••••••••"
            {...register("password")}
          />
          {errors.password && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C]/60">
              {errors.password.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 mb-2"
          >
            {t("auth.confirmPassword")}
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            disabled={isLoading}
            className="w-full border border-[#1C1C1C]/20 text-sm focus:outline-none focus:border-[#1C1C1C] transition-colors placeholder:text-[#1C1C1C]/30 px-4 py-3 bg-transparent"
            placeholder="••••••••"
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C]/60">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        {error && (
          <p className="font-sans text-xs text-[#1C1C1C]/80 bg-[#1C1C1C]/5 p-3 border border-[#1C1C1C]/10">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isLoading || !codeCompleted}
          className="w-full bg-[#1C1C1C] text-[#F9F8F6] font-sans text-xs uppercase tracking-[0.2em] px-6 py-4 border border-[#1C1C1C] hover:bg-transparent hover:text-[#1C1C1C] transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? t("auth.signingUp") : t("auth.createAccountCta")}
        </button>
      </form>

      <div className="relative my-10">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-[#1C1C1C]/10" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[#F9F8F6] px-4 font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
            {t("auth.or")}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-3 border border-[#1C1C1C]/20 text-[#1C1C1C] font-sans text-xs uppercase tracking-[0.2em] px-6 py-4 hover:border-[#1C1C1C] transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="currentColor"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="currentColor"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="currentColor"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        {t("auth.continueWithGoogle")}
      </button>

      <p className="mt-10 text-center font-sans text-xs text-[#1C1C1C]/60">
        {t("auth.haveAccount")}{" "}
        <Link
          href="/login"
          className="text-[#1C1C1C] underline underline-offset-4 hover:text-[#1C1C1C]/60 transition-colors"
        >
          {t("auth.signInLink")}
        </Link>
      </p>
    </div>
  );
}
