import type { Concept, ConceptType } from "@/types/concept-graph";
import type { RawConcept } from "@/lib/graph/concept-extract";
import { generateConceptId } from "@/utils/concept-graph-utils";

const VALID_PAPER_TYPES = [
  "method",
  "model",
  "metric",
  "dataset",
  "term",
  "tool",
  "task",
];
const VALID_CODE_TYPES = [
  "function",
  "class",
  "module",
  "interface",
  "variable",
];

function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeType(type: string): ConceptType {
  const lower = type.toLowerCase().trim();
  if ([...VALID_PAPER_TYPES, ...VALID_CODE_TYPES].includes(lower)) {
    return lower as ConceptType;
  }
  return "term";
}

interface ConceptGroup {
  label: string;
  type: ConceptType;
  aliases: Set<string>;
  evidence: string[];
}

export function resolveEntities(
  rawConcepts: RawConcept[],
  rawText?: string
): Concept[] {
  const groups = new Map<string, ConceptGroup>();

  for (const raw of rawConcepts) {
    const normLabel = normalize(raw.label);
    if (!normLabel) continue;

    const key = generateConceptId(raw.label);
    let group = groups.get(key);

    if (!group) {
      for (const [existingKey, existingGroup] of groups) {
        const allNames = [
          normalize(existingGroup.label),
          ...[...existingGroup.aliases].map(normalize),
        ];
        const rawNames = [normLabel, ...raw.aliases.map(normalize)];
        if (rawNames.some((n) => allNames.includes(n))) {
          group = existingGroup;
          groups.delete(key);
          groups.set(existingKey, group);
          break;
        }
      }
    }

    if (!group) {
      group = {
        label: raw.label,
        type: normalizeType(raw.type),
        aliases: new Set<string>(),
        evidence: [],
      };
      groups.set(key, group);
    }

    for (const alias of raw.aliases) {
      const normAlias = normalize(alias);
      if (normAlias && normAlias !== normLabel) {
        group.aliases.add(alias.trim());
      }
    }

    if (raw.evidence) {
      group.evidence.push(raw.evidence);
    }

    const newType = normalizeType(raw.type);
    if (group.type === "term" && newType !== "term") {
      group.type = newType;
    }
  }

  const concepts: Concept[] = [];
  // Pre-compute the full-text search target once. Scanning the entire
  // raw text gives a far more accurate frequency than scanning only the
  // LLM-provided evidence snippets (which are just a few quotes).
  const fullTextLower = rawText ? rawText.toLowerCase() : "";
  for (const [key, group] of groups) {
    const labelLower = normalize(group.label);
    const aliasLowers = [...group.aliases].map(normalize);

    let frequency = 0;
    // Search in full text (preferred) or fall back to evidence.
    const searchTarget = fullTextLower || group.evidence.join(" ").toLowerCase();
    for (const name of [labelLower, ...aliasLowers]) {
      if (!name) continue;
      let idx = 0;
      while ((idx = searchTarget.indexOf(name, idx)) !== -1) {
        frequency++;
        idx += name.length;
      }
    }
    frequency = Math.max(frequency, 1);

    concepts.push({
      id: key,
      label: group.label,
      type: group.type,
      aliases: [...group.aliases],
      frequency,
      importance: 0,
      clusterId: "",
      anchors: [],
    });
  }

  return concepts;
}
