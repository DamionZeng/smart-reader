# SmartReader · 概念图谱重构设计文档

> **状态**: Draft v1.1 · 待 Spec Review (第 2 轮)
> **日期**: 2026-06-23
> **作者**: Damion Zeng (与 AI 协作)
> **关联**: 替代当前 `SYSTEM_PROMPT_PAPER` / `SYSTEM_PROMPT_CODE` 单次 LLM 抽图方案
> **变更**: v1.1 修复 spec-review 第 1 轮的 10 个 Critical 问题

---

## 1. 背景与动机

### 1.1 当前实现的局限

SmartReader 目前的图谱生成依赖**单次 LLM 调用**:

- `src/app/api/ingest/route.ts` 中的 `SYSTEM_PROMPT_PAPER` / `SYSTEM_PROMPT_CODE` 要求 AI 一次性输出 5-20 个节点的 JSON
- 每个节点是"论文小节"或"代码模块"粒度, 强制包含 `title` + `description`
- 输入截断到 50,000 字符
- 布局用 dagre 树形 (TB/LR)

这套方案在**简单论文/小项目**上可用, 但在**复杂论文/大型 repo** 上有三个结构性缺陷:

| 缺陷 | 根因 | 表现 |
| --- | --- | --- |
| **准确度不足** | 50k 截断 + 单次调用, LLM 必须在"保结构"和"保细节"间取舍 | 关键概念遗漏, 关系编造 |
| **粒度太粗** | 节点是"小节"而非"概念" | 无法呈现 Transformer / Self-Attention / QKV 这类细粒度实体 |
| **可读性差** | 扁平 5-20 节点 + 树形布局 | 20+ 节点开始拥挤, 无法呈现"概念聚类"和"主题群" |

### 1.2 目标产品形态

参考 CiteSpace / VOSviewer / 知识气泡图, 新产品应该是**概念共现知识图谱**:

- **节点** = 论文里实际出现的每一个技术概念 (100-500 个)
- **边** = 概念间的共现关系或语义关系 (500-1500 条)
- **聚类** = Leiden 社区检测 + LLM 命名 (8-15 个主题群)
- **布局** = 力导向 (force-directed), 概念自然成团
- **层级** = 主题群可嵌套展开, 大气泡套小气泡

### 1.3 设计原则

1. **统计驱动, LLM 辅助**: 共现边用统计, 命名用 LLM —— 不让 LLM 编造结构
2. **AST 优先 (代码侧)**: 静态分析给骨架, LLM 给语义
3. **渐进式信息架构**: 概览 → 概念层 → 焦点层 → 钻取层, 4 层 LOD
4. **Editorial 审美不变**: 暖米色 / 无圆角 / 无阴影 / Playfair + Inter
5. **向后兼容**: 旧项目保留, 新项目走新 pipeline, 双版本共存
6. **Serverless 友好**: 所有技术选型必须兼容 Next.js serverless 运行时 (无 native binding, 无内存状态)

---

## 2. 数据模型

### 2.1 核心类型定义

新建 `src/types/concept-graph.ts`, 不修改旧 `src/types/index.ts`:

```ts
// === 概念类型: 论文 + 代码共用, 拆为两个联合 ===
type PaperConceptType =
  | 'method'    // 算法/流程: Self-Attention, Backprop
  | 'model'     // 具体模型: BERT, GPT-3
  | 'metric'    // 指标: Recall@K, BLEU
  | 'dataset'   // 数据集: ImageNet, MNIST
  | 'term'      // 通用术语: embedding, gradient
  | 'tool'      // 工具/库: PyTorch, NumPy
  | 'task';     // 任务: image classification, NER

type CodeConceptType =
  | 'function'
  | 'class'
  | 'module'
  | 'interface'
  | 'variable';

type ConceptType = PaperConceptType | CodeConceptType;

// === 概念节点 ===
interface Concept {
  id: string;                    // canonical slug, 由 label 归一化生成
  label: string;                 // 展示名, e.g. "Self-Attention"
  type: ConceptType;
  aliases: string[];             // 合并用别名
  frequency: number;             // 在原文出现次数
  importance: number;            // 0-1, 综合 PageRank + frequency 归一化
  clusterId: string;             // 所属社区
  // 可选富化字段 (仅 top-30 节点填充, 节省 token)
  description?: string;          // LLM 1-2 句解释
  anchors: string[];             // 1-3 个原文锚点句 (原 sourceContexts, 重命名避免与 edge 字段混淆)
  // code 专属
  filePath?: string;
  codeSnippet?: string;
}

// === 边: 关系 (统计或语义) ===
type ConceptEdgeType =
  | 'co-occurs'   // 统计: 同句/同段出现
  | 'defines'     // 语义: A 定义/形式化了 B
  | 'uses'        // 语义: A 使用了 B
  | 'extends'     // 语义: A 扩展了 B
  | 'calls'       // code 专属: A 调用了 B
  | 'imports'     // code 专属: A 导入了 B
  | 'implements'; // code 专属: A 实现了 B

interface ConceptEdge {
  id: string;
  source: string;                // concept id
  target: string;
  type: ConceptEdgeType;
  weight: number;                // 归一化到 1-10 (原始累加后 min-max 归一化)
  evidence: string[];            // 1-3 个佐证句 (原 contexts, 重命名避免与 concept.anchors 混淆)
  confidence: number;            // 0-1, 语义边的 LLM 置信度; co-occurs 固定为 1
}

// === 社区: 聚类结果 + LLM 命名 ===
interface ConceptCluster {
  id: string;
  label: string;                 // LLM 命名, e.g. "注意力机制与位置编码"
  description?: string;          // LLM 一句话总结
  colorName: string;             // 调色板色名 (非色值, 运行时查表)
  conceptIds: string[];
  parentClusterId?: string;      // 嵌套用
  level: number;                 // 0=顶层, 1=子层 (硬限制: 最多 2 层)
}

// === 完整图谱 ===
interface ConceptGraph {
  id: string;
  title: string;
  type: 'paper' | 'code';       // image 类型沿用旧 pipeline, 不迁移
  metadata?: PaperMetadata;      // code 项目时为 undefined
  rawText: string;               // 完整原文 (用于追溯 + Q&A)
  concepts: Concept[];
  edges: ConceptEdge[];
  clusters: ConceptCluster[];
  createdAt: string;
}
```

**v1.1 变更说明**:
- 删除 `Concept.symbolKind` (与 `type` 冗余), 拆分 `PaperConceptType` / `CodeConceptType`
- `Concept.sourceContexts` → `Concept.anchors` (避免与 edge 字段混淆)
- `ConceptEdge.contexts` → `ConceptEdge.evidence` (同上)
- `ConceptCluster.color` (string) → `ConceptCluster.colorName` (枚举, 运行时查 `CLUSTER_PALETTE`)
- `ConceptEdge.weight` 明确归一化策略 (原始累加后 min-max 归一化到 1-10)
- `ConceptGraph.type` 不含 `'image'` —— image 项目沿用旧 pipeline, 不迁移

### 2.2 数据库 Schema 变更

**不动现有 `documents` 表** (向后兼容)。新增 2 张表:

```ts
// src/db/schema.ts (新增)

// 概念图谱主表
export const conceptGraphs = pgTable(
  "concept_graphs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null", // 升级后旧记录保留, 不级联删除
    }),
    title: varchar("title", { length: 255 }).notNull(),
    type: varchar("type", { length: 20 }).notNull(), // 'paper' | 'code'
    concepts: jsonb("concepts").notNull(),           // Concept[]
    edges: jsonb("edges").notNull(),                 // ConceptEdge[]
    clusters: jsonb("clusters").notNull(),           // ConceptCluster[]
    rawText: text("raw_text"),
    // Paper metadata (code 项目为 null)
    authors: text("authors"),
    year: integer("year"),
    venue: varchar("venue", { length: 255 }),
    doi: varchar("doi", { length: 255 }),
    abstract: text("abstract"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    shareId: varchar("share_id", { length: 36 }),
  },
  (table) => ({
    userIdIdx: index("idx_concept_graphs_user_id").on(table.userId),
    documentIdx: index("idx_concept_graphs_document").on(table.documentId),
    userCreatedIdx: index("idx_concept_graphs_user_created").on(
      table.userId,
      table.createdAt
    ),
  })
);

// 异步 Ingest Job 表 (替代内存 Map, serverless 安全)
export const conceptGraphJobs = pgTable(
  "concept_graph_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, {
      onDelete: "cascade",
    }),
    status: varchar("status", { length: 20 }).notNull().default("processing"),
    // status: 'processing' | 'done' | 'failed'
    progress: jsonb("progress").notNull().default({
      step: "queued",
      current: 0,
      total: 7,
    }),
    // progress: { step: string, current: number, total: number }
    graphId: uuid("graph_id"), // 完成后指向 concept_graphs.id
    error: text("error"),      // 失败时存错误信息
    inputType: varchar("input_type", { length: 20 }).notNull(), // 'paper' | 'code'
    inputUrl: text("input_url"),
    inputFileName: text("input_file_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("idx_concept_graph_jobs_user").on(table.userId),
    statusIdx: index("idx_concept_graph_jobs_status").on(table.status),
  })
);
```

**迁移策略 (完整)**:
1. `drizzle-kit generate` 生成迁移 SQL → `drizzle-kit push` 应用
2. 旧 `documents` 表**完全保留**, 旧项目继续用 React Flow + dagre
3. Dashboard 上旧项目卡片显示 `Legacy` badge + "升级为概念图谱" 按钮
4. **升级流程**: 点击按钮 → 创建 `conceptGraphJobs` 记录 (异步) → 用旧 `documents.rawText` 作为输入跑新 pipeline → 完成后创建 `conceptGraphs` 记录, `documentId` 指向旧记录 → Dashboard 显示新图谱, 旧记录保留
5. **升级是异步的**: 按钮点击后跳转到进度页, 轮询 job 状态
6. **升级失败**: 旧记录不受影响, job 记录 error, 用户可重试
7. **升级免费**: 不计入用量统计 (作为功能升级引导)
8. **删除**: `DELETE /api/concept-graph/[id]` 删除新图谱; 旧 `documents` 记录独立删除; `documentId` FK 是 `set null` 不级联
9. **image 类型**: 不迁移, 沿用旧 pipeline; Dashboard 上 image 项目不显示升级按钮

---

## 3. Ingest 流水线

### 3.1 论文流水线 (7 步)

```
论文 PDF / Markdown / URL
    │
    ▼
[Step 1] 文本抽取 + 结构保留
    │  - pdf-parse 提取文字 (沿用现有实现)
    │  - 保留章节标题 + 段落边界
    │  - 产出: { section: string, paragraphs: string[] }[]
    │  - 错误处理: PDF 解析失败 → 返回 400 "Failed to extract text"
    │
    ▼
[Step 2] 句子切分
    │  - 用 sentence-splitter 切句 (轻量, 不用 compromise)
    │  - 保留 sentence → paragraph → section 反向索引
    │  - 产出: Sentence[] (含 section, paragraphIndex, text)
    │
    ▼
[Step 3] 概念抽取 (三路并行, 取并集)
    │  ├─ 3a. LLM Prompt: "List every technical concept, method, model,
    │  │    dataset, metric, and named entity. Use canonical names."
    │  │    → 50-200 entities
    │  │    错误处理: LLM 失败 → 降级到纯 3b+3c
    │  ├─ 3b. 短语挖掘: TextRank / YAKE → top-100 短语
    │  └─ 3c. 词典匹配: CS 领域专有词典 → 已知实体
    │  - 合并三路结果, 去重
    │  - 产出: RawConcept[] (含原始字符串 + 来源标记)
    │  - 错误处理: 三路全失败 → job status='failed', error='Concept extraction failed'
    │
    ▼
[Step 4] 概念归一 (Entity Resolution)
    │  - 字符串归一: lowercase, 去标点, 去停用词
    │  - 别名合并: "BERT" = "bert" = "B.E.R.T." = "the BERT model"
    │  - Embedding 合并: cosine > 0.88 → 合并 (谨慎阈值)
    │    错误处理: Embedding 服务不可用 → 降级到纯字符串归一
    │  - 频率统计: 合并后重新计算 frequency
    │  - 产出: Concept[] (canonical, 目标 150-400 个)
    │  - id 生成: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    │    中文论文: label 保持原文, id 用 pinyin 或 hash
    │
    ▼
[Step 5] 共现边构建
    │  - 滑窗策略:
    │    - 同一句 → edge weight += 2
    │    - 同一段 → edge weight += 0.5
    │  - 过滤: weight < 2 视为噪声丢弃
    │  - 附加 evidence: 记录共现的原文句子 (最多 3 个)
    │  - 归一化: 所有边 weight 做 min-max 归一化到 1-10
    │  - 产出: ConceptEdge[] (type='co-occurs', confidence=1, 目标 500-1500 条)
    │
    ▼
[Step 6] 社区检测 + LLM 命名
    │  - Leiden 算法 (graphology-communities-leiden)
    │    - 参数: resolution=1.0, seed=42 (可复现)
    │    - 第一层: 目标 8-15 个顶层 cluster
    │      - 若 < 5: 提高 resolution 到 1.5 重跑
    │      - 若 > 20: 降低 resolution 到 0.5 重跑
    │    - 递归: 每个 cluster 内再 Leiden, 最多 2 层 (硬限制)
    │  - 调色板分配: 8 色循环, 超过 8 个 cluster 用 stroke pattern 区分 (dashed/dotted)
    │  - LLM 命名: 给每个 cluster 喂 top-5 概念 → { label, description }
    │    错误处理: LLM 命名失败 → fallback 用 top-3 概念名拼接
    │  - 产出: ConceptCluster[] (含 level, parentClusterId)
    │
    ▼
[Step 7] 富化 (仅 top-30 概念)
    │  - 按 importance (PageRank + frequency) 排序, 取 top-30
    │  - LLM 对每个生成 1-2 句 description
    │  - 从原文挑 1-3 个最具代表性的句子作为 anchors
    │  - 产出: 富化后的 Concept[] (top-30 有 description, 其余只有 label)
    │  - 错误处理: LLM 富化失败 → 仅影响 description 缺失, 不阻塞
    │
    ▼
[Final] ConceptGraph → 持久化到 concept_graphs 表
```

### 3.2 代码流水线 (5 步)

```
源代码文件 / GitHub URL
    │
    ▼
[Step 1] AST 解析 (确定性, 不靠 LLM)
    │  - web-tree-sitter (WASM 版本, serverless 兼容)
    │    P1: TypeScript/JavaScript (tstypescript.wasm)
    │    P2: Python (python.wasm)
    │    P3: Go, Rust, Java (后续)
    │  - WASM 文件放在 public/wasm/ 目录, 运行时 fetch 加载
    │  - 提取符号: modules, classes, functions, methods, interfaces
    │  - 每个符号含: filePath, signature, scope, startLine, endLine
    │  - 产出: Symbol[]
    │  - 错误处理: 不支持的语言 → 降级到 LLM 抽取 (Step 3 only)
    │
    ▼
[Step 2] 静态关系构建 (确定性)
    │  - import graph: 遍历 import/require 语句 → 边 "imports"
    │  - call graph: 遍历 call_expr → 边 "calls"
    │  - inheritance: extends/implements → 边 "extends" / "implements"
    │  - 这些边 100% 准确, 不需要 LLM
    │  - 产出: ConceptEdge[] (type='imports'/'calls'/'extends'/'implements', confidence=1)
    │
    ▼
[Step 3] 概念层抽取 (LLM)
    │  - 输入: README + 顶层目录结构 + 入口文件
    │  - LLM Prompt: "Identify architectural concepts in this project.
    │    e.g. 'Plugin System', 'Event Loop', 'Middleware Chain'"
    │  - 产出: 5-15 个 concept 节点 (type='term')
    │  - 错误处理: LLM 失败 → 跳过概念层, 仅用 AST 符号
    │
    ▼
[Step 4] 概念 ↔ 符号链接 (LLM)
    │  - 对每个架构概念, LLM 找出实现它的 symbols
    │  - 加边: concept --uses--> symbol
    │  - 加边: concept --defines--> concept (概念间关系)
    │  - 产出: 补充 ConceptEdge[]
    │
    ▼
[Step 5] 共现 + 聚类 + 命名 (同论文 Step 5-6)
    │  - 代码里"共现"= 同文件 / 同模块
    │  - Leiden 聚类 + LLM 命名
    │  - 产出: ConceptCluster[]
    │
    ▼
[Final] ConceptGraph → 持久化
```

**关键原则**: code pipeline 里 **AST 是骨架 (确定), LLM 是血肉 (语义)**; 论文 pipeline 里 **统计 + 短语挖掘是骨架, LLM 是顶层命名**。

### 3.3 LLM Prompt 设计

#### 概念抽取 Prompt (论文 Step 3a)

```
You are a technical concept extractor for academic papers.

Read the following text and list EVERY technical concept, method, model,
dataset, metric, tool, and named entity mentioned.

Output ONLY a JSON array of objects:
[
  {
    "label": "canonical name, e.g. 'Self-Attention'",
    "type": "method | model | metric | dataset | term | tool | task",
    "aliases": ["alternative names, abbreviations"],
    "evidence": "a short quote from the text where this concept appears"
  }
]

Rules:
- Be exhaustive: list 50-200 concepts, not just the "important" ones.
- Use canonical names: "BERT" not "bert model", "Transformer" not "the transformer architecture".
- Include abbreviations as aliases, not separate entries.
- Do NOT include generic words (the, method, result, approach) unless they are domain-specific terms.
```

#### Cluster 命名 Prompt (Step 6)

```
You are naming a concept cluster from an academic paper.

The following concepts were grouped together by community detection:
{concept_labels: string[]}

Output ONLY a JSON object:
{
  "label": "2-5 word title for this group, e.g. 'Attention Mechanisms'",
  "description": "1 sentence summarizing what this cluster represents"
}

Rules:
- The label should be descriptive but concise.
- The description should explain the common theme, not list the concepts.
```

### 3.4 新增依赖

```json
{
  "dependencies": {
    "cytoscape": "^3.30.2",
    "cytoscape-fcose": "^2.2.0",
    "cytoscape-cola": "^2.5.1",
    "cytoscape-graphml": "^1.0.3",
    "web-tree-sitter": "^0.22.0",
    "sentence-splitter": "^5.0.0",
    "graphology": "^0.25.4",
    "graphology-communities-leiden": "^0.12.0",
    "graphology-metrics": "^0.3.0",
    "graphology-types": "^0.24.7"
  }
}
```

**v1.1 变更说明**:
- `tree-sitter` → `web-tree-sitter` (WASM, serverless 兼容)
- 删除 `compromise` (与 `sentence-splitter` 重复, 只留轻量的)
- 新增 `graphology-metrics` (PageRank 计算 importance)
- 新增 `graphology-types` (peer dep of leiden)
- 新增 `cytoscape-graphml` (GEXF/GraphML 导出)

### 3.5 LLM 调用成本控制

单篇论文最坏情况: Step 3a (1 次) + Step 6 命名 (8-15 次) + Step 7 富化 (30 次) = **~45 次 LLM 调用**。

**成本控制策略**:
1. **Step 3a 不分块**: 整篇论文 (50k 字符) 一次 LLM 调用抽概念, 不按 chunk 分 (避免 10-20 次调用)
2. **Step 6 批量命名**: 8-15 个 cluster 的命名合并为 1 次 LLM 调用 (输入所有 cluster 的 top-5 概念, 输出所有命名)
3. **Step 7 批量富化**: 30 个概念的 description 合并为 3 次 LLM 调用 (每次 10 个)
4. **总调用次数**: ~5 次 (1 + 1 + 3), 在 heavy 限流 (10/min) 内可完成
5. **缓存**: 相同输入的 LLM 响应缓存到 DB (hash 输入 → 存响应), 避免重复调用

---

## 4. 渲染层 (cytoscape.js)

### 4.1 技术选型: cytoscape.js

**选择理由**:
- 功能齐全: 内置 10+ 布局算法 (fcose, cola, euler, cose-bilkent)
- 性能: Canvas 渲染, 1000 节点流畅
- 生态: 丰富插件 (panzoom, popper, context-menus)
- React 集成: 自行封装 `useCytoscape` hook (不依赖第三方 wrapper, 避免 React 19 兼容问题)

**不选 react-force-graph-2d 的原因**: >500 节点性能下降, 布局算法少。
**不选 sigma.js 的原因**: 配置复杂, WebGL 在某些设备有兼容问题。

### 4.2 React 集成方案 (SSR 安全)

cytoscape.js 依赖 `window` / `document`, 必须用 `next/dynamic` + `ssr: false` 动态加载。

```tsx
// src/components/graph/ConceptGraphCanvas.tsx
"use client";
import { useEffect, useRef } from "react";
import type { ConceptGraph } from "@/types/concept-graph";

// cytoscape 在 useEffect 内动态 import, 避免 SSR 阶段访问 window
interface Props {
  graph: ConceptGraph;
  onNodeSelect?: (conceptId: string) => void;
  onClusterSelect?: (clusterId: string) => void;
}

export function ConceptGraphCanvas({ graph, onNodeSelect, onClusterSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);

  // 初始化: 仅在 graph.id 变化时重建 cytoscape 实例
  useEffect(() => {
    if (!containerRef.current) return;

    let cy: any;
    let destroyed = false;

    (async () => {
      const cytoscape = (await import("cytoscape")).default;
      const fcose = (await import("cytoscape-fcose")).default;
      const cola = (await import("cytoscape-cola")).default;
      if (destroyed) return;

      cytoscape.use(fcose);
      cytoscape.use(cola);

      cy = cytoscape({
        container: containerRef.current,
        elements: buildElements(graph),
        style: buildStylesheet(graph),
        layout: {
          name: "fcose",
          animate: true,
          nodeRepulsion: 8000,
          idealEdgeLength: 100,
          nodeSeparation: 80,
        },
        minZoom: 0.2,
        maxZoom: 3,
        wheelSensitivity: 0.3,
      });

      // 节点点击
      cy.on("tap", "node", (e: any) => {
        onNodeSelect?.(e.target.id());
      });

      // cluster 点击 (compound parent node)
      cy.on("tap", "node:parent", (e: any) => {
        onClusterSelect?.(e.target.id());
      });

      // zoom 事件: 动态控制标签显示
      cy.on("zoom", () => {
        const zoom = cy.zoom();
        if (zoom > 0.5) {
          cy.nodes().addClass("show-label");
        } else {
          cy.nodes().removeClass("show-label");
        }
      });

      cyRef.current = cy;
    })();

    return () => {
      destroyed = true;
      if (cy) cy.destroy();
    };
    // 仅在 graph.id 变化时重建, 避免频繁 destroy/create
  }, [graph.id]);

  // 元素更新: concepts/edges/clusters 变化时, 不重建实例
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().remove();
    cy.add(buildElements(graph));
    cy.layout({ name: "fcose", animate: true }).run();
  }, [graph.concepts, graph.edges, graph.clusters]);

  return <div ref={containerRef} className="w-full h-full" />;
}
```

```tsx
// src/app/graph/page.tsx 中使用 (SSR 安全)
import dynamic from "next/dynamic";

const ConceptGraphCanvas = dynamic(
  () => import("@/components/graph/ConceptGraphCanvas").then(m => m.ConceptGraphCanvas),
  { ssr: false, loading: () => <LoadingScreen /> }
);
```

### 4.3 视觉规范 (Editorial 兼容)

```ts
// src/components/graph/styles.ts

function buildStylesheet(graph: ConceptGraph): any[] {
  const clusterColorMap = new Map(
    graph.clusters.map(c => [c.id, CLUSTER_PALETTE.find(p => p.name === c.colorName)?.fill || "#1C1C1C"])
  );

  return [
    // === 节点默认样式 ===
    {
      selector: "node",
      style: {
        "background-color": (ele: any) => {
          const color = clusterColorMap.get(ele.data("clusterId"));
          return color ? color + "33" : "#1C1C1C33";
        },
        "border-color": (ele: any) => {
          const color = clusterColorMap.get(ele.data("clusterId"));
          return color || "#1C1C1C";
        },
        "border-width": 1.5,
        "border-style": "solid",
        // 节点大小用分级 selector (比函数快, 1000 节点优化)
        "width": 16,
        "height": 16,
        "label": "data(label)",
        "font-family": "Inter, sans-serif",
        "font-size": 11,
        "color": "#1C1C1C",
        "text-opacity": 0, // 默认隐藏
        "text-valign": "bottom",
        "text-margin-y": 6,
        "text-wrap": "wrap",
        "text-max-width": 100,
      },
    },
    // 大节点: importance >= 0.8
    {
      selector: "node[importance >= 0.8]",
      style: { "width": 30, "height": 30 },
    },
    // 中节点: 0.5 <= importance < 0.8
    {
      selector: "node[importance >= 0.5][importance < 0.8]",
      style: { "width": 22, "height": 22 },
    },
    // zoom > 0.5 时显示标签 (通过 class 控制)
    {
      selector: "node.show-label",
      style: { "text-opacity": 1 },
    },
    // === Hover 态 ===
    {
      selector: "node:hover",
      style: {
        "border-width": 2.5,
        "z-index": 999,
      },
    },
    // === 选中态 ===
    {
      selector: "node.selected",
      style: {
        "border-width": 3,
        "border-color": "#1C1C1C",
        "background-color": "#1C1C1C",
        "color": "#F9F8F6",
        "text-opacity": 1,
      },
    },
    // === 一阶邻居高亮 / 淡化 ===
    {
      selector: "node.highlighted",
      style: { "opacity": 1, "border-width": 2 },
    },
    {
      selector: "node.faded",
      style: { "opacity": 0.15 },
    },
    // === 边默认样式 ===
    {
      selector: "edge",
      style: {
        // 边颜色从 source 节点的 clusterId 查表 (运行时在 buildElements 中注入 sourceClusterId)
        "line-color": (ele: any) => {
          const color = clusterColorMap.get(ele.data("sourceClusterId"));
          return color ? color + "4D" : "#1C1C1C4D";
        },
        "width": (ele: any) => Math.max(0.5, Math.min(4, (ele.data("weight") || 1) * 0.4)),
        "curve-style": "bezier",
        "opacity": 0.6,
        "target-arrow-color": "transparent",
        "source-arrow-color": "transparent",
      },
    },
    // === Cluster 凸包 (compound node) ===
    {
      selector: ":parent",
      style: {
        "background-color": (ele: any) => {
          const color = CLUSTER_PALETTE.find(p => p.name === ele.data("colorName"))?.fill;
          return color ? color + "14" : "#1C1C1C14";
        },
        "border-color": (ele: any) => {
          const color = CLUSTER_PALETTE.find(p => p.name === ele.data("colorName"))?.fill;
          return color ? color + "4D" : "#1C1C1C4D";
        },
        "border-width": 1,
        "border-style": "dashed",
        "background-opacity": 1,
        "label": "data(label)",
        "font-family": "Playfair Display, serif",
        "font-style": "italic",
        "font-size": 14,
        "color": "#1C1C1C",
        "text-opacity": 0.7,
        "text-valign": "top",
        "text-margin-y": -8,
      },
    },
  ];
}

// buildElements 中为每条边注入 sourceClusterId
function buildElements(graph: ConceptGraph) {
  const conceptClusterMap = new Map(
    graph.concepts.map(c => [c.id, c.clusterId])
  );
  return [
    ...graph.clusters.map(c => ({
      group: "nodes" as const,
      data: { id: `cluster-${c.id}`, label: c.label, colorName: c.colorName },
      // compound parent
    })),
    ...graph.concepts.map(c => ({
      group: "nodes" as const,
      data: {
        id: c.id,
        label: c.label,
        importance: c.importance,
        clusterId: c.clusterId,
        parent: `cluster-${c.clusterId}`,
      },
    })),
    ...graph.edges.map(e => ({
      group: "edges" as const,
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        weight: e.weight,
        sourceClusterId: conceptClusterMap.get(e.source),
      },
    })),
  ];
}
```

**v1.1 变更说明**:
- 修复: 节点大小用分级 selector (`node[importance >= 0.8]`) 替代函数 (性能优化)
- 修复: 标签显示用 `node.show-label` class 替代重复 selector (M5)
- 修复: 边颜色通过 `buildElements` 注入 `sourceClusterId` (C4)
- 修复: cluster 点击用 `node:parent` selector (M7)

### 4.4 4 层渐进式视图

```
Layer 1 · 概览 (默认进入)
  └─ 只显 cluster 凸包 + cluster label
  └─ 节点是淡色点, 无标签
  └─ 目标: "这文章有哪几个主题群?"
  └─ 触发: 初始加载 / 点击 "Overview" 按钮

Layer 2 · 概念层 (zoom > 0.5 自动进入)
  └─ 节点 label 淡入 (通过 show-label class)
  └─ 边可见
  └─ 目标: "每个主题里有哪些关键概念?"
  └─ 触发: 滚轮缩放超过阈值

Layer 3 · 焦点层 (点击某节点)
  └─ 该节点 + 一阶邻居高亮, 其他节点 alpha 0.15
  └─ 侧栏滑出 ConceptDetailPanel
  └─ 目标: "告诉我这个概念是什么"
  └─ 触发: 单击节点

Layer 4 · 钻取 (双击 cluster)
  └─ 该 cluster 内部重新跑一次 fcose 布局
  └─ 顶层 cluster 退到画布边缘 (半透明)
  └─ 目标: "深入一个主题"
  └─ 触发: 双击 cluster 凸包
```

**空图处理**: 新项目刚创建时 `concepts/edges/clusters` 都是 `[]`, 画布显示空状态引导: "Upload a paper or code file to generate a concept graph"。

### 4.5 工具栏

```
[布局选择] Force (fcose) / Radial / Hierarchical / Time
[大小映射] Importance / Frequency / PageRank
[显示开关] □ Cluster hulls  □ Edges  □ Labels
[过滤]     按 type / cluster / importance 阈值 (slider)
[导出]     PNG / SVG / GraphML / JSON
```

### 4.6 调色板 (Editorial 兼容)

**低饱和度 8 色循环**, 超过 8 个 cluster 用 stroke pattern 区分:

```ts
const CLUSTER_PALETTE = [
  { name: "slate",   fill: "#1C1C1C" },
  { name: "rust",    fill: "#A0522D" },
  { name: "olive",   fill: "#6B8E23" },
  { name: "navy",    fill: "#1C2B4B" },
  { name: "plum",    fill: "#5D3A5D" },
  { name: "teal",    fill: "#2F5D5D" },
  { name: "umber",   fill: "#6B4226" },
  { name: "moss",    fill: "#4A5D23" },
];
// 透明度: fill@20% (节点), fill@100% (描边), fill@8% (凸包)
// 超过 8 个 cluster: 第 9+ 个用 dashed border, 第 16+ 个用 dotted border
```

---

## 5. API 设计

### 5.1 新增 API 路由

```
POST   /api/concept-graph/ingest
  - 接收: { url?, file?, type: 'paper' | 'code' }
  - 创建 job 记录, 返回 { jobId }
  - 限流: heavy (10/min)

GET    /api/concept-graph/jobs/[jobId]
  - 返回 { status, progress, graphId?, error? }
  - 限流: light (30/min)

GET    /api/concept-graph/[id]
  - 返回完整 ConceptGraph
  - 限流: light

PATCH  /api/concept-graph/[id]
  - 更新 concepts/edges/clusters (用户手动修正)
  - 限制: concepts ≤ 1000, edges ≤ 3000
  - 限流: light

DELETE /api/concept-graph/[id]
  - 删除图谱 (所有权校验)
  - 限流: light

POST   /api/concept-graph/[id]/enrich
  - 对未富化的概念批量生成 description
  - 限流: heavy

POST   /api/concept-graph/[id]/recluster
  - 重新跑 Leiden + 命名
  - 限流: heavy

GET    /api/concept-graph/[id]/export?format=png|svg|graphml|json
  - 导出图谱
  - 限流: light

POST   /api/concept-graph/compare
  - 多图谱合并 (简单并集, 不做复杂实体对齐)
  - 限流: heavy

POST   /api/concept-graph/[id]/share
  - 生成分享链接 (isPublic=true, shareId=UUID)
  - 限流: light

GET    /api/concept-graph/share/[shareId]
  - 公开只读访问 (无需认证)
```

### 5.2 异步 Ingest 方案 (DB 持久化)

大论文 (50+ 页) 的流水线耗时 10-30 秒 (5 次 LLM 调用)。方案:

```
1. POST /api/concept-graph/ingest
   → 创建 concept_graph_jobs 记录 (status='processing')
   → 立即返回 { jobId }
   → 使用 Next.js 的 waitUntil() 在响应后继续执行流水线
   → 每完成一步, UPDATE job 记录的 progress

2. 客户端轮询 GET /api/concept-graph/jobs/[jobId]
   → { status: 'processing', progress: { step: 'extracting', current: 3, total: 7 } }
   → 轮询间隔: 2 秒

3. 完成后:
   → { status: 'done', graphId: 'xxx' }
   → 客户端跳转 /graph?id=xxx

4. 失败:
   → { status: 'failed', error: 'Concept extraction failed' }
   → 客户端显示错误 + 重试按钮
```

**实现**: 用 `concept_graph_jobs` DB 表持久化状态 (serverless 安全)。`waitUntil()` 保证流水线在响应后继续执行。若 serverless 实例被回收, job 状态留在 DB, 下次轮询时检测到 `processing` 超时 (5 分钟) 则标记为 `failed`。

---

## 6. 与现有 AI 功能的集成

### 6.1 Explain (节点解释)

现有 `/api/explain` 接收 `{ nodeTitle, nodeDescription, sourceContext }`。新方案:

- **适配方式**: 新增 `/api/concept-graph/[id]/explain` 路由
- **输入**: `{ conceptId }` → 从 DB 查 concept 的 label/description/anchors
- **输出**: 流式 SSE (沿用现有格式)
- **Prompt 调整**: 从"解释论文小节"改为"解释技术概念", 附带 anchors 作为上下文
- **旧路由保留**: `/api/explain` 不动, 服务旧 board/codeboard

### 6.2 Q&A (问答)

现有 `/api/qa` 接收 `{ projectId, question, history }`, 上下文是 nodes/edges + rawText。新方案:

- **适配方式**: 新增 `/api/concept-graph/[id]/qa` 路由
- **上下文构造**:
  - 用 `concepts` (top-50 by importance) 替代 `nodes`
  - 用 `edges` (top-100 by weight) 替代旧 `edges`
  - `rawText` 不变 (截断到 30k 字符)
  - 新增: `clusters` 的 label/description 作为高层摘要
- **对话历史**: 复用 `conversations` 表, `projectId` 字段存 concept_graphs.id
- **旧路由保留**: `/api/qa` 不动

### 6.3 Review (文献综述)

现有 `/api/review` 聚合多论文的 nodes/edges/abstract。新方案:

- **适配方式**: 新增 `/api/concept-graph/review` 路由
- **输入**: `{ graphIds: string[] }` (2-8 个)
- **上下文**: 聚合各图谱的 clusters (高层主题) + top-20 concepts + abstract
- **输出**: 流式 Markdown (7 段结构不变)
- **旧路由保留**: `/api/review` 不动

### 6.4 Compare (对比)

现有 `/api/compare` 生成统一对比图谱。新方案:

- **适配方式**: 新增 `/api/concept-graph/compare` 路由
- **合并策略**: 简单并集 —— 跨图谱的相同 concept id 合并, `sourceContext` 标注来源
- **输出**: 新 ConceptGraph (插入 concept_graphs 表)
- **旧路由保留**: `/api/compare` 不动, 服务旧项目

### 6.5 Usage Tracking

现有 `usageRecords.endpoint` 枚举: `ingest/qa/explain/review/compare`。新增:

- `concept-graph-ingest`
- `concept-graph-enrich`
- `concept-graph-recluster`
- `concept-graph-qa`
- `concept-graph-explain`
- `concept-graph-compare`
- `concept-graph-review`

`trackUsage(userId, endpoint)` 函数不需要改 (endpoint 是 varchar)。

---

## 7. 页面路由与中间件

### 7.1 新增路由

```
/graph                    # 概念图谱工作台 (新)
/graph?id=xxx             # 加载特定图谱
/graph/compare?ids=...    # 多图谱对比
/graph/share/[shareId]    # 分享页 (只读)
```

### 7.2 现有路由保留

```
/board                    # 旧 Paper 图谱 (React Flow + dagre)
/codeboard                # 旧 Code 图谱 (React Flow + dagre)
/dashboard                # 仪表盘 (同时显示新旧项目)
```

### 7.3 中间件更新

`src/middleware.ts` 新增保护:

```
保护页面: /graph, /graph/compare
保护 API: /api/concept-graph/* (除 /api/concept-graph/share/*)
```

### 7.4 Dashboard 变更

- 新项目默认创建 concept graph
- 旧项目卡片加 "升级为概念图谱" 按钮 (异步 job)
- 项目类型 badge: `Legacy` (旧) / `Concept` (新)
- image 项目不显示升级按钮

### 7.5 分享功能

- 新 `concept_graphs` 表有 `isPublic` / `shareId` 字段
- 新增 `/api/concept-graph/share/[shareId]` 路由 (无需认证)
- 新增 `/graph/share/[shareId]/page.tsx` 页面 (只读 cytoscape)

### 7.6 Folders / Tags 集成

现有 `folders` / `tags` / `projectFolders` / `projectTags` 表 FK 到 `documents.id`。新方案:

- 新增 `conceptGraphFolders` / `conceptGraphTags` 表 (与旧表结构对称, FK 到 `conceptGraphs.id`)
- 或: 在 Dashboard 层用 `documentId` 关联 (若升级项目有 documentId)

**MVP 选择**: 不做新图谱的 folder/tag, P4 再加。

---

## 8. 组件结构

```
src/
├── components/
│   ├── graph/                          # 新: 概念图谱组件
│   │   ├── ConceptGraphCanvas.tsx      # cytoscape.js 画布 (动态加载)
│   │   ├── GraphToolbar.tsx            # 工具栏
│   │   ├── ClusterLegend.tsx           # 聚类图例
│   │   ├── ConceptDetailPanel.tsx      # 概念详情侧栏
│   │   ├── GraphFilter.tsx             # 过滤面板
│   │   ├── GraphExport.tsx             # 导出
│   │   ├── GraphEmpty.tsx              # 空状态
│   │   └── styles.ts                   # cytoscape 样式表
│   ├── Nodes/                          # 旧: 保留
│   └── board/                          # 旧: 保留
├── lib/
│   ├── graph/                          # 新: 图谱构建逻辑
│   │   ├── ingest-paper.ts             # 论文流水线
│   │   ├── ingest-code.ts              # 代码流水线
│   │   ├── concept-extract.ts          # 概念抽取
│   │   ├── entity-resolve.ts           # 概念归一
│   │   ├── cooccurrence.ts             # 共现边
│   │   ├── leiden.ts                   # 社区检测
│   │   ├── cluster-name.ts             # LLM 命名
│   │   ├── enrich.ts                   # 富化
│   │   └── pagerank.ts                 # PageRank 计算
│   ├── ast/                            # 新: AST 解析
│   │   ├── parser.ts                   # web-tree-sitter 封装
│   │   ├── typescript.ts               # TS 解析器
│   │   ├── python.ts                   # Python 解析器
│   │   └── symbols.ts                  # 符号提取
│   └── ...
├── app/
│   ├── graph/                          # 新: 概念图谱页面
│   │   ├── page.tsx
│   │   ├── compare/
│   │   │   └── page.tsx
│   │   └── share/
│   │       └── [shareId]/
│   │           └── page.tsx
│   └── api/
│       └── concept-graph/              # 新: API 路由
│           ├── ingest/route.ts
│           ├── jobs/[jobId]/route.ts
│           ├── [id]/route.ts
│           ├── [id]/enrich/route.ts
│           ├── [id]/recluster/route.ts
│           ├── [id]/export/route.ts
│           ├── [id]/explain/route.ts
│           ├── [id]/qa/route.ts
│           ├── [id]/share/route.ts
│           ├── compare/route.ts
│           ├── review/route.ts
│           └── share/[shareId]/route.ts
├── types/
│   ├── index.ts                        # 旧: 保留
│   └── concept-graph.ts                # 新: ConceptGraph 类型
└── utils/
    ├── graph-normalize.ts              # 旧: 保留
    └── concept-graph-utils.ts          # 新: 图谱工具函数
```

---

## 9. 错误处理矩阵

| 步骤 | 失败场景 | 处理策略 | Job 状态 |
| --- | --- | --- | --- |
| Step 1 文本抽取 | PDF 解析失败 / URL 不可达 | 返回 400 错误 | `failed` |
| Step 2 句子切分 | 空文本 / 极短文本 | 跳过切分, 整段作为一个 sentence | 继续 |
| Step 3a LLM 概念抽取 | LLM 超时 / JSON 解析失败 | 降级到纯 3b+3c (短语+词典) | 继续 |
| Step 3b+3c 短语/词典 | 三路全失败 | job 失败 | `failed` |
| Step 4 概念归一 | Embedding 服务不可用 | 降级到纯字符串归一 | 继续 |
| Step 5 共现边 | 概念数 < 5 | 跳过共现, 每个概念独立成 cluster | 继续 |
| Step 6 Leiden | 0 个 cluster / 收敛失败 | 全部归入 "Uncategorized" cluster | 继续 |
| Step 6 LLM 命名 | LLM 失败 | fallback: top-3 概念名拼接 | 继续 |
| Step 7 富化 | LLM 失败 | 跳过富化, description 缺失 | 继续 |
| 代码 Step 1 AST | 不支持的语言 / 语法错误 | 降级到 LLM 抽取 | 继续 |
| 代码 Step 1 AST | web-tree-sitter WASM 加载失败 | 降级到 LLM 抽取 | 继续 |
| DB 写入 | 连接失败 | job 失败 | `failed` |
| 整体超时 | 5 分钟未完成 | 标记 `failed` | `failed` |

**原则**: 非致命错误降级处理, 致命错误标记 job 失败。用户可重试。

---

## 10. 测试策略

### 10.1 单元测试

| 模块 | 测试方式 | 工具 |
| --- | --- | --- |
| `entity-resolve.ts` | 输入 fixture (重复概念), 断言合并结果 | vitest |
| `cooccurrence.ts` | 输入 fixture (句子数组), 断言边权重 | vitest |
| `leiden.ts` | 输入 fixture (图), 断言 cluster 数量在合理范围 | vitest |
| `pagerank.ts` | 输入 fixture (图), 断言 importance 排序 | vitest |
| `concept-graph-utils.ts` | 输入 fixture (ConceptGraph), 断言 buildElements 输出 | vitest |

### 10.2 集成测试

| 场景 | 测试方式 |
| --- | --- |
| 论文 ingest 端到端 | Mock LLM (录播 fixture), 真实 DB (test schema), 断言 ConceptGraph 结构 |
| 代码 ingest 端到端 | 同上 + web-tree-sitter 真实解析 |
| 异步 job 生命周期 | 创建 job → 轮询 → 断言 status 变化 |
| 错误降级 | Mock LLM 失败, 断言降级路径执行 |

### 10.3 LLM Mock 策略

- 用 `vi.mock` 拦截 `agnes.chat.completions.create`
- 录播 fixture: 真实调用一次, 存 JSON 响应, 后续测试回放
- fixture 按 input hash 命名, 便于维护

### 10.4 渲染测试

- cytoscape 在 jsdom 中不可用 (需要 canvas)
- 渲染测试仅测 `buildElements` / `buildStylesheet` 的输出 (纯函数)
- 交互测试用 Playwright (E2E)

### 10.5 测试依赖

```json
{
  "devDependencies": {
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "@playwright/test": "^1.48.0"
  }
}
```

---

## 11. i18n 与语言策略

### 11.1 UI 语言

- 新 `/graph` 页面的 UI 文案加入 `src/locales/en.json` / `zh.json`
- 命名空间: `graph.*` (e.g. `graph.toolbar.layout`, `graph.empty.title`)

### 11.2 AI 输出语言

- 所有新 LLM 调用 (概念抽取 / cluster 命名 / 富化 / explain / qa) 追加 `getLanguageInstructionForUser(userId)`
- **概念 label**: 跟随原文语言 (不翻译, 保留原始术语)
- **概念 description**: 跟随用户 AI 输出语言
- **Cluster label/description**: 跟随用户 AI 输出语言
- **中文论文的 concept id**: label 保持中文, id 用 `label.hashCode()` 生成 (避免 pinyin 依赖)

### 11.3 中间件

`src/middleware.ts` 新增 `/graph` 和 `/api/concept-graph/*` 到保护列表。

---

## 12. 迭代路径

| Phase | 内容 | 验收标准 |
| --- | --- | --- |
| **P1 · 基础** | 新 schema + 论文 ingest (单次 LLM 抽概念) + cytoscape 渲染 | 1 篇中等论文能出 100+ 节点图, 力导向布局 |
| **P2 · 算法** | 句子切分 + 归一 + Leiden + LLM 命名 | 聚类质量肉眼可接受, 命名不像废话 |
| **P3 · Code** | web-tree-sitter (TS/Py) + 静态 call graph + 概念层 | 一个小 repo 能出准确的"模块-类-函数"图 |
| **P4 · 交互** | 钻取 / 侧栏 / 重命名 / 合并 cluster / 手动修正 / folders/tags | 用户能主动修正图谱 |
| **P5 · 性能** | 1000+ 节点优化 + 异步 ingest + 进度条 | 大型论文 / 大型 repo 不卡 |

---

## 13. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
| --- | --- | --- | --- |
| LLM 概念抽取不全/不准 | 高 | 高 | 三路并行 (LLM + 短语 + 词典) + 用户补全 |
| Embedding 归一过合并 | 中 | 中 | 阈值调高 (cosine > 0.88) + 用户能拆分 |
| Leiden 命名太抽象 | 中 | 中 | top-5 概念作为 fallback label, 用户能改 |
| 1000+ 节点性能崩 | 中 | 中 | cytoscape Canvas + 分级 selector + LOD |
| 旧用户不接受新形态 | 中 | 高 | 双版本共存, 旧图保留, 升级按钮引导 |
| Code AST 多语言工作量大 | 高 | 中 | P1 先支持 TS/Py, 其他语言降级到 LLM 抽 |
| web-tree-sitter WASM 加载慢 | 低 | 中 | WASM 文件放 CDN / public 目录, 浏览器缓存 |
| serverless waitUntil 超时 | 中 | 高 | job 状态持久化到 DB, 超时标记 failed, 用户重试 |
| cytoscape SSR 报错 | 低 | 高 | `next/dynamic` + `ssr: false` |
| LLM 调用成本失控 | 中 | 高 | 批量调用 (5 次总) + 响应缓存 + 不分块 |

---

## 14. 不做的事情 (YAGNI)

- **不做**: 实时协作编辑 —— 复杂度极高, 当前用户量不支持
- **不做**: 自定义概念词典上传 —— 先用内置 CS 词典, 后续按需加
- **不做**: 跨论文概念图谱合并 —— Compare 功能先做简单并集, 不做复杂的实体对齐
- **不做**: 图谱版本历史 —— 旧 board 的 version 功能不迁移到新图谱
- **不做**: 移动端手势优化 —— 概念图谱是桌面优先产品, 移动端只做只读浏览
- **不做**: image 类型迁移 —— image 项目沿用旧 pipeline
- **不做**: 新图谱的 folders/tags —— P4 再加

---

## 15. 开放问题 (待讨论)

1. **Code pipeline 的 GitHub 深度**: 当前只 fetch README, 是否要递归 fetch 整个 repo 结构? 如果是, 如何控制 fetch 量?
2. **旧项目升级是否收费**: 当前设计为免费 (功能升级引导), 但大论文的 LLM 成本不低。
3. **Cluster 命名语言**: 当前设计跟随用户 AI 输出语言, 是否应该跟随论文原文语言?

---

## 附录 A · 与当前实现的对比

| 维度 | 当前实现 | 新方案 |
| --- | --- | --- |
| 节点粒度 | 论文小节 (5-20) | 技术概念 (100-500) |
| 边来源 | LLM 自由发挥 | 统计共现 + LLM 语义 |
| 布局 | dagre 树形 | cytoscape fcose 力导向 |
| 聚类 | LLM 输出 section | Leiden 社区检测 |
| 节点大小 | 全部一样 | importance 分级 |
| 颜色 | section 配色 | cluster 配色 (低饱和大地色) |
| 层级 | 扁平 | cluster 嵌套 (2 层) |
| 渲染库 | @xyflow/react | cytoscape.js |
| Ingest | 1 次 LLM | 5 次 LLM (批量优化) |
| 输入上限 | 50k 字符截断 | 整篇输入 (不分块) |
| Schema | DocumentNode/Edge | Concept/ConceptEdge/Cluster |
| 异步 | 同步 | DB 持久化 job |
| AST | 无 | web-tree-sitter (WASM) |

## 附录 B · 术语对照

| 术语 | 说明 |
| --- | --- |
| Concept | 概念节点, 粒度最细的实体 |
| ConceptEdge | 概念间关系, 带权重和置信度 |
| ConceptCluster | 社区检测结果, 主题群 |
| Co-occurrence | 共现, 两个概念在同一上下文出现 |
| Entity Resolution | 实体归一, 合并同一概念的不同写法 |
| Leiden | 社区检测算法, 比 Louvain 稳定 |
| fcose | cytoscape 力导向布局插件 |
| LOD | Level of Detail, 渐进式细节层次 |
| web-tree-sitter | tree-sitter 的 WASM 版本, serverless 兼容 |
| Compound Node | cytoscape 的嵌套节点, 用于 cluster 凸包 |
| waitUntil | Next.js API, 响应后继续执行后台任务 |

---

*文档版本: 1.1 · 2026-06-23 · 待 Spec Review (第 2 轮)*
