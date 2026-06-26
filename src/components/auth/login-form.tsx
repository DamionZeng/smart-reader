"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "@/lib/auth-client";
import { useTranslation } from "react-i18next";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setError(null);

    // Hand off to better-auth's signIn.email — it sets the session
    // cookie on the response automatically.
    const result = await signIn.email({
      email: data.email,
      password: data.password,
      callbackURL: "/dashboard",
    });

    if (result.error) {
      setError(result.error.message || t("auth.signInError"));
      setIsLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
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

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="text-center mb-12">
        <h1 className="font-serif text-4xl md:text-5xl tracking-tight mb-4">
          {t("auth.welcomeBack")}
        </h1>
        <p className="font-sans text-sm text-[#1C1C1C]/60">
          {t("auth.signInToAccount")}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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
            className="w-full border border-[#1C1C1C]/20 text-sm focus:outline-none focus:border-[#1C1C1C] transition-colors placeholder:text-[#1C1C1C]/30 px-4 py-3 bg-transparent"
            placeholder={t("auth.emailPlaceholder")}
            {...register("email")}
          />
          {errors.email && (
            <p className="mt-2 font-sans text-xs text-[#1C1C1C]/60">
              {errors.email.message}
            </p>
          )}
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
            autoComplete="current-password"
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
          <div className="flex justify-end mt-2">
            <Link
              href="/forgot-password"
              className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 hover:text-[#1C1C1C] hover:italic transition-all duration-200"
            >
              {t("auth.forgotPassword")}
            </Link>
          </div>
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
          {isLoading ? t("auth.signingIn") : t("auth.signInCta")}
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
        {t("auth.noAccount")}{" "}
        <Link
          href="/register"
          className="text-[#1C1C1C] underline underline-offset-4 hover:text-[#1C1C1C]/60 transition-colors"
        >
          {t("auth.signUp")}
        </Link>
      </p>
    </div>
  );
}
