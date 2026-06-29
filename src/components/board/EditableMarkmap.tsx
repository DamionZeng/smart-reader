"use client";

/**
 * EditableMarkmap — markmap 风格可编辑思维导图
 *
 * 设计目标：
 *   1. 视觉对标参考图：左中右放射状布局，中心节点 + 弧形 bezier 连线
 *   2. 完整可编辑能力：
 *      - 拖拽节点：改变同一父节点下的顺序
 *      - 双击重命名
 *      - 工具栏：添加子节点 / 删除节点
 *      - AI 润色：选中节点后调用 API 重写标题/摘要
 *
 * 布局算法：d3-hierarchy tree() 横向布局（root 在左，子节点向右）
 *
 * 与原 MindMapView 的关系：
 *   - 本组件完全替代 MindMapView
 *   - 通过 onChange 回调把编辑后的 sections 推回父组件
 *   - 父组件负责持久化（API 调用）
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, tree } from "d3-hierarchy";
import { linkHorizontal } from "d3-shape";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/cn";
import type { DocumentSection } from "@/types/concept-graph";

// === 内部数据模型（可编辑） ===
interface MindNode {
  id: string;
  title: string;
  summary: string;
  anchor?: string;
  children: MindNode[];
  /** 原始 sections 数组中的索引，用于 d3 sort 按正文顺序排布 */
  _order?: number;
}

interface EditableMarkmapProps {
  /** 文档主标题（中心节点） */
  documentTitle: string;
  /** 初始 sections（来自服务端） */
  sections?: DocumentSection[];
  /** 编辑后回调（向上推 sections） */
  onChange?: (sections: DocumentSection[]) => void;
  /** 点击章节跳转原文 */
  onJumpToAnchor?: (anchor: string) => void;
  /**
   * AI 润色回调（选中节点后点击工具栏「AI 润色」触发）。
   * 父组件负责调用 API，返回重写后的 title/summary。
   */
  onAIRewrite?: (
    nodeId: string,
    currentTitle: string,
    currentSummary: string,
    contextHint?: string
  ) => Promise<{ title: string; summary: string }>;
}

// === 工具：sections ⇄ MindNode ===
function sectionsToMind(sections: DocumentSection[] | undefined): MindNode[] {
  if (!sections) return [];
  return sections.map((s) => ({
    id: s.id,
    title: s.title,
    summary: s.summary,
    anchor: s.anchor,
    children: sectionsToMind(s.children),
  }));
}

/**
 * 防御性：对 LLM/旧版数据中可能存在的重复 id 重新分配。
 * 历史上 `sec-${index}` 会在不同父节点下产生相同 id（React 重复 key 警告）。
 * 用 path-based 唯一 id 重写整棵树，调用方可以放心使用。
 */
function sanitizeSectionIds(
  sections: DocumentSection[] | undefined,
  parentPath = ""
): DocumentSection[] {
  if (!sections) return [];
  return sections.map((s, i) => {
    const path = parentPath ? `${parentPath}-${i}` : `${i}`;
    const newId = s.id && !s.id.startsWith("sec-")
      ? s.id
      : `sec-${path}`;
    return {
      ...s,
      id: newId,
      ...(s.children && s.children.length > 0
        ? { children: sanitizeSectionIds(s.children, path) }
        : {}),
    };
  });
}

function mindToSections(nodes: MindNode[]): DocumentSection[] {
  return nodes.map((n, i) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    level: 0,
    conceptIds: [],
    ...(n.anchor ? { anchor: n.anchor } : {}),
    ...(n.children.length > 0 ? { children: mindToSections(n.children) } : {}),
    // 保留稳定 id（无 id 时回退到 sec-i-<index>-<random>）
  }));
}

function genId(prefix = "node"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// === 不可变树操作（保留原引用以触发 React 重渲染）===
function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

function findNode(root: MindNode[], id: string): MindNode | null {
  for (const n of root) {
    if (n.id === id) return n;
    const child = findNode(n.children, id);
    if (child) return child;
  }
  return null;
}

function findParent(root: MindNode[], id: string): MindNode[] | null {
  for (const n of root) {
    if (n.id === id) return root;
    const child = findParent(n.children, id);
    if (child) return child;
  }
  return null;
}

function updateNode(
  root: MindNode[],
  id: string,
  patch: Partial<MindNode>
): MindNode[] {
  return root.map((n) => {
    if (n.id === id) return { ...n, ...patch };
    if (n.children.length > 0) {
      return { ...n, children: updateNode(n.children, id, patch) };
    }
    return n;
  });
}

function removeNode(root: MindNode[], id: string): MindNode[] {
  return root
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

function addChild(root: MindNode[], parentId: string, child: MindNode): MindNode[] {
  if (parentId === "root") return [...root, child];
  return root.map((n) => {
    if (n.id === parentId) {
      return { ...n, children: [...n.children, child] };
    }
    if (n.children.length > 0) {
      return { ...n, children: addChild(n.children, parentId, child) };
    }
    return n;
  });
}

function moveNode(
  root: MindNode[],
  sourceId: string,
  targetParentId: string,
  targetIndex: number
): MindNode[] {
  // 1. 从原位置移除
  const source = findNode(root, sourceId);
  if (!source) return root;
  const without = removeNode(root, sourceId);
  // 2. 插入到目标父节点
  if (targetParentId === "root") {
    const next = [...without];
    const insertAt = Math.max(0, Math.min(targetIndex, next.length));
    next.splice(insertAt, 0, source);
    return next;
  }
  return without.map((n) => {
    if (n.id === targetParentId) {
      const next = [...n.children];
      const insertAt = Math.max(0, Math.min(targetIndex, next.length));
      next.splice(insertAt, 0, source);
      return { ...n, children: next };
    }
    if (n.children.length > 0) {
      return { ...n, children: moveNode(n.children, sourceId, targetParentId, targetIndex) };
    }
    return n;
  });
}

// === Bezier 路径计算（markmap 风格） ===
function pathFrom(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  // 水平放射：起点 (x1, y1) 在左，终点 (x2, y2) 在右
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

// === 主组件 ===
export function EditableMarkmap({
  documentTitle,
  sections,
  onChange,
  onJumpToAnchor,
  onAIRewrite,
}: EditableMarkmapProps) {
  const { t } = useTranslation();
  // 本地副本：用户编辑直到 onChange 提交
  // 加载时先 sanitize id，防止历史数据中有重复 id 触发 React 警告
  const [tree2, setTree] = useState<MindNode[]>(() =>
    sectionsToMind(sanitizeSectionIds(sections))
  );
  // props 变化时重置本地副本（外部 reload）
  useEffect(() => {
    setTree(sectionsToMind(sanitizeSectionIds(sections)));
  }, [sections]);

  // 选中 / 编辑 / 拖拽状态
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [dragState, setDragState] = useState<{
    id: string;
    /** 鼠标 Y 偏移（相对节点中心） */
    yOffset: number;
  } | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  // 容器尺寸（用于视口 / 缩放）
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setContainerSize({
          w: e.contentRect.width,
          h: e.contentRect.height,
        });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // === d3-hierarchy 水平放射状布局 ===
  //
  // d3.tree() 默认是 vertical tree：root 在最顶 (y=0)，子节点向下 (y>0)，
  // 同级节点沿 x 方向分布。要得到 markmap 风格的水平放射布局，需要：
  //   - 渲染时把 d.y 当作横向（向右），d.x 当作纵向
  //   - 用 d3-shape 的 linkHorizontal() 生成水平 bezier 连线
  //
  // 关键参数：
  //   nodeSize([depthStep, siblingStep])
  //     - depthStep: 父子之间的纵向距离（决定 root→一级→二级的总高度）
  //     - siblingStep: 同级节点之间的最小纵向距离
  //   separation(a, b): 1 = 贴在一起，>1 = 拉远不同分支
  //   sort((a, b) => order): 按原 sections 数组顺序排布，保留正文顺序
  //
  // 中文长标题宽度通常 180-220px，节点高度 40px。
  // siblingStep=110 配合 separation=1.4 可保证节点间不重叠。
  // depthStep=180 让一级、二级之间有明显留白，不显拥挤。
  const layout = useMemo(() => {
    if (tree2.length === 0) return null;
    // 注入原始数组索引，用于 sort 按正文顺序排布
    const injectOrder = (nodes: MindNode[], orderRef: { i: number }): MindNode[] =>
      nodes.map((n) => {
        const idx = orderRef.i++;
        const out: MindNode = { ...n, _order: idx } as any;
        if (n.children.length > 0) out.children = injectOrder(n.children, orderRef);
        return out;
      });
    const withOrder = injectOrder(tree2, { i: 0 });

    const root = hierarchy<{ id: string; title: string; children: MindNode[] }>(
      { id: "root", title: documentTitle, children: withOrder },
      (d) => d.children as any
    );
    // 关键：按 sections 数组顺序排布，保留正文顺序（引言→...→结论）
    // sort() 是 HierarchyNode 的方法（不是 TreeLayout），递归排序所有后代
    root.sort((a, b) => {
      const ao = ((a.data as any)._order ?? 0) as number;
      const bo = ((b.data as any)._order ?? 0) as number;
      return ao - bo;
    });
    const t = tree<any>()
      .nodeSize([180, 110]) // [depthStep, siblingStep] —— 父→子 180px，同级 110px
      .separation((a, b) => {
        // 同级：紧贴一点；不同分支：拉远
        if (a.parent === b.parent) return 1;
        return 1.6;
      });
    t(root);
    // 根节点居中：把 root 的 x 设为顶级子节点的平均 x
    const firstLevel = (root.children || []) as any[];
    if (firstLevel.length > 0) {
      const avgX = firstLevel.reduce((s, n) => s + n.x, 0) / firstLevel.length;
      (root as any).x = avgX;
      (root as any).y = 0;
    }
    return root;
  }, [tree2, documentTitle]);

  // 计算画布总尺寸（让 SVG viewBox 包含所有节点）
  // 水平布局：横向 (SVG X) = d.y，纵向 (SVG Y) = d.x
  const canvasSize = useMemo(() => {
    if (!layout) return { w: 0, h: 0 };
    let minY = 0,
      maxY = 0,
      minX = 0,
      maxX = 0;
    layout.each((n) => {
      minY = Math.min(minY, (n as any).y);
      maxY = Math.max(maxY, (n as any).y);
      minX = Math.min(minX, (n as any).x);
      maxX = Math.max(maxX, (n as any).x);
    });
    return {
      w: maxY - minY + 400, // 横向额外留出根节点宽度
      h: maxX - minX + 200, // 纵向额外留出节点高度
    };
  }, [layout]);

  // 视口平移：让画布在容器中居中并留出边距
  const offset = useMemo(() => {
    if (!layout) return { x: 0, y: 0 };
    let minY = Infinity,
      minX = Infinity;
    layout.each((n) => {
      minY = Math.min(minY, (n as any).y);
      minX = Math.min(minX, (n as any).x);
    });
    return { x: 220 - minY, y: 100 - minX };
  }, [layout]);

  // === 增/删/重命名/移动（包装 setTree） ===
  const commit = useCallback(
    (next: MindNode[]) => {
      setTree(next);
      onChange?.(mindToSections(next));
    },
    [onChange]
  );

  const handleAddChild = useCallback(
    (parentId: string) => {
      const newNode: MindNode = {
        id: genId(),
        title: "新章节",
        summary: "",
        children: [],
      };
      commit(addChild(tree2, parentId, newNode));
      setSelectedId(newNode.id);
      // 立即进入编辑模式
      setEditingId(newNode.id);
      setEditingValue(newNode.title);
    },
    [tree2, commit]
  );

  const handleAddSibling = useCallback(
    (siblingId: string) => {
      // 找 sibling 的父节点
      const parent =
        findNode(tree2, siblingId)?.children !== undefined
          ? null
          : findParent(tree2, siblingId);
      const parentId = parent ? "" : "root";
      // sibling 自身是父节点？改用其第一个兄弟
      const targetParentId = parent ? parent[0]?.id : "root";
      const newNode: MindNode = {
        id: genId(),
        title: "新章节",
        summary: "",
        children: [],
      };
      const baseParent = targetParentId;
      // 找到 sibling 所在父节点
      const realParent = findParent(tree2, siblingId);
      const useParentId = realParent
        ? tree2.find((n) => realParent.includes(n))?.id || "root"
        : "root";
      commit(addChild(tree2, useParentId, newNode));
      setSelectedId(newNode.id);
      setEditingId(newNode.id);
      setEditingValue(newNode.title);
    },
    [tree2, commit]
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (id === "root") return;
      if (!confirm("确定要删除这个节点及其子节点吗？")) return;
      commit(removeNode(tree2, id));
      if (selectedId === id) setSelectedId(null);
    },
    [tree2, commit, selectedId]
  );

  const handleRename = useCallback((id: string, title: string) => {
    setEditingId(id);
    setEditingValue(title);
  }, []);

  const handleRenameCommit = useCallback(() => {
    if (!editingId) return;
    commit(updateNode(tree2, editingId, { title: editingValue.trim() || "未命名" }));
    setEditingId(null);
    setEditingValue("");
  }, [editingId, editingValue, tree2, commit]);

  const handleAIRewrite = useCallback(
    async (id: string) => {
      if (!onAIRewrite) return;
      const node = findNode(tree2, id);
      if (!node) return;
      setAiLoading(id);
      try {
        const result = await onAIRewrite(id, node.title, node.summary);
        commit(updateNode(tree2, id, result));
      } catch (e) {
        console.error("[EditableMarkmap] AI rewrite failed", e);
        alert("AI 润色失败，请稍后重试");
      } finally {
        setAiLoading(null);
      }
    },
    [onAIRewrite, tree2, commit]
  );

  // === 拖拽 ===
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      // 编辑模式不触发拖拽
      if (editingId) return;
      e.stopPropagation();
      setSelectedId(id);
      const node = layout?.descendants().find((n) => (n.data as any).id === id);
      if (!node) return;
      // 水平布局：节点的纵向（视觉 Y）= d.x + offset.y
      const localY = e.clientY - (containerRef.current?.getBoundingClientRect().top ?? 0) - offset.y;
      const nodeX = (node as any).x + offset.y;
      setDragState({ id, yOffset: nodeX - localY });
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [editingId, layout, offset]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState || !containerRef.current || !layout) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const localY = e.clientY - containerRect.top - offset.y;
      const newX = localY + dragState.yOffset;
      // 找到当前最近的同级节点作为目标位置
      const dragged = layout.descendants().find((n) => (n.data as any).id === dragState.id);
      if (!dragged || !dragged.parent) return;
      // 水平布局：同级节点按 d.x 排序
      const siblings = dragged.parent.children || [];
      const sorted = [...siblings].sort(
        (a, b) => (a as any).x - (b as any).x
      );
      let targetIndex = sorted.length;
      for (let i = 0; i < sorted.length; i++) {
        if ((sorted[i] as any).x > newX) {
          targetIndex = i;
          break;
        }
      }
      // 移动（如果同位置不重排）
      const currentIdx = sorted.findIndex((n) => (n.data as any).id === dragState.id);
      if (currentIdx === targetIndex || (currentIdx === targetIndex - 1)) return;
      // 转换为「在 parent 中的索引」
      const parentId = (dragged.parent.data as any).id;
      const realIndex = targetIndex;
      // 注意：moveNode 内部会从原位置删除再插入，所以这里用 original index
      commit(moveNode(tree2, dragState.id, parentId, realIndex));
    },
    [dragState, layout, offset, tree2, commit]
  );

  const handlePointerUp = useCallback(() => {
    setDragState(null);
  }, []);

  if (!layout || tree2.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center p-12 bg-[#F9F8F6]"
      >
        <p className="font-sans text-sm italic text-[#1C1C1C]/40">
          {t("board.mindmapEmpty")}
        </p>
      </div>
    );
  }

  // d3-shape 的 linkHorizontal：输入 [[x, y], [x, y]] 输出 cubic bezier path
  // 源 = [d.source.y, d.source.x]（横向=SVG X，纵向=SVG Y）
  const linkGen = linkHorizontal<any, any>()
    .source((d) => [(d.source as any).y, (d.source as any).x])
    .target((d) => [(d.target as any).y, (d.target as any).x])
    .x((p) => p[0])
    .y((p) => p[1]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-[#F9F8F6] relative"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={() => setSelectedId(null)}
    >
      {/* 工具栏（选中节点时显示） */}
      {selectedId && selectedId !== "root" ? (
        <div
          className="sticky top-4 z-20 mx-auto w-fit bg-[#1C1C1C] text-[#F9F8F6] px-1 py-1 flex items-center gap-1 shadow-none"
          onClick={(e) => e.stopPropagation()}
        >
          <ToolbarButton
            label="重命名"
            onClick={() => {
              const node = findNode(tree2, selectedId);
              if (node) handleRename(selectedId, node.title);
            }}
          />
          <ToolbarButton
            label="新增子项"
            onClick={() => handleAddChild(selectedId)}
          />
          <ToolbarButton
            label="新增同级"
            onClick={() => handleAddSibling(selectedId)}
          />
          {onAIRewrite ? (
            <ToolbarButton
              label={aiLoading === selectedId ? "润色中..." : "AI 润色"}
              onClick={() => handleAIRewrite(selectedId)}
              disabled={aiLoading === selectedId}
            />
          ) : null}
          <div className="w-px h-5 bg-[#F9F8F6]/20 mx-1" />
          <ToolbarButton
            label="删除"
            onClick={() => handleDelete(selectedId)}
            danger
          />
        </div>
      ) : null}

      {/* SVG 画布 */}
      <svg
        ref={svgRef}
        width={Math.max(canvasSize.w, containerSize.w)}
        height={Math.max(canvasSize.h, containerSize.h)}
        style={{ display: "block" }}
      >
        <g transform={`translate(${offset.x}, ${offset.y})`}>
          {/* 连接线（先画，在节点下层）—— 用 d3 linkHorizontal 水平 bezier */}
          {layout.links().map((link) => {
            const isRoot = (link.source.data as any).id === "root";
            return (
              <path
                key={`${(link.source.data as any).id}-${(link.target.data as any).id}`}
                d={linkGen(link) || ""}
                stroke="#1C1C1C"
                strokeWidth={isRoot ? 1.2 : 1}
                fill="none"
                opacity={isRoot ? 0.55 : 0.4}
              />
            );
          })}

          {/* 节点 —— 水平布局：translate(y, x) 而不是 (x, y) */}
          {layout.descendants().map((d) => {
            const data = d.data as any;
            const isRoot = data.id === "root";
            const isSelected = data.id === selectedId;
            const x = (d as any).x; // SVG Y（纵向）
            const y = (d as any).y; // SVG X（横向）
            const isEditing = data.id === editingId;

            // 节点尺寸估算（按字符数 + 统一最小值，避免不同宽度节点重叠）
            const titleLen = (data.title || "").length;
            const w = isRoot
              ? 200
              : Math.min(Math.max(titleLen * 12 + 32, 160), 240);
            const h = isRoot ? 56 : 40;

            return (
              <g
                key={data.id}
                transform={`translate(${y - w / 2}, ${x - h / 2})`}
                onPointerDown={(e) =>
                  !isRoot && !isEditing && handlePointerDown(e, data.id)
                }
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isRoot) handleRename(data.id, data.title);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isRoot) return;
                  setSelectedId(data.id);
                }}
                style={{
                  cursor: isRoot ? "default" : isEditing ? "text" : "pointer",
                }}
              >
                {isRoot ? (
                  <g>
                    <rect
                      width={w}
                      height={h}
                      fill="#1C1C1C"
                    />
                    <foreignObject x={12} y={8} width={w - 24} height={h - 16}>
                      <div
                        className="text-[#F9F8F6] font-serif tracking-tight text-sm leading-tight truncate"
                        title={data.title}
                      >
                        {data.title}
                      </div>
                    </foreignObject>
                  </g>
                ) : (
                  <g>
                    {/* 选中态：描边加粗 */}
                    <rect
                      width={w}
                      height={h}
                      fill="#F9F8F6"
                      stroke={isSelected ? "#1C1C1C" : "#1C1C1C"}
                      strokeWidth={isSelected ? 2 : 1}
                    />
                    {isEditing ? (
                      <foreignObject x={4} y={4} width={w - 8} height={h - 8}>
                        <input
                          autoFocus
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={handleRenameCommit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleRenameCommit();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingId(null);
                            }
                          }}
                          className="w-full h-full bg-transparent font-serif tracking-tight text-sm text-[#1C1C1C] outline-none border-none px-1"
                        />
                      </foreignObject>
                    ) : (
                      <foreignObject x={8} y={6} width={w - 16} height={h - 12}>
                        <div
                          className={cn(
                            "font-serif tracking-tight text-sm leading-tight truncate select-none",
                            isSelected ? "text-[#1C1C1C]" : "text-[#1C1C1C]/80"
                          )}
                          title={data.title}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (e.detail === 2) return; // 双击不触发单击
                            if (onJumpToAnchor && data.anchor) {
                              onJumpToAnchor(data.anchor);
                            }
                          }}
                        >
                          {data.title}
                        </div>
                      </foreignObject>
                    )}
                    {aiLoading === data.id ? (
                      <text
                        x={w + 6}
                        y={h / 2 + 4}
                        fontSize="10"
                        fill="#1C1C1C"
                        opacity="0.5"
                      >
                        ⟳
                      </text>
                    ) : null}
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-3 py-1 text-[10px] uppercase tracking-[0.15em] font-sans transition-colors",
        danger
          ? "text-[#F9F8F6]/60 hover:text-[#F9F8F6] hover:bg-[#991B1B]"
          : "text-[#F9F8F6]/80 hover:text-[#F9F8F6] hover:bg-[#F9F8F6]/10",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      {label}
    </button>
  );
}
