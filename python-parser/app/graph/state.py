"""
langgraph 状态定义。

KGState 是 paper / code 两条管线共享的状态对象。
所有节点函数接收 KGState，返回部分更新 dict。
"""
from typing import Any, Literal, TypedDict


class KGState(TypedDict, total=False):
    """langgraph 工作流状态。

    `total=False` 让所有字段可选（langgraph 初始化时只需传入部分字段）。
    节点函数返回 dict，langgraph 自动 merge 到 state。
    """
    # === 输入 ===
    raw_text: str                    # 原始文本（HTML 或纯文本），存入 DB rawText
    plain_text: str                  # stripHtml 后的纯文本，供 LLM 处理
    title: str
    type: Literal["paper", "code"]
    lang_instruction: str
    job_id: str
    user_id: str
    document_id: str | None

    # === 管线中间产物 ===
    sentences: list[dict[str, Any]]       # Sentence[]
    raw_concepts: list[dict[str, Any]]    # RawConcept[]
    concepts: list[dict[str, Any]]        # Concept[]（resolve 后，含 importance）
    edges: list[dict[str, Any]]           # ConceptEdge[]
    clusters: list[dict[str, Any]]        # ConceptCluster[]
    sections: list[dict[str, Any]]        # DocumentSection[]
    skeleton: dict[str, Any]              # ArgumentSkeleton {nodes, links, mainClaimId?}

    # === 进度 ===
    current_step: int
    total_steps: int


# Paper 管线总步数（对应 ingest-paper.ts 的 TOTAL_STEPS）
PAPER_TOTAL_STEPS = 3

# Code 管线总步数（对应 ingest-code.ts 的 TOTAL_STEPS）
CODE_TOTAL_STEPS = 5
