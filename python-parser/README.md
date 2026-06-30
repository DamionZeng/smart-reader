# Smart Reader Parser

Python FastAPI 解析服务，承担 smart-reader 项目的 PDF/DOCX 解析 + langgraph 知识图谱 Agent 工作流。

## 为什么需要这个服务

Next.js 部署在 Vercel 上时受 Hobby 计划 60 秒函数超时限制，PDF 解析 + KG 管线（3 步并行 LLM 调用）经常在「生成思维导图与论证骨架」子步骤超时失败。本服务部署在独立服务器上，无超时限制，可稳定执行长管线。

## 架构

```
浏览器 ──> Next.js (Vercel) ──> Python FastAPI (独立服务器)
              │                       │
              │ thin proxy            │ FastAPI BackgroundTasks
              │ (PARSER_BACKEND)      │ + langgraph StateGraph
              ▼                       ▼
           共享 PostgreSQL (Neon / 本地 Docker)
              ▲
              │ 共享 Cloudflare R2（图片/PDF 存储）
```

- **Next.js 路由**作为 thin proxy，根据 `PARSER_BACKEND` 环境变量决定转发到 Python 服务还是走原有 Vercel 内置逻辑
- **Python 服务**直连同一个 PostgreSQL（asyncpg），不复制数据
- **鉴权**：Python 不持有用户 session，由 Next.js 转发时注入 `X-Parser-Secret` + `X-User-Id` header
- **前端契约零变更**：Python 服务响应 JSON 与 Next.js 路由完全一致

## 本地开发

### 1. 同步环境变量

```bash
cp ../.env .env
```

需要确保 `.env` 包含以下变量（与 Next.js 共用）：
- `DATABASE_URL` — PostgreSQL 连接串
- `AGNES_API_KEY` — LLM API key
- `R2_ENDPOINT_URL` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_PUBLIC_URL`
- `PARSER_SERVICE_SECRET` — 共享密钥（与 Next.js 的 `PARSER_SERVICE_SECRET` 一致）
- `CORS_ORIGINS` — 允许的前端来源（逗号分隔，默认 `http://localhost:3000`）

### 2. 安装依赖

```bash
pip install -e .
```

### 3. 启动服务

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

访问 http://localhost:8000/docs 查看 API 文档。

### 4. 在 Next.js 项目启用 Python 后端

在 smart-reader 根目录 `.env` 中设置：

```env
PARSER_BACKEND=python
PARSER_SERVICE_URL=http://localhost:8000
PARSER_SERVICE_SECRET=<与 python-parser/.env 中的 PARSER_SERVICE_SECRET 一致>
```

重启 Next.js dev server，提交解析任务时观察 Python 服务日志。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/health` | 健康检查（无需鉴权） |
| POST | `/parse` | 文档解析 + 创建项目 + 启动 KG 管线 |
| POST | `/kg/ingest` | 仅启动 KG 管线（项目必须已存在） |
| GET  | `/jobs/{id}` | 查询 job 状态（轮询用） |
| POST | `/jobs/{id}/cancel` | 取消正在运行的 job |

所有非 health 路由都需要 `X-Parser-Secret` + `X-User-Id` header。

## 切换后端

在 Next.js 项目 `.env` 中修改 `PARSER_BACKEND`：

| 值 | 行为 |
|---|---|
| `nextjs`（默认）| 走 Vercel 内置解析逻辑（受 60s 超时限制） |
| `python` | 转发到 Python FastAPI 服务（无超时限制） |

切换后重启 Next.js 即可生效。Next.js 解析代码保留不删除，作为回退。

## Docker 部署

```bash
# 从项目根目录
docker compose --profile parser up -d python-parser
```

或单独构建：

```bash
cd python-parser
docker build -t smart-reader-parser .
docker run -d -p 8000:8000 --env-file .env smart-reader-parser
```

## 与 Next.js 后端的关系

- **共享同一 PostgreSQL**：Python 服务通过 SQLAlchemy + asyncpg 直连，不复制数据
- **JSON 契约对齐**：响应结构与 Next.js 路由完全一致（concepts/edges/clusters/sections/skeleton 字段名）
- **可随时切回**：修改 `PARSER_BACKEND=nextjs` 即可回退到 Vercel 内置解析
- **documents.status 字段**：Python 服务创建项目时设为 `parsing`，KG 完成后设为 `ready`/`failed`；Next.js 模式下默认 `ready`，互不影响

## 环境变量说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | PostgreSQL 连接串（`postgresql://...`） |
| `AGNES_API_KEY` | 是 | LLM API key |
| `AGNES_BASE_URL` | 否 | LLM API base URL（默认 `https://apihub.agnes-ai.com/v1`） |
| `AGNES_MODEL` | 否 | LLM 模型名（默认 `agnes-2.0-flash`） |
| `R2_ENDPOINT_URL` | 是 | Cloudflare R2 endpoint |
| `R2_ACCESS_KEY_ID` | 是 | R2 access key |
| `R2_SECRET_ACCESS_KEY` | 是 | R2 secret key |
| `R2_BUCKET_NAME` | 是 | R2 bucket 名 |
| `R2_PUBLIC_URL` | 是 | R2 公开访问 URL |
| `PARSER_SERVICE_SECRET` | 是 | 与 Next.js 共享的鉴权密钥 |
| `HOST` | 否 | 监听地址（默认 `0.0.0.0`） |
| `PORT` | 否 | 监听端口（默认 `8000`） |
| `CORS_ORIGINS` | 否 | CORS 允许来源（逗号分隔，默认 `http://localhost:3000`） |
