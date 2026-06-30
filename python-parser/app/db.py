"""
数据库连接（SQLAlchemy 2.0 async + asyncpg）。

与 Next.js 的 Drizzle ORM 共用同一个 Neon PostgreSQL。
Python 服务直连 PG，读写 documents / concept_graphs / concept_graph_jobs 等表。

Neon 连接串通常带 ?sslmode=require，asyncpg 需要显式 SSL 上下文。
"""
import ssl
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from urllib.parse import urlparse, urlunparse

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings

_settings = get_settings()


def _build_ssl_context() -> ssl.SSLContext | None:
    """Neon 要求 SSL。从 DATABASE_URL 解析 sslmode=require 时创建 SSL 上下文。"""
    url = _settings.database_url.lower()
    if "sslmode=require" in url or ".neon." in url:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return None


def _normalize_db_url(url: str) -> str:
    """把 DATABASE_URL 转成 asyncpg 可用的连接串。

    1. postgresql:// / postgres:// → postgresql+asyncpg://
    2. 剥离所有 query 参数（asyncpg 不接受 URL query 中的 sslmode /
       channel_binding / options 等参数，会抛 TypeError；
       SSL 通过 connect_args 单独传入，其他参数此处也用不到）
    """
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)

    parsed = urlparse(url)
    return urlunparse(parsed._replace(query=""))


_db_url = _normalize_db_url(_settings.database_url)
_ssl_ctx = _build_ssl_context()

engine = create_async_engine(
    _db_url,
    pool_size=10,
    max_overflow=5,
    pool_pre_ping=True,
    echo=False,
    connect_args={"ssl": _ssl_ctx} if _ssl_ctx else {},
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """获取数据库 session 的上下文管理器。

    用于 BackgroundTasks（非 FastAPI 依赖注入场景）：
        async with get_db_session() as session:
            ...

    自动提交/回滚。
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI 依赖注入用的 session 生成器。

    用法：
        @router.get("/")
        async def handler(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
