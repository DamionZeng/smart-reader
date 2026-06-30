"""
论证骨架抽取节点（仅 paper 管线，对应 src/lib/graph/argument-extract.ts）。

让 LLM 从论文抽取"论断-证据-反例"三层结构。
"""
import json
from typing import Any

from app.config import get_settings
from app.graph.state import KGState
from app.llm import get_llm
from app.utils.text_utils import truncate

_settings = get_settings()

MAX_INPUT_CHARS = 100_000

SKELETON_SYSTEM_PROMPT = """You are an expert at extracting the ARGUMENTATION STRUCTURE of academic papers.

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
- Order nodes to follow the paper's logical flow: problem → method → evidence → results → limitations."""

VALID_NODE_TYPES = {"claim", "evidence", "counter", "limitation", "method", "result"}
VALID_RELATIONS = {"supports", "opposes", "extends", "evidence", "limitation"}


async def extract_argument_skeleton(
    text: str,
    concepts: list[dict[str, Any]],
    lang_instruction: str,
) -> dict[str, Any]:
    """抽取论证骨架（对应 argument-extract.ts 的 extractArgumentSkeleton）。

    返回 {nodes, links, mainClaimId?}。
    """
    if not text or not text.strip():
        return {"nodes": [], "links": []}

    truncated = truncate(text, MAX_INPUT_CHARS)

    # 构建 label(lower) → conceptId 映射
    concept_by_label: dict[str, str] = {}
    for c in concepts:
        label = c.get("label", "")
        if label:
            concept_by_label[label.strip().lower()] = c.get("id", "")
        for alias in c.get("aliases", []):
            a = alias.strip().lower() if isinstance(alias, str) else ""
            if a:
                concept_by_label[a] = c.get("id", "")

    concept_list = "\n".join(f"- {c.get('label', '')}" for c in concepts if c.get("label"))
    user_content = f"Paper text:\n{truncated}\n\nAvailable concepts (use these exact labels in conceptLabels):\n{concept_list}\n\nNow extract the argumentation skeleton as JSON."

    try:
        client = get_llm()
        response = await client.chat.completions.create(
            model=_settings.agnes_model,
            messages=[
                {"role": "system", "content": SKELETON_SYSTEM_PROMPT + lang_instruction},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)

        raw_nodes = parsed.get("nodes") if isinstance(parsed, dict) else None
        raw_links = parsed.get("links") if isinstance(parsed, dict) else None
        main_claim_id = parsed.get("mainClaimId") if isinstance(parsed.get("mainClaimId"), str) else None
        if not isinstance(raw_nodes, list):
            raw_nodes = []
        if not isinstance(raw_links, list):
            raw_links = []

        nodes: list[dict[str, Any]] = []
        valid_node_ids: set[str] = set()

        for raw in raw_nodes:
            if not isinstance(raw, dict):
                continue
            nid = raw.get("id")
            nid = nid.strip() if isinstance(nid, str) else ""
            ntext = raw.get("text")
            ntext = ntext.strip() if isinstance(ntext, str) else ""
            if not nid or not ntext:
                continue

            ntype = raw.get("type")
            ntype = ntype if isinstance(ntype, str) and ntype in VALID_NODE_TYPES else "claim"

            section = raw.get("section")
            section = section.strip() if isinstance(section, str) and section.strip() else None

            anchor = raw.get("anchor")
            anchor = anchor.strip() if isinstance(anchor, str) and anchor.strip() else None

            # conceptLabels → conceptIds
            concept_ids: list[str] = []
            concept_labels = raw.get("conceptLabels")
            if isinstance(concept_labels, list):
                for label in concept_labels:
                    if not isinstance(label, str):
                        continue
                    key = label.strip().lower()
                    if not key:
                        continue
                    cid = concept_by_label.get(key)
                    if cid and cid not in concept_ids:
                        concept_ids.append(cid)

            node: dict[str, Any] = {"id": nid, "text": ntext, "type": ntype}
            if section:
                node["section"] = section
            if anchor:
                node["anchor"] = anchor
            if concept_ids:
                node["conceptIds"] = concept_ids
            nodes.append(node)
            valid_node_ids.add(nid)

        links: list[dict[str, Any]] = []
        for raw in raw_links:
            if not isinstance(raw, dict):
                continue
            source = raw.get("source")
            source = source.strip() if isinstance(source, str) else ""
            target = raw.get("target")
            target = target.strip() if isinstance(target, str) else ""
            if not source or not target or source not in valid_node_ids or target not in valid_node_ids:
                continue
            relation = raw.get("relation")
            relation = relation if isinstance(relation, str) and relation in VALID_RELATIONS else "supports"
            links.append({"source": source, "target": target, "relation": relation})

        result: dict[str, Any] = {"nodes": nodes, "links": links}
        if main_claim_id and main_claim_id in valid_node_ids:
            result["mainClaimId"] = main_claim_id
        return result
    except Exception as e:
        print(f"[extract_skeleton] failed: {e}", flush=True)
        return {"nodes": [], "links": []}


async def extract_skeleton_node(state: KGState) -> dict:
    """langgraph 节点：抽取论证骨架。"""
    skeleton = await extract_argument_skeleton(
        state.get("plain_text", ""),
        state.get("concepts", []),
        state.get("lang_instruction", ""),
    )
    return {"skeleton": skeleton}
