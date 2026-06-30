"""
句子分割节点（对应 src/lib/graph/sentence-split.ts + ingest-code.ts 的 splitCodeIntoSentences）。

paper：调用 app.utils.sentence_split.split_sentences
code：按 // file: / --- file --- 分割代码块
"""
import re
from typing import Any

from app.graph.state import KGState
from app.utils.sentence_split import split_sentences as split_paper_sentences

# 代码文件标记正则（对应 ingest-code.ts 的 fileMatch）
_CODE_FILE_RE_1 = re.compile(r"^(?://|#|/\*)\s*(?:file|filename|path)[:\s]+(.+)$", re.IGNORECASE)
_CODE_FILE_RE_2 = re.compile(r"^---\s*(.+?)\s*---$")


def _split_code_into_sentences(code: str) -> list[dict[str, Any]]:
    """把代码按文件标记分割成 Sentence[]。

    对应 ingest-code.ts 的 splitCodeIntoSentences：
      - 遇到 "// file: xxx" 或 "--- xxx ---" 就切换 currentFile
      - 每个文件块（非空）作为一个 Sentence
    """
    if not code or not code.strip():
        return []
    sentences: list[dict[str, Any]] = []
    lines = code.split("\n")
    current_file = "main"
    file_index = 0
    buffer: list[str] = []

    def flush() -> None:
        nonlocal buffer
        if buffer:
            text = "\n".join(buffer).strip()
            if text:
                sentences.append({"text": text, "section": current_file, "paragraphIndex": file_index})
            buffer = []

    for line in lines:
        m = _CODE_FILE_RE_1.match(line) or _CODE_FILE_RE_2.match(line)
        if m:
            flush()
            current_file = m.group(1).strip()
            file_index += 1
            continue
        buffer.append(line)
    flush()

    if not sentences and code.strip():
        sentences.append({"text": code.strip(), "section": "main", "paragraphIndex": 0})

    return sentences


async def split_paper_sentences_node(state: KGState) -> dict:
    """Paper 管线节点：分割论文句子。"""
    sentences = split_paper_sentences(state.get("plain_text", ""))
    # 转成 dict 列表以兼容 KGState（Sentence dataclass → dict）
    result = [
        {"text": s.text, "section": s.section, "paragraphIndex": s.paragraph_index}
        for s in sentences
    ]
    return {"sentences": result}


async def split_code_sentences_node(state: KGState) -> dict:
    """Code 管线节点：分割代码块。"""
    sentences = _split_code_into_sentences(state.get("plain_text", ""))
    return {"sentences": sentences}
