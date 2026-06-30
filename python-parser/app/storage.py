"""
Cloudflare R2 存储层（boto3 S3 兼容客户端）。

对应 src/lib/storage.ts：
  - upload_image(buffer, mime, user_id) → 公开访问 URL
  - upload_document(buffer, mime, user_id, doc_id, kind) → 公开访问 URL

key 规则与 Next.js 完全一致，确保两端产物可互访。
"""
import re
import time
import uuid
from typing import Optional

import boto3
from botocore.client import BaseClient
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from app.config import get_settings

_settings = get_settings()

# MIME → 扩展名映射（与 storage.ts ACCEPTED_EXTS 对齐）
_IMAGE_EXTS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}

_DOC_EXTS = {
    "application/pdf": "pdf",
    "application/zip": "zip",
    "text/html": "html",
    "text/plain": "txt",
    "application/octet-stream": "bin",
}

_SAFE_RE = re.compile(r"[^a-zA-Z0-9_-]")


def _safe(s: str) -> str:
    """把 userId/docId/kind 中的非安全字符替换为 _，防止路径注入。"""
    return _SAFE_RE.sub("_", s)


_client: Optional[BaseClient] = None


def get_client() -> BaseClient:
    """获取 R2 S3 客户端单例。"""
    global _client
    if _client is not None:
        return _client
    if not _settings.is_r2_configured:
        raise RuntimeError(
            "R2 storage is not configured. Set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, "
            "R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_PUBLIC_URL."
        )
    _client = boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=_settings.r2_endpoint_url,
        aws_access_key_id=_settings.r2_access_key_id,
        aws_secret_access_key=_settings.r2_secret_access_key,
        config=BotoConfig(max_pool_connections=10),
    )
    return _client


def is_r2_configured() -> bool:
    return _settings.is_r2_configured


def get_r2_key_from_public_url(url: str) -> Optional[str]:
    """把公开访问 URL 解析回 R2 内部 key。仅识别本项目配置的 R2_PUBLIC_URL。"""
    public_url = _settings.r2_public_url
    if not public_url:
        return None
    prefix = public_url if public_url.endswith("/") else f"{public_url}/"
    if not url.startswith(prefix):
        return None
    key = url[len(prefix):]
    qidx = key.find("?")
    return key[:qidx] if qidx >= 0 else key


async def upload_image(buffer: bytes, mime: str, user_id: str) -> str:
    """上传一张图片到 R2，返回可公开访问的 URL。

    key 格式: images/{safeUserId}/{timestamp}-{uuid}.{ext}
    与 storage.ts 的 uploadImage 完全一致。
    """
    if not is_r2_configured():
        raise RuntimeError("R2 storage is not configured.")
    ext = _IMAGE_EXTS.get(mime.lower(), "bin")
    key = f"images/{_safe(user_id)}/{int(time.time() * 1000)}-{uuid.uuid4()}.{ext}"
    client = get_client()
    client.put_object(
        Bucket=_settings.r2_bucket_name,
        Key=key,
        Body=buffer,
        ContentType=mime,
    )
    return f"{_settings.r2_public_url}/{key}"


async def upload_document(
    buffer: bytes, mime: str, user_id: str, doc_id: str, kind: str
) -> str:
    """上传文档级资产（PDF/zip/HTML）到 R2。

    key 格式: documents/{safeUserId}/{safeDocId}/{safeKind}.{ext}
    与 storage.ts 的 uploadDocument 完全一致。
    """
    if not is_r2_configured():
        raise RuntimeError("R2 storage is not configured.")
    ext = _DOC_EXTS.get(mime.lower(), "bin")
    key = f"documents/{_safe(user_id)}/{_safe(doc_id)}/{_safe(kind)}.{ext}"
    client = get_client()
    client.put_object(
        Bucket=_settings.r2_bucket_name,
        Key=key,
        Body=buffer,
        ContentType=mime,
    )
    return f"{_settings.r2_public_url}/{key}"


def delete_image(key: str) -> None:
    """删除单个 R2 对象。失败不抛（容忍孤儿）。"""
    if not is_r2_configured():
        return
    try:
        get_client().delete_object(Bucket=_settings.r2_bucket_name, Key=key)
    except ClientError as e:
        # best-effort，与 Next.js 行为一致
        print(f"[storage] Failed to delete R2 object {key}: {e}", flush=True)
