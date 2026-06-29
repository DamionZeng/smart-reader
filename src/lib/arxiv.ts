/**
 * arxiv URL resolution + PDF download.
 *
 * What this module does:
 *   1. Detect whether a user-supplied URL is an arxiv URL (abs / pdf /
 *      older numeric-style / with optional version suffix).
 *   2. Normalize it to a stable `sourceKey` for idempotency.
 *   3. Fetch metadata (title, authors, year, abstract) from the arxiv
 *      Atom API — this is the public, keyless endpoint documented at
 *      https://info.arxiv.org/help/api/basics.html.
 *   4. Download the PDF as a Buffer for downstream conversion.
 *
 * It also recognises generic PDF URLs (https://example.com/foo.pdf) via
 * `isPdfUrl()` and the generic fetcher `downloadPdfFromUrl()`. The
 * distinction is only in the metadata side: arxiv has structured
 * metadata, generic PDF URLs do not.
 */

const ARXIV_HOST_RE = /^(?:www\.)?arxiv\.org$/i;

export interface ArxivResolution {
  arxivId: string; // '1706.03762'
  version: number; // 7 (1 if no version suffix)
  absUrl: string; // https://arxiv.org/abs/1706.03762v7
  pdfUrl: string; // https://arxiv.org/pdf/1706.03762v7
  /** Stable idempotency key: "1706.03762-v7" */
  sourceKey: string;
}

export interface ArxivMetadata {
  arxivId: string;
  version: number;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string;
  doi: string | null;
}

/**
 * Returns true if `url` is an arxiv URL we know how to handle.
 *  - arxiv.org/abs/<id>[vN]
 *  - arxiv.org/pdf/<id>[vN]
 *  - arxiv.org/pdf/<id>[vN].pdf
 *  - arxiv.org/abs/ftp/<...>  (legacy)
 */
export function isArxivUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!ARXIV_HOST_RE.test(u.hostname)) return false;
    return /^\/(abs|pdf)\//.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Heuristic for "the URL is a direct PDF file somewhere on the web".
 * Used as a catch-all: if a user pastes a PDF URL that isn't from
 * arxiv, we still want to be able to download it.
 *
 * Detection:
 *  - pathname ends with .pdf
 *  - OR has Content-Type: application/pdf on HEAD (not checked here;
 *    done by the caller in `downloadPdfFromUrl` to verify the response)
 */
export function isPdfUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return /\.pdf(\?|$|#)/i.test(u.pathname + u.search);
  } catch {
    return false;
  }
}

/**
 * Parse an arxiv URL into a stable resolution object. Throws on URLs
 * that are not arxiv (caller should branch on `isArxivUrl` first).
 *
 * Examples of accepted forms:
 *   https://arxiv.org/abs/1706.03762
 *   https://arxiv.org/abs/1706.03762v7
 *   https://arxiv.org/pdf/1706.03762
 *   https://arxiv.org/pdf/1706.03762v7.pdf
 *   https://arxiv.org/pdf/1706.03762.pdf
 */
export function resolveArxivUrl(url: string): ArxivResolution {
  const u = new URL(url);
  if (!ARXIV_HOST_RE.test(u.hostname)) {
    throw new Error(`Not an arxiv URL: ${url}`);
  }
  // pathname is like "/abs/1706.03762v7" or "/pdf/1706.03762v7.pdf"
  const m = u.pathname.match(/^\/(?:abs|pdf)\/([^./?#]+?)(?:\.pdf)?$/i);
  if (!m) {
    throw new Error(`Cannot parse arxiv id from URL: ${url}`);
  }
  const raw = m[1];
  // "1706.03762v7" or "1706.03762"
  const verMatch = raw.match(/^(.+?)(?:v(\d+))?$/);
  if (!verMatch) {
    throw new Error(`Cannot split arxiv id/version: ${raw}`);
  }
  const arxivId = verMatch[1];
  const version = verMatch[2] ? Number(verMatch[2]) : 1;
  if (!/^\d{4}\.\d{4,5}$/.test(arxivId) && !/^[a-z\-]+\/\d{7}$/i.test(arxivId)) {
    // Modern id ("1706.03762") or old-style ("cs.LG/0601001")
    throw new Error(`Unrecognized arxiv id format: ${arxivId}`);
  }
  return {
    arxivId,
    version,
    absUrl: `https://arxiv.org/abs/${arxivId}v${version}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}v${version}`,
    sourceKey: `${arxivId}-v${version}`,
  };
}

/**
 * Fetch metadata for an arxiv paper via the public Atom API.
 * Returns null on failure (caller should fall back to PDF-only parsing).
 */
export async function fetchArxivMetadata(
  arxivId: string
): Promise<ArxivMetadata | null> {
  const query = encodeURIComponent(arxivId);
  const apiUrl = `http://export.arxiv.org/api/query?id_list=${query}`;
  try {
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": "cosmos/1.0" },
      // 10s cap — arxiv API is fast but rate-limited
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[arxiv] metadata fetch ${res.status} for ${arxivId}`);
      return null;
    }
    const xml = await res.text();
    return parseArxivAtom(xml, arxivId);
  } catch (e) {
    console.warn(`[arxiv] metadata fetch failed for ${arxivId}:`, e);
    return null;
  }
}

/**
 * Minimal Atom parser for the arxiv API. We only extract a few fields;
 * intentionally avoid an XML dependency to keep the bundle small.
 */
function parseArxivAtom(xml: string, fallbackId: string): ArxivMetadata | null {
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/i);
  if (!entryMatch) return null;
  const entry = entryMatch[1];

  const title = cleanText(extractTag(entry, "title"));
  const summary = cleanText(extractTag(entry, "summary"));
  const published = extractTag(entry, "published");
  const yearMatch = published?.match(/^(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  // arxiv id appears in <id>url</id>; we want the bit after the last /
  const idUrl = extractTag(entry, "id") || "";
  const idMatch = idUrl.match(/abs\/(.+?)(?:v\d+)?$/);
  const arxivId = idMatch ? idMatch[1] : fallbackId;

  // Authors: zero or more <author><name>X</name></author>
  const authors: string[] = [];
  const authorRe = /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi;
  let m: RegExpExecArray | null;
  while ((m = authorRe.exec(entry)) !== null) {
    const name = cleanText(m[1]);
    if (name) authors.push(name);
  }

  // DOI is in <arxiv:doi> or <link href="http://dx.doi.org/..."/>
  let doi: string | null = extractTag(entry, "arxiv:doi") || null;
  if (!doi) {
    const doiLink = entry.match(/href="https?:\/\/(?:dx\.)?doi\.org\/(10\.[^"]+)"/i);
    if (doiLink) doi = doiLink[1];
  }

  return {
    arxivId,
    version: 1, // Atom response doesn't always include version; main use is title/authors
    title,
    authors,
    year,
    abstract: summary,
    doi,
  };
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1] : null;
}

function cleanText(s: string | null): string {
  if (!s) return "";
  return s
    .replace(/<[^>]+>/g, "") // strip nested tags
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Download a PDF from any URL as a Buffer. Validates that the response
 * is actually application/pdf before returning.
 *
 * Throws on:
 *  - non-2xx HTTP status
 *  - wrong Content-Type (e.g. an HTML error page that happened to 200)
 *  - timeout (default 60s, configurable)
 */
export async function downloadPdfFromUrl(
  url: string,
  options: { timeoutMs?: number } = {}
): Promise<{ buffer: Buffer; size: number }> {
  const timeout = options.timeoutMs ?? 60_000;
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
    headers: {
      // arxiv + most academic CDNs return PDF for this UA
      "User-Agent": "cosmos/1.0 (mailto:dev@cosmos.local)",
      Accept: "application/pdf,*/*;q=0.5",
    },
  });
  if (!res.ok) {
    throw new Error(`PDF download HTTP ${res.status} for ${url}`);
  }
  const contentType = res.headers.get("content-type") || "";
  // Be lenient: some servers send application/octet-stream for PDFs.
  if (
    !/application\/pdf/i.test(contentType) &&
    !/application\/octet-stream/i.test(contentType)
  ) {
    throw new Error(
      `Expected PDF but got "${contentType}" for ${url}`
    );
  }
  const ab = await res.arrayBuffer();
  const buffer = Buffer.from(ab);
  // PDF magic bytes: %PDF-
  if (buffer.length < 5 || buffer.slice(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`Downloaded file is not a valid PDF (missing %PDF- magic): ${url}`);
  }
  return { buffer, size: buffer.length };
}
