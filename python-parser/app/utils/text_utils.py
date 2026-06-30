"""
文本/概念图工具函数，对应 src/utils/concept-graph-utils.ts。

关键：JS 32 位整数哈希算法（hash_input / generate_concept_id）必须与
TS 版本逐位一致，否则跨端生成的 concept id 不匹配会导致前端渲染错乱。
Python 整数无限精度，需用 _to_int32 模拟 JS 位运算的 32 位截断。
"""
import re
from typing import Any


def _to_int32(n: int) -> int:
    """模拟 JS 位运算的 32 位有符号整数截断。

    JS 的 `<<`、`|`、`&` 等位运算符将操作数转换为 int32，
    并返回 int32。Python 整数无限精度，需手动截断。

    算法：取低 32 位，若 >= 2^31 则减 2^32 转为负数。
    """
    n = n & 0xFFFFFFFF
    if n >= 0x80000000:
        n -= 0x100000000
    return n


def _js_string_hash(s: str) -> int:
    """JS 的字符串哈希算法（对应 TS 中的 hash 循环体）。

    for (let i = 0; i < label.length; i++) {
        const char = label.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }

    注意：JS charCodeAt 返回 UTF-16 code unit，Python ord 返回 Unicode codepoint。
    对于 BMP 字符（含常见中英文）两者一致；辅助平面字符（emoji 等）有差异，
    但概念标签几乎不会包含这类字符，可接受。
    """
    h = 0
    for ch in s:
        char = ord(ch)
        # JS: hash << 5 （int32 截断）
        shifted = _to_int32(h << 5)
        # JS: (hash << 5) - hash + char （算术运算，可能超 32 位）
        # JS: hash |= 0 （转回 int32）
        h = _to_int32(shifted - h + char)
    return h


def _to_base36(n: int) -> str:
    """非负整数转 base-36 字符串（小写 0-9a-z），对应 JS Number.toString(36)。"""
    if n == 0:
        return "0"
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    result = ""
    while n > 0:
        n, r = divmod(n, 36)
        result = chars[r] + result
    return result


def hash_input(input_str: str) -> str:
    """从字符串构建简单哈希，用于缓存 key。对应 hashInput。"""
    h = _js_string_hash(input_str)
    return _to_base36(abs(h))


def generate_concept_id(label: str) -> str:
    """从标签生成规范 slug。对应 generateConceptId。

    英文：lowercase + 连字符；
    非 ASCII（中文等）：用哈希生成 concept-{hash}。
    """
    normalized = re.sub(r'[^a-z0-9]+', '-', label.lower()).strip('-')
    if normalized:
        return normalized
    # 非 ASCII 标签：哈希
    h = _js_string_hash(label)
    return f"concept-{_to_base36(abs(h))}"


def truncate(text: str, max_len: int) -> str:
    """截断文本到最大长度，超长加省略号。对应 truncate。"""
    if len(text) <= max_len:
        return text
    return text[:max_len - 3] + "..."


def normalize_weights(edges: list[dict]) -> list[dict]:
    """min-max 归一化边权重到 1-10 范围。对应 normalizeWeights。"""
    if not edges:
        return edges
    weights = [e.get("weight", 0) for e in edges]
    mn = min(weights)
    mx = max(weights)
    rng = mx - mn or 1
    result = []
    for e in edges:
        w = round((1 + ((e.get("weight", 0) - mn) / rng) * 9) * 10) / 10
        result.append({**e, "weight": w})
    return result


def count_by_type(concepts: list[dict]) -> dict[str, int]:
    """按类型统计概念数。对应 countByType。"""
    counts: dict[str, int] = {}
    for c in concepts:
        t = c.get("type", "")
        counts[t] = counts.get(t, 0) + 1
    return counts


def get_top_concepts(concepts: list[dict], n: int) -> list[dict]:
    """按 importance 降序取前 N 个概念。对应 getTopConcepts。"""
    return sorted(concepts, key=lambda c: c.get("importance", 0), reverse=True)[:n]


def get_top_edges(edges: list[dict], n: int) -> list[dict]:
    """按 weight 降序取前 N 条边。对应 getTopEdges。"""
    return sorted(edges, key=lambda e: e.get("weight", 0), reverse=True)[:n]


def validate_concept_graph(graph: Any) -> bool:
    """校验 ConceptGraph 结构。对应 validateConceptGraph。"""
    if not graph or not isinstance(graph, dict):
        return False
    return (
        isinstance(graph.get("concepts"), list)
        and isinstance(graph.get("edges"), list)
        and isinstance(graph.get("clusters"), list)
        and isinstance(graph.get("title"), str)
        and graph.get("type") in ("paper", "code")
    )


def build_graph_summary(
    graph: dict,
    max_concepts: int = 50,
    max_edges: int = 100,
) -> str:
    """构建图谱文本摘要供 LLM 上下文用。对应 buildGraphSummary。"""
    top_concepts = get_top_concepts(graph.get("concepts", []), max_concepts)
    top_edges = get_top_edges(graph.get("edges", []), max_edges)

    cluster_summary = "\n".join(
        f"- {c.get('label', '')}{': ' + c['description'] if c.get('description') else ''}"
        for c in graph.get("clusters", [])
    )

    concept_summary = "\n".join(
        f"- {c.get('label', '')} ({c.get('type', '')})"
        f"{' — ' + c['description'] if c.get('description') else ''}"
        for c in top_concepts
    )

    # 构建 label → concept 映射用于边摘要
    label_map = {c.get("id"): c.get("label", c.get("id", "")) for c in graph.get("concepts", [])}

    edge_lines = []
    for e in top_edges:
        s = label_map.get(e.get("source"), e.get("source", ""))
        t = label_map.get(e.get("target"), e.get("target", ""))
        edge_lines.append(f"- {s} --[{e.get('type', '')}]--> {t}")
    edge_summary = "\n".join(edge_lines)

    return f"""Title: {graph.get('title', '')}

Clusters:
{cluster_summary}

Key Concepts:
{concept_summary}

Key Relationships:
{edge_summary}"""
