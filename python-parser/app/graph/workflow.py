"""
KG 管线编排（对应 src/lib/graph/ingest-paper.ts + ingest-code.ts）。

Paper 管线（3 步）：
  Step 1: extract_concepts + split_sentences（并行）
  Step 2: resolve_entities → build_edges → pagerank（串行本地）
  Step 3: enrich + extract_sections + extract_skeleton（并行 LLM）

Code 管线（5 步）：
  extract_concepts → resolve_entities → build_edges + split_sentences → pagerank → cluster → enrich

设计说明：
  使用普通 async 管线串行编排各步骤，并行的 LLM 调用放在单个步骤内部用 asyncio.gather 实现。
  这样：
    - 并行性不丢失（asyncio.gather）
    - 实现简单，避免复杂的图编排配置
"""
import asyncio
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from app.graph.nodes.build_edges import build_cooccurrence_edges
from app.graph.nodes.cluster import detect_and_name_clusters_node
from app.graph.nodes.enrich import enrich_concepts
from app.graph.nodes.extract_concepts import extract_code_concepts, extract_paper_concepts
from app.graph.nodes.extract_sections import extract_sections
from app.graph.nodes.extract_skeleton import extract_argument_skeleton
from app.graph.nodes.pagerank import calculate_importance
from app.graph.nodes.resolve_entities import resolve_entities
from app.graph.nodes.split_sentences import _split_code_into_sentences, split_paper_sentences_node
from app.graph.state import CODE_TOTAL_STEPS, PAPER_TOTAL_STEPS, KGState
from app.utils.text_utils import hash_input

# 进度回调类型：async (step_name: str, current: int, total: int) -> None
ProgressCallback = Callable[[str, int, int], Awaitable[None]]


async def _run_paper_step1(state: KGState, on_progress: ProgressCallback) -> dict:
    """Paper Step 1: extract_concepts + split_sentences 并行。"""
    await on_progress("extracting-concepts", 1, PAPER_TOTAL_STEPS)
    # 并行：句子分割（本地）+ 概念抽取（LLM）
    sentences_result, concepts_result = await asyncio.gather(
        split_paper_sentences_node(state),
        extract_paper_concepts(state),
    )
    return {**sentences_result, **concepts_result, "current_step": 1}


async def _run_paper_step2(state: KGState, on_progress: ProgressCallback) -> dict:
    """Paper Step 2: resolve_entities → build_edges → pagerank（本地，<100ms）。"""
    await on_progress("building-graph", 2, PAPER_TOTAL_STEPS)
    concepts = resolve_entities(state.get("raw_concepts", []), state.get("plain_text", ""))
    edges = build_cooccurrence_edges(concepts, state.get("sentences", []))
    concepts_with_importance = calculate_importance(concepts, edges)
    return {"concepts": concepts_with_importance, "edges": edges, "current_step": 2}


async def _run_paper_step3(state: KGState, on_progress: ProgressCallback) -> dict:
    """Paper Step 3: enrich + extract_sections + extract_skeleton 并行。"""
    await on_progress("enriching", 3, PAPER_TOTAL_STEPS)
    concepts = state.get("concepts", [])
    raw_text = state.get("plain_text", "")
    lang_instruction = state.get("lang_instruction", "")

    # 三个 LLM 任务并行（都只依赖 concepts + raw_text，互不依赖）
    enriched, sections, skeleton = await asyncio.gather(
        enrich_concepts(concepts, raw_text, lang_instruction),
        extract_sections(raw_text, concepts, lang_instruction),
        extract_argument_skeleton(raw_text, concepts, lang_instruction),
    )
    return {
        "concepts": enriched,
        "sections": sections,
        "skeleton": skeleton,
        "current_step": 3,
    }


async def run_paper_pipeline(
    initial_state: KGState,
    on_progress: ProgressCallback,
) -> dict[str, Any]:
    """运行 paper 管线（对应 ingest-paper.ts 的 ingestPaper）。

    返回最终的 ConceptGraph dict：
      {id, title, type, rawText, concepts, edges, clusters, createdAt, sections?, skeleton?}
    """
    raw_text = initial_state.get("raw_text", "")
    resolved_title = initial_state.get("title") or "Untitled"

    # Step 1
    step1_result = await _run_paper_step1(initial_state, on_progress)
    state = {**initial_state, **step1_result}

    # Step 2
    step2_result = await _run_paper_step2(state, on_progress)
    state = {**state, **step2_result}

    # Step 3
    step3_result = await _run_paper_step3(state, on_progress)
    state = {**state, **step3_result}

    # 组装最终 ConceptGraph
    result: dict[str, Any] = {
        "id": hash_input(raw_text + resolved_title),
        "title": resolved_title,
        "type": "paper",
        "rawText": raw_text,
        "concepts": state.get("concepts", []),
        "edges": state.get("edges", []),
        "clusters": [],  # paper 管线不生成 cluster
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    sections = state.get("sections", [])
    if sections:
        result["sections"] = sections
    skeleton = state.get("skeleton", {})
    if skeleton.get("nodes"):
        result["skeleton"] = skeleton
    return result


async def run_code_pipeline(
    initial_state: KGState,
    on_progress: ProgressCallback,
) -> dict[str, Any]:
    """运行 code 管线（对应 ingest-code.ts 的 ingestCode）。

    5 步串行：
      1. extract_code_concepts
      2. resolve_entities
      3. build_edges（含 split_code_into_sentences）
      4. detect_communities + name_clusters
      5. enrich_concepts
    """
    raw_text = initial_state.get("raw_text", "")
    resolved_title = initial_state.get("title") or "Untitled"
    lang_instruction = initial_state.get("lang_instruction", "")
    state = dict(initial_state)

    # Step 1: 抽取代码概念
    await on_progress("extracting-concepts", 1, CODE_TOTAL_STEPS)
    step1 = await extract_code_concepts(state)
    state.update(step1)

    # Step 2: 实体归并
    await on_progress("resolving-entities", 2, CODE_TOTAL_STEPS)
    from app.graph.nodes.resolve_entities import resolve_entities_node
    step2 = await resolve_entities_node(state)
    state.update(step2)

    # Step 3: 构建边 + PageRank
    await on_progress("building-edges", 3, CODE_TOTAL_STEPS)
    sentences = _split_code_into_sentences(state.get("plain_text", ""))
    state["sentences"] = sentences
    from app.graph.nodes.build_edges import build_edges_node
    step3 = await build_edges_node(state)
    state.update(step3)
    from app.graph.nodes.pagerank import calculate_importance_node
    step3b = await calculate_importance_node(state)
    state.update(step3b)

    # Step 4: 社区检测 + 命名
    await on_progress("detecting-communities", 4, CODE_TOTAL_STEPS)
    step4 = await detect_and_name_clusters_node(state)
    state.update(step4)

    # Step 5: enrich
    await on_progress("enriching-concepts", 5, CODE_TOTAL_STEPS)
    enriched = await enrich_concepts(
        state.get("concepts", []),
        state.get("plain_text", ""),
        lang_instruction,
    )
    state["concepts"] = enriched
    state["current_step"] = 5

    # 组装最终 ConceptGraph
    result: dict[str, Any] = {
        "id": hash_input(raw_text + resolved_title),
        "title": resolved_title,
        "type": "code",
        "rawText": raw_text,
        "concepts": state.get("concepts", []),
        "edges": state.get("edges", []),
        "clusters": state.get("clusters", []),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    return result
