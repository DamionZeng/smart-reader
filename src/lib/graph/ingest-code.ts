import type { ConceptGraph, JobProgress } from "@/types/concept-graph";
import type { RawConcept } from "@/lib/graph/concept-extract";
import type { Sentence } from "@/lib/graph/sentence-split";
import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { resolveEntities } from "@/lib/graph/entity-resolve";
import { buildCooccurrenceEdges } from "@/lib/graph/cooccurrence";
import { calculateImportance } from "@/lib/graph/pagerank";
import { detectCommunities } from "@/lib/graph/leiden";
import { nameClusters } from "@/lib/graph/cluster-name";
import { enrichConcepts } from "@/lib/graph/enrich";
import { hashInput, truncate } from "@/utils/concept-graph-utils";

const MAX_INPUT_CHARS = 50000;
const TOTAL_STEPS = 5;

const SYSTEM_PROMPT = `You are an expert code concept extractor. Your goal is to extract the MOST IMPORTANT and MEANINGFUL concepts from the codebase — the architectural building blocks, key abstractions, and significant symbols that define the system's structure.

Output ONLY a JSON object of the form:
{ "concepts": [ { "label": "...", "type": "...", "aliases": [...], "evidence": "..." } ] }

Each concept object:
{
  "label": "canonical name, e.g. 'AuthService' or 'parseConfig()' or 'DatabasePool'",
  "type": "function | class | module | interface | variable",
  "aliases": ["alternative names, abbreviations"],
  "evidence": "a verbatim snippet from the code where this concept is defined or used"
}

Type definitions:
- function: a function or method (e.g. 'parseConfig()', 'AuthService.login()')
- class: a class definition (e.g. 'AuthService', 'DatabasePool')
- module: a module or file-level concept (e.g. 'auth/router', 'config/loader')
- interface: an interface or type definition (e.g. 'User', 'Config')
- variable: a significant constant or configuration variable (e.g. 'MAX_RETRIES', 'DEFAULT_PORT')

Rules:
- Extract 15-60 high-quality concepts. Focus on the architectural backbone, not every helper.
- Use canonical names from the code.
- Include the symbol's file path in the evidence when available.
- Skip trivial utilities (e.g. 'isNotEmpty()', 'toString()') unless they are central.
- Prefer higher-level concepts: 'Authentication System' is better than every individual function in it.
- Every concept MUST have a non-empty evidence snippet from the source code.`;

async function extractCodeConcepts(
  text: string,
  langInstruction: string
): Promise<RawConcept[]> {
  if (!text || !text.trim()) return [];
  const truncated = truncate(text, MAX_INPUT_CHARS);
  try {
    const completion = await agnes.chat.completions.create({
      model: AGNES_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT + langInstruction },
        { role: "user", content: truncated },
      ],
      response_format: { type: "json_object" },
    });
    const content = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const concepts = parsed.concepts;
    if (!Array.isArray(concepts)) return [];
    return concepts
      .filter(
        (c: unknown) =>
          c !== null &&
          typeof c === "object" &&
          typeof (c as { label?: unknown }).label === "string" &&
          ((c as { label?: unknown }).label as string).trim().length > 0
      )
      .map((c: Record<string, unknown>) => ({
        label: String(c.label).trim(),
        type:
          typeof c.type === "string" && c.type.trim()
            ? c.type.trim()
            : "variable",
        aliases: Array.isArray(c.aliases)
          ? c.aliases
              .filter((a: unknown) => typeof a === "string" && a.trim())
              .map((a: unknown) => String(a).trim())
          : [],
        evidence:
          typeof c.evidence === "string" ? c.evidence.trim() : "",
      }));
  } catch {
    return [];
  }
}

function splitCodeIntoSentences(code: string): Sentence[] {
  if (!code || !code.trim()) return [];
  const sentences: Sentence[] = [];
  const lines = code.split("\n");
  let currentFile = "main";
  let fileIndex = 0;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length > 0) {
      const text = buffer.join("\n").trim();
      if (text) {
        sentences.push({ text, section: currentFile, paragraphIndex: fileIndex });
      }
      buffer = [];
    }
  };

  for (const line of lines) {
    const fileMatch =
      line.match(
        /^(?:\/\/|#|\/\*)\s*(?:file|filename|path)[:\s]+(.+)$/i
      ) || line.match(/^---\s*(.+?)\s*---$/);
    if (fileMatch) {
      flush();
      currentFile = fileMatch[1].trim();
      fileIndex++;
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (sentences.length === 0 && code.trim()) {
    sentences.push({ text: code.trim(), section: "main", paragraphIndex: 0 });
  }

  return sentences;
}

export async function ingestCode(
  rawText: string,
  title: string | null,
  langInstruction: string,
  onProgress?: (progress: JobProgress) => void | Promise<void>
): Promise<ConceptGraph> {
  const resolvedTitle = title || "Untitled";
  // Awaiting the progress callback serialises the DB writes so the
  // polling client never sees a stale or out-of-order step. Without
  // this, back-to-back progress() calls race in the database and the
  // sub-step indicator can hop backwards and forwards.
  const progress = async (step: string, current: number) => {
    await onProgress?.({ step, current, total: TOTAL_STEPS });
  };

  await progress("extracting-concepts", 1);
  const rawConcepts = await extractCodeConcepts(rawText, langInstruction);

  await progress("resolving-entities", 2);
  let concepts = resolveEntities(rawConcepts, rawText);

  await progress("building-edges", 3);
  const sentences = splitCodeIntoSentences(rawText);
  const edges = buildCooccurrenceEdges(concepts, sentences);

  concepts = calculateImportance(concepts, edges);

  await progress("detecting-communities", 4);
  const clusters = detectCommunities(concepts, edges);
  const namedClusters = await nameClusters(clusters, concepts, langInstruction);

  await progress("enriching-concepts", 5);
  const graph: ConceptGraph = {
    id: hashInput(rawText + resolvedTitle),
    title: resolvedTitle,
    type: "code",
    rawText,
    concepts,
    edges,
    clusters: namedClusters,
    createdAt: new Date().toISOString(),
  };
  return enrichConcepts(graph, langInstruction);
}
