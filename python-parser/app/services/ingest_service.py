"""
核心编排服务：串联文档解析 + KG 管线 + DB 写入。

这是整个异步流程的大脑。对外暴露两个入口：
  - start_parse_job: 解析 + 创建项目 + 启动 KG（合并 Next.js 的 /api/ingest + /api/concept-graph/ingest）
  - start_kg_job: 仅对已有项目启动 KG（对应 /api/concept-graph/ingest 的 projectId 分支）

异步执行策略：
  使用 FastAPI BackgroundTasks（不用 Celery/Redis）。
  前台完成解析 + DB 写入后注册后台任务，立即返回。
  后台任务用 get_db_session() 独立获取 DB 连接。

取消机制：
  run_full_pipeline 在每个 onProgress 边界查询 job.status，
  若为 'cancelled' 则抛出 CANCEL_SENTINEL 静默退出。
"""
import json
import re
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy import and_, desc, select, text

from app.db import get_db_session
from app.llm import get_lang_instruction
from app.models import ConceptGraph, ConceptGraphJob, Document
from app.parsers.image_extractor import ParseResult
from app.parsers.pdf_parser import convert_pdf_to_html
from app.parsers.docx_parser import convert_docx_to_html, is_docx_buffer
from app.parsers.url_resolver import (
    ArxivMetadata,
    ArxivResolution,
    download_pdf_from_url,
    fetch_arxiv_metadata,
    is_arxiv_url,
    is_pdf_url,
    resolve_arxiv_url,
    resolve_github_url,
    resolve_paper_url,
    validate_fetch_url,
)
from app.schemas import (
    ExistingProject,
    KgIngestResponse,
    ParseResponse,
)
from app.utils.html_utils import is_html, safe_truncate_html, strip_html

# Sentinel error used to signal "user cancelled this job".
# Mirrors Next.js CANCEL_SENTINEL in concept-graph/ingest/route.ts.
CANCEL_SENTINEL = "PIPELINE_CANCELLED"

# Max stored HTML length for rawText (matches Next.js MAX_RAW_TEXT_LEN)
MAX_RAW_TEXT_LEN = 500_000

# Paper file extensions (matches Next.js PAPER_FILE_EXTENSIONS)
_PAPER_FILE_EXTENSIONS = [".md", ".markdown", ".txt", ".json", ".pdf", ".doc", ".docx"]
_CODE_FILE_EXTENSIONS = [
    ".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".rs",
    ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".swift", ".kt", ".scala",
    ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml",
]


# ============================================================================
# 工具函数
# ============================================================================

def _get_file_extension(name: str) -> str:
    i = name.rfind(".")
    return name[i:].lower() if i >= 0 else ""


def _is_paper_file(filename: str, mime: str = "") -> bool:
    ext = _get_file_extension(filename)
    if ext in _PAPER_FILE_EXTENSIONS:
        return True
    mt = mime.lower()
    return mt.startswith("text/") or mt in ("application/json", "application/pdf")


def _is_code_file(filename: str, mime: str = "") -> bool:
    ext = _get_file_extension(filename)
    if ext in _CODE_FILE_EXTENSIONS:
        return True
    mt = mime.lower()
    return mt.startswith("text/") or mt in ("application/json", "application/x-yaml")


def normalize_source_key(url: str) -> str:
    """规范化 URL 作为幂等 key。对应 src/lib/resolve-ingest.ts 的 normalizeSourceKey。

    小写化主机名 + 移除 fragment + 移除常见跟踪参数。
    """
    try:
        u = urlparse(url)
        # 保留 path + query，但移除 fragment
        path = u.path.rstrip("/")
        query = u.query
        # 移除常见跟踪参数
        if query:
            params = []
            for part in query.split("&"):
                if "=" in part:
                    k, _ = part.split("=", 1)
                    if k.lower() not in ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"):
                        params.append(part)
                else:
                    params.append(part)
            query = "&".join(params)
        return f"{u.scheme}://{u.hostname}{path}{('?' + query) if query else ''}"
    except Exception:
        return url


async def find_existing_by_source_key(
    user_id: str, source_key: str
) -> Optional[tuple[str, str, str, Optional[str], Optional[str], datetime, bool]]:
    """查询用户是否已导入过此 sourceKey。

    返回 (document_id, title, type, source_type, source_url, updated_at, has_pdf_asset) 或 None。
    """
    async with get_db_session() as session:
        result = await session.execute(
            select(
                Document.id,
                Document.title,
                Document.type,
                Document.source_type,
                Document.source_url,
                Document.updated_at,
            ).where(
                and_(
                    Document.user_id == user_id,
                    Document.source_key == source_key,
                )
            ).limit(1)
        )
        row = result.first()
        if not row:
            return None
        # Check for PDF asset
        from app.models import DocumentAsset
        asset_result = await session.execute(
            select(DocumentAsset.id).where(
                and_(
                    DocumentAsset.document_id == row[0],
                    DocumentAsset.kind == "pdf",
                )
            ).limit(1)
        )
        has_pdf = asset_result.first() is not None
        return (row[0], row[1], row[2], row[3], row[4], row[5], has_pdf)


def _derive_title(
    content: str,
    fallback_title: str,
    arxiv_meta: Optional[ArxivMetadata] = None,
    parse_title: Optional[str] = None,
) -> str:
    """从内容派生标题。简化版（不调 LLM）。

    优先级：
      1. arxiv 元数据标题
      2. PDF/DOCX 元数据标题（parse_title）
      3. fallback_title（文件名/URL hostname）
      4. "Untitled"

    注意：不再使用正文第一行作为标题——PDF/网页的第一行通常是
    页眉、版权声明或正文首句（如 "Provided proper attribution..."），
    不是真正的标题。
    """
    if arxiv_meta and arxiv_meta.title:
        return arxiv_meta.title[:255]

    if parse_title:
        return parse_title[:255]

    return fallback_title[:255] if fallback_title else "Untitled"


# ============================================================================
# Job 状态管理
# ============================================================================

async def check_cancelled(job_id: str) -> bool:
    """查询 job 是否已被取消。"""
    async with get_db_session() as session:
        result = await session.execute(
            select(ConceptGraphJob.status).where(ConceptGraphJob.id == job_id).limit(1)
        )
        row = result.first()
        return row is not None and row[0] == "cancelled"


async def update_progress(job_id: str, step: str, current: int, total: int) -> None:
    """串行写入 job.progress，避免竞态。

    同时检查取消状态——若已取消则抛出 CANCEL_SENTINEL 中断管线。
    """
    async with get_db_session() as session:
        # 检查取消
        result = await session.execute(
            select(ConceptGraphJob.status).where(ConceptGraphJob.id == job_id).limit(1)
        )
        row = result.first()
        if row and row[0] == "cancelled":
            raise Exception(CANCEL_SENTINEL)
        # 更新进度
        await session.execute(
            text(
                "UPDATE concept_graph_jobs SET progress = :progress, updated_at = now() "
                "WHERE id = :jid"
            ),
            {"progress": json.dumps({"step": step, "current": current, "total": total}), "jid": job_id},
        )


async def cancel_job(job_id: str) -> None:
    """设置 job.status='cancelled'。后台任务在下一个 onProgress 边界退出。"""
    async with get_db_session() as session:
        await session.execute(
            text(
                "UPDATE concept_graph_jobs SET status = 'cancelled', updated_at = now() "
                "WHERE id = :jid"
            ),
            {"jid": job_id},
        )


# ============================================================================
# 后台管线
# ============================================================================

async def run_full_pipeline(
    job_id: str,
    document_id: str,
    doc_type: str,
    user_id: str,
    lang_instruction: str,
    raw_text: str,
    title: str,
) -> None:
    """后台任务：运行 KG 管线 + 写 concept_graphs + 更新 job/documents 状态。

    对应 Next.js 的 runPipeline 函数。
    """
    from app.graph.workflow import run_code_pipeline, run_paper_pipeline

    # 预检取消（处理 POST 返回与后台启动之间的竞态）
    if await check_cancelled(job_id):
        print(f"[ingest_service] job {job_id} cancelled before pipeline start", flush=True)
        return

    # raw_text 可能是结构化 HTML（PDF/DOCX 产物），KG 管线需要纯文本
    plain_text = strip_html(raw_text) if is_html(raw_text) else raw_text

    initial_state = {
        "raw_text": raw_text,
        "plain_text": plain_text,
        "title": title,
        "type": doc_type,
        "lang_instruction": lang_instruction,
        "job_id": job_id,
        "user_id": user_id,
        "document_id": document_id,
    }

    async def on_progress(step: str, current: int, total: int) -> None:
        """进度回调：检查取消 + 更新 DB。"""
        await update_progress(job_id, step, current, total)

    try:
        if doc_type == "code":
            result = await run_code_pipeline(initial_state, on_progress)
        else:
            result = await run_paper_pipeline(initial_state, on_progress)

        # 删除该 document 的旧 concept_graphs 行（避免重复）
        async with get_db_session() as session:
            await session.execute(
                text(
                    "DELETE FROM concept_graphs WHERE document_id = :did AND user_id = :uid"
                ),
                {"did": document_id, "uid": user_id},
            )

        # 插入新的 concept_graphs 行
        graph_values = {
            "title": (result.get("title") or title or "Untitled")[:255],
            "type": doc_type,
            "concepts": json.dumps(result.get("concepts", [])),
            "edges": json.dumps(result.get("edges", [])),
            "clusters": json.dumps(result.get("clusters", [])),
            "raw_text": raw_text[:100000],  # 存原始 HTML
            "user_id": user_id,
            "document_id": document_id,
        }
        # 可选字段
        if result.get("sections"):
            graph_values["sections"] = json.dumps(result["sections"])
        if result.get("skeleton") and result["skeleton"].get("nodes"):
            graph_values["skeleton"] = json.dumps(result["skeleton"])

        async with get_db_session() as session:
            insert_result = await session.execute(
                text(
                    "INSERT INTO concept_graphs "
                    "(title, type, concepts, edges, clusters, raw_text, user_id, document_id"
                    + (", sections" if "sections" in graph_values else "")
                    + (", skeleton" if "skeleton" in graph_values else "")
                    + ") VALUES "
                    "(:title, :type, CAST(:concepts AS jsonb), CAST(:edges AS jsonb), CAST(:clusters AS jsonb), "
                    ":raw_text, :user_id, :document_id"
                    + (", CAST(:sections AS jsonb)" if "sections" in graph_values else "")
                    + (", CAST(:skeleton AS jsonb)" if "skeleton" in graph_values else "")
                    + ") RETURNING id"
                ),
                graph_values,
            )
            graph_row = insert_result.first()
            graph_id = str(graph_row[0]) if graph_row else None

        # 更新 job 为 done
        async with get_db_session() as session:
            await session.execute(
                text(
                    "UPDATE concept_graph_jobs SET status = 'done', graph_id = :gid, "
                    "project_id = :did, updated_at = now() WHERE id = :jid"
                ),
                {"gid": graph_id, "did": document_id, "jid": job_id},
            )

        # 更新 documents 状态为 ready
        async with get_db_session() as session:
            await session.execute(
                text(
                    "UPDATE documents SET status = 'ready', updated_at = now() WHERE id = :did"
                ),
                {"did": document_id},
            )

        print(f"[ingest_service] job {job_id} done, graph_id={graph_id}", flush=True)

    except Exception as e:
        # 用户取消 — cancel 端点已设置 status='cancelled'，不覆盖
        if CANCEL_SENTINEL in str(e):
            print(f"[ingest_service] job {job_id} cancelled by user mid-pipeline", flush=True)
            # 取消不算成功,标记为 failed 让用户可以重新解析或删除
            async with get_db_session() as session:
                await session.execute(
                    text(
                        "UPDATE documents SET status = 'failed', updated_at = now() WHERE id = :did"
                    ),
                    {"did": document_id},
                )
            return

        # 真正的错误
        err_msg = str(e)[:1000]
        print(f"[ingest_service] job {job_id} failed: {err_msg}", flush=True)
        async with get_db_session() as session:
            await session.execute(
                text(
                    "UPDATE concept_graph_jobs SET status = 'failed', error = :err, "
                    "updated_at = now() WHERE id = :jid"
                ),
                {"err": err_msg, "jid": job_id},
            )
            # 更新 documents 状态为 failed
            await session.execute(
                text(
                    "UPDATE documents SET status = 'failed', updated_at = now() WHERE id = :did"
                ),
                {"did": document_id},
            )


# ============================================================================
# 文档解析
# ============================================================================

async def _fetch_url_content(
    url: str, doc_type: str, user_id: str
) -> tuple[str, Optional[str], Optional[str], Optional[str], Optional[ArxivMetadata], Optional[str]]:
    """从 URL 获取内容。

    返回 (raw_content, source_url, source_type, source_key, arxiv_meta, parse_title)。
    raw_content 可能是 HTML（PDF/DOCX）或纯文本。
    parse_title 是从 PDF/DOCX 元数据提取的标题（可能为 None）。
    """
    source_url = url
    source_type: Optional[str] = None
    source_key: Optional[str] = None
    arxiv_meta: Optional[ArxivMetadata] = None

    # arxiv 特殊处理
    if is_arxiv_url(url):
        try:
            resolution = resolve_arxiv_url(url)
            source_type = "arxiv"
            source_key = resolution.source_key
            # 抓取元数据
            arxiv_meta = await fetch_arxiv_metadata(resolution.arxiv_id)
            # 下载 PDF
            pdf_buffer, _ = await download_pdf_from_url(resolution.pdf_url, timeout_ms=60_000)
            parse_result = await convert_pdf_to_html(pdf_buffer, user_id)
            return parse_result.html, source_url, source_type, source_key, arxiv_meta, parse_result.title
        except Exception as e:
            print(f"[ingest_service] arxiv URL parse failed, falling back: {e}", flush=True)
            source_type = "pdf-url"
            source_key = normalize_source_key(url)

    elif is_pdf_url(url):
        source_type = "pdf-url"
        source_key = normalize_source_key(url)

    elif doc_type == "code":
        source_type = "github-repo"
        source_key = normalize_source_key(url)
    else:
        source_type = "web"
        source_key = normalize_source_key(url)

    # 解析 URL 到可 fetch 的地址
    fetch_url = url
    is_pdf_response = False
    if doc_type == "code":
        raw_url = resolve_github_url(url)
        if raw_url:
            fetch_url = raw_url
    else:
        resolved = resolve_paper_url(url)
        if resolved:
            fetch_url, is_pdf_response = resolved

    # SSRF 校验
    safe_url = validate_fetch_url(fetch_url)
    if not safe_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The provided URL is not allowed. Only public http(s) URLs are permitted.",
        )
    fetch_url = safe_url

    # 下载内容
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            res = await client.get(fetch_url, headers={"User-Agent": "Cosmos/1.0"})
            if res.status_code >= 400:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to fetch URL (status {res.status_code}).",
                )
            content_type = res.headers.get("content-type", "").lower()

            if is_pdf_response or "application/pdf" in content_type:
                # PDF → HTML
                if len(res.content) > 20 * 1024 * 1024:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="The response is too large to process.",
                    )
                parse_result = await convert_pdf_to_html(res.content, user_id)
                return parse_result.html, source_url, source_type, source_key, arxiv_meta, parse_result.title

            elif "application/vnd.openxmlformats-officedocument.wordprocessingml.document" in content_type or (
                "application/octet-stream" in content_type and url.lower().endswith(".docx")
            ):
                # DOCX → HTML
                if is_docx_buffer(res.content):
                    parse_result = await convert_docx_to_html(res.content, user_id)
                    return parse_result.html, source_url, source_type, source_key, arxiv_meta, parse_result.title

            # 纯文本/HTML
            raw_content = res.text
            return raw_content, source_url, source_type, source_key, arxiv_meta, None

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read content from URL: {e}",
        )


async def _parse_file(
    file_bytes: bytes, filename: str, mime: str, doc_type: str, user_id: str
) -> tuple[str, Optional[str]]:
    """解析上传文件，返回 (raw_content, parse_title)。

    parse_title 是从 PDF/DOCX 元数据提取的标题（可能为 None）。
    """
    ext = _get_file_extension(filename)

    # PDF
    if ext == ".pdf" or mime == "application/pdf":
        parse_result = await convert_pdf_to_html(file_bytes, user_id)
        return parse_result.html, parse_result.title

    # DOCX
    if ext == ".docx" or is_docx_buffer(file_bytes):
        parse_result = await convert_docx_to_html(file_bytes, user_id)
        return parse_result.html, parse_result.title

    # 纯文本/代码/markdown
    try:
        return file_bytes.decode("utf-8"), None
    except UnicodeDecodeError:
        return file_bytes.decode("latin-1", errors="replace"), None


# ============================================================================
# 公开入口
# ============================================================================

async def start_parse_job(
    url: Optional[str],
    file_bytes: Optional[bytes],
    file_name: Optional[str],
    file_mime: Optional[str],
    project_id: Optional[str],
    doc_type: str,
    user_id: str,
    accept_language: Optional[str],
    background_tasks: BackgroundTasks,
) -> ParseResponse:
    """同步入口：解析文档 → 创建/更新 documents 行 → 创建 job → 启动后台 KG → 立即返回。

    对应 Next.js 的 POST /api/ingest + POST /api/concept-graph/ingest 合并。
    """
    warnings: list[str] = []
    raw_content = ""
    source_url: Optional[str] = None
    source_type: Optional[str] = None
    source_key: Optional[str] = None
    arxiv_meta: Optional[ArxivMetadata] = None
    source_label: Optional[str] = None
    parse_title: Optional[str] = None

    # === 获取内容 ===
    if file_bytes:
        # 文件上传
        source_label = file_name
        source_type = "file"
        source_key = None  # 文件上传无幂等 key
        try:
            raw_content, parse_title = await _parse_file(file_bytes, file_name or "", file_mime or "", doc_type, user_id)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to parse the uploaded file: {e}",
            )
    elif url:
        # URL
        try:
            raw_content, source_url, source_type, source_key, arxiv_meta, parse_title = await _fetch_url_content(
                url, doc_type, user_id
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to fetch URL: {e}",
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide either a URL or a file.",
        )

    if not raw_content.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The document could not be parsed. No text content was extracted.",
        )

    # === 幂等检查（仅 URL 导入，无 projectId）===
    if not project_id and source_key:
        existing = await find_existing_by_source_key(user_id, source_key)
        if existing:
            doc_id, doc_title, doc_type_val, src_type, src_url, updated_at, has_pdf = existing
            return ParseResponse(
                id=None,
                title=doc_title,
                rawText="",
                existing=ExistingProject(
                    id=doc_id,
                    title=doc_title,
                    type=doc_type_val,
                    sourceType=src_type,
                    sourceUrl=src_url,
                    updatedAt=updated_at.isoformat() if isinstance(updated_at, datetime) else str(updated_at),
                    hasPdfAsset=has_pdf,
                ),
            )

    # === 派生标题 ===
    fallback_title = (
        source_label.replace(_get_file_extension(source_label), "").replace("_", " ").replace("-", " ").strip()
        if source_label
        else (urlparse(url).hostname.replace("www.", "") if url else "Untitled")
    )
    derived_title = _derive_title(raw_content, fallback_title, arxiv_meta, parse_title)

    # === 截断 raw_text ===
    raw_text_truncated = safe_truncate_html(raw_content, MAX_RAW_TEXT_LEN)

    # === arxiv 元数据 ===
    derived_authors = json.dumps(arxiv_meta.authors) if arxiv_meta and arxiv_meta.authors else None
    derived_year = arxiv_meta.year if arxiv_meta else None
    derived_abstract = arxiv_meta.abstract if arxiv_meta else None
    derived_doi = arxiv_meta.doi if arxiv_meta else None

    # === 获取语言指令 ===
    lang_instruction = await get_lang_instruction(doc_type, user_id, accept_language)

    # === 创建/更新 documents 行 + job 行 ===
    if project_id:
        # 更新已有项目
        async with get_db_session() as session:
            await session.execute(
                text(
                    "UPDATE documents SET nodes = '[]'::jsonb, edges = '[]'::jsonb, "
                    "original_url = :url, title = :title, raw_text = :raw, "
                    "source_url = :surl, source_type = :stype, source_key = :skey, "
                    "status = 'parsing', updated_at = now() "
                    + (", authors = :authors" if derived_authors else "")
                    + (", year = :year" if derived_year is not None else "")
                    + (", abstract = :abstract" if derived_abstract else "")
                    + (", doi = :doi" if derived_doi else "")
                    + " WHERE id = :did AND user_id = :uid"
                ),
                {
                    "url": url,
                    "title": derived_title,
                    "raw": raw_text_truncated,
                    "surl": source_url,
                    "stype": source_type,
                    "skey": source_key,
                    "did": project_id,
                    "uid": user_id,
                    **({"authors": derived_authors} if derived_authors else {}),
                    **({"year": derived_year} if derived_year is not None else {}),
                    **({"abstract": derived_abstract} if derived_abstract else {}),
                    **({"doi": derived_doi} if derived_doi else {}),
                },
            )
        document_id = project_id
    else:
        # 创建新项目
        async with get_db_session() as session:
            insert_result = await session.execute(
                text(
                    "INSERT INTO documents "
                    "(title, type, original_url, source_url, source_type, source_key, "
                    "raw_text, nodes, edges, user_id, status"
                    + (", authors" if derived_authors else "")
                    + (", year" if derived_year is not None else "")
                    + (", abstract" if derived_abstract else "")
                    + (", doi" if derived_doi else "")
                    + ") VALUES "
                    "(:title, :type, :url, :surl, :stype, :skey, "
                    ":raw, '[]'::jsonb, '[]'::jsonb, :uid, 'parsing'"
                    + (", :authors" if derived_authors else "")
                    + (", :year" if derived_year is not None else "")
                    + (", :abstract" if derived_abstract else "")
                    + (", :doi" if derived_doi else "")
                    + ") RETURNING id"
                ),
                {
                    "title": derived_title,
                    "type": doc_type,
                    "url": url,
                    "surl": source_url,
                    "stype": source_type,
                    "skey": source_key,
                    "raw": raw_text_truncated,
                    "uid": user_id,
                    **({"authors": derived_authors} if derived_authors else {}),
                    **({"year": derived_year} if derived_year is not None else {}),
                    **({"abstract": derived_abstract} if derived_abstract else {}),
                    **({"doi": derived_doi} if derived_doi else {}),
                },
            )
            row = insert_result.first()
            document_id = str(row[0]) if row else None

    if not document_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create the project.",
        )

    # === 创建 job 行 ===
    total_steps = 5 if doc_type == "code" else 3
    async with get_db_session() as session:
        job_result = await session.execute(
            text(
                "INSERT INTO concept_graph_jobs "
                "(user_id, status, progress, input_type, input_url, input_file_name, project_id) "
                "VALUES (:uid, 'processing', CAST(:progress AS jsonb), :itype, :iurl, :ifname, :pid) "
                "RETURNING id"
            ),
            {
                "uid": user_id,
                "progress": json.dumps({"step": "queued", "current": 0, "total": total_steps}),
                "itype": doc_type,
                "iurl": url,
                "ifname": source_label,
                "pid": document_id,
            },
        )
        job_row = job_result.first()
        job_id = str(job_row[0]) if job_row else None

    if not job_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create the parsing job.",
        )

    # === 注册后台任务 ===
    background_tasks.add_task(
        run_full_pipeline,
        job_id=job_id,
        document_id=document_id,
        doc_type=doc_type,
        user_id=user_id,
        lang_instruction=lang_instruction,
        raw_text=raw_text_truncated,
        title=derived_title,
    )

    return ParseResponse(
        id=document_id,
        title=derived_title,
        rawText=raw_text_truncated,
        warnings=warnings if warnings else None,
    )


async def start_kg_job(
    project_id: Optional[str],
    url: Optional[str],
    file_bytes: Optional[bytes],
    file_name: Optional[str],
    file_mime: Optional[str],
    doc_type: str,
    user_id: str,
    accept_language: Optional[str],
    background_tasks: BackgroundTasks,
) -> KgIngestResponse:
    """仅启动 KG 管线（对应 Next.js POST /api/concept-graph/ingest）。

    三种输入模式：
      1. 只传 projectId：从 documents 表读 rawText → 启动 KG
      2. 传 url/file + projectId：先解析更新 documents → 启动 KG
      3. 传 url/file 无 projectId：走 start_parse_job 完整流程
    """
    if project_id and not url and not file_bytes:
        # 模式 1：从已有项目读 rawText
        async with get_db_session() as session:
            result = await session.execute(
                select(Document.raw_text, Document.title).where(
                    and_(
                        Document.id == project_id,
                        Document.user_id == user_id,
                    )
                ).limit(1)
            )
            row = result.first()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Project not found.",
                )
            raw_text = row[0] or ""
            title = row[1] or "Untitled"

        if not raw_text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This project has no parsed content yet. Re-import the original file or URL from the import page.",
            )

        lang_instruction = await get_lang_instruction(doc_type, user_id, accept_language)

        # 设置 documents 状态为 parsing
        async with get_db_session() as session:
            await session.execute(
                text("UPDATE documents SET status = 'parsing', updated_at = now() WHERE id = :did"),
                {"did": project_id},
            )

        total_steps = 5 if doc_type == "code" else 3
        async with get_db_session() as session:
            job_result = await session.execute(
                text(
                    "INSERT INTO concept_graph_jobs "
                "(user_id, status, progress, input_type, project_id) "
                "VALUES (:uid, 'processing', CAST(:progress AS jsonb), :itype, :pid) "
                "RETURNING id"
                ),
                {
                    "uid": user_id,
                    "progress": json.dumps({"step": "queued", "current": 0, "total": total_steps}),
                    "itype": doc_type,
                    "pid": project_id,
                },
            )
            job_row = job_result.first()
            job_id = str(job_row[0]) if job_row else None

        background_tasks.add_task(
            run_full_pipeline,
            job_id=job_id,
            document_id=project_id,
            doc_type=doc_type,
            user_id=user_id,
            lang_instruction=lang_instruction,
            raw_text=raw_text,
            title=title,
        )

        return KgIngestResponse(jobId=job_id)

    # 模式 2/3：有 url/file → 走完整解析流程
    parse_response = await start_parse_job(
        url=url,
        file_bytes=file_bytes,
        file_name=file_name,
        file_mime=file_mime,
        project_id=project_id,
        doc_type=doc_type,
        user_id=user_id,
        accept_language=accept_language,
        background_tasks=background_tasks,
    )

    # start_parse_job 已经创建了 job 并注册了后台任务
    # 但前端期望 { jobId }，我们需要查询刚创建的 job
    if not parse_response.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to start KG pipeline: no project id returned.",
        )

    # 查询该 document 最新的 job
    async with get_db_session() as session:
        result = await session.execute(
            select(ConceptGraphJob.id).where(
                and_(
                    ConceptGraphJob.project_id == parse_response.id,
                    ConceptGraphJob.user_id == user_id,
                )
            ).order_by(desc(ConceptGraphJob.created_at)).limit(1)
        )
        row = result.first()
        job_id = str(row[0]) if row else None

    if not job_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve the parsing job id.",
        )

    return KgIngestResponse(jobId=job_id)
