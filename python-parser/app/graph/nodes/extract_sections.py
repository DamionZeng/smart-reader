"""
章节抽取节点（仅 paper 管线，对应 src/lib/graph/section-extract.ts）。

让 LLM 从论文原文抽取逻辑章节大纲（思维导图视图用）。
"""
import json
from typing import Any

from app.config import get_settings
from app.graph.state import KGState
from app.llm import get_llm
from app.utils.text_utils import truncate

_settings = get_settings()

MAX_INPUT_CHARS = 100_000

SECTION_SYSTEM_PROMPT = """You are an expert academic paper structural analyst.

Your goal is to read the paper text and produce a LOGICAL chapter outline — not a verbatim copy of the table of contents. Re-organise the content into coherent sections that reflect the paper's intellectual structure.

Output ONLY a JSON object of the form:
{ "sections": [{ "title": "...", "summary": "...", "level": 0, "conceptLabels": ["..."], "anchor": "...", "children": [...] }] }

Each section object:
{
  "title": "a concise section title (can differ from the paper's original headings if a logical re-grouping is clearer)",
  "summary": "1-2 sentence summary of what this section discusses",
  "level": 0 for top-level sections, 1 for subsections,
  "conceptLabels": ["labels of concepts from the provided list that this section covers"],
  "anchor": "a verbatim sentence from the source text that opens or defines this section (used for jump-to-source navigation)",
  "children": [ optional array of subsections with the same shape ]
}

Rules:
- Produce 5-10 top-level sections. Subsections (level=1) are optional but encouraged for dense papers.
- Every section MUST have a non-empty anchor quote copied verbatim from the source text.
- conceptLabels MUST come from the provided concept list — do not invent new labels.
- Keep titles short and informative (aim for <= 8 words).
- Summaries should be factual and specific to this paper, not generic descriptions.
- Order sections to follow the paper's logical flow (typically: problem → background → method → experiments → results → conclusion).
- If the paper lacks a clear structure, infer the most sensible logical grouping."""


def _normalize_raw_section(
    raw: Any,
    index: int,
    concept_by_label: dict[str, str],
    parent_path: str = "",
) -> dict[str, Any] | None:
    """校验 + 归一化单个 section（对应 section-extract.ts 的 normalizeRawSection）。

    id 生成：path-based（父级 path + 当前同级 index），保证全局唯一。
    """
    if not isinstance(raw, dict):
        return None
    title = raw.get("title")
    title = title.strip() if isinstance(title, str) and title.strip() else ""
    if not title:
        return None

    summary = raw.get("summary")
    summary = summary.strip() if isinstance(summary, str) and summary.strip() else ""

    level = raw.get("level")
    level = level if isinstance(level, int) and level in (0, 1) else 0

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

    anchor = raw.get("anchor")
    anchor = anchor.strip() if isinstance(anchor, str) and anchor.strip() else None

    # path-based id
    current_path = f"{parent_path}-{index}" if parent_path else f"{index}"
    section_id = f"sec-{current_path}"

    result: dict[str, Any] = {
        "id": section_id,
        "title": title,
        "summary": summary,
        "level": level,
        "conceptIds": concept_ids,
    }
    if anchor:
        result["anchor"] = anchor

    # 递归处理 children
    children = raw.get("children")
    if isinstance(children, list) and children:
        child_sections = []
        for i, child in enumerate(children):
            normalized = _normalize_raw_section(child, i, concept_by_label, current_path)
            if normalized:
                child_sections.append(normalized)
        if child_sections:
            result["children"] = child_sections

    return result


async def extract_sections(
    text: str,
    concepts: list[dict[str, Any]],
    lang_instruction: str,
) -> list[dict[str, Any]]:
    """抽取章节大纲（对应 section-extract.ts 的 extractSections）。"""
    if not text or not text.strip():
        return []

    truncated = truncate(text, MAX_INPUT_CHARS)

    # 构建 label( lower) → conceptId 映射（含 aliases）
    concept_by_label: dict[str, str] = {}
    for c in concepts:
        label = c.get("label", "")
        if label:
            concept_by_label[label.strip().lower()] = c.get("id", "")
        for alias in c.get("aliases", []):
            a = alias.strip().lower() if isinstance(alias, str) else ""
            if a:
                concept_by_label[a] = c.get("id", "")

    # 构建 concept label 列表供 LLM 引用
    concept_list = "\n".join(f"- {c.get('label', '')}" for c in concepts if c.get("label"))

    user_content = f"Paper text:\n{truncated}\n\nAvailable concepts (use these exact labels in conceptLabels):\n{concept_list}\n\nNow produce the section outline as JSON."

    try:
        client = get_llm()
        response = await client.chat.completions.create(
            model=_settings.agnes_model,
            messages=[
                {"role": "system", "content": SECTION_SYSTEM_PROMPT + lang_instruction},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)
        sections = parsed.get("sections") if isinstance(parsed, dict) else None
        if not isinstance(sections, list):
            return []
        result: list[dict[str, Any]] = []
        for i, sec in enumerate(sections):
            normalized = _normalize_raw_section(sec, i, concept_by_label)
            if normalized:
                result.append(normalized)
        return result
    except Exception as e:
        print(f"[extract_sections] failed: {e}", flush=True)
        return []


async def extract_sections_node(state: KGState) -> dict:
    """langgraph 节点：抽取章节大纲。"""
    sections = await extract_sections(
        state.get("plain_text", ""),
        state.get("concepts", []),
        state.get("lang_instruction", ""),
    )
    return {"sections": sections}
