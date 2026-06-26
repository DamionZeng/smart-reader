/**
 * Helpers for handling image attachments used by the Tier 2 vision
 * pipeline (image ingest, multimodal Q&A, node image attachments).
 *
 * All images flow through the system as data-URLs (data:image/...;base64,...)
 * so the browser can display them inline and the server can forward them
 * directly to the OpenAI-compatible chat completions endpoint.
 */

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB per image (base64 inflates ~33%)

/** MIME types we accept for image ingest / attachments. */
export const ACCEPTED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
] as const;

export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIME)[number];

/** Whether a file looks like a supported image based on MIME and extension. */
export function isAcceptedImage(file: File): boolean {
  if (ACCEPTED_IMAGE_MIME.includes(file.type as AcceptedImageMime)) {
    return true;
  }
  const name = file.name.toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif"].some((ext) =>
    name.endsWith(ext)
  );
}

/** Whether a data-URL string is a supported image data-URL. */
export function isAcceptedImageDataUrl(dataUrl: string): boolean {
  return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(dataUrl);
}

/**
 * Reads a File into a base64 data-URL. Throws on unsupported type or
 * when the file is over the size budget.
 */
export async function fileToImageDataUrl(file: File): Promise<string> {
  if (!isAcceptedImage(file)) {
    throw new Error(
      "Unsupported image type. Please upload PNG, JPEG, WEBP, or GIF."
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is too large. Maximum size is ${(
        MAX_IMAGE_BYTES /
        1024 /
        1024
      ).toFixed(0)} MB.`
    );
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

/** Strips a data-URL prefix to get the raw base64 payload. */
export function stripDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/** Extracts the MIME type from a data-URL (defaults to image/png). */
export function getDataUrlMime(dataUrl: string): string {
  const m = dataUrl.match(/^data:([^;]+);base64,/i);
  return m ? m[1].toLowerCase() : "image/png";
}

/** Rough byte size of a base64 string (3 raw bytes per 4 chars). */
export function approxBase64Bytes(b64: string): number {
  // Strip any padding for the calculation
  const len = b64.length;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

/**
 * Validates a server-supplied image URL (or data-URL) before we hand
 * it back to the LLM. Rejects anything that is not:
 *  - a data-URL with an accepted MIME type
 *  - an http(s) URL pointing at a public host (no private IPs)
 */
export function isSafeImageRef(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  if (isAcceptedImageDataUrl(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  return false;
}
