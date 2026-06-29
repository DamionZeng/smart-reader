import { agnes, AGNES_MODEL } from "@/lib/agnes";
import { truncate } from "@/utils/concept-graph-utils";
import type { Concept, DocumentSection } from "@/types/concept-graph";

const MAX_INPUT_CHARS = 100000;

// 系统提示词：让 LLM 从论文原文中抽取逻辑章节结构（不是逐字复制目录），
// 而是基于内容理解重新整理出有层级的章节大纲，每节附 1-2 句摘要、
// 关联的概念 label 列表，以及用于跳转定位的原文锚点句。
const SYSTEM_PROMPT = `You are an expert academic paper structural analyst.

Your goal is to read the paper text and produce a LOGICAL chapter outline — not a verbatim copy of the table of contents. Re-organise the content into coherent sections that reflect the paper's intellectual structure.

Output ONLY a JSON object of the form:
{ "sections": [{ "title": "...", "summary": "...", "level": 0, "conceptLabels": ["..."], "anchor": "...", "children": [...] }] }

Each section object:
{
  "title": "a concise section title (can differ from the paper's original headings if a logical re-grouping is clearer)",
  "summary": "1-2 sentence summary of what this section discusses",
  "level": 0 for top-level sections, 1 for subsections,
  "conceptLabels": ["labels of concepts from the provided list that this section covers"],
  "anchor": "a verbatim sentence from the source text that opens or defines this section (used for jump-to-source navigation)",
  "children": [ optional array of subsections with the same shape ]
}

Rules:
- Produce 5-10 top-level sections. Subsections (level=1) are optional but encouraged for dense papers.
- Every section MUST have a non-empty anchor quote copied verbatim from the source text.
- conceptLabels MUST come from the provided concept list — do not invent new labels.
- Keep titles short and informative (aim for <= 8 words).
- Summaries should be factual and specific to this paper, not generic descriptions.
- Order sections to follow the paper's logical flow (typically: problem → background → method → experiments → results → conclusion).
- If the paper lacks a clear structure, infer the most sensible logical grouping.`;

interface RawSection {
  title?: unknown;
  summary?: unknown;
  level?: unknown;
  conceptLabels?: unknown;
  anchor?: unknown;
  children?: unknown;
}

/**
 * 校验并清洗从 LLM 返回的单个 section 对象。
 * 返回 null 表示该 section 无效，应被丢弃。
 *
 * id 生成规则：使用「父级 path + 当前同级索引」拼接为 path-based id，
 * 保证整棵 section 树中所有节点 id 全局唯一。
 * 例：sec-0、sec-0-0、sec-0-1、sec-1、sec-1-0 ...
 *
 * 历史上曾用 `sec-${index}`，但 index 只是同级索引，不同父节点下
 * 会有相同 id（导致 React 重复 key 警告）。
 */
function normalizeRawSection(
  raw: unknown,
  index: number,
  conceptByLabel: Map<string, string>,
  parentPath = ""
): DocumentSection | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as RawSection;

  const title =
    typeof s.title === "string" && s.title.trim() ? s.title.trim() : "";
  if (!title) return null;

  const summary =
    typeof s.summary === "string" && s.summary.trim() ? s.summary.trim() : "";

  const level =
    typeof s.level === "number" && (s.level === 0 || s.level === 1)
      ? s.level
      : 0;

  // 将 LLM 返回的 conceptLabels 匹配回 conceptIds。
  // 匹配策略：大小写不敏感 + trimmed 比较；未命中的 label 直接忽略。
  const conceptIds: string[] = [];
  if (Array.isArray(s.conceptLabels)) {
    for (const label of s.conceptLabels) {
      if (typeof label !== "string") continue;
      const key = label.trim().toLowerCase();
      if (!key) continue;
      const id = conceptByLabel.get(key);
      if (id && !conceptIds.includes(id)) {
        conceptIds.push(id);
      }
    }
  }

  const anchor =
    typeof s.anchor === "string" && s.anchor.trim() ? s.anchor.trim() : undefined;

  // path-based 唯一 id：父级 path + "-" + 当前同级 index
  const currentPath = parentPath ? `${parentPath}-${index}` : `${index}`;
  const id = `sec-${currentPath}`;

  // 递归处理子章节（把当前 path 传下去作为子节点的 parentPath）
  let children: DocumentSection[] | undefined;
  if (Array.isArray(s.children) && s.children.length > 0) {
    const childSections = s.children
      .map((child, i) =>
        normalizeRawSection(child, i, conceptByLabel, currentPath)
      )
      .filter((c): c is DocumentSection => c !== null);
    if (childSections.length > 0) {
      children = childSections;
    }
  }

  return {
    id,
    title,
    summary,
    level,
    conceptIds,
    ...(anchor ? { anchor } : {}),
    ...(children ? { children } : {}),
  };
}

/**
 * 调用 LLM 从论文原文抽取章节结构，输出 DocumentSection[]。
 *
 * 实现要点：
 * - 使用 agnes 客户端 + JSON 输出模式
 * - 把已抽取的 concepts 的 label 列表传给 LLM，让它知道有哪些概念
 * - LLM 输出 conceptLabels，后端在这里匹配回 conceptIds
 * - 失败时返回空数组（不阻塞管线）
 *
 * @param text 论文原文
 * @param concepts 已抽取的概念节点列表（用于 label → id 映射）
 * @param langInstruction 语言指令（拼接在 system prompt 后）
 */
export async function extractSections(
  text: string,
  concepts: Concept[],
  langInstruction: string
): Promise<DocumentSection[]> {
  if (!text || !text.trim()) return [];

  const truncated = truncate(text, MAX_INPUT_CHARS);

  // 构建 label -> id 映射（大小写不敏感），用于把 LLM 输出的
  // conceptLabels 匹配回 conceptIds。aliases 也一并纳入映射，这样
  // LLM 即使使用了别名也能正确关联。
  const conceptByLabel = new Map<string, string>();
  for (const c of concepts) {
    if (!c.label) continue;
    conceptByLabel.set(c.label.trim().toLowerCase(), c.id);
    for (const alias of c.aliases || []) {
      const a = alias.trim().toLowerCase();
      if (a) conceptByLabel.set(a, c.id);
    }
  }

  // 在 user message 中显式列出所有 concept label，方便 LLM 引用
  const conceptList = concepts
    .map((c) => `- ${c.label}`)
    .filter(Boolean)
    .join("\n");

  const userContent = `Paper text:
${truncated}

Available concepts (use these exact labels in conceptLabels):
${conceptList}

Now produce the section outline as JSON.`;

  try {
    const completion = await agnes.chat.completions.create({
      model: AGNES_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT + langInstruction },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const sections = parsed.sections;
    if (!Array.isArray(sections)) return [];

    const result: DocumentSection[] = [];
    for (let i = 0; i < sections.length; i++) {
      const normalized = normalizeRawSection(sections[i], i, conceptByLabel);
      if (normalized) result.push(normalized);
    }
    return result;
  } catch {
    // 章节抽取是辅助功能，失败时不阻塞主管线
    return [];
  }
}
