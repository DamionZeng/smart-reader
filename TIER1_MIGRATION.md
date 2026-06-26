# Tier 1 功能实施 — 数据库迁移说明

## 新增表（运行 `npm run db:push` 自动同步）

1. **folders** — 文件夹（单层、按用户隔离）
2. **tags** — 标签（按用户隔离）
3. **project_folders** — 项目 ↔ 文件夹（多对多预留，实际只用一个）
4. **project_tags** — 项目 ↔ 标签（多对多）
5. **project_versions** — 项目版本快照（用于历史与回滚）

## Tier 1 实施清单

### ✅ 1. 项目文件夹/标签系统
- DB Schema：5 张新表 + 索引（已完成）
- API：
  - `GET/POST /api/folders` — 文件夹 CRUD
  - `GET/POST /api/folders?type=tags` — 标签 CRUD
  - `PATCH/DELETE /api/folders/[id]` — 通用 PATCH/DELETE
  - `PUT /api/projects/[id]/organization` — 设置项目的文件夹/标签
- 客户端 API：`src/api/organization.ts`
- UI 组件：
  - `src/components/dashboard/ProjectOrganizationDialog.tsx` — 文件夹/标签编辑对话框
  - Dashboard 项目卡片：显示文件夹 + 标签 + 组织按钮
  - Dashboard 顶部过滤器栏：按文件夹/标签筛选
- 增强 `GET /api/projects` 返回 folder + tags
- i18n：补齐 `organization.*` 命名空间（en + zh）

### ✅ 2. 版本历史
- DB Schema：`project_versions` 表（已完成）
- API：`src/app/api/projects/[id]/versions/route.ts`（已新增）
- 客户端 API：`src/api/versions.ts`（已新增）
- Board 自动快照：10 分钟间隔 + 最多保留 50 版
- 历史面板：Board 顶部"History" 按钮打开
- 一键回滚 + 删除版本

### ✅ 3. 节点关系深度编辑
- 类型增强：`DocumentEdge.edgeType` + `note`（relates/depends/extends/contradicts）
- 视觉区分：
  - relates — 实线
  - depends — 虚线 + 动画
  - extends — 加粗实线
  - contradicts — 点线
- `src/utils/edge-style.ts` 重写为 `buildEdge()`，按 edgeType 应用视觉
- 边编辑 UI：Board 选中边后弹出 EdgeEditorModal
- 关系类型图例：Board 右下角

### ✅ 4. 错误边界 + 降级 UI
- `src/app/error.tsx` — 全局错误边界
- `src/app/dashboard/error.tsx` — Dashboard 路由级
- `src/app/board/error.tsx` — Board 路由级
- `src/app/codeboard/error.tsx` — CodeBoard 路由级
- `src/components/board/AIErrorBoundary.tsx` — AI 流式错误时显示
- `src/components/board/AIStreamFallback.tsx` — 友好降级提示
- 全部遵循 Editorial 设计语言
