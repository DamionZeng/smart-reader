"""
GET  /jobs/{id}        — 查询 job 状态（轮询用）
POST /jobs/{id}/cancel — 取消正在运行的 job

对应 Next.js 的：
  - /api/concept-graph/jobs/[jobId]/route.ts
  - /api/concept-graph/jobs/[jobId]/cancel/route.ts

响应契约与 Next.js 完全一致，前端 useIngestionFlow.ts 无需改动。
"""
import json
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Path, status
from sqlalchemy import select, text

from app.db import get_db_session
from app.models import ConceptGraphJob
from app.schemas import CancelJobResponse, ErrorResponse, JobStatusResponse

router = APIRouter()


def _normalize_progress(raw: Any) -> Optional[dict]:
    """jsonb 字段在 asyncpg 下默认反序列化为 dict；
    若驱动配置变化导致返回 str，则手动 json.loads。
    """
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return None
    return None


@router.get(
    "/jobs/{job_id}",
    response_model=JobStatusResponse,
    responses={
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
    summary="Poll job status",
)
async def get_job(
    job_id: str = Path(...),
):
    """查询 job 状态。

    只允许 job owner 查询（X-User-Id 必须匹配 job.user_id）。
    返回字段与 Next.js 完全一致：
      - status: "processing" | "done" | "failed" | "cancelled"
      - progress: { step, current, total }
      - graphId?: 仅 status=done 时有
      - projectId?: job 关联的 document id
      - error?: 仅 status=failed 时有
    """
    async with get_db_session() as session:
        result = await session.execute(
            select(
                ConceptGraphJob.id,
                ConceptGraphJob.status,
                ConceptGraphJob.progress,
                ConceptGraphJob.graph_id,
                ConceptGraphJob.project_id,
                ConceptGraphJob.error,
            ).where(
                ConceptGraphJob.id == job_id
            ).limit(1)
        )
        row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    progress = _normalize_progress(row[2])
    resp: dict = {
        "id": row[0],
        "status": row[1],
        "progress": progress,
    }
    # 仅在存在时附加可选字段（与 Next.js 的 `...(row.graphId ? { graphId } : {})` 对齐）
    if row[3]:
        resp["graphId"] = row[3]
    if row[4]:
        resp["projectId"] = row[4]
    if row[5]:
        resp["error"] = row[5]
    return resp


@router.post(
    "/jobs/{job_id}/cancel",
    response_model=CancelJobResponse,
    responses={
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
    summary="Cancel a running KG pipeline job",
)
async def cancel_job(
    job_id: str = Path(...),
):
    """标记 job 为 'cancelled'。

    与 Next.js 对齐：只在 `status='processing'` 时翻成 `'cancelled'`，
    其余终态（done/failed/cancelled）保留——保证幂等。

    后台 `run_full_pipeline` 在下一个 onProgress 边界检测到 'cancelled'
    后静默退出（不写 failed 状态、不写 error 字段）。
    """
    async with get_db_session() as session:
        await session.execute(
            text(
                "UPDATE concept_graph_jobs "
                "SET status = 'cancelled', updated_at = now() "
                "WHERE id = :jid AND status = 'processing'"
            ),
            {"jid": job_id},
        )
    return {"ok": True}
