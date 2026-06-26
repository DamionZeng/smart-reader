import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { conceptGraphs, conceptGraphJobs } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { eq, and } from "drizzle-orm";
import { enforceRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";
import { trackUsage } from "@/app/api/usage/track";
import { getLanguageInstructionForUser, SOURCE_LANGUAGE_INSTRUCTION } from "@/lib/ai-settings";
import { ingestPaper } from "@/lib/graph/ingest-paper";
import { ingestCode } from "@/lib/graph/ingest-code";
import type { JobProgress } from "@/types/concept-graph";

/**
 * Sentinel error used to signal "the user cancelled this job" from
 * inside the pipeline. Thrown by the cancellation check at the
 * start of the pipeline and from inside the `onProgress` callback
 * (which is awaited by `ingestPaper` / `ingestCode`, so a throw
 * there propagates up and aborts the run). The outer `catch` in
 * `runPipeline` recognises it and exits without writing any
 * terminal status — the cancel endpoint has already set the row
 * to "cancelled".
 */
const CANCEL_SENTINEL = "PIPELINE_CANCELLED";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024; // 50MB

const PAPER_FILE_EXTENSIONS = [".md", ".markdown", ".txt", ".json", ".pdf"];
const PAPER_FILE_MIME_PREFIXES = ["text/", "application/json", "application/pdf"];
const CODE_FILE_EXTENSIONS = [
  ".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".rs",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".swift", ".kt", ".scala",
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml",
];
const CODE_FILE_MIME_PREFIXES = ["text/", "application/json", "application/x-yaml"];

/**
 * Validates that a URL is safe to fetch server-side. Blocks non-http(s)
 * schemes and private / loopback / link-local hostnames (SSRF protection).
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (h === "::1" || h === "::" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fe80:")) return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
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
  if (u.username || u.password) return null;
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
  return PAPER_FILE_MIME_PREFIXES.some((p) => type.startsWith(p));
}

function isCodeFile(file: File): boolean {
  const ext = getFileExtension(file.name);
  if (CODE_FILE_EXTENSIONS.includes(ext)) return true;
  const type = (file.type || "").toLowerCase();
  return CODE_FILE_MIME_PREFIXES.some((p) => type.startsWith(p));
}

/**
 * Converts a GitHub URL (repo root, tree, or blob) into a raw README URL.
 */
function resolveGitHubUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[1];
      if (parts.length >= 5 && parts[2] === "blob") {
        const branch = parts[3];
        const filePath = parts.slice(4).join("/");
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
      }
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
 */
function resolvePaperUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "arxiv.org" || host === "www.arxiv.org") {
      const path = u.pathname;
      const absMatch = path.match(/^\/abs\/(.+)$/);
      if (absMatch) {
        const id = absMatch[1];
        return `https://arxiv.org/pdf/${id}`;
      }
      return url;
    }
    if (host === "doi.org" || host === "www.doi.org") {
      return url;
    }
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

/**
 * Background pipeline: runs the ingest pipeline, updates the job record with
 * progress, and on success creates a conceptGraphs row + marks the job done.
 * On failure the job is marked failed with the error message.
 *
 * Cancellation:
 *   The `onProgress` callback (and a pre-flight check at the top of
 *   this function) polls the job's `status` column. When it sees
 *   "cancelled" — set by `/api/concept-graph/jobs/[id]/cancel` when
 *   the user clicks Cancel in the import UI — the pipeline throws
 *   `CANCEL_SENTINEL`, the outer catch recognises it, and the
 *   function exits without writing any terminal status. The job
 *   row stays at "cancelled" for the client-side poller to observe.
 */
async function runPipeline(
  jobId: string,
  rawText: string,
  title: string | null,
  type: "paper" | "code",
  userId: string,
  langInstruction: string,
  documentId?: string
): Promise<void> {
  // Pre-flight cancellation check. Handles the race where the
  // user clicks Cancel between the POST returning the jobId and
  // `after()` actually firing this function. If the row is
  // already "cancelled" by the time we get here, exit silently.
  try {
    const [current] = await db
      .select({ status: conceptGraphJobs.status })
      .from(conceptGraphJobs)
      .where(eq(conceptGraphJobs.id, jobId))
      .limit(1);
    if (current?.status === "cancelled") {
      console.log(`[concept-graph/ingest] job ${jobId} cancelled before pipeline start`);
      return;
    }
  } catch (e) {
    // Non-fatal: if the pre-flight check itself fails, continue
    // and let the per-step check handle it.
    console.warn("[concept-graph/ingest] pre-flight cancellation check failed:", e);
  }

  const onProgress = async (progress: JobProgress): Promise<void> => {
    try {
      // Cancellation check before each substep. We do a single
      // SELECT (returning the status column) so we don't have to
      // round-trip a separate query when the job is still in
      // flight. Throwing here aborts the run because both
      // `ingestPaper` and `ingestCode` `await` the callback.
      const [current] = await db
        .select({ status: conceptGraphJobs.status })
        .from(conceptGraphJobs)
        .where(eq(conceptGraphJobs.id, jobId))
        .limit(1);
      if (current?.status === "cancelled") {
        throw new Error(CANCEL_SENTINEL);
      }
      await db
        .update(conceptGraphJobs)
        .set({ progress, updatedAt: new Date() })
        .where(eq(conceptGraphJobs.id, jobId));
    } catch (e: any) {
      // Re-throw the cancellation sentinel so the outer runPipeline
      // catch can see it and skip the "failed" status write.
      if (e?.message === CANCEL_SENTINEL) throw e;
      // Non-fatal: any other error here (e.g. transient DB blip)
      // must not break the pipeline.
    }
  };

  // rawText may now be structured HTML (from PDF-to-HTML conversion).
  // The KG pipeline needs plain text for LLM processing, but we store
  // the original HTML in concept_graphs.rawText for the OriginalTextPanel.
  const { isHtml, stripHtml } = await import("@/utils/html-utils");
  const plainText = isHtml(rawText) ? stripHtml(rawText) : rawText;

  try {
    const result =
      type === "code"
        ? await ingestCode(plainText, title, langInstruction, onProgress)
        : await ingestPaper(plainText, title, langInstruction, onProgress);

    // Delete any prior concept_graphs rows for this document BEFORE
    // inserting the new one. Without this, re-running the KG pipeline
    // for the same document stacks up rows in the table (each one
    // then becomes a separate "document" cluster in the global graph
    // on the dashboard, producing duplicate big-circles). The /regenerate
    // route also deletes first, but a user can hit /ingest directly
    // (e.g. via the import page's "regenerate" flow) so we do it here
    // too for safety.
    if (documentId) {
      try {
        await db
          .delete(conceptGraphs)
          .where(
            and(
              eq(conceptGraphs.documentId, documentId),
              eq(conceptGraphs.userId, userId),
            )
          );
      } catch (e) {
        console.error("[concept-graph/ingest] failed to wipe prior graph:", e);
        // Continue — partial cleanup is better than aborting
      }
    }

    const [graph] = await db
      .insert(conceptGraphs)
      .values({
        title: (result.title || title || "Untitled").slice(0, 255),
        type,
        concepts: result.concepts,
        edges: result.edges,
        clusters: result.clusters,
        rawText: rawText.substring(0, 100000), // store original HTML
        userId,
        // Link the graph to its source document so board/codeboard
        // can look it up via /api/concept-graph/by-document/[documentId].
        ...(documentId ? { documentId } : {}),
        ...(result.metadata
          ? {
              authors: JSON.stringify(result.metadata.authors),
              year: result.metadata.year,
              venue: result.metadata.venue,
              doi: result.metadata.doi,
              abstract: result.metadata.abstract,
            }
          : {}),
      })
      .returning();

    await db
      .update(conceptGraphJobs)
      .set({
        status: "done",
        graphId: graph.id,
        projectId: documentId ? documentId : null,
        updatedAt: new Date(),
      })
      .where(eq(conceptGraphJobs.id, jobId));

    await trackUsage(userId, "concept-graph-ingest");
  } catch (e: any) {
    // User cancelled. The cancel endpoint has already set the row
    // to "cancelled" — do NOT overwrite that with "failed" or the
    // client-side poller will surface a misleading error.
    if (e?.message === CANCEL_SENTINEL) {
      console.log(`[concept-graph/ingest] job ${jobId} cancelled by user mid-pipeline`);
      return;
    }
    try {
      await db
        .update(conceptGraphJobs)
        .set({
          status: "failed",
          error: (e?.message || "Unknown error").slice(0, 1000),
          updatedAt: new Date(),
        })
        .where(eq(conceptGraphJobs.id, jobId));
    } catch {
      // Best-effort: if even the failure update fails, nothing more we can do.
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: heavy AI operation
    const rlKey = getRateLimitKey(request);
    const blocked = enforceRateLimit(request, rlKey, RATE_LIMITS.heavy);
    if (blocked) return blocked;

    const session = await auth.api.getSession({ headers: await headers() });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const url = formData.get("url") as string | null;
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string | null;
    const rawType = formData.get("type") as string | null;
    const type: "paper" | "code" = rawType === "code" ? "code" : "paper";

    // If projectId is provided, fetch rawText from the documents table
    // instead of requiring a file/URL upload. This lets board/codeboard
    // trigger the KG pipeline on an already-ingested project.
    if (projectId && !url && !file) {
      const { documents } = await import("@/db/schema");
      const [doc] = await db
        .select({
          rawText: documents.rawText,
          title: documents.title,
        })
        .from(documents)
        .where(eq(documents.id, projectId))
        .limit(1);
      if (!doc) {
        return NextResponse.json(
          { error: "Project not found." },
          { status: 404 }
        );
      }
      if (!doc.rawText || !doc.rawText.trim()) {
        return NextResponse.json(
          { error: "Project has no raw text to analyze. Please ingest content first." },
          { status: 400 }
        );
      }

      const acceptLanguage = request.headers.get("accept-language");
      // Paper: output language follows the source text language.
      // Code: output language follows user preference (unchanged).
      const langInstruction = type === "paper"
        ? SOURCE_LANGUAGE_INSTRUCTION
        : await getLanguageInstructionForUser(userId, acceptLanguage);

      const [job] = await db
        .insert(conceptGraphJobs)
        .values({
          userId,
          status: "processing",
          progress: { step: "queued", current: 0, total: 7 },
          inputType: type,
        })
        .returning();

      after(() =>
        runPipeline(job.id, doc.rawText || "", doc.title, type, userId, langInstruction, projectId)
      );
      return NextResponse.json({ jobId: job.id });
    }

    if (!url && !file) {
      return NextResponse.json(
        { error: "Please provide either a URL, a file, or a projectId." },
        { status: 400 }
      );
    }

    let rawText = "";
    let sourceLabel: string | null = null;

    if (file) {
      const validFile = type === "code" ? isCodeFile(file) : isPaperFile(file);
      if (!validFile) {
        return NextResponse.json(
          {
            error:
              type === "code"
                ? "Unsupported file type. Please upload a source code file (.js, .ts, .py, .go, .md, etc.)."
                : "Unsupported file type. Please upload a Markdown, plain text, JSON, or PDF file.",
          },
          { status: 400 }
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "File is too large. Maximum size is 10MB." },
          { status: 400 }
        );
      }
      try {
        if (file.type === "application/pdf" || getFileExtension(file.name) === ".pdf") {
          const arrayBuffer = await file.arrayBuffer();
          const { convertPdfToHtml } = await import("@/lib/pdf-to-html");
          const result = await convertPdfToHtml(Buffer.from(arrayBuffer), { userId });
          rawText = result.html;
        } else {
          rawText = await file.text();
        }
      } catch {
        return NextResponse.json(
          { error: "Failed to read the uploaded file." },
          { status: 400 }
        );
      }
      sourceLabel = file.name;
    } else if (url) {
      let fetchUrl = url;
      let isPdfResponse = false;
      if (type === "code") {
        const rawUrl = resolveGitHubUrl(url);
        if (rawUrl) fetchUrl = rawUrl;
      } else {
        const resolved = resolvePaperUrl(url);
        if (resolved) {
          fetchUrl = resolved;
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
            headers: { "User-Agent": "SmartReader/1.0" },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        return NextResponse.json(
          { error: "Could not reach the URL. Check that it is reachable." },
          { status: 400 }
        );
      }
      if (!response.ok) {
        return NextResponse.json(
          { error: `Failed to fetch URL (status ${response.status}).` },
          { status: 400 }
        );
      }
      try {
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        if (isPdfResponse || contentType.includes("application/pdf")) {
          const arrayBuffer = await response.arrayBuffer();
          if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
            return NextResponse.json(
              { error: "The response is too large to process." },
              { status: 400 }
            );
          }
          const { convertPdfToHtml } = await import("@/lib/pdf-to-html");
          const result = await convertPdfToHtml(Buffer.from(arrayBuffer), { userId });
          rawText = result.html;
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
            rawText = new TextDecoder().decode(bytes);
          } else {
            rawText = await response.text();
          }
        }
      } catch {
        return NextResponse.json(
          { error: "Failed to read content from URL." },
          { status: 400 }
        );
      }
    }

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: "Source content is empty. Nothing to parse." },
        { status: 400 }
      );
    }

    const acceptLanguage = request.headers.get("accept-language");
    // Paper: output language follows the source text language.
    // Code: output language follows user preference (unchanged).
    const langInstruction = type === "paper"
      ? SOURCE_LANGUAGE_INSTRUCTION
      : await getLanguageInstructionForUser(userId, acceptLanguage);

    // Create a job record (status='processing') and return the jobId
    // immediately. The heavy pipeline runs in the background via after().
    const [job] = await db
      .insert(conceptGraphJobs)
      .values({
        userId,
        status: "processing",
        progress: { step: "queued", current: 0, total: 7 },
        inputType: type,
        inputUrl: url || null,
        inputFileName: sourceLabel || null,
      })
      .returning();

    const title = sourceLabel
      ? sourceLabel.replace(/\.[^.]+$/, "")
      : url
      ? new URL(url).pathname.split("/").filter(Boolean).pop() || null
      : null;

    // Always link the generated graph to its source document. For new
    // projects `projectId` comes from the preceding /api/ingest call;
    // for existing projects it is the project being augmented.
    after(() =>
      runPipeline(job.id, rawText, title, type, userId, langInstruction, projectId ?? undefined)
    );

    return NextResponse.json({ jobId: job.id });
  } catch (error: any) {
    console.error("Concept graph ingest error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
