"""
FastAPI 应用入口。

启动方式：
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

路由注册：
    /health          — 健康检查（无需鉴权）
    /parse           — 文档解析 + 启动 KG（需 X-Parser-Secret）
    /kg/ingest       — 仅启动 KG（需 X-Parser-Secret）
    /jobs/{id}       — 查询/取消 job（需 X-Parser-Secret）
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings

_settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时预热，关闭时清理连接池。"""
    # 启动时可做预热（如 DB 连接测试），这里保持轻量
    print(f"[parser] 服务启动 → {_settings.host}:{_settings.port}", flush=True)
    yield
    # 关闭时释放 SQLAlchemy 连接池
    from app.db import engine
    await engine.dispose()
    print("[parser] 服务关闭，连接池已释放", flush=True)


app = FastAPI(
    title="Smart Reader Parser",
    description="PDF/DOCX 解析 + langgraph KG Agent 服务",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS：不限制来源，允许任意域名直接调用。
# 注意：Starlette 不允许 allow_origins=["*"] 与 allow_credentials=True 同时使用,
# 因此这里关闭 credentials（本服务鉴权走 X-Parser-Secret header,不依赖 Cookie)。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由（health 无需鉴权，其他路由开放访问（无鉴权））
from app.routers import health, jobs, kg, parse  # noqa: E402

app.include_router(health.router)
app.include_router(parse.router)
app.include_router(kg.router)
app.include_router(jobs.router)


@app.get("/")
async def root() -> dict:
    return {"service": "smart-reader-parser", "docs": "/docs"}
