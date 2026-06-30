"""
概念充实节点（对应 src/lib/graph/enrich.ts）。

分批并行调用 LLM，为每个概念添加 description + anchors。
"""
import asyncio
import json
from typing import Any

from app.config import get_settings
from app.graph.state import KGState
from app.llm import get_llm
from app.utils.text_utils import get_top_concepts, truncate

_settings = get_settings()

MAX_SOURCE_CHARS = 50_000
BATCH_SIZE = 15
TOP_N = 60

ENRICH_SYSTEM_PROMPT = """You are an expert at enriching technical concepts from a source text.

For each concept, provide a clear 1-2 sentence description explaining what it is and why it matters in the context of the source text. Also identify 1-3 representative sentences from the source text that best illustrate the concept.

Output ONLY a JSON object:
{
  "concepts": [
    {
      "id": "concept-id",
      "description": "1-2 sentence explanation of what the concept is and its significance",
      "anchors": ["verbatim sentence 1 from the source", "sentence 2"]
    }
  ]
}

Rules:
- The description should be precise and informative, explaining the concept's role in the work.
- The anchors MUST be verbatim sentences from the source text (copy them exactly).
- Choose anchors that best define or demonstrate the concept, not just any mention.
- If you cannot find a good anchor, provide an empty array.
- Write descriptions in the same language as the source text."""


async def _enrich_batch(
    batch: list[dict[str, Any]],
    source_text: str,
    lang_instruction: str,
) -> dict[str, dict[str, Any]]:
    """处理一批概念，返回 {concept_id: {description, anchors}}。"""
    input_data = {
        "concepts": [{"id": c.get("id", ""), "label": c.get("label", "")} for c in batch],
        "source_text": source_text,
    }
    try:
        client = get_llm()
        response = await client.chat.completions.create(
            model=_settings.agnes_model,
            messages=[
                {"role": "system", "content": ENRICH_SYSTEM_PROMPT + lang_instruction},
                {"role": "user", "content": json.dumps(input_data, ensure_ascii=False)},
            ],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)
        result_concepts = parsed.get("concepts") if isinstance(parsed, dict) else None
        if not isinstance(result_concepts, list):
            return {}
        enrichments: dict[str, dict[str, Any]] = {}
        for rc in result_concepts:
            if not isinstance(rc, dict):
                continue
            cid = rc.get("id")
            if not isinstance(cid, str):
                continue
            description = rc.get("description")
            description = description.strip() if isinstance(description, str) else ""
            anchors = rc.get("anchors")
            if isinstance(anchors, list):
                anchors = [str(a).strip() for a in anchors if isinstance(a, str) and a.strip()]
            else:
                anchors = []
            enrichments[cid] = {"description": description, "anchors": anchors}
        return enrichments
    except Exception as e:
        print(f"[enrich] batch failed: {e}", flush=True)
        return {}


async def enrich_concepts(
    concepts: list[dict[str, Any]],
    raw_text: str,
    lang_instruction: str,
) -> list[dict[str, Any]]:
    """充实概念（对应 enrich.ts 的 enrichConcepts）。

    用 asyncio.gather 并行发送多个批次。
    """
    if not concepts:
        return concepts

    top = get_top_concepts(concepts, TOP_N)
    source_text = truncate(raw_text, MAX_SOURCE_CHARS)

    # 分批
    batches = [top[i:i + BATCH_SIZE] for i in range(0, len(top), BATCH_SIZE)]

    # 并行处理所有批次
    results = await asyncio.gather(*[_enrich_batch(b, source_text, lang_instruction) for b in batches])
    enrichments: dict[str, dict[str, Any]] = {}
    for r in results:
        enrichments.update(r)

    # 合并回原 concepts
    enriched: list[dict[str, Any]] = []
    for concept in concepts:
        cid = concept.get("id", "")
        enrichment = enrichments.get(cid)
        if enrichment:
            description = enrichment.get("description", "") or concept.get("description", "")
            anchors = enrichment.get("anchors", [])
            if not anchors:
                anchors = concept.get("anchors", [])
            enriched.append({**concept, "description": description, "anchors": anchors})
        else:
            enriched.append(concept)
    return enriched


async def enrich_concepts_node(state: KGState) -> dict:
    """langgraph 节点：充实概念。"""
    enriched = await enrich_concepts(
        state.get("concepts", []),
        state.get("plain_text", ""),
        state.get("lang_instruction", ""),
    )
    # paper 管线第 3 步，code 管线第 5 步
    doc_type = state.get("type", "paper")
    step = 3 if doc_type == "paper" else 5
    return {"concepts": enriched, "current_step": step}
