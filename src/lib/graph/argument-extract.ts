import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { truncate } from "@/utils/concept-graph-utils";
import type { Concept, ArgumentSkeleton, ArgumentNode, ArgumentLink, ArgumentRelation } from "@/types/concept-graph";

const MAX_INPUT_CHARS = 100000;

// 系统提示词：让 LLM 从论文中抽取"论断-证据-反例"三层结构，
// 而不是实体-关系。核心是理解作者在论证什么。
const SYSTEM_PROMPT = `You are an expert at extracting the ARGUMENTATION STRUCTURE of academic papers.

Your goal is to identify WHAT the author is arguing and HOW they support it — not just what concepts appear. A paper is 80% argumentation, 20% entities. Capture the argumentation.

Output ONLY a JSON object:
{
  "mainClaimId": "id of the paper's central thesis claim",
  "nodes": [
    {
      "id": "c1",
      "text": "the claim or statement (verbatim from text or close paraphrase)",
      "type": "claim | evidence | counter | limitation | method | result",
      "section": "which section this appears in",
      "anchor": "verbatim sentence from source for jump-to-source navigation",
      "conceptLabels": ["labels from the provided concept list"]
    }
  ],
  "links": [
    { "source": "c1", "target": "c2", "relation": "supports | opposes | extends | evidence | limitation" }
  ]
}

Node types:
- claim: a statement the author asserts as true (e.g. "Self-attention is superior to RNNs for sequence modeling")
- evidence: experimental or theoretical support (e.g. "BLEU score improved by 2.1 on WMT14")
- counter: a counter-argument or opposing view the author addresses
- limitation: a weakness the author acknowledges (THIS IS HIGH VALUE — researchers care most about these)
- method: a methodological choice being justified (e.g. "We use Adam optimizer with lr=0.0001")
- result: an empirical finding (e.g. "Training time reduced by 40%")

Link relations:
- supports: source argues in favor of target claim
- opposes: source argues against target claim
- extends: source builds on or extends target
- evidence: source is evidence FOR target claim
- limitation: source is a limitation OF target claim

Rules:
- Extract 8-20 nodes. Focus on the CORE argumentation, not every sentence.
- Every paper MUST have a mainClaimId — the single most important claim the paper makes.
- ALWAYS include limitations the author acknowledges (these are the most valuable nodes).
- ALWAYS include the key results with concrete numbers if available.
- Every node MUST have a non-empty anchor quote copied verbatim from the source.
- conceptLabels MUST come from the provided concept list — do not invent new labels.
- Links should form a connected graph — every node (except mainClaim) should have at least one link.
- Order nodes to follow the paper's logical flow: problem → method → evidence → results → limitations.`;

interface RawNode {
  id?: unknown;
  text?: unknown;
  type?: unknown;
  section?: unknown;
  anchor?: unknown;
  conceptLabels?: unknown;
}

interface RawLink {
  source?: unknown;
  target?: unknown;
  relation?: unknown;
}

const VALID_NODE_TYPES = new Set(["claim", "evidence", "counter", "limitation", "method", "result"]);
const VALID_RELATIONS = new Set(["supports", "opposes", "extends", "evidence", "limitation"]);

/**
 * 调用 LLM 从论文原文抽取论证骨架（论断-证据-反例结构）。
 *
 * 与知识图谱（实体-关系）不同，论证骨架关注的是：
 * - 作者在论证什么（claim）
 * - 用什么证据支撑（evidence）
 * - 承认了什么局限（limitation）
 *
 * 失败时返回空骨架（不阻塞管线）。
 */
export async function extractArgumentSkeleton(
  text: string,
  concepts: Concept[],
  langInstruction: string
): Promise<ArgumentSkeleton> {
  if (!text || !text.trim()) return { nodes: [], links: [] };

  const truncated = truncate(text, MAX_INPUT_CHARS);

  // 构建 label -> id 映射（大小写不敏感），用于把 LLM 输出的
  // conceptLabels 匹配回 conceptIds。
  const conceptByLabel = new Map<string, string>();
  for (const c of concepts) {
    if (!c.label) continue;
    conceptByLabel.set(c.label.trim().toLowerCase(), c.id);
    for (const alias of c.aliases || []) {
      const a = alias.trim().toLowerCase();
      if (a) conceptByLabel.set(a, c.id);
    }
  }

  const conceptList = concepts
    .map((c) => `- ${c.label}`)
    .filter(Boolean)
    .join("\n");

  const userContent = `Paper text:
${truncated}

Available concepts (use these exact labels in conceptLabels):
${conceptList}

Now extract the argumentation skeleton as JSON.`;

  try {
    const completion = await agnes.chat.completions.create({
      model: AGNES_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT + langInstruction },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    const rawNodes: RawNode[] = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const rawLinks: RawLink[] = Array.isArray(parsed.links) ? parsed.links : [];
    const mainClaimId =
      typeof parsed.mainClaimId === "string" ? parsed.mainClaimId : undefined;

    const nodes: ArgumentNode[] = [];
    const validNodeIds = new Set<string>();

    for (const raw of rawNodes) {
      if (!raw || typeof raw !== "object") continue;
      const id = typeof raw.id === "string" ? raw.id.trim() : "";
      const nodeText = typeof raw.text === "string" ? raw.text.trim() : "";
      if (!id || !nodeText) continue;

      const type = typeof raw.type === "string" && VALID_NODE_TYPES.has(raw.type)
        ? (raw.type as ArgumentNode["type"])
        : "claim";

      const section = typeof raw.section === "string" && raw.section.trim()
        ? raw.section.trim()
        : undefined;

      const anchor = typeof raw.anchor === "string" && raw.anchor.trim()
        ? raw.anchor.trim()
        : undefined;

      // 匹配 conceptLabels → conceptIds
      const conceptIds: string[] = [];
      if (Array.isArray(raw.conceptLabels)) {
        for (const label of raw.conceptLabels) {
          if (typeof label !== "string") continue;
          const key = label.trim().toLowerCase();
          if (!key) continue;
          const cid = conceptByLabel.get(key);
          if (cid && !conceptIds.includes(cid)) conceptIds.push(cid);
        }
      }

      nodes.push({
        id,
        text: nodeText,
        type,
        ...(section ? { section } : {}),
        ...(anchor ? { anchor } : {}),
        ...(conceptIds.length > 0 ? { conceptIds } : {}),
      });
      validNodeIds.add(id);
    }

    const links: ArgumentLink[] = [];
    for (const raw of rawLinks) {
      if (!raw || typeof raw !== "object") continue;
      const source = typeof raw.source === "string" ? raw.source.trim() : "";
      const target = typeof raw.target === "string" ? raw.target.trim() : "";
      if (!source || !target || !validNodeIds.has(source) || !validNodeIds.has(target)) continue;
      const relation = typeof raw.relation === "string" && VALID_RELATIONS.has(raw.relation)
        ? (raw.relation as ArgumentRelation)
        : "supports";
      links.push({ source, target, relation });
    }

    return {
      nodes,
      links,
      ...(mainClaimId && validNodeIds.has(mainClaimId) ? { mainClaimId } : {}),
    };
  } catch {
    // 论证骨架是辅助功能，失败时不阻塞主管线
    return { nodes: [], links: [] };
  }
}
