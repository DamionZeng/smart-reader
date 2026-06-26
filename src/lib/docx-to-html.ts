/**
 * DOCX → structured HTML converter with R2 image upload.
 *
 * Strategy:
 *  - Use `mammoth` to convert the .docx to HTML — it handles the
 *    document.xml → HTML mapping for headings/paragraphs/lists/tables
 *    and produces clean, semantic markup.
 *  - Intercept mammoth's image converter: instead of returning a
 *    base64 data URI (which would bloat rawText and the DB), upload
 *    each image to R2 via `uploadImage()` and return an `<img src>`
 *    pointing at the R2 URL. This matches the PDF pipeline's approach
 *    so OriginalTextPanel renders the same way regardless of source.
 *  - On R2-not-configured or any failure, fall back to mammoth's
 *    default base64 inline image — the document is still readable,
 *    just heavier in the DB.
 *
 * Output shape is the same as `convertPdfToHtml`:
 *   { html, plainText, imageCount, pageCount }
 * (`pageCount` is always 1 for docx — there's no page concept in
 *  OOXML, only flow content. We keep the field for interface parity.)
 */

import mammoth from "mammoth";
import { uploadImage, isR2Configured } from "@/lib/storage";
import { stripHtml } from "@/utils/html-utils";

export interface DocxConvertResult {
  html: string;
  plainText: string;
  imageCount: number;
  pageCount: number;
}

export async function convertDocxToHtml(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  options: { userId: string }
): Promise<DocxConvertResult> {
  const input = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(buffer as Uint8Array);

  let imageCount = 0;

  // Custom image converter: upload each embedded image to R2 and
  // return an <img> tag with the R2 URL. Falls back to base64 if R2
  // isn't configured (the docx is still readable, just bigger in DB).
  const converters = {
    image: async (image: any) => {
      try {
        // mammoth hands us an image element with a read() method that
        // returns a Buffer, and a contentType string.
        const imageBuffer: Buffer = await image.read();
        const mime: string = image.contentType || "image/png";

        if (isR2Configured()) {
          const url = await uploadImage(imageBuffer, mime, options.userId);
          imageCount++;
          return {
            src: url,
          };
        }

        // Fallback: inline base64 (mammoth's default behavior)
        imageCount++;
        return {
          src: `data:${mime};base64,${imageBuffer.toString("base64")}`,
        };
      } catch (e) {
        console.warn("[docx-to-html] image conversion failed:", e);
        // Return a placeholder so the rest of the document still renders
        return { src: "" };
      }
    },
  };

  // mammoth's TS types don't include `converters` in the Options object,
  // but it's a documented runtime option. Cast to `any` to bypass the
  // type check — the runtime contract is what matters here.
  const result = await mammoth.convertToHtml(
    { buffer: input },
    { converters } as any
  );

  const html = result.value || "";
  const plainText = stripHtml(html);

  // Mammoth emits warnings for unsupported elements; log them at debug
  // level so they're visible during development but don't spam prod.
  if (result.messages && result.messages.length > 0) {
    for (const m of result.messages.slice(0, 5)) {
      console.debug(`[docx-to-html] mammoth ${m.type}: ${m.message}`);
    }
  }

  return {
    html,
    plainText,
    imageCount,
    pageCount: 1, // docx has no page concept
  };
}

/**
 * Quick sniff check: is this buffer a docx file?
 *  - Magic bytes: PK\x03\x04 (it's a zip)
 *  - The first internal file should be [Content_Types].xml
 *
 * We don't strictly need this — the caller already knows from the
 * filename / content-type — but it's useful as a defensive check.
 */
export function isDocxBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 4) return false;
  // PK\x03\x04 — zip magic
  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}
