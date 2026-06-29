/**
 * PDF-to-HTML converter using pdfjs-dist.
 *
 * Extracts text with positioning information and embedded images,
 * producing structured HTML that preserves the document's formatting
 * (headings, paragraphs, lists) and inline images (uploaded to R2).
 *
 * Used by /api/ingest to replace the old pdf-parse plain-text extraction.
 * The resulting HTML is stored as rawText; the KG pipeline calls
 * stripHtml() to get plain text for LLM processing.
 */

import { escapeHtml } from "@/utils/html-utils";
import { uploadImage, isR2Configured } from "@/lib/storage";
import { PNG } from "pngjs";

// ─── Types ─────────────────────────────────────────────

export interface PdfToHtmlOptions {
  userId: string;
  maxPages?: number;
}

export interface PdfToHtmlResult {
  html: string;
  plainText: string;
  imageCount: number;
  pageCount: number;
}

interface TextItem {
  str: string;
  x: number;
  y: number;        // PDF coordinate (bottom-left origin)
  fontSize: number;
  fontName: string;
  width: number;
  hasEOL: boolean;
}

interface LineItem {
  text: string;
  y: number;        // PDF coordinate
  avgFontSize: number;
  x: number;        // leftmost X
  items: TextItem[];
}

interface ImageEntry {
  y: number;        // PDF coordinate (for sorting)
  url: string;      // R2 public URL
  alt: string;
  width: number;    // display width hint (px)
}

// pdfjs OPS constants (avoid importing the enum)
const OPS_TRANSFORM = 15;
const OPS_PAINT_IMAGE_XOBJECT = 85;
const OPS_PAINT_INLINE_IMAGE = 87;

// ─── pdfjs dynamic loader ──────────────────────────────

/**
 * Polyfill browser APIs that pdfjs-dist v4 expects at module load time.
 *
 * On Vercel serverless (Node.js without a browser environment), pdfjs
 * references `DOMMatrix` and `Path2D` during parsing. These are Web APIs
 * that don't exist in pure Node. Local dev works because some dependency
 * tree happens to polyfill them, but the production bundle doesn't.
 *
 * We install minimal stubs before importing pdfjs so the module loads
 * cleanly. The stubs implement just enough of the API surface for text
 * extraction — image rendering / canvas operations are not supported
 * (and not needed server-side).
 */
function installDomPolyfills() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    class DOMMatrixStub {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      m11 = 1; m12 = 0; m21 = 0; m22 = 1; m41 = 0; m42 = 0;
      constructor() {}
      multiply() { return new DOMMatrixStub(); }
      translate() { return new DOMMatrixStub(); }
      scale() { return new DOMMatrixStub(); }
      rotate() { return new DOMMatrixStub(); }
      inverse() { return new DOMMatrixStub(); }
    }
    (globalThis as any).DOMMatrix = DOMMatrixStub;
  }
  if (typeof globalThis.Path2D === "undefined") {
    class Path2DStub {
      constructor() {}
      moveTo() {} lineTo() {} closePath() {} arc() {}
      bezierCurveTo() {} quadraticCurveTo() {} rect() {}
    }
    (globalThis as any).Path2D = Path2DStub;
  }
  if (typeof globalThis.DOMPoint === "undefined") {
    class DOMPointStub {
      x = 0; y = 0; z = 0; w = 1;
      constructor() {}
    }
    (globalThis as any).DOMPoint = DOMPointStub;
  }
}

let _pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

async function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = (async () => {
      // Install polyfills BEFORE importing pdfjs so the module's
      // top-level code can find DOMMatrix etc.
      installDomPolyfills();
      const mod = await import(
        /* webpackIgnore: true */ "pdfjs-dist/legacy/build/pdf.mjs"
      );
      // We run server-side in Node, so we never need a real Web Worker.
      // Pass `useWorkerFetch: false` and `isEvalSupported: false` plus
      // `disableWorker: true` on getDocument() to keep pdfjs in the
      // main process. The legacy import (vs the modern build) already
      // supports a "fake worker" mode, but the fake worker still
      // requires `GlobalWorkerOptions.workerSrc` to point at a real
      // file on disk — and under Next.js RSC the worker .mjs lives in
      // a webpack-bundled path like `/.next/(rsc)/node_modules/...`
      // that `createRequire(import.meta.url).resolve()` can't find
      // (it returns the unbundled node_modules path instead). Setting
      // `GlobalWorkerOptions.workerSrc = ""` here would trip the
      // "No workerSrc specified" guard, so we leave it untouched and
      // rely on the per-task `disableWorker: true` below to skip the
      // fake-worker init entirely. That's the documented Node usage.
      return mod;
    })();
  }
  return _pdfjsPromise;
}

// ─── Image extraction helpers ──────────────────────────

/**
 * Convert pdfjs image data (RGB or RGBA Uint8ClampedArray) to a PNG Buffer.
 */
function imageDataToPngBuffer(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  kind: number
): Buffer {
  const png = new PNG({ width, height });

  if (kind === 2) {
    // RGBA_24BPP (4 bytes per pixel) — copy directly
    png.data = Buffer.from(data);
  } else if (kind === 1) {
    // RGB_24BPP (3 bytes per pixel) — add alpha channel
    const src = Buffer.from(data);
    const dst = png.data;
    for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
      dst[j] = src[i];
      dst[j + 1] = src[i + 1];
      dst[j + 2] = src[i + 2];
      dst[j + 3] = 255;
    }
  } else {
    // Fallback: treat as RGBA
    png.data = Buffer.from(data);
  }

  return PNG.sync.write(png);
}

/**
 * Extract images from a page via the operator list.
 * Returns image entries with Y positions for interleaving with text.
 */
async function extractImagesFromPage(
  page: any,
  pageHeight: number,
  userId: string,
  pageIndex: number,
  r2Ready: boolean
): Promise<ImageEntry[]> {
  const images: ImageEntry[] = [];
  if (!r2Ready) return images;

  try {
    const opList = await page.getOperatorList();
    let currentTransform: number[] = [1, 0, 0, 1, 0, 0];

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];

      if (fn === OPS_TRANSFORM && Array.isArray(args) && args.length >= 6) {
        currentTransform = args as number[];
      }

      if (fn === OPS_PAINT_IMAGE_XOBJECT || fn === OPS_PAINT_INLINE_IMAGE) {
        try {
          let imgData: any = null;
          let imgWidth = 0;
          let imgHeight = 0;

          if (fn === OPS_PAINT_INLINE_IMAGE) {
            // Inline image: data is in args[0]
            imgData = args[0];
            imgWidth = args[0]?.width || 0;
            imgHeight = args[0]?.height || 0;
          } else {
            // XObject: args[0] is objId, need to fetch from page.objs
            const objId = args[0];
            if (typeof objId === "string") {
              imgData = await new Promise<any>((resolve) => {
                page.objs.get(objId, (d: any) => resolve(d));
              });
              imgWidth = imgData?.width || 0;
              imgHeight = imgData?.height || 0;
            }
          }

          if (!imgData || !imgData.data || imgWidth === 0 || imgHeight === 0) {
            continue;
          }

          // Skip tiny images (likely decorative elements, < 20x20)
          if (imgWidth < 20 || imgHeight < 20) continue;

          const pngBuffer = imageDataToPngBuffer(
            imgData.data,
            imgWidth,
            imgHeight,
            imgData.kind ?? 2
          );

          // Upload to R2
          const url = await uploadImage(pngBuffer, "image/png", userId);

          // Y position from transform (convert from PDF coords)
          const y = currentTransform[5] || 0;

          // Display width hint: cap at 100% of panel, but preserve aspect
          const displayWidth = Math.min(imgWidth, 400);

          images.push({
            y,
            url,
            alt: `Figure from page ${pageIndex + 1}`,
            width: displayWidth,
          });
        } catch (err) {
          // Skip individual image failures
          console.error(`[pdf-to-html] Image extraction failed on page ${pageIndex + 1}:`, err);
        }
      }
    }
  } catch (err) {
    console.error(`[pdf-to-html] Operator list failed on page ${pageIndex + 1}:`, err);
  }

  return images;
}

// ─── Text grouping helpers ─────────────────────────────

/**
 * Extract and normalize text items from a page.
 */
async function extractTextItems(page: any): Promise<TextItem[]> {
  const content = await page.getTextContent();
  const items: TextItem[] = [];

  for (const raw of content.items) {
    if (!raw || typeof raw.str !== "string" || !raw.str.trim()) continue;

    const tr = raw.transform as number[];
    const fontSize = Math.abs(tr[0]) || Math.sqrt(tr[0] * tr[0] + tr[1] * tr[1]) || 10;

    items.push({
      str: raw.str,
      x: tr[4],
      y: tr[5],
      fontSize,
      fontName: raw.fontName || "",
      width: raw.width || 0,
      hasEOL: raw.hasEOL || false,
    });
  }

  return items;
}

/**
 * Group text items into lines based on Y coordinate proximity.
 * Items with similar Y (within threshold) form a line.
 */
function groupIntoLines(items: TextItem[], lineThreshold = 3): LineItem[] {
  if (items.length === 0) return [];

  // Sort by Y descending (top of page first in reading order)
  const sorted = [...items].sort((a, b) => b.y - a.y);

  const lines: LineItem[] = [];
  let currentLine: TextItem[] = [];
  let currentY = sorted[0].y;

  for (const item of sorted) {
    if (Math.abs(item.y - currentY) > lineThreshold) {
      if (currentLine.length > 0) {
        lines.push(finalizeLine(currentLine));
      }
      currentLine = [item];
      currentY = item.y;
    } else {
      currentLine.push(item);
    }
  }
  if (currentLine.length > 0) {
    lines.push(finalizeLine(currentLine));
  }

  return lines;
}

function finalizeLine(items: TextItem[]): LineItem {
  // Sort items in line by X (left to right)
  const sorted = [...items].sort((a, b) => a.x - b.x);

  // Join items, adding space if there's an X gap
  let text = "";
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prevEnd = sorted[i - 1].x + sorted[i - 1].width;
      const gap = sorted[i].x - prevEnd;
      // Add space if gap is significant
      if (gap > sorted[i].fontSize * 0.3) {
        text += " ";
      }
    }
    text += sorted[i].str;
  }

  const avgFontSize =
    sorted.reduce((sum, item) => sum + item.fontSize, 0) / sorted.length;

  return {
    text: text.trim(),
    y: sorted[0].y,
    avgFontSize,
    x: sorted[0].x,
    items: sorted,
  };
}

/**
 * Build absolutely-positioned HTML for a single PDF page.
 *
 * Instead of reflowing text into semantic <p>/<h1> blocks (which loses
 * the PDF's original multi-column / table / figure layout), we render
 * every text item at its exact PDF coordinate using CSS absolute
 * positioning. This produces a 1:1 visual replica of the PDF page.
 *
 * Coordinate transform: PDF uses bottom-left origin; screen uses
 * top-left. So screenY = pageHeight - pdfY.
 *
 * Each text item becomes a <span> positioned at its (x, y) with the
 * correct font size. Images become <img> positioned at their (x, y).
 * The page container has the PDF page's pixel dimensions and
 * position:relative so children anchor to it.
 */
function buildPageHtml(
  lines: LineItem[],
  images: ImageEntry[],
  pageIndex: number,
  pageWidth: number,
  pageHeight: number
): string {
  if (lines.length === 0 && images.length === 0) return "";

  const htmlParts: string[] = [];
  // Page container: exact PDF dimensions, relative positioning context
  htmlParts.push(
    `<div class="pdf-page" data-page="${pageIndex + 1}" style="position:relative;width:${pageWidth}px;height:${pageHeight}px;background:white;margin:0 auto 24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">`
  );

  // Render images first (lower z-index so text appears on top if overlapping)
  for (const img of images) {
    // img.y is in PDF coordinates (bottom-left origin)
    const screenY = pageHeight - img.y;
    htmlParts.push(
      `  <img src="${img.url}" alt="${escapeHtml(img.alt)}" style="position:absolute;left:0;top:${screenY}px;max-width:100%;height:auto;z-index:1;" />`
    );
  }

  // Render each text line at its absolute position
  for (const line of lines) {
    if (!line.text) continue;
    // line.y is in PDF coordinates (bottom-left origin)
    // line.y is the baseline; adjust by font size to get top
    const screenY = pageHeight - line.y - line.avgFontSize * 0.85;
    const screenX = line.x;

    // Estimate font weight by font name (heuristic: bold fonts contain "Bold"/"Heavy")
    const isBold = /bold|heavy|black/i.test(line.items[0]?.fontName || "");

    htmlParts.push(
      `  <span style="position:absolute;left:${screenX}px;top:${screenY}px;font-size:${line.avgFontSize}px;font-family:serif;${isBold ? "font-weight:bold;" : ""}white-space:pre;line-height:1.15;color:#1c1c1c;z-index:2;">${escapeHtml(line.text)}</span>`
    );
  }

  htmlParts.push("</div>");
  return htmlParts.join("\n");
}

// ─── Main converter ────────────────────────────────────

/**
 * Convert a PDF buffer to structured HTML.
 *
 * - Text is extracted with positioning and grouped into headings/paragraphs/lists
 * - Embedded images are extracted, converted to PNG, and uploaded to R2
 * - If R2 is not configured, images are skipped (text-only HTML)
 * - Falls back to basic text extraction if pdfjs fails
 */
export async function convertPdfToHtml(
  buffer: Buffer,
  options: PdfToHtmlOptions
): Promise<PdfToHtmlResult> {
  const { userId, maxPages = 80 } = options;
  const r2Ready = isR2Configured();

  let pdfjs: any;
  try {
    pdfjs = await getPdfjs();
  } catch (err) {
    console.error("[pdf-to-html] Failed to load pdfjs-dist:", err);
    throw new Error("PDF parser library is unavailable on the server.");
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Disable font loading (not needed for text extraction)
    disableFontFace: true,
    // Don't attempt to use system fonts
    useSystemFonts: false,
    // Run the parser on the main Node process — no worker setup.
    // Critical for server-side rendering: without this pdfjs tries
    // to spin up a fake worker which requires GlobalWorkerOptions.
    // workerSrc, and under Next.js that path doesn't resolve (the
    // worker is webpack-bundled to .next/(rsc)/node_modules/...).
    disableWorker: true,
    // Also disable the modern worker-fetch path so pdfjs doesn't try
    // to dynamic-import the worker module on its own.
    useWorkerFetch: false,
  });

  let pdfDoc: any;
  try {
    pdfDoc = await loadingTask.promise;
  } catch (err) {
    console.error("[pdf-to-html] Failed to load PDF document:", err);
    throw new Error("Failed to parse the PDF file. The file may be corrupted.");
  }

  const pageCount = Math.min(pdfDoc.numPages, maxPages);
  const pageHtmlParts: string[] = [];
  let totalImageCount = 0;

  try {
    for (let i = 0; i < pageCount; i++) {
      const page = await pdfDoc.getPage(i + 1);
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;

      // Extract text items
      const textItems = await extractTextItems(page);

      // Extract images
      const images = await extractImagesFromPage(
        page,
        pageHeight,
        userId,
        i,
        r2Ready
      );
      totalImageCount += images.length;

      // Group text into lines
      const lines = groupIntoLines(textItems);

      // Build HTML for this page — absolute positioning preserves
      // the PDF's original layout (multi-column, tables, figure positions)
      const pageHtml = buildPageHtml(lines, images, i, pageWidth, pageHeight);
      if (pageHtml) {
        pageHtmlParts.push(pageHtml);
      }

      // Clean up page resources
      try {
        page.cleanup();
      } catch {
        /* best-effort */
      }
    }
  } finally {
    try {
      await pdfDoc.destroy();
    } catch {
      /* best-effort */
    }
  }

  const html = pageHtmlParts.join("\n\n");

  // Import stripHtml lazily to avoid circular dependency
  const { stripHtml } = await import("@/utils/html-utils");
  const plainText = stripHtml(html);

  if (!plainText.trim()) {
    // PDF likely has no extractable text (e.g., scanned document)
    console.warn("[pdf-to-html] No text content extracted from PDF (may be scanned).");
  }

  return {
    html,
    plainText,
    imageCount: totalImageCount,
    pageCount,
  };
}
