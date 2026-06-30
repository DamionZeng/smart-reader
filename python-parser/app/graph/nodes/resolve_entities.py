"""
实体归并节点（对应 src/lib/graph/entity-resolve.ts）。

将 LLM 抽取的 RawConcept[] 归并为 Concept[]：
  - 同名/别名归并
  - 生成 concept id（与 TS 跨端一致）
  - 统计全文频率
"""
import re
import unicodedata
from typing import Any

from app.graph.state import KGState
from app.utils.text_utils import generate_concept_id

VALID_PAPER_TYPES = {"method", "model", "metric", "dataset", "term", "tool", "task"}
VALID_CODE_TYPES = {"function", "class", "module", "interface", "variable"}


def _normalize(s: str) -> str:
    """归一化字符串（对应 entity-resolve.ts 的 normalize）。

    lowercase + 非 letter/number 转空格 + trim。
    用 \w 替代 \p{L}\p{N}（Python re 默认 Unicode-aware）。
    """
    lower = s.lower()
    # \W 匹配非单词字符（Unicode-aware），等价于 TS 的 [^\p{L}\p{N}]+
    cleaned = re.sub(r"\W+", " ", lower, flags=re.UNICODE)
    return cleaned.strip()


def _normalize_type(ctype: str) -> str:
    """归一化类型（对应 entity-resolve.ts 的 normalizeType）。"""
    lower = ctype.lower().strip()
    if lower in VALID_PAPER_TYPES or lower in VALID_CODE_TYPES:
        return lower
    return "term"


def resolve_entities(raw_concepts: list[dict[str, Any]], raw_text: str | None = None) -> list[dict[str, Any]]:
    """归并实体（对应 entity-resolve.ts 的 resolveEntities）。

    返回 Concept[] dict 列表，字段与 TS 版本一致：
      {id, label, type, aliases, frequency, importance, clusterId, anchors}
    """
    groups: dict[str, dict[str, Any]] = {}

    for raw in raw_concepts:
        label = raw.get("label", "")
        norm_label = _normalize(label)
        if not norm_label:
            continue

        key = generate_concept_id(label)
        group = groups.get(key)

        # 如果按 key 没找到，尝试用别名匹配已有组
        if group is None:
            for existing_key, existing_group in list(groups.items()):
                all_names = [_normalize(existing_group["label"])] + [_normalize(a) for a in existing_group["aliases"]]
                raw_names = [norm_label] + [_normalize(a) for a in raw.get("aliases", [])]
                if any(n in all_names for n in raw_names):
                    group = existing_group
                    # 不删除再插入（TS 版本删除 key 重新 set existingKey，这里保持 existing_key）
                    break

        if group is None:
            group = {
                "label": label,
                "type": _normalize_type(raw.get("type", "term")),
                "aliases": set(),
                "evidence": [],
            }
            groups[key] = group

        # 合并 aliases
        for alias in raw.get("aliases", []):
            norm_alias = _normalize(alias)
            if norm_alias and norm_alias != norm_label:
                group["aliases"].add(alias.strip())

        # 合并 evidence
        if raw.get("evidence"):
            group["evidence"].append(raw["evidence"])

        # 类型升级：term → 具体
        new_type = _normalize_type(raw.get("type", "term"))
        if group["type"] == "term" and new_type != "term":
            group["type"] = new_type

    # 构建最终 concepts 列表
    concepts: list[dict[str, Any]] = []
    full_text_lower = raw_text.lower() if raw_text else ""
    for key, group in groups.items():
        label_lower = _normalize(group["label"])
        alias_lowers = [_normalize(a) for a in group["aliases"]]

        # 频率统计：优先全文，降级到 evidence
        frequency = 0
        search_target = full_text_lower or " ".join(group["evidence"]).lower()
        for name in [label_lower] + alias_lowers:
            if not name:
                continue
            idx = 0
            while True:
                idx = search_target.find(name, idx)
                if idx == -1:
                    break
                frequency += 1
                idx += len(name)
        frequency = max(frequency, 1)

        concepts.append({
            "id": key,
            "label": group["label"],
            "type": group["type"],
            "aliases": list(group["aliases"]),
            "frequency": frequency,
            "importance": 0,
            "clusterId": "",
            "anchors": [],
        })

    return concepts


async def resolve_entities_node(state: KGState) -> dict:
    """langgraph 节点：归并实体。"""
    concepts = resolve_entities(state.get("raw_concepts", []), state.get("plain_text", ""))
    return {"concepts": concepts, "current_step": 2}
