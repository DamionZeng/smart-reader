"""
概念抽取节点（对应 src/lib/graph/concept-extract.ts + ingest-code.ts 的 extractCodeConcepts）。

paper 和 code 两个版本共用同一套 LLM 调用逻辑，仅 SYSTEM_PROMPT 和 MAX_INPUT_CHARS 不同。
"""
import json
from typing import Any

from app.config import get_settings
from app.graph.state import KGState
from app.llm import get_llm
from app.utils.text_utils import truncate

_settings = get_settings()

MAX_INPUT_CHARS_PAPER = 100_000
MAX_INPUT_CHARS_CODE = 50_000

PAPER_SYSTEM_PROMPT = """You are an expert technical concept extractor for academic papers.

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
- If the paper proposes a novel method, always include it as a concept with type "method"."""

CODE_SYSTEM_PROMPT = """You are an expert code concept extractor. Your goal is to extract the MOST IMPORTANT and MEANINGFUL concepts from the codebase — the architectural building blocks, key abstractions, and significant symbols that define the system's structure.

Output ONLY a JSON object of the form:
{ "concepts": [ { "label": "...", "type": "...", "aliases": [...], "evidence": "..." } ] }

Each concept object:
{
  "label": "canonical name, e.g. 'AuthService' or 'parseConfig()' or 'DatabasePool'",
  "type": "function | class | module | interface | variable",
  "aliases": ["alternative names, abbreviations"],
  "evidence": "a verbatim snippet from the code where this concept is defined or used"
}

Type definitions:
- function: a function or method (e.g. 'parseConfig()', 'AuthService.login()')
- class: a class definition (e.g. 'AuthService', 'DatabasePool')
- module: a module or file-level concept (e.g. 'auth/router', 'config/loader')
- interface: an interface or type definition (e.g. 'User', 'Config')
- variable: a significant constant or configuration variable (e.g. 'MAX_RETRIES', 'DEFAULT_PORT')

Rules:
- Extract 15-60 high-quality concepts. Focus on the architectural backbone, not every helper.
- Use canonical names from the code.
- Include the symbol's file path in the evidence when available.
- Skip trivial utilities (e.g. 'isNotEmpty()', 'toString()') unless they are central.
- Prefer higher-level concepts: 'Authentication System' is better than every individual function in it.
- Every concept MUST have a non-empty evidence snippet from the source code."""


def _parse_raw_concepts(content: str, default_type: str = "term") -> list[dict[str, Any]]:
    """解析 LLM 返回的 JSON，提取 RawConcept 列表。

    对应 concept-extract.ts 的 JSON.parse + filter + map 逻辑。
    """
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return []
    concepts = parsed.get("concepts") if isinstance(parsed, dict) else None
    if not isinstance(concepts, list):
        return []
    result: list[dict[str, Any]] = []
    for c in concepts:
        if not isinstance(c, dict):
            continue
        label = c.get("label")
        if not isinstance(label, str) or not label.strip():
            continue
        ctype = c.get("type")
        ctype = ctype.strip() if isinstance(ctype, str) and ctype.strip() else default_type
        aliases = c.get("aliases")
        if isinstance(aliases, list):
            aliases = [str(a).strip() for a in aliases if isinstance(a, str) and a.strip()]
        else:
            aliases = []
        evidence = c.get("evidence")
        evidence = evidence.strip() if isinstance(evidence, str) else ""
        result.append({"label": label.strip(), "type": ctype, "aliases": aliases, "evidence": evidence})
    return result


async def _extract_concepts(system_prompt: str, text: str, lang_instruction: str, max_chars: int, default_type: str) -> list[dict[str, Any]]:
    """通用概念抽取：调用 LLM，解析 JSON 返回 RawConcept[]。"""
    if not text or not text.strip():
        return []
    truncated = truncate(text, max_chars)
    try:
        client = get_llm()
        response = await client.chat.completions.create(
            model=_settings.agnes_model,
            messages=[
                {"role": "system", "content": system_prompt + lang_instruction},
                {"role": "user", "content": truncated},
            ],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or ""
        return _parse_raw_concepts(content, default_type)
    except Exception as e:
        print(f"[extract_concepts] LLM call failed: {e}", flush=True)
        return []


async def extract_paper_concepts(state: KGState) -> dict:
    """Paper 管线节点：抽取论文概念。"""
    raw_concepts = await _extract_concepts(
        PAPER_SYSTEM_PROMPT,
        state.get("plain_text", ""),
        state.get("lang_instruction", ""),
        MAX_INPUT_CHARS_PAPER,
        "term",
    )
    return {"raw_concepts": raw_concepts, "current_step": 1}


async def extract_code_concepts(state: KGState) -> dict:
    """Code 管线节点：抽取代码概念。"""
    raw_concepts = await _extract_concepts(
        CODE_SYSTEM_PROMPT,
        state.get("plain_text", ""),
        state.get("lang_instruction", ""),
        MAX_INPUT_CHARS_CODE,
        "variable",
    )
    return {"raw_concepts": raw_concepts, "current_step": 1}
