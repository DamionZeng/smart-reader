"""
PageRank 重要度计算节点（对应 src/lib/graph/pagerank.ts）。

用 networkx.pagerank 替代 graphology，归一化逻辑与 TS 版本一致。
"""
from typing import Any

import networkx as nx

from app.graph.state import KGState


def calculate_importance(
    concepts: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """计算概念重要度（对应 pagerank.ts 的 calculateImportance）。

    importance = 0.7 * prNorm + 0.3 * freqNorm
    """
    if not concepts:
        return concepts

    # 构建无向图
    graph = nx.Graph()
    for concept in concepts:
        cid = concept.get("id", "")
        if cid and not graph.has_node(cid):
            graph.add_node(cid)
    for edge in edges:
        source = edge.get("source", "")
        target = edge.get("target", "")
        if source == target:
            continue
        if not graph.has_node(source) or not graph.has_node(target):
            continue
        weight = edge.get("weight", 1)
        if graph.has_edge(source, target):
            graph[source][target]["weight"] += weight
        else:
            graph.add_edge(source, target, weight=weight)

    # PageRank（damping=0.85）。某些图结构在有限迭代内不收敛，
    # 捕获 PowerIterationFailedConvergence 后用均匀分布兜底——
    # importance 计算仍可由 frequency 分量提供区分度。
    if graph.number_of_edges() > 0:
        try:
            pagerank = nx.pagerank(graph, alpha=0.85, max_iter=100, weight="weight", tol=1e-6)
        except (nx.PowerIterationFailedConvergence, Exception):
            pagerank = {n: 1.0 / graph.number_of_nodes() for n in graph}
    else:
        pagerank = {n: 1.0 / len(graph) for n in graph} if graph.number_of_nodes() > 0 else {}

    # 归一化 PageRank
    pr_values = list(pagerank.values())
    pr_max = max(pr_values) if pr_values else 0
    pr_min = min(pr_values) if pr_values else 0
    pr_range = pr_max - pr_min or 1

    # 归一化频率
    freq_values = [c.get("frequency", 0) for c in concepts]
    freq_max = max(freq_values) if freq_values else 1
    freq_min = min(freq_values) if freq_values else 0
    freq_range = freq_max - freq_min or 1

    result: list[dict[str, Any]] = []
    for concept in concepts:
        cid = concept.get("id", "")
        pr = pagerank.get(cid, 0)
        pr_norm = (pr - pr_min) / pr_range
        freq_norm = (concept.get("frequency", 0) - freq_min) / freq_range
        importance = 0.7 * pr_norm + 0.3 * freq_norm
        # round to 3 decimals（对应 TS 的 Math.round(importance * 1000) / 1000）
        result.append({**concept, "importance": round(importance, 3)})
    return result


async def calculate_importance_node(state: KGState) -> dict:
    """langgraph 节点：计算重要度。"""
    concepts = calculate_importance(state.get("concepts", []), state.get("edges", []))
    return {"concepts": concepts}
