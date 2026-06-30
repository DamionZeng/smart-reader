"""
Pydantic 请求/响应模型，对齐前端契约。

所有响应结构必须与 Next.js 现有路由返回的 JSON 形状完全一致，
这样 Next.js 转发层无需做任何字段转换，前端契约零变更。
"""
from typing import Optional

from pydantic import BaseModel


# ============================================================================
# Job 相关（前端 useIngestionFlow 轮询契约）
# ============================================================================

class JobProgress(BaseModel):
    """job.progress 字段结构。"""
    step: str = "queued"
    current: int = 0
    total: int = 5


class JobStatusResponse(BaseModel):
    """GET /jobs/{id} 响应。

    前端 useIngestionFlow.ts 直接读取这些字段：
      - job.status: "processing" | "done" | "failed" | "cancelled"
      - job.progress: { step, current, total }
      - job.graphId: 仅 status=done 时出现，用于 GET /api/concept-graph/{graphId}
      - job.projectId: 用于最终导航
      - job.error: 仅 status=failed 时出现
    """
    id: str
    status: str  # "processing" | "done" | "failed" | "cancelled"
    progress: JobProgress
    graphId: Optional[str] = None
    projectId: Optional[str] = None
    error: Optional[str] = None


class CancelJobResponse(BaseModel):
    """POST /jobs/{id}/cancel 响应。"""
    ok: bool = True


class KgIngestResponse(BaseModel):
    """POST /kg/ingest 响应。前端读取 { jobId }。"""
    jobId: str


# ============================================================================
# 解析相关（对齐 /api/ingest 响应）
# ============================================================================

class ExistingProject(BaseModel):
    """幂等命中时返回的已存在项目信息。

    前端 src/api/document.ts 读取 data.existing 判断是否已导入过。
    """
    id: str
    title: str
    type: str  # "paper" | "code"
    sourceType: Optional[str] = None
    sourceUrl: Optional[str] = None
    updatedAt: str  # ISO 时间戳字符串
    hasPdfAsset: bool = False


class ParseResponse(BaseModel):
    """POST /parse 响应。

    成功创建项目时：
      { id, title, rawText, thumbnail?, warnings? }
    幂等命中（URL 已导入过）时：
      { id: null, title, rawText: "", existing: {...} }

    前端 src/api/document.ts 的 parseDocument 函数读取这些字段。
    """
    id: Optional[str] = None
    title: str = ""
    rawText: str = ""
    thumbnail: Optional[str] = None
    existing: Optional[ExistingProject] = None
    warnings: Optional[list[str]] = None


# ============================================================================
# 错误响应
# ============================================================================

class ErrorResponse(BaseModel):
    """标准错误响应。"""
    error: str
