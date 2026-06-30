"""
宝塔部署入口文件。

问题：
    宝塔 Python 项目管理器要求指定一个"入口文件"。如果直接用
    `app/main.py` 作为入口，Python 会把 `app/` 目录作为 sys.path[0]，
    导致 `from app.config import ...` 找不到模块
    （因为 Python 在 `app/` 里找 `app/config.py`，即 `app/app/config.py`）。

解决：
    在项目根目录放一个 run.py，启动前先把项目根目录（本文件所在目录）
    插入 sys.path[0]，这样 `app` 包就能被正常解析。
    宝塔入口文件填 `run.py`，启动命令等价于：
        python run.py
    或
        gunicorn -w 4 -k uvicorn.workers.UvicornWorker run:app

启动方式：
    本地开发：python run.py
    宝塔生产：gunicorn -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000 run:app
    或 uvicorn run:app --host 0.0.0.0 --port 8000
"""
import os
import sys
from pathlib import Path

# 把项目根目录（run.py 所在目录）插入 sys.path 最前
# 这样 `from app.config import ...` 才能找到 app/ 包
_PROJECT_ROOT = str(Path(__file__).resolve().parent)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# 现在可以安全导入 app 包了
from app.main import app  # noqa: E402
from app.config import get_settings  # noqa: E402

_settings = get_settings()


if __name__ == "__main__":
    # 本地直接 python run.py 启动
    import uvicorn

    uvicorn.run(
        "run:app",
        host=_settings.host,
        port=_settings.port,
        reload=False,
        log_level="info",
    )
