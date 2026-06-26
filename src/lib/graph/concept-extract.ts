import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { truncate } from "@/utils/concept-graph-utils";

export interface RawConcept {
  label: string;
  type: string;
  aliases: string[];
  evidence: string;
}

const MAX_INPUT_CHARS = 100000;

const SYSTEM_PROMPT = `You are an expert technical concept extractor for academic papers.

Your goal is to extract the MOST IMPORTANT and MEANINGFUL concepts from the paper — the ones that form the intellectual backbone of the work. Quality matters far more than quantity.

Output ONLY a JSON object of the form:
{ "concepts": [ { "label": "...", "type": "...", "aliases": [...], "evidence": "..." } ] }

Each concept object:
{
  "label": "canonical name, e.g. 'Self-Attention' or 'Multi-Head Attention'",
  "type": "method | model | metric | dataset | term | tool | task",
  "aliases": ["alternative names, abbreviations, e.g. 'MHA', 'multi-head attention'"],
  "evidence": "a verbatim sentence or clause from the text where this concept is defined, used, or evaluated"
}

Type definitions:
- method: a technique, algorithm, or procedure (e.g. 'Beam Search', 'Dropout')
- model: a named architecture or model (e.g. 'Transformer', 'BERT')
- metric: an evaluation measure (e.g. 'BLEU', 'Perplexity')
- dataset: a named data source (e.g. 'WMT 2014', 'ImageNet')
- term: a domain-specific concept that is not a method/model/metric/dataset (e.g. 'attention weight', 'positional encoding')
- tool: a software tool or framework (e.g. 'TensorFlow')
- task: a research task (e.g. 'machine translation', 'question answering')

Rules:
- Extract 20-80 high-quality concepts. Focus on concepts that are central to the paper's contribution.
- Use canonical names: "BERT" not "bert model", "Transformer" not "the transformer architecture".
- Include abbreviations as aliases, not separate entries.
- Do NOT include generic words (the, method, result, approach, system) unless they are domain-specific terms.
- Every concept MUST have a non-empty evidence quote from the source text.
- Prefer specific concepts over vague ones: "Multi-Head Attention" is better than "Attention".
- If the paper proposes a novel method, always include it as a concept with type "method".`;

export async function extractConcepts(
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
            : "term",
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
