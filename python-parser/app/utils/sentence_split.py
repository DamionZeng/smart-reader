"""
句子分割工具，对应 src/lib/graph/sentence-split.ts。

JS 版用 sentence-splitter 库；Python 版用正则实现等价的中英文断句。
句子用于 buildCooccurrenceEdges 构建共现边，分割点近似即可。
"""
import re
from dataclasses import dataclass


@dataclass
class Sentence:
    text: str
    section: str
    paragraph_index: int


# 常见学术论文章节标题（小写），用于 detectSection
_SECTION_HEADERS = [
    "abstract",
    "introduction",
    "background",
    "related work",
    "related-work",
    "method",
    "methods",
    "methodology",
    "approach",
    "experiment",
    "experiments",
    "experimental setup",
    "results",
    "discussion",
    "conclusion",
    "conclusions",
    "references",
    "acknowledgments",
    "appendix",
]


def _normalize_section_name(name: str) -> str:
    lower = name.lower().strip()
    for header in _SECTION_HEADERS:
        if header in lower:
            return header
    return re.sub(r'\s+', '-', lower)


def _detect_section(paragraph: str) -> str | None:
    trimmed = paragraph.strip()
    if not trimmed:
        return None

    # markdown 标题
    md_match = re.match(r'^#{1,6}\s+(.+)$', trimmed)
    if md_match:
        return _normalize_section_name(md_match.group(1))

    lines = trimmed.split('\n')
    if len(lines) == 1 and len(trimmed) <= 80:
        # 去除前缀编号
        without_number = re.sub(r'^\d+\.?\s*', '', trimmed)
        without_number = re.sub(r'^[IVXLCM]+\.\s*', '', without_number)
        if (
            0 < len(without_number) <= 60
            and not re.search(r'[.;:]$', without_number)
        ):
            lower = without_number.lower()
            if any(h in lower for h in _SECTION_HEADERS):
                return _normalize_section_name(without_number)

    return None


# 句子结束标点：. ! ? 。 ！ ？  后跟空白或行尾
# 保留标点在句子里
_SENTENCE_SPLIT_RE = re.compile(r'(?<=[.!?。！？])(?:\s+|$)')


def _split_paragraph_to_sentences(paragraph: str) -> list[str]:
    """把段落拆成句子。近似 sentence-splitter 的行为。

    策略：在 . ! ? 。 ！ ？ 后的空白处分割，保留标点。
    过滤掉长度 < 2 的片段。
    """
    parts = _SENTENCE_SPLIT_RE.split(paragraph)
    sentences = []
    for p in parts:
        p = p.strip()
        if len(p) >= 2:
            sentences.append(p)
    return sentences if sentences else [paragraph.strip()] if paragraph.strip() else []


def split_sentences(text: str) -> list[Sentence]:
    """把文本拆成句子列表（带章节归属）。对应 splitSentences。"""
    if not text or not text.strip():
        return []

    sentences: list[Sentence] = []
    # 段落用双换行分隔
    paragraphs = re.split(r'\n\s*\n', text)
    current_section = "body"

    for paragraph_index, paragraph in enumerate(paragraphs):
        section = _detect_section(paragraph)
        if section:
            current_section = section
            continue
        if not paragraph.strip():
            continue

        final_sentences = _split_paragraph_to_sentences(paragraph)
        for s in final_sentences:
            if len(s) >= 2:
                sentences.append(Sentence(
                    text=s,
                    section=current_section,
                    paragraph_index=paragraph_index,
                ))

    return sentences
