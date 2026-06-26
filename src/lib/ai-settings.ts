import { db } from "@/lib/db";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  detectBrowserLanguage,
  DEFAULT_LANGUAGE,
  type SupportedLanguage,
} from "@/lib/i18n-config";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  zh: "Chinese (Simplified)",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
};

/**
 * Fetch the user's preferred AI output language from the database.
 *
 * Order of precedence:
 *  1. Explicit `userSettings.aiOutputLanguage` row in the DB (the user
 *     actively chose a language, or onboarding already wrote one).
 *  2. Browser `Accept-Language` header (when supplied) — so a brand-new
 *     account that has never opened the settings page still gets
 *     responses in the browser language instead of being silently
 *     pinned to English.
 *  3. DEFAULT_LANGUAGE ("en") as the last-resort fallback.
 */
export async function getAIOutputLanguage(
  userId: string,
  acceptLanguage?: string | null
): Promise<string> {
  try {
    const [row] = await db
      .select({ aiOutputLanguage: userSettings.aiOutputLanguage })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    if (row?.aiOutputLanguage) return row.aiOutputLanguage;
  } catch {
    // Table may not exist yet (pending migration) — fall through.
  }
  if (acceptLanguage) {
    return detectBrowserLanguage(acceptLanguage);
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Build a language instruction string to append to AI system prompts.
 * Returns an empty string if the language is English (default).
 */
export function getLanguageInstruction(language: string): string {
  if (!language || language === "en") return "";
  const langName = LANGUAGE_NAMES[language] || language;
  return `\n\nIMPORTANT: You must write ALL your output (including node titles, descriptions, explanations, analogies, reviews, and any other text) in ${langName}. Do not use English unless you are quoting source material verbatim.`;
}

/**
 * Instruction for paper ingestion: output language follows the source text.
 * The LLM detects the dominant language of the paper and writes all output
 * (concept labels, descriptions, cluster names, enrichment) in that same
 * language. This is used instead of the user-preference-based instruction
 * for paper parsing so that a Chinese paper yields Chinese concepts, an
 * English paper yields English concepts, etc.
 */
export const SOURCE_LANGUAGE_INSTRUCTION = `\n\nIMPORTANT: You must write ALL your output (including concept labels, descriptions, cluster names, and any other text) in the SAME language as the source text provided. If the source text is in Chinese, write everything in Chinese. If in English, write in English. If in Japanese, write in Japanese. Always match the dominant language of the source text. You may use the original language verbatim when quoting evidence.`;

/**
 * Combined helper: fetch user's AI output language and return the
 * instruction string. Accepts the raw `Accept-Language` header so the
 * fallback chain can honour a brand-new user's browser language
 * without requiring them to open the settings page first.
 */
export async function getLanguageInstructionForUser(
  userId: string,
  acceptLanguage?: string | null
): Promise<string> {
  const lang = await getAIOutputLanguage(userId, acceptLanguage);
  return getLanguageInstruction(lang);
}
