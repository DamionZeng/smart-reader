"""
HTML 工具函数，对应 src/utils/html-utils.ts。

KG 流水线前需要 stripHtml 把结构化 HTML（PDF/DOCX 产物）转成纯文本送给 LLM；
escapeHtml 用于解析器把提取出的文本插入 HTML 结构时转义。
"""
import re
from typing import Set

# void 标签集合（safe_truncate_html 用）—— 与 TS 版本一致
_VOID_TAGS: Set[str] = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}


def strip_html(html: str) -> str:
    """去除所有 HTML 标签，返回纯文本。

    - block 级闭合标签转换为换行
    - <br> 转换为换行
    - <td>/<th> 转换为 tab
    - 解码常见 HTML 实体
    - 折叠 3+ 换行为 2 个
    """
    if not html:
        return ""

    s = html
    # block 级闭合标签 → 换行
    s = re.sub(r'</(p|div|h[1-6]|li|tr|blockquote)>', '\n', s, flags=re.IGNORECASE)
    # <br> → 换行
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.IGNORECASE)
    # <td>/<th> → tab
    s = re.sub(r'</?(td|th)>', '\t', s, flags=re.IGNORECASE)
    # 移除所有剩余标签
    s = re.sub(r'<[^>]+>', '', s)
    # 解码常见 HTML 实体（顺序与 TS 版本一致，&amp; 必须最先）
    s = s.replace('&amp;', '&')
    s = s.replace('&lt;', '<')
    s = s.replace('&gt;', '>')
    s = s.replace('&quot;', '"')
    s = s.replace('&#39;', "'")
    s = s.replace('&apos;', "'")
    s = s.replace('&nbsp;', ' ')
    # 数字实体 &#NNN;
    s = re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))), s)
    # 折叠 3+ 换行为 2 个
    s = re.sub(r'\n{3,}', '\n\n', s)
    # 每行去首尾空白
    s = '\n'.join(line.strip() for line in s.split('\n'))
    return s.strip()


def escape_html(text: str) -> str:
    """转义 HTML 特殊字符，用于把提取文本安全插入 HTML 结构。"""
    if not text:
        return ""
    s = text
    s = s.replace('&', '&amp;')
    s = s.replace('<', '&lt;')
    s = s.replace('>', '&gt;')
    s = s.replace('"', '&quot;')
    s = s.replace("'", '&#39;')
    return s


def is_html(text: str) -> bool:
    """检测字符串是否像 HTML（包含标签）。用于决定是否 strip 后再送 LLM。"""
    if not text:
        return False
    return bool(re.search(r'<[a-z][\s\S]*?>', text, re.IGNORECASE))


def safe_truncate_html(html: str, max_len: int) -> str:
    """安全截断 HTML 到最大长度，不留下未闭合标签。

    朴素的 substring(0, N) 会切断 <figure><img src="..."> 中间，
    导致浏览器丢弃破损元素——这是 OriginalTextPanel 图片丢失的根因。

    策略（与 TS 版本逐行对齐）：
      1. 长度未超限直接返回
      2. 遍历字符串追踪开/闭标签栈，在不超过 limit 且不在标签内部的位置截断
      3. 收集仍打开的标签，按逆序追加闭合标签
    """
    if not html or len(html) <= max_len:
        return html or ""

    open_stack: list[str] = []
    i = 0
    cut_pos = -1

    while i < len(html) and i < max_len:
        ch = html[i]

        if ch == '<':
            end = html.find('>', i)
            if end == -1:
                # 畸形标签——在此截断
                cut_pos = i
                break
            tag_content = html[i + 1:end]
            is_closing = tag_content.startswith('/')
            tag_name_match = re.match(r'^/?\s*([a-zA-Z][a-zA-Z0-9]*)', tag_content)
            tag_name = tag_name_match.group(1).lower() if tag_name_match else ""

            if is_closing:
                # 从栈中弹出直到匹配的标签
                try:
                    idx = len(open_stack) - 1 - open_stack[::-1].index(tag_name)
                    open_stack = open_stack[:idx]
                except ValueError:
                    pass  # 栈中没有匹配项，忽略
            elif tag_name not in _VOID_TAGS and not tag_content.endswith('/'):
                # 开标签（非 void、非自闭合）
                open_stack.append(tag_name)

            # 如果标签整体在 max_len 内，跳过它
            if end + 1 <= max_len:
                i = end + 1
                cut_pos = i
            else:
                # 标签跨越 limit——在此标签前截断以保持完整
                cut_pos = i
                break
        else:
            i += 1
            if i <= max_len:
                cut_pos = i

    if cut_pos == -1:
        cut_pos = max_len

    result = html[:cut_pos]
    # 按逆序追加未闭合标签
    for j in range(len(open_stack) - 1, -1, -1):
        result += f'</{open_stack[j]}>'

    return result
