/**
 * Supported UI/AI languages.
 *
 * Single source of truth — both the client (settings page, language
 * gate) and the server (settings API, AI prompt builder) import from
 * here. Adding a new language is a two-line change: push the code
 * into this tuple and add the label in en.json / zh.json under
 * `settings.languages.<code>`.
 */
export const SUPPORTED_LANGUAGES = [
  "en",
  "zh",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "ru",
  "ar",
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Default fallback when nothing else tells us what to use. */
export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

/**
 * Resolve a browser navigator.language string to one of our supported
 * languages. Examples:
 *   detectBrowserLanguage("zh-CN")      // "zh"
 *   detectBrowserLanguage("en-GB")      // "en"
 *   detectBrowserLanguage("ja-JP")      // "ja"
 *   detectBrowserLanguage("xx-YY")      // "en"  (unsupported)
 *   detectBrowserLanguage(undefined)    // "en"  (server / no browser)
 *   detectBrowserLanguage("")           // "en"
 *
 * We only look at the primary subtag. Region tags are not honoured
 * here — the user can switch to a regional variant manually from the
 * settings page if we ever need it.
 */
export function detectBrowserLanguage(
  raw?: string | null
): SupportedLanguage {
  if (!raw) return DEFAULT_LANGUAGE;
  const primary = raw.toLowerCase().split(/[-_]/)[0];
  if (
    (SUPPORTED_LANGUAGES as readonly string[]).includes(primary)
  ) {
    return primary as SupportedLanguage;
  }
  return DEFAULT_LANGUAGE;
}

/** Type guard for incoming values from forms / API bodies. */
export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}
