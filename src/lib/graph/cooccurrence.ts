import type { Concept, ConceptEdge } from "@/types/concept-graph";
import type { Sentence } from "@/lib/graph/sentence-split";
import { normalizeWeights } from "@/utils/concept-graph-utils";

interface EdgeAccumulator {
  source: Concept;
  target: Concept;
  weight: number;
  evidence: string[];
}

function buildSearchIndex(concepts: Concept[]): Map<string, Concept> {
  const index = new Map<string, Concept>();
  for (const concept of concepts) {
    const names = [concept.label, ...concept.aliases];
    for (const name of names) {
      const lower = name.toLowerCase();
      if (lower) index.set(lower, concept);
    }
  }
  return index;
}

function findConceptsInSentence(
  sentence: Sentence,
  index: Map<string, Concept>
): Set<Concept> {
  const lowerText = sentence.text.toLowerCase();
  const found = new Set<Concept>();
  for (const [name, concept] of index) {
    if (lowerText.includes(name)) {
      found.add(concept);
    }
  }
  return found;
}

export function buildCooccurrenceEdges(
  concepts: Concept[],
  sentences: Sentence[]
): ConceptEdge[] {
  if (concepts.length === 0 || sentences.length === 0) return [];

  const index = buildSearchIndex(concepts);
  const edgeMap = new Map<string, EdgeAccumulator>();

  const addWeight = (
    a: Concept,
    b: Concept,
    weight: number,
    evidence?: string
  ) => {
    if (a.id === b.id) return;
    const [source, target] = a.id < b.id ? [a, b] : [b, a];
    const key = `${source.id}__${target.id}`;
    const edge = edgeMap.get(key);
    if (edge) {
      edge.weight += weight;
      if (
        evidence &&
        edge.evidence.length < 3 &&
        !edge.evidence.includes(evidence)
      ) {
        edge.evidence.push(evidence);
      }
    } else {
      edgeMap.set(key, {
        source,
        target,
        weight,
        evidence: evidence ? [evidence] : [],
      });
    }
  };

  for (const sentence of sentences) {
    const found = findConceptsInSentence(sentence, index);
    const list = [...found];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        addWeight(list[i], list[j], 2, sentence.text);
      }
    }
  }

  const paragraphs = new Map<number, Sentence[]>();
  for (const sentence of sentences) {
    const arr = paragraphs.get(sentence.paragraphIndex) || [];
    arr.push(sentence);
    paragraphs.set(sentence.paragraphIndex, arr);
  }

  for (const [, paraSentences] of paragraphs) {
    const paraConcepts = new Set<Concept>();
    for (const s of paraSentences) {
      const found = findConceptsInSentence(s, index);
      for (const c of found) paraConcepts.add(c);
    }
    const list = [...paraConcepts];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        addWeight(list[i], list[j], 0.5);
      }
    }
  }

  const filtered: ConceptEdge[] = [];
  for (const edge of edgeMap.values()) {
    if (edge.weight < 2) continue;
    filtered.push({
      id: `edge-${edge.source.id}-${edge.target.id}`,
      source: edge.source.id,
      target: edge.target.id,
      type: "co-occurs",
      weight: edge.weight,
      evidence: edge.evidence.slice(0, 3),
      confidence: 1,
    });
  }

  return normalizeWeights(filtered);
}
