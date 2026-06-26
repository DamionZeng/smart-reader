# SmartReader · Code Wiki

> Canvas Smart Reader — 一款将技术文档/论文/源代码转化为可交互式空间知识图谱的 AI 阅读工具。
>
> 本 Wiki 基于对仓库源代码的逐文件分析生成，涵盖整体架构、模块职责、关键类与函数、依赖关系与运行方式，并严格遵循 `.trae/rules/ui-design.md` 中定义的 **编辑杂志风(Editorial)** 设计规范。

---

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈与依赖](#2-技术栈与依赖)
3. [目录结构](#3-目录结构)
4. [整体架构](#4-整体架构)
5. [UI 设计规范(必读)](#5-ui-设计规范必读)
6. [模块职责详解](#6-模块职责详解)
7. [关键类型定义](#7-关键类型定义)
8. [数据流：从文档到图谱](#8-数据流从文档到图谱)
9. [AI 能力矩阵](#9-ai-能力矩阵)
10. [环境变量](#10-环境变量)
11. [本地运行方式](#11-本地运行方式)
12. [数据库迁移](#12-数据库迁移)
13. [扩展点与待完善项](#13-扩展点与待完善项)

---

## 1. 项目概览

| 项 | 说明 |
| --- | --- |
| **产品名** | SmartReader / Canvas Smart Reader |
| **核心价值主张** | "Read Beyond The Linear" — 突破线性阅读，通过空间图谱组织复杂技术信息 |
| **目标场景** | 学术论文研究、软件架构理解、文献综述、多论文对比分析 |
| **核心特性** | 文档/URL/源代码摄取 → AI 解析为知识图谱 → 节点解释 → Q&A 对话 → 文献综述 → 多论文对比 → 分享导出 |
| **项目类型** | 双管线：**Paper**(论文/文章) + **Code**(源代码/仓库) |
| **技术形态** | Next.js 15 App Router 全栈应用，SSR + CSR 混合 |
| **数据持久化** | PostgreSQL(Neon Serverless)+ Drizzle ORM |
| **AI 模型** | Agnes AI(`agnes-2.0-flash`，OpenAI 兼容协议)，支持流式输出 |
| **认证** | Better Auth(邮箱/密码 + Google OAuth + 邮箱验证 + 密码重置) |
| **多语言** | UI: 英文/中文；AI 输出: 10 种语言(en/zh/ja/ko/fr/de/es/pt/ru/ar) |
| **设计语言** | Editorial(编辑杂志风)— Playfair Display 衬线标题 + Inter 无衬线正文，暖米色背景，单色克制 |

### 1.1 核心功能清单

| 模块 | 功能 |
| --- | --- |
| **摄取(Ingest)** | URL/文件上传 → AI 解析为知识图谱；支持 PDF/MD/TXT/JSON + 源代码文件；arXiv/DOI/GitHub URL 自动解析 |
| **画布(Board)** | React Flow 知识图谱编辑；节点拖拽/连接/编辑/笔记；撤销重做；自动布局；自动保存 |
| **节点解释(Explain)** | 点击节点 → AI 流式生成解释 + 类比 |
| **Q&A 对话** | 基于图谱+原文的流式问答；对话历史持久化 |
| **文献综述(Review)** | 多论文(2-8 篇)AI 综合成结构化文献综述 |
| **论文对比(Compare)** | 多论文(2-5 篇)生成统一对比图谱 |
| **全文搜索** | 跨所有项目的标题+原文搜索 |
| **分享** | 生成公开分享链接，只读访问 |
| **导出** | Markdown / JSON / HTML / PDF / PNG 图片 |
| **设置** | UI 语言 + AI 输出语言配置 |
| **用量统计** | AI 请求次数统计(按端点/时间维度) |

---

## 2. 技术栈与依赖

### 2.1 核心框架

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `next` | ^15.5.19 | App Router、SSR、API Routes |
| `react` / `react-dom` | ^19.0.1 | UI 框架 |
| `typescript` | ~5.8.2 | 类型系统，`strict: true` |

### 2.2 样式与交互

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `tailwindcss` | ^4.1.14 | 原子化 CSS 框架 |
| `@tailwindcss/postcss` | ^4.3.1 | Tailwind v4 PostCSS 插件 |
| `clsx` + `tailwind-merge` | ^2.1.1 / ^3.6.0 | 通过 `utils/cn.ts` 合并 className |
| `lucide-react` | ^0.546.0 | 图标库(线性、细描边) |
| `motion` | ^12.23.24 | 动画类底层实现 |
| `markdown-to-jsx` | ^9.8.2 | Markdown 渲染(Q&A/Review 输出) |

### 2.3 数据与后端

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `@neondatabase/serverless` | ^1.1.0 | Neon Postgres HTTP 驱动 |
| `drizzle-orm` | ^0.45.2 | ORM |
| `drizzle-kit` | ^0.31.10 | Schema 迁移与 Drizzle Studio |
| `dotenv` | ^17.2.3 | `.env` 加载 |

### 2.4 认证

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `better-auth` | ^1.6.20 | 服务端鉴权(邮箱验证/密码重置/Google OAuth/速率限制) |
| `better-auth/react` | (同包) | 客户端 React Hooks |

### 2.5 AI 与文档处理

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `openai` | ^6.44.0 | OpenAI 兼容 SDK，调用 Agnes AI |
| `pdf-parse` | ^2.4.5 | PDF 文本提取(论文/文档) |

### 2.6 画布与可视化

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `@xyflow/react` | ^12.11.0 | 知识图谱画布(节点/边/连接) |
| `@dagrejs/dagre` | ^3.0.0 | 自动布局算法(TB/LR tree/radial/hierarchical/compact) |
| `html-to-image` | ^1.11.13 | 画布导出为 PNG |
| `jspdf` | ^2.5.2 | 导出为 PDF |

### 2.7 业务与工具

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `react-hook-form` | ^7.80.0 | 表单状态管理 |
| `zod` | ^4.4.3 | Schema 校验 |
| `@hookform/resolvers` | ^5.4.0 | RHF + Zod 桥接 |
| `i18next` + `react-i18next` | ^26.3.1 / ^17.0.8 | 国际化 |

---

## 3. 目录结构

```
smart-reader/
├── src/
│   ├── app/                              # Next.js App Router
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── [...all]/route.ts         # Better Auth 入口
│   │   │   │   ├── verify-email/route.ts     # 邮箱验证
│   │   │   │   └── reset-password/route.ts   # 密码重置
│   │   │   ├── ingest/route.ts               # 文档摄取(Paper/Code 双管线)
│   │   │   ├── explain/route.ts              # 节点 AI 解释(流式)
│   │   │   ├── qa/
│   │   │   │   ├── route.ts                  # Q&A 对话(流式)
│   │   │   │   └── conversations/
│   │   │   │       ├── route.ts              # 对话历史 CRUD
│   │   │   │       └── [id]/route.ts         # 删除对话
│   │   │   ├── review/route.ts               # 文献综述(流式)
│   │   │   ├── compare/route.ts              # 论文对比(流式 + 持久化)
│   │   │   ├── search/route.ts               # 全文搜索
│   │   │   ├── settings/route.ts             # 用户设置
│   │   │   ├── usage/
│   │   │   │   ├── route.ts                  # 用量统计
│   │   │   │   └── track.ts                  # 用量记录辅助函数
│   │   │   ├── projects/
│   │   │   │   ├── route.ts                  # 列表/创建
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts              # 详情/更新/删除
│   │   │   │       └── share/route.ts        # 分享管理
│   │   │   └── share/[shareId]/route.ts      # 公开只读访问
│   │   ├── board/page.tsx                    # Paper 知识图谱工作台
│   │   ├── codeboard/page.tsx                # Code 知识图谱工作台
│   │   ├── dashboard/page.tsx                # 项目仪表盘(含对比/综述/用量)
│   │   ├── share/[shareId]/page.tsx          # 分享页面(只读)
│   │   ├── settings/page.tsx                 # 用户设置页
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   ├── forgot-password/page.tsx
│   │   ├── verify-email/page.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx                          # 营销首页
│   ├── api/
│   │   ├── document.ts                       # parseDocument 客户端封装
│   │   └── project.ts                        # 项目 CRUD 客户端封装
│   ├── components/
│   │   ├── Nodes/
│   │   │   ├── ConceptNode.tsx               # 概念节点(Paper)
│   │   │   └── CodeNode.tsx                  # 代码节点(module/function/class)
│   │   ├── auth/
│   │   │   ├── login-form.tsx
│   │   │   └── register-form.tsx
│   │   ├── board/
│   │   │   ├── IngestionUI.tsx               # Paper 摄取表单
│   │   │   ├── CodeIngestionUI.tsx           # Code 摄取表单
│   │   │   ├── IngestionFlow.tsx             # 摄取进度可视化
│   │   │   ├── ExplanationPanel.tsx          # 节点解释+编辑+笔记
│   │   │   ├── OriginalTextPanel.tsx         # 原文侧栏
│   │   │   ├── QAPanel.tsx                   # Q&A 对话面板
│   │   │   ├── SaveIndicator.tsx
│   │   │   └── Sidebar.tsx                   # 大纲/搜索/导出/导入
│   │   ├── ui/Slider.tsx
│   │   ├── I18nHydrationGate.tsx
│   │   ├── LoadingScreen.tsx
│   │   └── UserMenu.tsx
│   ├── db/schema.ts                          # Drizzle 表定义(7 张表)
│   ├── lib/
│   │   ├── agnes.ts                          # Agnes AI 客户端
│   │   ├── ai-settings.ts                    # AI 输出语言指令
│   │   ├── auth.ts                           # Better Auth 服务端
│   │   ├── auth-client.ts                    # Better Auth 客户端
│   │   ├── db.ts                             # Drizzle + Neon 初始化
│   │   ├── email.ts                          # 邮件发送(开发态 console)
│   │   └── rate-limit.ts                     # 内存滑动窗口限流
│   ├── locales/
│   │   ├── en.json
│   │   └── zh.json
│   ├── types/index.ts                        # 业务类型定义
│   ├── utils/
│   │   ├── auto-layout.ts                    # Dagre 自动布局
│   │   ├── cn.ts
│   │   ├── edge-style.ts                     # React Flow 边样式
│   │   ├── export-image.ts                   # PNG 导出
│   │   ├── export-markdown.ts                # MD/JSON/HTML/PDF 导出
│   │   ├── graph-normalize.ts                # AI 输出归一化
│   │   └── string.ts
│   ├── i18n.ts
│   └── middleware.ts                         # 路由+API 保护
├── .env.example
├── drizzle.config.ts
├── next.config.ts
├── package.json
└── tsconfig.json
```

---

## 4. 整体架构

### 4.1 架构分层

```
┌──────────────────────────────────────────────────────────────────┐
│                         Browser (CSR)                             │
│                                                                  │
│  ┌──────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐  │
│  │ Landing  │ │ Dashboard  │ │ Board /    │ │ Share Page     │  │
│  │ Auth     │ │ + Compare  │ │ CodeBoard  │ │ (read-only)    │  │
│  │ Settings │ │ + Review   │ │ + QA +     │ │                │  │
│  │          │ │ + Usage    │ │ Explain    │ │                │  │
│  └────┬─────┘ └─────┬──────┘ └─────┬──────┘ └───────┬────────┘  │
│       │             │              │                │            │
└───────┼─────────────┼──────────────┼────────────────┼────────────┘
        │             │              │                │
        ▼             ▼              ▼                ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Next.js Edge / Node Runtime                     │
│                                                                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ Better Auth│ │ Drizzle ORM│ │ Agnes AI   │ │ Rate Limiter │  │
│  │ (session/  │ │ + Neon HTTP│ │ (OpenAI    │ │ (in-memory)  │  │
│  │  verify/   │ │            │ │  SDK +     │ │              │  │
│  │  reset)    │ │            │ │  streaming)│ │              │  │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └──────────────┘  │
└────────┼──────────────┼─────────────┼───────────────────────────┘
         ▼              ▼             ▼
     Session Cookie  PostgreSQL    apihub.agnes-ai.com
     (Neon-hosted)   (7 tables)    (JSON-mode + SSE streaming)
```

### 4.2 角色与责任

- **Server Components / Route Handlers**: 鉴权、数据库读写、调用 AI、限流、用量记录。
- **Client Components**: 编辑画布、流式接收 AI 输出、自动保存、i18n 切换、撤销重做。
- **数据库**: 用户、会话、项目(含元数据)、对话、用量、设置。
- **AI(Agnes)**: 摄取(结构化 JSON)、解释(流式文本)、Q&A(流式文本)、综述(流式 Markdown)、对比(流式 JSON)。
- **Middleware**: Edge 层快速 cookie 存在性校验，保护 `/board` `/codeboard` `/dashboard` 及敏感 API。

---

## 5. UI 设计规范(必读)

> 完整规范位于 `.trae/rules/ui-design.md`，任何新增/修改页面 **必须** 严格遵守。

### 5.1 Token 速览

| 维度 | 取值 |
| --- | --- |
| 背景 | `#F9F8F6`(暖米色，变量名 `--color-editorial-bg`) |
| 文字 | `#1C1C1C`(柔和黑，变量名 `--color-editorial-text`) |
| 字体-标题 | `Playfair Display`,serif,`tracking-tight` |
| 字体-正文 | `Inter`,sans-serif |
| 字体-代码 | `font-mono`(CodeNode 使用) |
| 圆角 | 仅 `rounded-none`，禁止 `rounded-sm/md/lg/xl/2xl/3xl/full` |
| 阴影 | 仅 `shadow-none` |
| 边框 | `border` 单像素，颜色用 `border-[#1C1C1C]/10` / `/20` 等透明度 |
| 标签 | `text-[10px] uppercase tracking-[0.2em]` |
| 标题字号 | `text-3xl md:text-5xl`，Hero 用 `text-5xl md:text-7xl lg:text-8xl` |
| 容器宽度 | `max-w-7xl mx-auto px-6` |
| Section 间距 | `py-16 md:py-24 lg:py-32` |
| 按钮 | `px-6 py-3 text-sm tracking-wide transition-colors`，主按钮 `bg-[#1C1C1C] text-[#F9F8F6]` |
| 输入框 | `border border-border text-sm focus:outline-none focus:border-foreground transition-colors` |

### 5.2 禁止项(FORBIDDEN)

- 任何 `rounded-*`(除 `none`)
- 任何 `shadow-*`(除 `none`)
- `border-2/4/8`(仅允许 `border` 单像素)
- `bg-gradient-*` / `bg-blue-500` 等彩色
- `font-black`(标题使用 `font-serif`，字重默认)

### 5.3 必备项(REQUIRED)

- 按钮:`px-6 py-3 text-sm tracking-wide transition-colors`
- 卡片:`border border-border hover:border-foreground transition-colors p-6`
- 输入框:`border border-border text-sm focus:outline-none focus:border-foreground transition-colors placeholder:text-muted`

### 5.4 交互模式

- 链接 hover:`group-hover:italic` 或 `hover:underline`
- 卡片 hover:背景从 `bg-[#F9F8F6]` 过渡到 `bg-[#1C1C1C]/5`
- 选中态:激活节点/项目使用 `text-[#1C1C1C]` + `italic`
- 复选/标签:`text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40`

### 5.5 字体注入

在 `src/app/globals.css` 中通过 `@theme` 注册自定义颜色与字体：

```css
--font-serif: "Playfair Display", Georgia, serif;
--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
--color-editorial-bg: #F9F8F6;
--color-editorial-text: #1C1C1C;
```

`Playfair Display` 与 `Inter` 通过 Google Fonts 在 `@import` 处加载。

---

## 6. 模块职责详解

### 6.1 应用入口与全局布局

#### `src/app/layout.tsx`
- Root Layout(服务端组件)
- 注入 `metadata`、引入 `globals.css`
- 用 `<I18nHydrationGate>` 包裹 `{children}` 解决 SSR/CSR 语言不一致
- `<html lang="en" suppressHydrationWarning>` — 锁定服务端语言为 `en`

#### `src/app/globals.css`
- 引入 Playfair Display + Inter Google Fonts
- 注册 Tailwind v4 `@theme` 变量
- 全局 `body` 颜色 + 选区(`::selection`)配色反转

#### `src/i18n.ts`
- 故意把 i18next 初始语言锁定为 `en`，推迟到客户端 `useEffect` 探测
- 加载 `en.json` / `zh.json` 静态资源

#### `src/middleware.ts`
- **Edge 层快速 cookie 存在性校验**(不再 fetch 后端验证，避免延迟)
- 保护页面：`/board` `/codeboard` `/dashboard`
- 保护 API：`/api/projects/*` `/api/ingest` `/api/compare` `/api/review` `/api/qa` `/api/explain`
- 未登录 → 页面重定向 `/login`，API 返回 401 JSON

---

### 6.2 页面模块

#### 6.2.1 `src/app/page.tsx` — 营销首页(Landing)
- Client Component
- 结构：Nav(毛玻璃) → Hero(大字) → Manifesto → Cases → Features → Metrics → Footer
- 入口逻辑：`router.push(session?.user ? "/dashboard" : "/board")`

#### 6.2.2 `src/app/dashboard/page.tsx` — 项目仪表盘
- Client Component
- **核心功能**：
  - 项目列表(按 `createdAt DESC`)
  - 创建项目(类型选择器：Paper / Code)
  - 删除项目(确认弹窗 + a11y)
  - **对比模式**：多选(2-5 个) → 生成对比图谱
  - **文献综述**：多选(2-8 个) → 流式生成 Markdown 综述(可下载/复制)
  - **用量统计**：展示总请求数、7 天/24 小时数据、按端点分布
- 辅助：`useModalA11y` Hook 处理弹窗焦点陷阱 + Escape 关闭

#### 6.2.3 `src/app/board/page.tsx` — Paper 知识图谱工作台
- Client Component(被 `Suspense` 包裹)
- **核心状态**：`documentContent` / `activeNodeId` / `nodes` / `edges` / `saveStatus` / `showOriginalText` / `showQA`
- **关键能力**：
  1. `useEffect` 监听 `projectId`，调用 `getProject(id)` 装载
  2. `nodes/edges` 变化触发 **800ms 防抖自动保存** + **30s 周期保存**
  3. **撤销/重做**：50 步历史，结构变更前快照(拖拽/增删/连接/编辑/布局)
  4. 节点点击 → `ExplanationPanel` 滑出
  5. 原文侧栏(`OriginalTextPanel`)切换
  6. Q&A 面板(`QAPanel`)切换
  7. 自动布局(dagre TB/LR + 模板)
  8. 导出(MD/JSON/HTML/PDF/PNG)
  9. JSON 导入
  10. 节点类型强制为 `concept`(legacy 迁移)
- **画布配置**：`ConnectionMode.Loose`、`fitView`、`minZoom={0.2}`，背景 `#1C1C1C` 1px 点阵 10% 透明度

#### 6.2.4 `src/app/codeboard/page.tsx` — Code 知识图谱工作台
- 与 `board/page.tsx` 结构对称，差异：
  - 注册 `module` / `function` / `class` / `concept` 四种节点类型
  - 使用 `CodeIngestionUI`(支持 GitHub URL + 源代码文件)
  - 节点渲染走 `CodeNode`(含 `filePath` / `language` / `codeSnippet`)

#### 6.2.5 `src/app/share/[shareId]/page.tsx` — 分享页(只读)
- 通过 `/api/share/[shareId]` 获取公开项目
- 只读 React Flow 展示，无编辑/保存
- 显示论文元数据(authors/year/venue/doi/abstract)

#### 6.2.6 `src/app/settings/page.tsx` — 用户设置
- UI 语言(同步到 localStorage + i18next)
- AI 输出语言(10 种，持久化到 DB)
- 即时应用 + 保存反馈

#### 6.2.7 认证页面
- `login/page.tsx` / `register/page.tsx`：壳组件渲染表单
- `forgot-password/page.tsx`：密码重置请求
- `verify-email/page.tsx`：邮箱验证回调处理

---

### 6.3 API 路由模块

#### 6.3.1 认证路由
- `api/auth/[...all]/route.ts`：Better Auth 入口(signIn/signUp/signOut/get-session/callback)
- `api/auth/verify-email/route.ts`：GET 邮箱验证(token → `auth.api.verifyEmail`)
- `api/auth/reset-password/route.ts`：POST 密码重置请求(防枚举，始终返回 success)

#### 6.3.2 `api/ingest/route.ts` — 文档摄取(核心)
- **方法**：POST，`multipart/form-data`
- **双管线**：`type=paper`(默认) / `type=code`
- **输入**：`url` 或 `file` + 可选 `projectId`(追加模式)
- **Paper 管线**：
  - URL 解析：arXiv `/abs/` → `/pdf/`、DOI 直通、Semantic Scholar / PubMed 直通
  - 文件：`.md/.markdown/.txt/.json/.pdf`
  - Prompt：提取 `metadata`(authors/year/venue/doi/abstract) + `section` 分类
- **Code 管线**：
  - URL 解析：GitHub repo/tree/blob → raw.githubusercontent.com
  - 文件：`.js/.ts/.py/.go/.java/.rs/.c/.cpp/...` + `.md/.txt/.json/.yaml`
  - Prompt：节点类型 `module/function/class/concept`，含 `filePath/language/codeSnippet`
- **安全**：
  - SSRF 防护：`validateFetchUrl` 阻止私网/loopback/元数据 IP
  - 文件大小限制：10MB(上传) / 50MB(URL 响应)
  - 30s fetch 超时
  - 输入截断：50,000 字符
- **流程**：fetch/读取 → 截断 → Agnes JSON mode → `normaliseGraph` → 持久化(插入或更新) → 返回 `{ id, graph }`
- **限流**：heavy(10/min)

#### 6.3.3 `api/explain/route.ts` — 节点解释(流式)
- POST，接收 `{ nodeTitle, nodeDescription, sourceContext }`
- Agnes 流式输出，SSE 格式 `data: {content}\n\n`
- Prompt 强制 `[EXPLANATION]` + `[ANALOGY]` 两段式输出
- 限流：light(30/min)

#### 6.3.4 `api/qa/route.ts` — Q&A 对话(流式)
- POST，接收 `{ projectId, question, history }`
- 上下文：知识图谱 nodes/edges + 原文(截断 30k 字符)
- 历史限制：6 条消息，每条 5000 字符
- 问题限制：5000 字符
- Agnes 流式输出，SSE
- 限流：light(30/min)

#### 6.3.5 `api/qa/conversations/route.ts` — 对话历史
- GET `?projectId=xxx`：获取该项目的最新对话
- POST：upsert 对话(每项目每用户一条)
- 消息限制：200 条，每条 10000 字符
- `api/qa/conversations/[id]/route.ts`：DELETE 删除对话

#### 6.3.6 `api/review/route.ts` — 文献综述(流式)
- POST，接收 `{ projectIds: string[] }`(2-8 个)
- 聚合多论文的 nodes/edges/abstract → Agnes 流式生成 Markdown 综述
- 7 段结构：Overview / Common Themes / Methodological Approaches / Key Findings / Contradictions / Research Gaps / Conclusion
- 限流：heavy(10/min)

#### 6.3.7 `api/compare/route.ts` — 论文对比(流式 + 持久化)
- POST，接收 `{ projectIds: string[] }`(2-5 个)
- 自动检测主导项目类型(paper/code)
- Agnes JSON mode 流式 → `normaliseGraph` → 插入新项目 → 返回 `{ result: { id } }`
- 节点 `sourceContext` 标注来源论文(Paper A / Paper B / Paper A;Paper B)
- 限流：heavy(10/min)

#### 6.3.8 `api/search/route.ts` — 全文搜索
- GET `?q=keyword`
- 跨用户所有项目的 `title` + `rawText` 搜索(ilike)
- 返回最多 20 条结果，含 200 字符 snippet
- 限流：light(30/min)

#### 6.3.9 `api/settings/route.ts` — 用户设置
- GET：返回 `{ language, aiOutputLanguage }`
- POST：upsert 设置(支持 10 种语言)
- 表不存在时优雅降级返回默认值

#### 6.3.10 `api/usage/route.ts` — 用量统计
- GET：返回总数、按端点分布、24h/7d/30d 计数、30 天每日明细
- `api/usage/track.ts`：`trackUsage(userId, endpoint)` 辅助函数(非致命)

#### 6.3.11 `api/projects/route.ts` — 项目列表/创建
- GET：当前用户所有项目，按 `createdAt DESC`
- POST：创建空项目壳(用于 `/board` 无 id 时立即获得真实 id)

#### 6.3.12 `api/projects/[id]/route.ts` — 项目详情/更新/删除
- GET：完整项目(含 nodes/edges/rawText/metadata)
- PATCH：更新 nodes(≤500)/edges(≤1000)/title/rawText/metadata
- DELETE：删除项目(所有权校验)
- 限流：light(30/min)

#### 6.3.13 `api/projects/[id]/share/route.ts` — 分享管理
- POST `action=revoke`：撤销分享(`isPublic=false, shareId=null`)
- POST(默认)：启用分享(生成 `shareId` UUID)

#### 6.3.14 `api/share/[shareId]/route.ts` — 公开只读访问
- GET：通过 `shareId` + `isPublic=true` 查询，无需认证
- 返回项目完整数据(含元数据)

---

### 6.4 客户端 API 封装

#### `src/api/document.ts`
```ts
parseDocument(textOrUrl: string, file?: File | null, options?: { type?: "paper" | "code", projectId?: string }): Promise<IngestResult>
```
- 组装 `FormData` → `POST /api/ingest`
- 失败时回退到 MOCK(保证演示可运行)

#### `src/api/project.ts`
| 函数 | 用途 |
| --- | --- |
| `listProjects()` | `GET /api/projects` → `ProjectSummary[]` |
| `getProject(id)` | `GET /api/projects/[id]` → `ProjectDetail`(含 rawText/metadata) |
| `saveProject(id, payload)` | `PATCH /api/projects/[id]`(nodes/edges/title/rawText/metadata) |
| `createProject(payload?)` | `POST /api/projects`(创建空壳) |
| `deleteProject(id)` | `DELETE /api/projects/[id]` |

辅助函数 `jsonOrThrow<T>(res)` 统一处理非 OK 响应并提取 `error` 字段。

---

### 6.5 数据库与 Schema

#### `src/lib/db.ts`
- `@neondatabase/serverless` HTTP SQL 客户端
- `drizzle(sql, { schema })` ORM 实例
- 启动校验 `DATABASE_URL` 必填

#### `src/db/schema.ts` — 7 张表

**Better Auth 表(4 张)**：

| 表 | 关键字段 |
| --- | --- |
| `user` | `id`(text,PK), `name`, `email` UNIQUE, `emailVerified`, `image`, `createdAt`, `updatedAt` |
| `session` | `id`, `token` UNIQUE, `expiresAt`, `ipAddress`, `userAgent`, `userId` FK→user(`onDelete: cascade`), `impersonatedBy` |
| `account` | `accountId`, `providerId`(google/credential), `accessToken`, `refreshToken`, `idToken`, `password`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope` |
| `verification` | `identifier`, `value`, `expiresAt` |

**应用表(3 张)**：

| 表 | 关键字段 |
| --- | --- |
| `documents` | `id` UUID, `title`, `type`('paper'\|'code'), `originalUrl`, `authors`(JSON string), `year`, `venue`, `doi`, `abstract`, `rawText`(100k 截断), `nodes` jsonb, `edges` jsonb, `userId` FK→user(**`onDelete: cascade`**), `createdAt`, `updatedAt`, `isPublic`, `shareId` |
| `usageRecords` | `id` UUID, `userId`, `endpoint`('ingest'\|'qa'\|'explain'\|'review'\|'compare'), `tokensUsed`, `createdAt` |
| `conversations` | `id` UUID, `userId`, `projectId`, `messages` jsonb(默认 `[]`), `createdAt`, `updatedAt` |
| `userSettings` | `id` UUID, `userId` FK→user(`onDelete: cascade`), `language`(默认 'en'), `aiOutputLanguage`(默认 'en'), `createdAt`, `updatedAt` |

**索引**：
- `idx_documents_user_id`、`idx_documents_user_created`
- `idx_usage_user_id`、`idx_usage_user_created`
- `idx_conversations_user_id`、`idx_conversations_project_id`
- `idx_user_settings_user_id`
- `documents_type_check` CHECK 约束(`type IN ('paper','code')`)

> **变更说明**：`documents.userId` 已从 `set null` 改为 `cascade`，用户删除时其项目一并清除。

---

### 6.6 认证模块

#### `src/lib/auth.ts`(服务端)
- `betterAuth({ database: drizzleAdapter(db, { provider: "pg", schema }) })`
- **关键配置**：
  - `secret: BETTER_AUTH_SECRET`
  - `baseURL: APP_URL`
  - `trustedOrigins`: 同时配 `APP_URL` 和 `NEXT_PUBLIC_APP_URL`(避免 1.6+ CORS 预检失败)
  - `emailAndPassword`：
    - `enabled: true`，`autoSignInAfterRegistration: true`
    - `minPasswordLength: 8`，`maxPasswordLength: 128`
    - **`requireEmailVerification: true`**(必须验证邮箱才能登录)
    - `sendResetPassword` / `sendVerificationEmail` 回调(走 `lib/email.ts`)
  - `socialProviders.google`：回调 `APP_URL/api/auth/callback/google`
  - **`rateLimit`**：`signIn` 5/min，`signUp` 3/min(内存存储)

#### `src/lib/auth-client.ts`(客户端)
```ts
export const authClient = createAuthClient({ baseURL: process.env.NEXT_PUBLIC_APP_URL });
export const { signIn, signUp, signOut, useSession } = authClient;
```

#### `src/lib/email.ts`
- 开发态：`console.log` 输出验证/重置 URL
- 生产态：预留 Resend 集成(需 `RESEND_API_KEY`)

---

### 6.7 AI 接入(Agnes)

#### `src/lib/agnes.ts`
```ts
export const agnes = new OpenAI({
  baseURL: "https://apihub.agnes-ai.com/v1",
  apiKey: process.env.AGNES_API_KEY,
});
export const AGNES_MODEL = "agnes-2.0-flash";
```

#### `src/lib/ai-settings.ts`
- `getAIOutputLanguage(userId)`：从 DB 读取用户 AI 输出语言偏好
- `getLanguageInstruction(language)`：构造语言指令字符串(非 en 时追加 "write ALL output in {language}")
- `getLanguageInstructionForUser(userId)`：组合调用
- 支持 10 种语言：en/zh/ja/ko/fr/de/es/pt/ru/ar

**调用点**：所有 5 个 AI 路由(ingest/explain/qa/review/compare)在 system prompt 末尾追加 `langInstruction`。

---

### 6.8 限流

#### `src/lib/rate-limit.ts`
- **内存滑动窗口**(单实例适用，多副本需换 Redis)
- 周期清理过期条目(5 分钟一次)
- `getRateLimitKey(request, userId?)`：优先 userId，回退 `x-forwarded-for` / `x-real-ip` / `anonymous`
- `enforceRateLimit`：超限返回 429 + `Retry-After` + `X-RateLimit-*` 头
- **预设**：
  - `heavy`：10 次/分钟(ingest/compare/review)
  - `light`：30 次/分钟(qa/explain/search/projects/usage)
- **自定义**：verify-email 5/min，reset-password 3/min

---

### 6.9 核心组件

| 组件 | 路径 | 职责 |
| --- | --- | --- |
| **Sidebar** | `components/board/Sidebar.tsx` | 大纲侧栏：节点列表(序号 01-99)、跨项目搜索、导出下拉(MD/JSON/HTML/PDF)、JSON 导入、标题编辑、手动保存 |
| **ExplanationPanel** | `components/board/ExplanationPanel.tsx` | 节点解释面板：流式接收 `/api/explain`，解析 `[EXPLANATION]`/`[ANALOGY]` 标记；支持节点标题/描述内联编辑 + 用户笔记 |
| **QAPanel** | `components/board/QAPanel.tsx` | Q&A 对话面板：流式接收 `/api/qa`；挂载时从 DB 恢复对话历史；自动保存；中断/重试 |
| **OriginalTextPanel** | `components/board/OriginalTextPanel.tsx` | 原文侧栏：展示 `rawText`(100k 截断) |
| **IngestionUI** | `components/board/IngestionUI.tsx` | Paper 摄取表单：项目名 + URL/文件 + 错误展示；可作为全页或模态框 |
| **CodeIngestionUI** | `components/board/CodeIngestionUI.tsx` | Code 摄取表单：GitHub URL + 源代码文件 |
| **IngestionFlow** | `components/board/IngestionFlow.tsx` | 摄取进度可视化：3 阶段(Upload/Parse/Generate) + 子步骤 |
| **SaveIndicator** | `components/board/SaveIndicator.tsx` | 浮动状态徽标(saving/saved/error)，`role="status"` + `aria-live` |
| **UserMenu** | `components/UserMenu.tsx` | 右上角用户菜单：Dashboard/Settings/Sign out |
| **LoadingScreen** | `components/LoadingScreen.tsx` | 通用 loading，黑点 ping 动画 |
| **I18nHydrationGate** | `components/I18nHydrationGate.tsx` | 客户端语言探测(localStorage/navigator) |
| **LoginForm** / **RegisterForm** | `components/auth/*` | RHF + Zod，邮箱/密码 + Google |

---

### 6.10 React Flow 节点

#### `src/components/Nodes/ConceptNode.tsx`(Paper)
- 字段：`title` / `description` / `isActive`
- 视觉：240-280px 宽，`p-6`，顶部 "Topic Node" 标签，选中态 `italic`
- Handle：Top/Bottom，2x2 实心点

#### `src/components/Nodes/CodeNode.tsx`(Code)
- 字段：`title` / `description` / `filePath` / `language` / `codeSnippet` / `isActive`
- 视觉：260-320px 宽，`font-mono`，顶部类型标签(MODULE/FUNCTION/CLASS/CONCEPT) + 语言标签
- 支持代码片段展示
- Handle：Top/Bottom

> `types/index.ts` 中 `DocumentNode.type` 支持 `'concept' | 'code' | 'diagram' | 'summary' | 'module' | 'function' | 'class'`，`/board` 仅注册 `concept`，`/codeboard` 注册 `module/function/class/concept`。

---

### 6.11 工具函数

#### `src/utils/graph-normalize.ts`
- 将 AI 返回的任意结构归一化为 UI 期望的 `{ id, type, position, data: { title, description, ... } }`
- 处理 `data.content` vs `data.description`、扁平 vs 嵌套、缺失 position 等
- 服务端(ingest/compare)与客户端(board/codeboard)共享

#### `src/utils/auto-layout.ts`
- `autoLayout(nodes, edges, direction)`：dagre 层级布局(TB/LR)
- `applyLayoutTemplate(nodes, edges, template)`：tree/radial/hierarchical/compact

#### `src/utils/export-markdown.ts`
- `exportGraphToMarkdown` / `exportGraphToJSON` / `exportGraphToHTML` / `exportGraphToPDF`
- `exportAndDownload(format, ...)`：统一导出入口
- HTML 导出含完整 Editorial 内联样式

#### `src/utils/export-image.ts`
- `exportGraphAsImage(filename)`：`html-to-image` 的 `toPng` 捕获 `.react-flow`，过滤控件/面板

---

### 6.12 国际化(i18n)

- **资源**：`src/locales/en.json` 与 `zh.json`
- **命名空间**：`hero.*` / `dashboard.*` / `board.*` / `ingest.*` / `usage.*` / `settings.*` / `share.*` / `verifyEmail.*` 等
- **切换入口**：首页/Dashboard 顶部导航 `toggleLanguage` 按钮
- **持久化**：`I18nHydrationGate` 从 `localStorage.i18nextLng` 读取
- **AI 输出语言**：独立于 UI 语言，通过 `userSettings.aiOutputLanguage` 持久化，影响所有 AI 路由的 system prompt

---

## 7. 关键类型定义

`src/types/index.ts`：

```ts
type ProjectType = 'paper' | 'code';

type PaperSection = 'abstract' | 'introduction' | 'method' | 'experiment' | 'result' | 'conclusion' | 'related-work' | 'background';

interface PaperMetadata {
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  abstract: string;
}

interface DocumentNode {
  id: string;
  type: 'concept' | 'code' | 'diagram' | 'summary' | 'module' | 'function' | 'class';
  section?: PaperSection;
  position: { x: number; y: number };
  data: {
    title: string;
    description: string;
    sourceContext?: string;
    details?: string;
    note?: string;              // 用户笔记
    filePath?: string;          // Code 专属
    language?: string;          // Code 专属
    codeSnippet?: string;       // Code 专属
  };
}

interface DocumentEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
}

interface ParsedDocument {
  id: string;
  title: string;
  type: ProjectType;
  rawText: string;
  metadata?: PaperMetadata;
  nodes: DocumentNode[];
  edges: DocumentEdge[];
}

interface NodeExplanation {
  analogy: string;
  simplified: string;
  codeSnippet?: string;
}
```

---

## 8. 数据流：从文档到图谱

```
[用户在 Board/CodeBoard 页面]
        │
        │ 1. 输入 URL 或上传文件(+ projectType)
        ▼
[IngestionUI / CodeIngestionUI.onIngest]
        │
        ▼
[board/page.tsx handleIngest]
        │ 2. parseDocument(url, file, { type, projectId })  → FormData
        ▼
[POST /api/ingest]
        │ 3. 限流检查(heavy)
        │ 4. URL 解析(arXiv/GitHub/DOI) 或 文件读取(含 PDF 提取)
        │ 5. SSRF 校验 → fetch(30s 超时) / file.text()
        │ 6. 截断 50k 字符
        │ 7. auth.api.getSession → userId
        │ 8. getLanguageInstructionForUser(userId)
        │ 9. agnes.chat.completions.create({ response_format: 'json_object' })
        ▼
[Agnes AI] ── JSON: { title, metadata?, nodes[], edges[] }
        │
        │ 10. JSON.parse + 校验
        │ 11. normaliseGraph(rawGraphData, "", type)
        │ 12. trackUsage(userId, "ingest")
        │ 13. projectId ? UPDATE : INSERT documents
        ▼
[返回] { id, graph: { title, nodes, edges, rawText, metadata? } }
        │
        ▼
[board/page.tsx setNodes/setEdges]
        │ 14. router.replace(`/board?id=${id}`)
        ▼
[用户开始拖拽/编辑/笔记]
        │ 15. nodes/edges 变化 → 800ms 防抖 + 30s 周期
        │     撤销/重做快照(结构变更前)
        ▼
[PATCH /api/projects/[id]]  { nodes, edges, title, rawText, metadata }
        │ 16. UPDATE documents SET ... WHERE id=? AND userId=?
        ▼
[SaveIndicator 显示 'saved']
```

---

## 9. AI 能力矩阵

| 端点 | 模式 | 输入 | 输出 | 限流 | 持久化 |
| --- | --- | --- | --- | --- | --- |
| `/api/ingest` | 同步 JSON | URL/文件 + type | `{ id, graph }` | heavy | documents 表(插入/更新) |
| `/api/explain` | 流式 SSE | `{ nodeTitle, nodeDescription, sourceContext }` | `[EXPLANATION]...[ANALOGY]...` 文本 | light | usageRecords |
| `/api/qa` | 流式 SSE | `{ projectId, question, history }` | Markdown 答案 | light | usageRecords + conversations(由前端保存) |
| `/api/review` | 流式 SSE | `{ projectIds: string[] }`(2-8) | Markdown 文献综述 | heavy | usageRecords |
| `/api/compare` | 流式 SSE + JSON | `{ projectIds: string[] }`(2-5) | `{ result: { id } }` + 流式 JSON | heavy | usageRecords + documents(插入新项目) |

**共同特性**：
- 所有 AI 路由追加用户 AI 输出语言指令
- 所有 AI 路由记录 `usageRecords`
- 所有 AI 路由要求认证(除 `/api/share/[shareId]`)
- 流式端点统一 SSE 格式：`data: {content}\n\n` + `data: [DONE]\n\n`

---

## 10. 环境变量

复制 `.env.example` 为 `.env.local` 并填入：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `AGNES_API_KEY` | ✅ | Agnes AI 平台申请 |
| `DATABASE_URL` | ✅ | Neon Postgres 连接串，带 `?sslmode=require` |
| `BETTER_AUTH_SECRET` | ✅ | 用 `openssl rand -base64 32` 生成 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ⚠️ OAuth 登录需要 | Google Cloud Console OAuth Client |
| `NEXT_PUBLIC_APP_URL` | ✅ | 前端 base URL，通常 `http://localhost:3000` |
| `APP_URL` | ✅ | 服务端 base URL(中间件和 OAuth 回调) |
| `RESEND_API_KEY` | ⚠️ 生产邮件发送 | Resend 邮件服务(可选) |

---

## 11. 本地运行方式

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入真实 key

# 3. 启动开发服务器
npm run dev
# 默认 http://localhost:3000
```

常用脚本(`package.json`)：

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Next.js 开发服务 |
| `npm run build` | 生产构建(`output: "standalone"`) |
| `npm run start` | 运行构建产物 |
| `npm run lint` | Next.js Lint |
| `npm run format` / `format:check` | Prettier 格式化 |
| `npm run db:push` | Drizzle 把 schema 直接推到数据库(无迁移文件) |
| `npm run db:studio` | 启动 Drizzle Studio 可视化 |

---

## 12. 数据库迁移

- 当前使用 `drizzle-kit push` 直接同步(适合 MVP 阶段，无迁移历史)
- 配置文件 `drizzle.config.ts`：
  - `schema: './src/db/schema.ts'`
  - `out: './src/db/migrations'`(目录已预留但尚未使用)
- 正式生产前建议改为生成迁移文件：`drizzle-kit generate` → 提交 SQL → 在 CI 中执行

---

## 13. 扩展点与待完善项

> 这些点不是 bug，而是产品演进中自然出现的"下一步"。

### 13.1 已实现但可增强

1. **节点类型扩展**：`types/index.ts` 声明了 `diagram` / `summary`，但未注册渲染器。
2. **邮件发送**：`lib/email.ts` 生产态仍为 `console.log`，需接入 Resend/SendGrid。
3. **限流存储**：`lib/rate-limit.ts` 为内存存储，多副本部署需换 Redis。
4. **数据库迁移**：仍用 `push`，生产前需改为 `generate` + CI 执行。
5. **测试**：`npm test` 仅 `echo "No tests yet"`，无单测/集成测试。

### 13.2 待完善

6. **错误边界**：Board/CodeBoard 页面缺少全局 `error.tsx`，AI 调用失败或 DB 异常时建议给出更友好的降级 UI。
7. **可访问性**：`SaveIndicator` 已加 `role="status"` + `aria-live`，其他交互组件可继续补 `aria-label`。
8. **移动端适配**：画布在小屏幕上的体验待优化。
9. **性能**：大图谱(>100 节点)渲染性能待优化(虚拟化/分块)。

---

## 附录 A · 关键文件速查

| 关注点 | 文件 |
| --- | --- |
| Paper 摄取 Prompt | `src/app/api/ingest/route.ts` (`SYSTEM_PROMPT_PAPER`) |
| Code 摄取 Prompt | `src/app/api/ingest/route.ts` (`SYSTEM_PROMPT_CODE`) |
| 解释 Prompt | `src/app/api/explain/route.ts` (`EXPLAIN_PROMPT`) |
| Q&A Prompt | `src/app/api/qa/route.ts` (`SYSTEM_PROMPT`) |
| 综述 Prompt | `src/app/api/review/route.ts` (`SYSTEM_PROMPT`) |
| 对比 Prompt | `src/app/api/compare/route.ts` (`SYSTEM_PROMPT`) |
| Paper 画布 | `src/app/board/page.tsx` |
| Code 画布 | `src/app/codeboard/page.tsx` |
| 节点组件 | `src/components/Nodes/ConceptNode.tsx` / `CodeNode.tsx` |
| 自动保存 | `src/app/board/page.tsx` (debounce + periodic) |
| 撤销重做 | `src/app/board/page.tsx` (past/future stacks) |
| 数据库表 | `src/db/schema.ts` |
| 认证配置 | `src/lib/auth.ts` |
| 限流 | `src/lib/rate-limit.ts` |
| AI 语言指令 | `src/lib/ai-settings.ts` |
| 客户端 session | `src/lib/auth-client.ts` |
| i18n 资源 | `src/locales/en.json` / `zh.json` |
| 设计规范 | `.trae/rules/ui-design.md` |
| 全局样式 | `src/app/globals.css` |
| 图谱归一化 | `src/utils/graph-normalize.ts` |
| 自动布局 | `src/utils/auto-layout.ts` |
| 导出 | `src/utils/export-markdown.ts` / `export-image.ts` |

---

## 附录 B · 术语对照

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| Board | 工作台 | `/board` 页，Paper 知识图谱画布 |
| CodeBoard | 代码工作台 | `/codeboard` 页，Code 知识图谱画布 |
| Project | 项目 | 一个文档/代码对应的图谱，含 nodes/edges/metadata |
| Node | 节点 | 图谱中的概念/模块/函数/类卡片 |
| Edge | 边 | 节点之间的关系 |
| Ingestion | 摄取 | 把外部文档/URL/代码导入系统 |
| Explanation | 解释 | 选中节点后展示的 AI 辅助解读(EXPLANATION + ANALOGY) |
| Q&A | 问答 | 基于图谱+原文的对话 |
| Review | 文献综述 | 多论文 AI 综合成结构化综述 |
| Compare | 对比 | 多论文生成统一对比图谱 |
| Share | 分享 | 生成公开只读链接 |
| Usage | 用量 | AI 请求次数统计 |
| Section | 章节 | Paper 节点的章节分类(abstract/introduction/method/...) |

---

*文档更新时间：2026-06-23 · 严格遵循 `.trae/rules/ui-design.md` 中定义的 Editorial 设计语言。*
