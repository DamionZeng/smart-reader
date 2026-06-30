"""
SQLAlchemy ORM 模型，映射现有 PostgreSQL 表。

与 Next.js 的 Drizzle ORM 共用同一套表结构，Python 服务只读写已有表，
不创建新表。使用 `extend_existing=True` 避免与 Drizzle 的 schema 定义冲突。

列名使用 Drizzle 的 snake_case 映射（如 raw_text → rawText），
Python 侧属性名保持与 DB 列名一致（snake_case）。
"""
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """声明式基类。所有 ORM 模型继承自此。"""
    pass


class Document(Base):
    """documents 表 — 项目主表。

    Python 服务在解析阶段创建此行（status='parsing'），
    KG 管线完成后更新 status='ready'。
    """

    __tablename__ = "documents"
    __table_args__ = {"extend_existing": True}

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False, server_default="paper")
    original_url: Mapped[Optional[str]] = mapped_column(Text)
    # === Source tracking ===
    source_url: Mapped[Optional[str]] = mapped_column(Text)
    source_type: Mapped[Optional[str]] = mapped_column(String(20))
    source_key: Mapped[Optional[str]] = mapped_column(String(255))
    # === Paper metadata ===
    authors: Mapped[Optional[str]] = mapped_column(Text)  # JSON array string
    year: Mapped[Optional[int]] = mapped_column(Integer)
    venue: Mapped[Optional[str]] = mapped_column(String(255))
    doi: Mapped[Optional[str]] = mapped_column(String(255))
    abstract: Mapped[Optional[str]] = mapped_column(Text)
    raw_text: Mapped[Optional[str]] = mapped_column(Text)
    nodes: Mapped[Any] = mapped_column(JSONB, nullable=False)
    edges: Mapped[Any] = mapped_column(JSONB, nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    share_id: Mapped[Optional[str]] = mapped_column(String(36))
    # === Parse status ===
    # 'parsing' | 'ready' | 'failed' — default 'ready' for legacy rows.
    # Python service sets 'parsing' on creation, flips to 'ready'/'failed' on completion.
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="ready")


class ConceptGraphJob(Base):
    """concept_graph_jobs 表 — 异步 KG 管线 job 跟踪。

    Python 服务创建 job 行后立即返回 jobId，后台任务更新 progress/status。
    前端轮询 GET /jobs/{id} 读取此行。
    """

    __tablename__ = "concept_graph_jobs"
    __table_args__ = {"extend_existing": True}

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="processing")
    # progress: { step: string, current: number, total: number }
    progress: Mapped[Any] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    graph_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False))
    project_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False))
    error: Mapped[Optional[str]] = mapped_column(Text)
    input_type: Mapped[str] = mapped_column(String(20), nullable=False)
    input_url: Mapped[Optional[str]] = mapped_column(Text)
    input_file_name: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))


class ConceptGraph(Base):
    """concept_graphs 表 — KG 管线最终产物。

    Python 服务在 KG 管线完成后插入此行，前端通过 /api/concept-graph/[id] 读取。
    """

    __tablename__ = "concept_graphs"
    __table_args__ = {"extend_existing": True}

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    document_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    concepts: Mapped[Any] = mapped_column(JSONB, nullable=False)
    edges: Mapped[Any] = mapped_column(JSONB, nullable=False)
    clusters: Mapped[Any] = mapped_column(JSONB, nullable=False)
    raw_text: Mapped[Optional[str]] = mapped_column(Text)
    sections: Mapped[Optional[Any]] = mapped_column(JSONB)
    skeleton: Mapped[Optional[Any]] = mapped_column(JSONB)
    authors: Mapped[Optional[str]] = mapped_column(Text)
    year: Mapped[Optional[int]] = mapped_column(Integer)
    venue: Mapped[Optional[str]] = mapped_column(String(255))
    doi: Mapped[Optional[str]] = mapped_column(String(255))
    abstract: Mapped[Optional[str]] = mapped_column(Text)
    user_id: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    share_id: Mapped[Optional[str]] = mapped_column(String(36))


class UserSettings(Base):
    """user_settings 表 — 用户偏好（AI 输出语言）。

    Python 服务在 code 管线中查询此表获取用户的 AI 输出语言偏好。
    """

    __tablename__ = "user_settings"
    __table_args__ = {"extend_existing": True}

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(String(10), nullable=False, server_default="en")
    ai_output_language: Mapped[str] = mapped_column(String(20), nullable=False, server_default="en")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))


class DocumentAsset(Base):
    """document_assets 表 — 源文件资源（PDF 等）。

    Python 服务在 arxiv URL 解析时存储原始 PDF 供 OriginalTextPanel 精确定位。
    """

    __tablename__ = "document_assets"
    __table_args__ = {"extend_existing": True}

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    document_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)  # 'pdf' | 'image-bundle' | ...
    storage_url: Mapped[str] = mapped_column(Text, nullable=False)  # R2 object key
    size: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    mime: Mapped[Optional[str]] = mapped_column(String(100))
    meta: Mapped[Any] = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("now()"))
