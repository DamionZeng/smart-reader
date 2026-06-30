FROM python:3.11-slim

# 系统依赖：PyMuPDF 与 Pillow 需要系统级 libjpeg/libpng 才能正常解码图像。
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg-dev \
    libpng-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 优先安装依赖（利用 Docker 层缓存，源码变动不会触发重装）。
# 使用 editable 安装以便 app/ 包可被 import。
COPY pyproject.toml ./
COPY app/__init__.py ./app/__init__.py
RUN pip install --no-cache-dir -e .

# 复制源码
COPY . .

EXPOSE 8000

# 单 worker：BackgroundTasks 在进程内运行，多 worker 会导致
# 请求落到不同 worker 上后台任务状态不可见。如需高并发，
# 引入 Celery + Redis 把 KG 管线拆到独立 worker 进程。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
