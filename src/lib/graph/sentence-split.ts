import { split } from "sentence-splitter";

export interface Sentence {
  text: string;
  section: string;
  paragraphIndex: number;
}

const SECTION_HEADERS = [
  "abstract",
  "introduction",
  "background",
  "related work",
  "related-work",
  "method",
  "methods",
  "methodology",
  "approach",
  "experiment",
  "experiments",
  "experimental setup",
  "results",
  "discussion",
  "conclusion",
  "conclusions",
  "references",
  "acknowledgments",
  "appendix",
];

function normalizeSectionName(name: string): string {
  const lower = name.toLowerCase().trim();
  for (const header of SECTION_HEADERS) {
    if (lower.includes(header)) return header;
  }
  return lower.replace(/\s+/g, "-");
}

function detectSection(paragraph: string): string | null {
  const trimmed = paragraph.trim();
  if (!trimmed) return null;

  const mdMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
  if (mdMatch) {
    return normalizeSectionName(mdMatch[1]);
  }

  const lines = trimmed.split("\n");
  if (lines.length === 1 && trimmed.length <= 80) {
    const withoutNumber = trimmed
      .replace(/^\d+\.?\s*/, "")
      .replace(/^[IVXLCM]+\.\s*/, "");
    if (
      withoutNumber.length > 0 &&
      withoutNumber.length <= 60 &&
      !/[.;:]$/.test(withoutNumber)
    ) {
      const lower = withoutNumber.toLowerCase();
      if (SECTION_HEADERS.some((h) => lower.includes(h))) {
        return normalizeSectionName(withoutNumber);
      }
    }
  }

  return null;
}

export function splitSentences(text: string): Sentence[] {
  if (!text || !text.trim()) return [];

  const sentences: Sentence[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentSection = "body";

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const section = detectSection(paragraph);
    if (section) {
      currentSection = section;
      return;
    }
    if (!paragraph.trim()) return;

    let parts: { type?: string; raw?: string; value?: string }[] = [];
    try {
      parts = split(paragraph) as { type?: string; raw?: string; value?: string }[];
    } catch {
      parts = [];
    }

    const extracted = parts
      .filter((p) => p && p.type === "Sentence")
      .map((p) => (p.raw || p.value || "").trim())
      .filter((s) => s.length > 0);

    const finalSentences = extracted.length > 0 ? extracted : [paragraph.trim()];

    for (const s of finalSentences) {
      if (s.length >= 2) {
        sentences.push({
          text: s,
          section: currentSection,
          paragraphIndex,
        });
      }
    }
  });

  return sentences;
}
