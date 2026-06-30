"""健康检查端点，用于部署健康探测。"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    """返回服务存活状态。

    不检查 DB/R2/LLM 连接（那些由具体端点在使用时暴露错误），
    只确认进程存活、能响应 HTTP。
    """
    return {"status": "ok"}
