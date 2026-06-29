import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/email";

const appUrl = process.env.APP_URL || "http://localhost:3000";
const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL || appUrl;
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: appUrl,
  // better-auth 1.6+ 不再把 baseURL 自动加入 trustedOrigins，
  // 缺少此项会导致 /api/auth/* 的 CORS 预检失败，
  // 浏览器在预检阶段直接抛 "Failed to fetch"。
  // 接收函数形式并始终放行任意请求的 origin（不做域名限制）。
  trustedOrigins: async (request) => {
    if (request) {
      try {
        const origin = new URL(request.url).origin;
        return [origin];
      } catch {
        return [appUrl, publicAppUrl];
      }
    }
    return [appUrl, publicAppUrl];
  },
  emailAndPassword: {
    enabled: true,
    // We do not auto-sign-in after sign-up: the user still has to enter
    // the 6-digit code we sent to their inbox. This is the whole point
    // of the new code-based verification flow.
    autoSignInAfterRegistration: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // We handle email verification ourselves (see /api/auth/send-code
    // and /api/auth/verify-code). better-auth's built-in flow uses
    // magic links, which we don't want.
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ email: user.email, url });
    },
  },
  socialProviders: {
    google: {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectURI: `${appUrl}/api/auth/callback/google`,
    },
  },
  rateLimit: {
    enabled: true,
    storage: "memory",
    rules: {
      signIn: { max: 5, window: 60 },
      signUp: { max: 3, window: 60 },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
