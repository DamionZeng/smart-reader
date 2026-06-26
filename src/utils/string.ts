/**
 * Returns the first non-empty trimmed string from the given candidates.
 * Returns empty string if none match.
 */
export function pickFirstString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return "";
}
