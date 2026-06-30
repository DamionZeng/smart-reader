"""
POST /parse — 文档解析 + 项目创建 + 启动 KG 管线（合并 Next.js /api/ingest + /api/concept-graph/ingest）。

请求格式：multipart/form-data
  - url?:     str           — 在线文档 URL（arxiv/pdf/web）
  - file?:    UploadFile    — 上传文件（PDF/DOCX/txt/code）
  - projectId?: str         — 已有项目 id（更新而非新建）
  - type:     str           — "paper" | "code"

Header:
  - X-Parser-Secret: str    — 共享密钥（必填）
  - X-User-Id: str          — 用户 id（Next.js 转发时注入）
  - Accept-Language?: str   — 浏览器语言偏好

响应：ParseResponse（与 Next.js /api/ingest 完全一致）
"""
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Header, UploadFile

from app.schemas import ErrorResponse, ParseResponse
from app.services.ingest_service import start_parse_job

router = APIRouter()


@router.post(
    "/parse",
    response_model=ParseResponse,
    responses={
        400: {"model": ErrorResponse},
        401: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
    summary="Parse document + create project + start KG pipeline",
)
async def parse(
    background_tasks: BackgroundTasks,
    user_id: str = Form(..., alias="userId"),
    url: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    project_id: Optional[str] = Form(default=None, alias="projectId"),
    type: str = Form(...),
    accept_language: Optional[str] = Header(default=None, alias="Accept-Language"),
):
    """解析文档 → 创建/更新 documents 行 → 创建 job → 注册后台 KG 任务 → 立即返回。

    对应 Next.js 的 POST /api/ingest + POST /api/concept-graph/ingest 合并流程。
    前端调用此端点后立即拿到 `{id, title, rawText}`，KG 管线在后台异步执行，
    通过 GET /jobs/{id} 轮询进度。
    """
    file_bytes = await file.read() if file else None
    return await start_parse_job(
        url=url,
        file_bytes=file_bytes,
        file_name=file.filename if file else None,
        file_mime=file.content_type if file else None,
        project_id=project_id,
        doc_type=type,
        user_id=user_id,
        accept_language=accept_language,
        background_tasks=background_tasks,
    )
