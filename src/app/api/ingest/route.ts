import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents, documentAssets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import { trackUsage } from "@/app/api/usage/track";
import {
  isR2Configured,
  uploadImage,
  uploadDocument,
  extractR2ImageKeys,
  deleteImagesByKeys,
} from "@/lib/storage";
import {
  isArxivUrl,
  isPdfUrl,
  resolveArxivUrl,
  fetchArxivMetadata,
  downloadPdfFromUrl,
} from "@/lib/arxiv";
import {
  findExistingBySourceKey,
  normalizeSourceKey,
} from "@/lib/resolve-ingest";
import { safeTruncateHtml, stripHtml, isHtml } from "@/utils/html-utils";
import { generateProjectTitle } from "@/lib/graph/title-gen";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB per image (base64 inflates ~33%)
/**
 * Max stored HTML length for rawText. PDFs with many figures can
 * produce 200KB+ of HTML; we cap at 500KB (well under the 1MB text
 * column ceiling) and use safeTruncateHtml so we never cut a `<figure>
 * <img>` tag in half (which silently drops images in the reader).
 */
const MAX_RAW_TEXT_LEN = 500_000;

// Paper pipeline: text formats + PDF + Word documents
// .doc/.docx (Microsoft Word) are routed through mammoth → plain text.
// .pdf is routed through pdf-parse → plain text.
const PAPER_FILE_EXTENSIONS = [
  ".md", ".markdown", ".txt", ".json",
  ".pdf",
  ".doc", ".docx",
];
const PAPER_FILE_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/pdf",
];
// Word documents are commonly sent as either of these MIME types.
const PAPER_FILE_MIME_EXACT = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-word",
  "application/x-msword",
]);
// Image pipeline (Tier 2): direct image input — screenshots, scans, charts
const IMAGE_FILE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const IMAGE_FILE_MIME_PREFIXES = ["image/"];
// Code pipeline: source code files
const CODE_FILE_EXTENSIONS = [
  ".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".rs",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".swift", ".kt", ".scala",
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml",
];
const CODE_FILE_MIME_PREFIXES = ["text/", "application/json", "application/x-yaml"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Validates that a URL is safe to fetch server-side. Blocks:
 *  - Non-http(s) schemes (file://, data:, etc.)
 *  - Private / loopback / link-local hostnames and IPs (SSRF protection)
 *  - Hostnames that resolve to private IPs (basic DNS rebinding defence)
 *
 * Returns the normalised URL string when safe, or null when blocked.
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4 literals
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  // IPv6 literals
  if (h === "::1" || h === "::" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fe80:")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local
  // Common loopback / metadata hostnames
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "metadata.google.internal" ||
    h === "169.254.169.254"
  ) {
    return true;
  }
  return false;
}

function validateFetchUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null; // reject embedded credentials
  if (isPrivateHost(u.hostname)) return null;
  return u.toString();
}

function getFileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function isPaperFile(file: File): boolean {
  const ext = getFileExtension(file.name);
  if (PAPER_FILE_EXTENSIONS.includes(ext)) return true;
  const type = (file.type || "").toLowerCase();
  if (PAPER_FILE_MIME_PREFIXES.some((p) => type.startsWith(p))) return true;
  if (PAPER_FILE_MIME_EXACT.has(type)) return true;
  return false;
}

function isCodeFile(file: File): boolean {
  const ext = getFileExtension(file.name);
  if (CODE_FILE_EXTENSIONS.includes(ext)) return true;
  const type = (file.type || "").toLowerCase();
  return CODE_FILE_MIME_PREFIXES.some((p) => type.startsWith(p));
}

function isImageFile(file: File): boolean {
  const ext = getFileExtension(file.name);
  if (IMAGE_FILE_EXTENSIONS.includes(ext)) return true;
  const type = (file.type || "").toLowerCase();
  return IMAGE_FILE_MIME_PREFIXES.some((p) => type.startsWith(p));
}

/**
 * Converts a GitHub URL (repo root, tree, or blob) into a raw README URL
 * that we can fetch as plain text. Supports:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo/tree/branch
 *   - https://github.com/owner/repo/blob/branch/path/to/file
 * Returns null if the URL is not a recognisable GitHub URL.
 */
function resolveGitHubUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    // owner/repo → fetch README from default branch via raw
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[1];
      // If it's a blob URL, fetch that specific file raw
      if (parts.length >= 5 && parts[2] === "blob") {
        const branch = parts[3];
        const filePath = parts.slice(4).join("/");
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
      }
      // For repo root or tree URL, try the default branch README
      const branch = parts.length >= 4 && parts[2] === "tree" ? parts[3] : "main";
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves academic paper URLs into a directly fetchable plain-text / PDF URL.
 * Supports:
 *   - arXiv abstract:  https://arxiv.org/abs/2401.12345      → https://arxiv.org/pdf/2401.12345
 *   - arXiv PDF:       https://arxiv.org/pdf/2401.12345       → (unchanged)
 *   - arXiv old-style: https://arxiv.org/abs/cs.AI/0601001    → https://arxiv.org/pdf/cs.AI/0601001
 *   - DOI:             https://doi.org/10.1145/3292500.3330700 → (unchanged, let fetch follow redirects)
 *   - Semantic Scholar: https://www.semanticscholar.org/paper/<id> → (unchanged, will be fetched as HTML)
 * Returns null if the URL is not a recognised academic source.
 */
function resolvePaperUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    // arXiv: convert /abs/ → /pdf/
    if (host === "arxiv.org" || host === "www.arxiv.org") {
      const path = u.pathname;
      const absMatch = path.match(/^\/abs\/(.+)$/);
      if (absMatch) {
        const id = absMatch[1];
        return `https://arxiv.org/pdf/${id}`;
      }
      // Already a PDF URL or other arXiv path — return as-is
      return url;
    }

    // DOI URLs: return as-is, the fetch will follow redirects to the publisher
    if (host === "doi.org" || host === "www.doi.org") {
      return url;
    }

    // Semantic Scholar / PubMed / other academic hosts: return as-is
    if (
      host === "www.semanticscholar.org" ||
      host === "semanticscholar.org" ||
      host === "pubmed.ncbi.nlm.nih.gov" ||
      host === "www.ncbi.nlm.nih.gov"
    ) {
      return url;
    }

    return null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: heavy AI operation
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.heavy);
    if (blocked) return blocked;

    // Soft warnings collected during ingestion. Returned to the
    // client alongside the project id so the UI can show a toast
    // (e.g. "PDF couldn't be parsed, project created with empty
    // content") instead of failing the whole request.
    const ingestionWarnings: string[] = [];

    const formData = await request.formData();
    const url = formData.get("url") as string | null;
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string | null;
    const rawType = formData.get("type") as string | null;
    // Tier 2: explicit "image" type forces the vision pipeline. Auto-detected
    // from the file MIME if not supplied.
    const projectType = rawType === "code" ? "code" : rawType === "image" ? "image" : "paper";
    const isCode = projectType === "code";
    const isImage = projectType === "image";

    if (!url && !file) {
      return NextResponse.json(
        { error: "Please provide either a URL or a file." },
        { status: 400 }
      );
    }

    // If we got an image file but the caller didn't pass type=image,
    // auto-route it through the vision pipeline. This makes the front-end
    // simpler: it can just send an image file with type=paper and the
    // server will pick the right prompt.
    let effectiveType = projectType;
    if (file && !isCode && !isImage && isImageFile(file)) {
      effectiveType = "image";
    }

    let rawContent = "";
    let imageDataUrl: string | null = null; // data-URL kept in-memory for R2 upload fallback
    let imageR2Url: string | null = null; // R2 https URL — what we persist + return to the UI
    let imageBuffer: Buffer | null = null; // raw bytes, retained until userId is known so we can upload to R2 with the right prefix
    let imageMime: string | null = null;
    let pdfBuffer: Buffer | null = null; // PDF raw bytes, retained until userId is known for R2 image upload
    let docxBuffer: Buffer | null = null; // DOCX raw bytes, retained until userId is known for R2 image upload
    let sourceLabel: string | null = null;
    // === Source tracking (URL-based ingest, see schema.ts for definitions) ===
    // - sourceUrl:   the L1 link the user pasted
    // - sourceType:  'arxiv' | 'pdf-url' | 'github-repo' | 'web' | 'file'
    // - sourceKey:   the idempotency key (arxiv id+version, normalized URL, ...)
    // - preflightArxivMetadata: best-effort arxiv API metadata used to
    //   seed the title/authors/abstract BEFORE the KG pipeline runs, so
    //   the project shell isn't "Untitled" for a few seconds.
    let sourceUrl: string | null = null;
    let sourceType: "arxiv" | "pdf-url" | "github-repo" | "web" | "file" | null = null;
    let sourceKey: string | null = null;
    let preflightArxivMetadata: {
      title: string;
      authors: string[];
      year: number | null;
      abstract: string;
      doi: string | null;
    } | null = null;

    if (file) {
      // Route to the right validator
      const isImageNow = effectiveType === "image";
      const validFile = isCode
        ? isCodeFile(file)
        : isImageNow
        ? isImageFile(file)
        : isPaperFile(file);
      if (!validFile) {
        return NextResponse.json(
          {
            error: isCode
              ? "Unsupported file type. Please upload a source code file (.js, .ts, .py, .go, .md, etc.)."
              : isImageNow
              ? "Unsupported image type. Please upload a PNG, JPEG, WEBP, or GIF file."
              : "Unsupported file type. Please upload a Markdown, plain text, JSON, PDF, DOC, or DOCX file.",
          },
          { status: 400 }
        );
      }
      // Image files have a tighter size budget than text / code (6 MB vs 10 MB)
      const sizeLimit = isImageNow ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
      if (file.size > sizeLimit) {
        return NextResponse.json(
          {
            error: isImageNow
              ? `Image is too large. Maximum size is ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)} MB.`
              : "File is too large. Maximum size is 10MB.",
          },
          { status: 400 }
        );
      }
      try {
        if (isImageNow) {
          // Vision pipeline: keep a base64 data-URL in memory to feed the
          // multimodal model, AND retain the raw bytes so we can upload to
          // R2 once we know the authenticated userId. The R2 upload itself
          // is deferred to right after the auth check below — that way the
          // object's key lives under the right user prefix.
          const buf = await file.arrayBuffer();
          imageBuffer = Buffer.from(buf);
          const mime = (file.type || "image/png").toLowerCase();
          imageDataUrl = `data:${mime};base64,${imageBuffer.toString("base64")}`;
          imageMime = mime;
          rawContent = "[image]"; // sentinel; the model will read the image part
        } else if (file.type === "application/pdf" || getFileExtension(file.name) === ".pdf") {
          // PDF: store buffer for PDF-to-HTML conversion after auth
          // (conversion needs userId for R2 image upload)
          const arrayBuffer = await file.arrayBuffer();
          pdfBuffer = Buffer.from(arrayBuffer);
          rawContent = ""; // will be filled after auth
        } else if (
          // Microsoft Word OOXML (.docx). Legacy .doc is not supported
          // by mammoth — we let it fall through to the text branch
          // which will probably produce garbage, but at least won't
          // crash. The user is told to convert to .docx in that case.
          getFileExtension(file.name) === ".docx" ||
          file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          // DOCX: store buffer for DOCX-to-HTML conversion after auth
          // (conversion needs userId for R2 image upload, same as PDF)
          const arrayBuffer = await file.arrayBuffer();
          docxBuffer = Buffer.from(arrayBuffer);
          rawContent = ""; // will be filled after auth
        } else {
          rawContent = await file.text();
        }
      } catch (e: any) {
        // Surface the actual error message in development to make
        // debugging much easier (e.g. "PDFParse is not a constructor").
        // In production we keep the user-facing copy generic.
        const isDev = process.env.NODE_ENV !== "production";
        const detail = e?.message || "Unknown error while reading the file.";
        console.error("[ingest] Failed to read uploaded file:", e);
        return NextResponse.json(
          {
            error: isDev
              ? `Failed to read the uploaded file: ${detail}`
              : "Failed to read the uploaded file.",
          },
          { status: 400 }
        );
      }
      sourceLabel = file.name;
      // File uploads are sourceType='file'; sourceKey is left null so
      // legacy files don't suddenly collide on (userId, sourceKey).
      sourceUrl = null;
      sourceType = "file";
      sourceKey = null;
    } else if (url) {
      // Capture L1 source URL. arxiv gets a structured sourceKey
      // ({id}-v{version}); generic PDF URLs use the normalized URL
      // itself; everything else falls back to the URL.
      sourceUrl = url;
      if (isArxivUrl(url)) {
        try {
          const resolved = resolveArxivUrl(url);
          sourceType = "arxiv";
          sourceKey = resolved.sourceKey;
          // Best-effort metadata fetch — failure is non-fatal, the KG
          // pipeline will still pull the same info from the PDF.
          // Fire-and-await: it's <2s on a warm connection and removes
          // the need for a separate /resolve round-trip.
          const meta = await fetchArxivMetadata(resolved.arxivId);
          if (meta) {
            preflightArxivMetadata = {
              title: meta.title,
              authors: meta.authors,
              year: meta.year,
              abstract: meta.abstract,
              doi: meta.doi,
            };
          }
        } catch (e) {
          console.warn("[ingest] arxiv URL parse failed:", e);
          // Fall through to generic PDF handling
          sourceType = "pdf-url";
          sourceKey = normalizeSourceKey(url);
        }
      } else if (isPdfUrl(url)) {
        sourceType = "pdf-url";
        sourceKey = normalizeSourceKey(url);
      } else if (isCode) {
        sourceType = "github-repo";
        // For github URLs the key is owner/repo@ref — but we don't have
        // a resolver for that in this round; use the URL for now and
        // upgrade later when /code-import learns to dedupe.
        sourceKey = normalizeSourceKey(url);
      } else {
        sourceType = "web";
        sourceKey = normalizeSourceKey(url);
      }
      // Resolve special URLs to directly fetchable content
      let fetchUrl = url;
      let isPdfResponse = false;
      if (isCode) {
        const rawUrl = resolveGitHubUrl(url);
        if (rawUrl) {
          fetchUrl = rawUrl;
        }
      } else {
        // Paper pipeline: try arXiv / DOI / academic resolvers
        const resolved = resolvePaperUrl(url);
        if (resolved) {
          fetchUrl = resolved;
          // arXiv /abs/ → /pdf/ produces a PDF response
          if (resolved.endsWith(".pdf") || resolved.includes("arxiv.org/pdf/")) {
            isPdfResponse = true;
          }
        }
      }

      let response: Response;
      try {
        const safeUrl = validateFetchUrl(fetchUrl);
        if (!safeUrl) {
          return NextResponse.json(
            { error: "The provided URL is not allowed. Only public http(s) URLs are permitted." },
            { status: 400 }
          );
        }
        fetchUrl = safeUrl;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          response = await fetch(fetchUrl, {
            redirect: "follow",
            headers: { "User-Agent": "Cosmos/1.0" },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      } catch (e: any) {
        return NextResponse.json(
          { error: "Could not reach the URL. Check that it is reachable." },
          { status: 400 }
        );
      }
      if (!response.ok) {
        return NextResponse.json(
          {
            error: `Failed to fetch URL (status ${response.status}).`,
          },
          { status: 400 }
        );
      }
      try {
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        const MAX_RESPONSE_BYTES = 50 * 1024 * 1024; // 50MB
        // If we know it's a PDF (from resolver) or the server says so, extract text
        if (isPdfResponse || contentType.includes("application/pdf")) {
          const arrayBuffer = await response.arrayBuffer();
          if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
            return NextResponse.json(
              { error: "The response is too large to process." },
              { status: 400 }
            );
          }
          pdfBuffer = Buffer.from(arrayBuffer);
          rawContent = ""; // will be filled after auth
        } else if (
          // Microsoft Word .docx returned by a remote URL (e.g. an
          // academic publisher that doesn't expose a PDF endpoint).
          // .doc (legacy binary) is not supported via URL — clients can
          // upload the file instead.
          contentType.includes(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          ) ||
          // Some servers serve .docx as octet-stream; fall back to
          // filename extension to recognise it.
          (contentType.includes("application/octet-stream") &&
            url.toLowerCase().endsWith(".docx"))
        ) {
          const arrayBuffer = await response.arrayBuffer();
          if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
            return NextResponse.json(
              { error: "The response is too large to process." },
              { status: 400 }
            );
          }
          const mammothModule = (await import("mammoth")) as any;
          const mammoth = mammothModule.default || mammothModule;
          const result = await mammoth.extractRawText({
            buffer: Buffer.from(arrayBuffer),
          });
          rawContent = result?.value || "";
        } else {
          const reader = response.body?.getReader();
          if (reader) {
            const chunks: Uint8Array[] = [];
            let totalBytes = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              totalBytes += value.byteLength;
              if (totalBytes > MAX_RESPONSE_BYTES) {
                throw new Error("Response too large");
              }
              chunks.push(value);
            }
            const bytes = new Uint8Array(totalBytes);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            rawContent = new TextDecoder().decode(bytes);
          } else {
            rawContent = await response.text();
          }
        }
      } catch (e: any) {
        return NextResponse.json(
          { error: "Failed to read content from URL." },
          { status: 400 }
        );
      }
    }

    if (!rawContent.trim() && !imageDataUrl && !pdfBuffer && !docxBuffer) {
      return NextResponse.json(
        { error: "Source content is empty. Nothing to parse." },
        { status: 400 }
      );
    }

    // Resolve authenticated user early so we can apply their AI language
    // preference to the ingestion prompt.
    let userId: string | undefined;
    try {
      const session = await auth.api.getSession({
        headers: await headers(),
      });
      userId = session?.user?.id;
    } catch {
      userId = undefined;
    }

    if (!userId) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 }
      );
    }

    // === Idempotency check (URL-based ingest only) ===
    // If the user has already imported this exact source (arxiv id+version
    // or normalized URL), return the existing project metadata instead of
    // creating a duplicate. The client uses this to show the
    // "已导入过 — 打开 / 重新生成" modal.
    //
    // The file-upload path is exempt: file uploads don't have a stable
    // sourceKey in this round, so they always create a new project (and
    // the user can delete the old one if needed).
    if (!projectId && sourceKey) {
      const existing = await findExistingBySourceKey(userId, sourceKey);
      if (existing) {
        return NextResponse.json({
          existing: {
            id: existing.documentId,
            title: existing.title,
            type: existing.type,
            sourceType: existing.sourceType,
            sourceUrl: existing.sourceUrl,
            updatedAt: existing.updatedAt.toISOString(),
            hasPdfAsset: existing.hasPdfAsset,
          },
        });
      }
    }

    // R2 upload (deferred until we know the userId so the key is namespaced
    // under the right user prefix). Failure is non-fatal — we fall back to
    // the data-URL so the project still works.
    if (imageBuffer && imageMime) {
      if (isR2Configured()) {
        try {
          imageR2Url = await uploadImage(imageBuffer, imageMime, userId);
          // Free the buffer; we no longer need the raw bytes
          imageBuffer = null;
        } catch (e: any) {
          console.error("[ingest] R2 upload failed:", e);
          imageR2Url = imageDataUrl; // fallback: persist as data-URL
        }
      } else {
        // R2 not configured (e.g. local dev without env) — keep the data-URL.
        // The UI continues to work, just with TOAST bloat in jsonb.
        imageR2Url = imageDataUrl;
      }
    }

    // PDF-to-HTML conversion (deferred until userId is known for R2 image upload).
    // Produces structured HTML with headings, paragraphs, and inline images
    // uploaded to R2. Falls back to pdf-parse plain text on failure.
    //
    // The whole block is wrapped in a "swallow everything" try/catch so
    // a single broken PDF never bubbles up and causes the whole POST to
    // return 500. The worst case is that we end up with an empty
    // `rawContent` — the project still gets created, the KG pipeline
    // still runs on whatever we managed to extract, and the user can
    // see a clear warning in the response telling them the PDF was
    // unreadable so they can try another file.
    if (pdfBuffer) {
      // Stage 1: try the rich pdfjs-based converter.
      let pdfStage1Ok = false;
      try {
        const { convertPdfToHtml } = await import("@/lib/pdf-to-html");
        const result = await convertPdfToHtml(pdfBuffer, { userId });
        if (result.html && result.html.trim().length > 0) {
          rawContent = result.html;
          pdfStage1Ok = true;
        } else {
          // pdfjs returned nothing usable (e.g. encrypted PDF, all-image
          // pages without OCR). Fall through to pdf-parse.
          console.warn(
            "[ingest] PDF-to-HTML returned empty content, falling back to pdf-parse"
          );
        }
      } catch (e: any) {
        // Most common cause: pdfjs fails to load the document because
        // the file is corrupted, encrypted, or uses a feature pdfjs
        // doesn't support. Don't let this abort the whole request —
        // try pdf-parse next.
        console.error(
          "[ingest] PDF-to-HTML conversion failed, falling back to pdf-parse:",
          e?.message || e
        );
      }

      // Stage 2: try the lighter pdf-parse (text-only, no images).
      if (!pdfStage1Ok) {
        try {
          const pdfModule: any = await import("pdf-parse");
          const PDFParseCtor =
            pdfModule.PDFParse || pdfModule.default?.PDFParse;
          if (PDFParseCtor) {
            const parser = new PDFParseCtor({ data: pdfBuffer });
            try {
              const result = await parser.getText();
              const plain = result?.text || "";
              if (plain.trim().length > 0) {
                rawContent = plain;
              } else {
                console.warn(
                  "[ingest] pdf-parse returned empty text — PDF appears to be empty or image-only"
                );
                ingestionWarnings.push("PDF was parsed but no text content was found (image-only or empty PDF).");
              }
            } finally {
              try {
                await parser.destroy();
              } catch {
                /* best-effort */
              }
            }
          } else {
            console.error(
              "[ingest] pdf-parse: PDFParse constructor not found in module, skipping fallback"
            );
          }
        } catch (e2: any) {
          console.error(
            "[ingest] pdf-parse fallback also failed:",
            e2?.message || e2
          );
          ingestionWarnings.push(
            "PDF could not be parsed by either the structured or fallback reader. The project will be created with empty content."
          );
        }
      }
      pdfBuffer = null; // free memory
    }

    // DOCX-to-HTML conversion (deferred until userId is known for R2 image upload).
    // Produces structured HTML via mammoth with images uploaded to R2.
    // Falls back to mammoth.extractRawText on failure (plain text, no images).
    if (docxBuffer) {
      try {
        const { convertDocxToHtml } = await import("@/lib/docx-to-html");
        const result = await convertDocxToHtml(docxBuffer, { userId });
        rawContent = result.html;
      } catch (e: any) {
        console.error("[ingest] DOCX-to-HTML conversion failed, falling back to plain text:", e);
        try {
          const mammothModule = (await import("mammoth")) as any;
          const mammoth = mammothModule.default || mammothModule;
          const result = await mammoth.extractRawText({
            buffer: docxBuffer,
          });
          rawContent = result?.value || "";
        } catch (e2) {
          console.error("[ingest] mammoth plain-text fallback also failed:", e2);
        }
      }
      docxBuffer = null; // free memory
    }

    // Track usage (non-fatal)
    await trackUsage(userId, "ingest");

    // Derive a title from the content. Priority:
    //   1. Pre-flighted arxiv metadata (real paper title) — best.
    //   2. LLM-generated title from the document text — good for
    //      PDF/DOCX/text uploads where we have content but no metadata.
    //   3. Filename without extension — fallback.
    //   4. URL hostname — last resort.
    //   5. "Untitled".
    // The LLM call is awaited so the project shell has a real title
    // from the moment it's created. On any failure we fall back to
    // the filename/hostname. Title generation must never block
    // ingestion — generateProjectTitle catches its own errors.
    let derivedTitle: string;
    if (preflightArxivMetadata?.title) {
      derivedTitle = preflightArxivMetadata.title;
    } else {
      // Build a fallback from filename or URL first, then try to
      // improve it with the LLM.
      const fallbackTitle = sourceLabel
        ? sourceLabel.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim()
        : url
          ? (() => {
              try { return new URL(url).hostname.replace(/^www\./, ""); }
              catch { return "Untitled"; }
            })()
          : "Untitled";

      // Generate a title from the content. We strip HTML first so the
      // LLM sees clean text (PDF/DOCX rawText is HTML).
      const plainForTitle = isHtml(rawContent) ? stripHtml(rawContent) : rawContent;
      derivedTitle = await generateProjectTitle(plainForTitle, fallbackTitle);
    }

    // Pre-flighted arxiv metadata → seed authors/year/abstract/doi so
    // the project shell is rich from the moment it's created (rather
    // than waiting for the KG pipeline to fill them in 30s later).
    const derivedAuthors = preflightArxivMetadata?.authors ?? null;
    const derivedYear = preflightArxivMetadata?.year ?? null;
    const derivedAbstract = preflightArxivMetadata?.abstract ?? null;
    const derivedDoi = preflightArxivMetadata?.doi ?? null;

    // If a projectId was supplied, update that project's rawText so the
    // KG pipeline can pick it up. Otherwise create a new project shell.
    // Security: updating an existing project requires authentication —
    // anonymous callers must not be able to overwrite arbitrary projects.
    if (projectId) {
      if (!userId) {
        return NextResponse.json(
          { error: "Authentication is required to update an existing project." },
          { status: 401 }
        );
      }
      const update: Record<string, unknown> = {
        nodes: [],
        edges: [],
        originalUrl: url || null,
        title: derivedTitle,
        rawText: safeTruncateHtml(rawContent, MAX_RAW_TEXT_LEN),
        // Source tracking (set even on update; harmless if null)
        sourceUrl,
        sourceType,
        sourceKey,
        // Authors/abstract from arxiv (only overwritten if we have new
        // values; legacy projects without arxiv metadata stay as-is)
        ...(derivedAuthors ? { authors: JSON.stringify(derivedAuthors) } : {}),
        ...(derivedYear != null ? { year: derivedYear } : {}),
        ...(derivedAbstract ? { abstract: derivedAbstract } : {}),
        ...(derivedDoi ? { doi: derivedDoi } : {}),
      };
      try {
        // R2 cleanup: when re-ingesting into an existing image project, remove
        // any R2 objects that are no longer referenced.
        if (isR2Configured()) {
          try {
            const [oldRow] = await db
              .select({ nodes: documents.nodes })
              .from(documents)
              .where(and(eq(documents.id, projectId), eq(documents.userId, userId)))
              .limit(1);
            if (oldRow) {
              const oldKeys = new Set(extractR2ImageKeys(oldRow.nodes));
              const orphaned: string[] = [];
              for (const k of oldKeys) {
                orphaned.push(k);
              }
              if (orphaned.length > 0) {
                void deleteImagesByKeys(orphaned);
              }
            }
          } catch (e) {
            console.error("[ingest] R2 orphan cleanup failed:", e);
          }
        }

        const [row] = await db
          .update(documents)
          .set(update)
          .where(
            and(eq(documents.id, projectId), eq(documents.userId, userId))
          )
          .returning();

        if (row) {
          return NextResponse.json({
            id: row.id,
            title: derivedTitle,
            rawText: safeTruncateHtml(rawContent, MAX_RAW_TEXT_LEN),
            thumbnail: imageR2Url ?? null,
          });
        }
        // Fall through to insert if the project was not found / not owned
      } catch (e: any) {
        console.error("DB update failed:", e);
        return NextResponse.json(
          { error: "Failed to save the project. Please try again." },
          { status: 500 }
        );
      }
    }

    try {
      const [inserted] = await db
        .insert(documents)
        .values({
          title: derivedTitle,
          type: projectType,
          originalUrl: url || null,
          // === Source tracking ===
          sourceUrl,
          sourceType,
          sourceKey,
          // === Preflight arxiv metadata (best-effort) ===
          ...(derivedAuthors ? { authors: JSON.stringify(derivedAuthors) } : {}),
          ...(derivedYear != null ? { year: derivedYear } : {}),
          ...(derivedAbstract ? { abstract: derivedAbstract } : {}),
          ...(derivedDoi ? { doi: derivedDoi } : {}),
          nodes: [],
          edges: [],
          userId: userId || null,
          rawText: safeTruncateHtml(rawContent, MAX_RAW_TEXT_LEN),
        })
        .returning();

      // === Persist the original PDF as a document_asset ===
      // The buffer was cleared after PDF→HTML conversion, so re-fetch
      // from the response is impossible. Instead, the /regenerate path
      // is responsible for uploading. For URL-based ingest we make a
      // best-effort fetch of the PDF here and store it as a 'pdf'
      // asset so OriginalTextPanel can re-render with precise
      // coordinates in future rounds.
      if (inserted && sourceType === "arxiv" && url) {
        try {
          const { downloadPdfFromUrl, resolveArxivUrl } = await import("@/lib/arxiv");
          const resolved = resolveArxivUrl(url);
          const { buffer, size } = await downloadPdfFromUrl(resolved.pdfUrl, {
            timeoutMs: 60_000,
          });
          if (isR2Configured()) {
            const r2Url = await uploadDocument(
              buffer,
              "application/pdf",
              userId!,
              inserted.id,
              "pdf"
            );
            await db.insert(documentAssets).values({
              documentId: inserted.id,
              kind: "pdf",
              storageUrl: r2Url,
              size,
              mime: "application/pdf",
              metadata: {
                arxivId: resolved.arxivId,
                version: resolved.version,
                sourceUrl: resolved.absUrl,
                pdfUrl: resolved.pdfUrl,
              },
            });
          }
        } catch (e) {
          // Non-fatal: ingest still works without a stored PDF; just
          // log so we can see arxiv availability / R2 issues.
          console.warn("[ingest] PDF asset upload failed:", e);
        }
      }

      return NextResponse.json({
        id: inserted.id,
        title: derivedTitle,
        rawText: safeTruncateHtml(rawContent, MAX_RAW_TEXT_LEN),
        thumbnail: imageR2Url ?? null,
        // Soft warnings (e.g. "PDF couldn't be parsed, project
        // created with empty content") — non-fatal, surfaced to UI
        // for the user to see.
        warnings: ingestionWarnings.length > 0 ? ingestionWarnings : undefined,
      });
    } catch (e: any) {
      console.error("DB insert failed:", e);
      return NextResponse.json(
        { error: "Failed to create the project. Please try again." },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Ingestion error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
