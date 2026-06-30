"""
POST /kg/ingest — 仅启动 KG 管线（对应 Next.js /api/concept-graph/ingest）。

请求格式：multipart/form-data
  - type:       str           — "paper" | "code"（必填）
  - projectId?: str           — 已有项目 id
  - url?:       str           — 在线文档 URL
  - file?:      UploadFile    — 上传文件

三种输入模式：
  1. 仅 projectId：从 documents 表读 rawText → 启动 KG
  2. url/file + projectId：先解析更新 documents → 启动 KG
  3. url/file 无 projectId：走完整 /parse 流程

响应：KgIngestResponse `{ jobId }`
"""
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Header, UploadFile

from app.schemas import ErrorResponse, KgIngestResponse
from app.services.ingest_service import start_kg_job

router = APIRouter()


@router.post(
    "/kg/ingest",
    response_model=KgIngestResponse,
    responses={
        400: {"model": ErrorResponse},
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
    summary="Start KG pipeline only (project must exist or be created via /parse)",
)
async def kg_ingest(
    background_tasks: BackgroundTasks,
    user_id: str = Form(..., alias="userId"),
    type: str = Form(...),
    project_id: Optional[str] = Form(default=None, alias="projectId"),
    url: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    accept_language: Optional[str] = Header(default=None, alias="Accept-Language"),
):
    """启动 KG 管线，返回 job id 供前端轮询。

    与 /parse 的区别：/parse 是"解析 + 启动 KG"一站式（用于新导入）；
    /kg/ingest 是"仅启动 KG"（用于重新生成已有项目的图谱，或前端单独触发 KG）。
    """
    file_bytes = await file.read() if file else None
    return await start_kg_job(
        project_id=project_id,
        url=url,
        file_bytes=file_bytes,
        file_name=file.filename if file else None,
        file_mime=file.content_type if file else None,
        doc_type=type,
        user_id=user_id,
        accept_language=accept_language,
        background_tasks=background_tasks,
    )
