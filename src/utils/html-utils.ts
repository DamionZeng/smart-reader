/**
 * HTML utility functions for the PDF-to-HTML pipeline.
 *
 * After switching rawText storage from plain text to structured HTML,
 * the KG pipeline (concept extraction, sentence splitting, entity
 * resolution, enrichment) and QA endpoints still need plain text.
 * These utilities provide safe HTML stripping and escaping.
 */

/**
 * Strip all HTML tags and return plain text.
 * - Converts <br> and </p> to newlines for readability
 * - Decodes common HTML entities
 * - Collapses excessive whitespace
 */
export function stripHtml(html: string): string {
  if (!html) return "";

  return html
    // Convert block-level closing tags to newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    // Convert <br> to newlines
    .replace(/<br\s*\/?>/gi, "\n")
    // Convert <td>/<th> to tab-separated
    .replace(/<\/?(td|th)>/gi, "\t")
    // Remove all remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    // Collapse 3+ newlines to 2
    .replace(/\n{3,}/g, "\n\n")
    // Trim each line
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * Escape HTML special characters for safe inline rendering.
 * Used when inserting PDF-extracted text into HTML structure.
 */
export function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Check if a string looks like HTML (contains tags).
 * Used to determine whether to strip before LLM processing.
 */
export function isHtml(text: string): boolean {
  if (!text) return false;
  return /<[a-z][\s\S]*?>/i.test(text);
}

/**
 * Truncate an HTML string to a maximum byte length WITHOUT leaving
 * open tags. Naive `substring(0, N)` cuts in the middle of `<figure>
 * <img src="...">` and the browser drops the broken element — this is
 * the root cause of missing images in OriginalTextPanel.
 *
 * Strategy:
 *  1. If the string is under the limit, return as-is.
 *  2. Otherwise, walk the string tracking open/close tags. Cut at the
 *     first position <= limit that is NOT inside a tag.
 *  3. Collect still-open tags and append their closing tags in reverse
 *     order so the result is well-formed HTML.
 *
 * The limit is on UTF-16 code unit length (String.length), which is
 * what the DB column size check uses anyway.
 */
export function safeTruncateHtml(html: string, maxLen: number): string {
  if (!html || html.length <= maxLen) return html || "";

  // Walk the string, tracking open tags. We only close void elements
  // list to skip them when emitting closers.
  const voidTags = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
  ]);

  const openStack: string[] = [];
  let i = 0;
  let cutPos = -1;

  while (i < html.length && i < maxLen) {
    const ch = html[i];

    if (ch === "<") {
      // Find the closing '>'
      const end = html.indexOf(">", i);
      if (end === -1) {
        // Malformed — cut here
        cutPos = i;
        break;
      }
      // Check if this is a closing tag </name>
      const tagContent = html.slice(i + 1, end);
      const isClosing = tagContent.startsWith("/");
      const tagNameMatch = tagContent.match(/^\/?\s*([a-zA-Z][a-zA-Z0-9]*)/);
      const tagName = tagNameMatch ? tagNameMatch[1].toLowerCase() : "";

      if (isClosing) {
        // Pop from stack until we find the matching tag
        const idx = openStack.lastIndexOf(tagName);
        if (idx !== -1) {
          openStack.splice(idx);
        }
      } else if (!voidTags.has(tagName) && !tagContent.endsWith("/")) {
        // Opening tag (non-void, non-self-closing)
        openStack.push(tagName);
      }

      // If this tag ends exactly at maxLen, cut after it
      if (end + 1 <= maxLen) {
        i = end + 1;
        cutPos = i;
      } else {
        // Tag straddles the limit — cut before this tag to keep it whole
        cutPos = i;
        break;
      }
    } else {
      i++;
      if (i <= maxLen) cutPos = i;
    }
  }

  if (cutPos === -1) cutPos = maxLen;

  let result = html.slice(0, cutPos);

  // Append closers for any still-open tags, in reverse order
  for (let j = openStack.length - 1; j >= 0; j--) {
    result += `</${openStack[j]}>`;
  }

  return result;
}

