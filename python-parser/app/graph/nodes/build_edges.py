"""
共现边构建节点（对应 src/lib/graph/cooccurrence.ts）。

基于句子级 + 段落级共现构建 ConceptEdge[]。
"""
from typing import Any

from app.graph.state import KGState
from app.utils.text_utils import normalize_weights


def _build_search_index(concepts: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """构建 name(lower) → concept 映射（对应 cooccurrence.ts 的 buildSearchIndex）。"""
    index: dict[str, dict[str, Any]] = {}
    for concept in concepts:
        names = [concept.get("label", "")] + concept.get("aliases", [])
        for name in names:
            lower = name.lower() if isinstance(name, str) else ""
            if lower:
                index[lower] = concept
    return index


def _find_concepts_in_sentence(sentence_text: str, index: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """在句子中查找出现的概念（对应 cooccurrence.ts 的 findConceptsInSentence）。

    返回 list（而非 Set），用 id 去重。
    """
    lower_text = sentence_text.lower()
    seen_ids: set[str] = set()
    found: list[dict[str, Any]] = []
    for name, concept in index.items():
        if name in lower_text:
            cid = concept.get("id", "")
            if cid not in seen_ids:
                seen_ids.add(cid)
                found.append(concept)
    return found


def build_cooccurrence_edges(
    concepts: list[dict[str, Any]],
    sentences: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """构建共现边（对应 cooccurrence.ts 的 buildCooccurrenceEdges）。

    返回 ConceptEdge[] dict 列表，字段与 TS 版本一致：
      {id, source, target, type, weight, evidence, confidence}
    """
    if not concepts or not sentences:
        return []

    index = _build_search_index(concepts)
    edge_map: dict[str, dict[str, Any]] = {}

    def add_weight(a: dict[str, Any], b: dict[str, Any], weight: float, evidence: str | None = None) -> None:
        aid = a.get("id", "")
        bid = b.get("id", "")
        if aid == bid:
            return
        # 排序保证 source < target（对应 TS 的 a.id < b.id）
        if aid < bid:
            source, target = a, b
        else:
            source, target = b, a
        sid = source.get("id", "")
        tid = target.get("id", "")
        key = f"{sid}__{tid}"
        edge = edge_map.get(key)
        if edge:
            edge["weight"] += weight
            if evidence and len(edge["evidence"]) < 3 and evidence not in edge["evidence"]:
                edge["evidence"].append(evidence)
        else:
            edge_map[key] = {
                "source": source,
                "target": target,
                "weight": weight,
                "evidence": [evidence] if evidence else [],
            }

    # 句子级共现（weight=2）
    for sentence in sentences:
        text = sentence.get("text", "")
        found = _find_concepts_in_sentence(text, index)
        for i in range(len(found)):
            for j in range(i + 1, len(found)):
                add_weight(found[i], found[j], 2, text)

    # 段落级共现（weight=0.5）
    paragraphs: dict[int, list[dict[str, Any]]] = {}
    for sentence in sentences:
        pidx = sentence.get("paragraphIndex", 0)
        paragraphs.setdefault(pidx, []).append(sentence)

    for para_sentences in paragraphs.values():
        para_concept_ids: set[str] = set()
        para_concepts: list[dict[str, Any]] = []
        for s in para_sentences:
            found = _find_concepts_in_sentence(s.get("text", ""), index)
            for c in found:
                cid = c.get("id", "")
                if cid not in para_concept_ids:
                    para_concept_ids.add(cid)
                    para_concepts.append(c)
        for i in range(len(para_concepts)):
            for j in range(i + 1, len(para_concepts)):
                add_weight(para_concepts[i], para_concepts[j], 0.5)

    # 过滤 weight < 2 + 构建 ConceptEdge[]
    filtered: list[dict[str, Any]] = []
    for edge in edge_map.values():
        if edge["weight"] < 2:
            continue
        sid = edge["source"].get("id", "")
        tid = edge["target"].get("id", "")
        filtered.append({
            "id": f"edge-{sid}-{tid}",
            "source": sid,
            "target": tid,
            "type": "co-occurs",
            "weight": edge["weight"],
            "evidence": edge["evidence"][:3],
            "confidence": 1,
        })

    return normalize_weights(filtered)


async def build_edges_node(state: KGState) -> dict:
    """langgraph 节点：构建共现边。"""
    edges = build_cooccurrence_edges(state.get("concepts", []), state.get("sentences", []))
    return {"edges": edges}
