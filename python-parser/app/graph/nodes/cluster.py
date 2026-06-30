"""
社区检测 + 命名节点（仅 code 管线，对应 src/lib/graph/leiden.ts + cluster-name.ts）。

用 networkx.community.louvain_communities 替代 graphology-louvain。
调用 LLM 命名集群，失败时用 fallback（top-3 concept label 拼接）。
"""
import json
from typing import Any

import networkx as nx

from app.config import get_settings
from app.graph.state import KGState
from app.llm import get_llm

_settings = get_settings()

CLUSTER_SYSTEM_PROMPT = """You are an expert at naming concept clusters from an academic paper or code project.

You will receive a JSON object with multiple clusters, each containing its top concepts (sorted by importance).
For each cluster, provide:
- A concise 2-4 word label that captures the cluster's theme
- A 1 sentence description explaining what this cluster represents

Output ONLY a JSON object:
{
  "clusters": [
    { "id": "cluster-0", "label": "2-4 word title", "description": "1 sentence summary" }
  ]
}

Rules:
- The label should be descriptive and specific, not generic (e.g. "Attention Mechanisms" not "Neural Networks").
- The description should explain the common theme and why these concepts are grouped together.
- Use the same language as the concepts provided.
- If a cluster has only 1 concept, the label can be that concept's name."""


def detect_communities(
    concepts: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """社区检测（对应 leiden.ts 的 detectCommunities）。

    返回 ConceptCluster[] dict 列表：{id, label, description, conceptIds}
    """
    if not concepts:
        return []

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

    if graph.number_of_edges() == 0:
        return []

    # Louvain 社区检测（networkx 3.2+ 内置）
    try:
        communities = nx.community.louvain_communities(graph, weight="weight", seed=42)
    except Exception:
        # 降级：每个连通分量一个社区
        communities = list(nx.connected_components(graph))

    clusters: list[dict[str, Any]] = []
    for i, community in enumerate(communities):
        concept_ids = sorted(community)
        if not concept_ids:
            continue
        clusters.append({
            "id": f"cluster-{i}",
            "label": "",  # 待 LLM 命名
            "description": "",
            "conceptIds": concept_ids,
        })
    return clusters


def _fallback_name(cluster: dict[str, Any], concept_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """fallback 命名：top-3 concept label 用 ' / ' 拼接（对应 cluster-name.ts 的 fallbackName）。"""
    if cluster.get("label"):
        return cluster
    cluster_concepts = sorted(
        [concept_map[cid] for cid in cluster.get("conceptIds", []) if cid in concept_map],
        key=lambda c: c.get("importance", 0),
        reverse=True,
    )[:3]
    label = " / ".join(c.get("label", "") for c in cluster_concepts) or "Unnamed"
    return {**cluster, "label": label}


async def name_clusters(
    clusters: list[dict[str, Any]],
    concepts: list[dict[str, Any]],
    lang_instruction: str,
) -> list[dict[str, Any]]:
    """LLM 命名集群（对应 cluster-name.ts 的 nameClusters）。"""
    if not clusters:
        return clusters

    concept_map = {c.get("id", ""): c for c in concepts if c.get("id")}

    # 构建输入：每个 cluster 取 top-5 concept label
    input_data = {
        "clusters": [
            {
                "id": cl.get("id", ""),
                "concepts": [
                    c.get("label", "")
                    for c in sorted(
                        [concept_map[cid] for cid in cl.get("conceptIds", []) if cid in concept_map],
                        key=lambda c: c.get("importance", 0),
                        reverse=True,
                    )[:5]
                ],
            }
            for cl in clusters
        ]
    }

    try:
        client = get_llm()
        response = await client.chat.completions.create(
            model=_settings.agnes_model,
            messages=[
                {"role": "system", "content": CLUSTER_SYSTEM_PROMPT + lang_instruction},
                {"role": "user", "content": json.dumps(input_data, ensure_ascii=False)},
            ],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)
        named = parsed.get("clusters") if isinstance(parsed, dict) else None
        if not isinstance(named, list):
            return [_fallback_name(cl, concept_map) for cl in clusters]

        # 构建 id → {label, description} 映射
        name_map: dict[str, dict[str, str]] = {}
        for nc in named:
            if not isinstance(nc, dict):
                continue
            cid = nc.get("id")
            label = nc.get("label")
            if isinstance(cid, str) and isinstance(label, str) and label.strip():
                name_map[cid] = {"label": label.strip(), "description": nc.get("description", "").strip() if isinstance(nc.get("description"), str) else ""}

        result: list[dict[str, Any]] = []
        for cl in clusters:
            named_entry = name_map.get(cl.get("id", ""))
            if named_entry:
                result.append({**cl, "label": named_entry["label"], "description": named_entry["description"]})
            else:
                result.append(_fallback_name(cl, concept_map))
        return result
    except Exception as e:
        print(f"[cluster] LLM naming failed: {e}", flush=True)
        return [_fallback_name(cl, concept_map) for cl in clusters]


async def detect_and_name_clusters_node(state: KGState) -> dict:
    """langgraph 节点：检测 + 命名集群（仅 code 管线）。"""
    clusters = detect_communities(state.get("concepts", []), state.get("edges", []))
    named = await name_clusters(clusters, state.get("concepts", []), state.get("lang_instruction", ""))
    return {"clusters": named, "current_step": 4}
