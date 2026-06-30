"""
PDF → HTML 转换器，对应 src/lib/pdf-to-html.ts。

使用 PyMuPDF (fitz) 提取文本 span（带 bbox）和图片（带 bbox），
生成绝对定位 HTML 1:1 复刻 PDF 版面。图片转 PNG 传 R2。

输出结构与 TS 版本兼容：OriginalTextPanel 的 .pdf-content 样式作用域、
<mark> 高亮注入、data-link-id 等属性依赖此结构。

PyMuPDF 坐标系：top-left origin（y 向下），与 pdfjs 的 bottom-left 不同。
因此无需 TS 版本的 screenY = pageHeight - pdfY 转换，直接用 bbox 坐标。
"""
import io
from dataclasses import dataclass

import fitz  # PyMuPDF
from PIL import Image

from app import storage
from app.config import get_settings
from app.parsers.image_extractor import ParseResult
from app.utils.html_utils import escape_html, strip_html

_settings = get_settings()


@dataclass
class _TextSpan:
    """文本 span（一行内同一格式的连续文本）。"""
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    font_size: float
    font_name: str


@dataclass
class _ImageEntry:
    """图片条目（带页面内位置）。"""
    url: str
    alt: str
    x0: float
    y0: float
    width: int
    height: int


def _is_bold_font(font_name: str) -> bool:
    """启发式：字体名含 bold/heavy/black 视为粗体。对应 TS 版本 isBold 检测。"""
    name = (font_name or "").lower()
    return any(kw in name for kw in ("bold", "heavy", "black"))


@dataclass
class _TextLine:
    """文本行（直接对应 PyMuPDF dict 里的 line，不重新分组）。"""
    bbox: tuple[float, float, float, float]  # (x0, y0, x1, y1) 页面坐标系
    spans: list["_TextSpan"]


def _build_line_html(line: _TextLine) -> str:
    """构建单行文本的 HTML。

    核心设计（修复文字重叠）：
    1. 用 PyMuPDF 原生 line.bbox 作为 div 的位置和尺寸，不重新分组——
       之前用 y_tolerance=2.0 自己分组，会把双栏论文/脚注里 y0 相近的
       两行错误合并成一行，导致一行内挤进两行内容，重叠严重。
    2. div 有明确的 width 和 height，溢出 hidden——浏览器渲染字体
       度量 ≠ PDF 字体度量，div 没 height 时浏览器行高会超过 PDF 行距，
       把下一行盖住。
    3. div 内每个 span 用**相对 div 的绝对定位**（left = span.x0 - line.x0），
       保留 PDF 原始 justify 间距，不依赖浏览器 inline flow 的累积宽度。
    4. span 的 top 用 (line.height - span.font_size) / 2，让文字在
       line div 内垂直居中，baseline 对齐。
    """
    lx0, ly0, lx1, ly1 = line.bbox
    line_width = lx1 - lx0
    line_height = ly1 - ly0
    if line_width <= 0 or line_height <= 0:
        return ""

    parts = [
        f'  <div style="position:absolute;left:{lx0:.1f}px;top:{ly0:.1f}px;'
        f'width:{line_width:.1f}px;height:{line_height:.1f}px;'
        f'font-family:serif;color:#1c1c1c;z-index:2;overflow:hidden;">'
    ]
    for span in line.spans:
        is_bold = _is_bold_font(span.font_name)
        font_weight = "font-weight:bold;" if is_bold else ""
        # span 相对 div 左上角的偏移：x 用 PDF 原始坐标差，y 让文字垂直居中
        rel_x = span.x0 - lx0
        rel_y = max(0.0, (line_height - span.font_size) / 2)
        parts.append(
            f'    <span style="position:absolute;left:{rel_x:.1f}px;top:{rel_y:.1f}px;'
            f'font-size:{span.font_size:.1f}px;{font_weight}'
            f'white-space:pre;line-height:1.0;">'
            f'{escape_html(span.text)}</span>'
        )
    parts.append("  </div>")
    return "\n".join(parts)


def _extract_text_lines(page: fitz.Page) -> list[_TextLine]:
    """从页面提取文本行（直接用 PyMuPDF 的 line 结构，不重新分组）。

    PyMuPDF 的 page.get_text("dict") 已经按行分好组：
    blocks → lines → spans。每个 line 有自己的 bbox，line 内的 spans
    是同一行里同格式的连续文本。

    之前用 y_tolerance 自己重新分组是错误的——双栏论文/脚注里相邻行
    y0 差距可能 < 2pt，会被错误合并成一行，导致严重重叠。
    """
    lines: list[_TextLine] = []
    try:
        text_dict = page.get_text("dict")
        for block in text_dict.get("blocks", []):
            if block.get("type", 0) != 0:  # 非文本块（图片）
                continue
            for line in block.get("lines", []):
                line_bbox = tuple(line.get("bbox", [0, 0, 0, 0]))
                spans: list[_TextSpan] = []
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    if not text or not text.strip():
                        continue
                    bbox = span.get("bbox", [0, 0, 0, 0])
                    spans.append(_TextSpan(
                        text=text,
                        x0=bbox[0],
                        y0=bbox[1],
                        x1=bbox[2],
                        y1=bbox[3],
                        font_size=span.get("size", 10),
                        font_name=span.get("font", ""),
                    ))
                if spans:
                    lines.append(_TextLine(bbox=line_bbox, spans=spans))
    except Exception as e:
        print(f"[pdf_parser] text extraction failed: {e}", flush=True)

    return lines


def _build_image_html(img: _ImageEntry) -> str:
    """构建图片 HTML。对应 TS 版本的 <img> 标签。

    关键:width/height 必须是页面坐标系里的**渲染尺寸**（即 bbox 尺寸），
    而不是原始图片像素尺寸——否则 `max-width:100%` 会让图片按原始像素
    等比缩放到页面宽度,远超实际渲染框,盖住后面的文字。
    """
    return (
        f'  <img src="{img.url}" alt="{escape_html(img.alt)}" '
        f'style="position:absolute;left:{img.x0:.1f}px;top:{img.y0:.1f}px;'
        f'width:{img.width:.1f}px;height:{img.height:.1f}px;z-index:1;" />'
    )


def _build_page_html(
    lines: list[_TextLine],
    images: list[_ImageEntry],
    page_index: int,
    page_width: float,
    page_height: float,
) -> str:
    """构建单页 HTML，结构与 TS 版本 buildPageHtml 对齐。

    `lines` 是 PyMuPDF 原生 line 结构（不重新分组），每个 line 有自己的
    bbox 和 spans。每个 line 渲染为一个带明确 bbox 的 div，div 内 span
    用相对绝对定位保留 PDF 原始 x 坐标。
    """
    if not lines and not images:
        return ""

    parts: list[str] = []
    # 页面容器：精确 PDF 尺寸，relative 定位上下文
    parts.append(
        f'<div class="pdf-page" data-page="{page_index + 1}" '
        f'style="position:relative;width:{page_width:.1f}px;height:{page_height:.1f}px;'
        f'background:white;margin:0 auto 24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">'
    )
    # 图片先渲染（低 z-index，文字在上层）
    for img in images:
        parts.append(_build_image_html(img))
    # 文本行
    for line in lines:
        if not any(s.text.strip() for s in line.spans):
            continue
        parts.append(_build_line_html(line))
    parts.append("</div>")
    return "\n".join(parts)


async def _extract_images_from_page(
    doc: fitz.Document,
    page: fitz.Page,
    page_index: int,
    user_id: str,
) -> list[_ImageEntry]:
    """从页面提取图片，上传 R2，返回带位置的图片条目。

    用 page.get_images() + page.get_image_bbox() 获取图片位置，
    用 doc.extract_image() 获取图片字节。
    """
    if not storage.is_r2_configured():
        return []

    images: list[_ImageEntry] = []
    seen_xrefs: set[int] = set()  # 去重：同一图片在同一页多次引用只取一次
    try:
        img_list = page.get_images(full=True)
        for img_info in img_list:
            xref = img_info[0]
            if xref in seen_xrefs:
                continue
            try:
                # 获取图片在页面上的渲染 bbox（已经应用了变换矩阵，
                # bbox.width/height 是 PDF 页面坐标系里的实际渲染尺寸）
                bbox = page.get_image_bbox(img_info)
                if bbox is None or bbox.is_empty:
                    continue

                # 用渲染尺寸跳过过小的装饰性图片（不是原始像素尺寸）
                if bbox.width < 20 or bbox.height < 20:
                    continue

                # 提取图片字节
                img_data = doc.extract_image(xref)
                if not img_data or not img_data.get("image"):
                    continue

                # 转 PNG
                png_bytes = _convert_to_png(img_data["image"], img_data.get("ext", ""))

                # 上传 R2
                url = await storage.upload_image(png_bytes, "image/png", user_id)

                seen_xrefs.add(xref)
                images.append(_ImageEntry(
                    url=url,
                    alt=f"Figure from page {page_index + 1}",
                    x0=bbox.x0,
                    y0=bbox.y0,
                    width=bbox.width,
                    height=bbox.height,
                ))
            except Exception as e:
                # 跳过单张图片失败
                print(f"[pdf_parser] Image extraction failed on page {page_index + 1}: {e}", flush=True)
    except Exception as e:
        print(f"[pdf_parser] get_images failed on page {page_index + 1}: {e}", flush=True)

    return images


def _convert_to_png(image_bytes: bytes, ext: str) -> bytes:
    """把图片字节转成 PNG。处理 CMYK 等非 RGB 模式。"""
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def convert_pdf_to_html(
    buffer: bytes,
    user_id: str,
    max_pages: int | None = None,
) -> ParseResult:
    """把 PDF 字节转换为结构化 HTML。对应 convertPdfToHtml。

    - 文本以绝对定位 <span> 渲染，1:1 复刻 PDF 版面
    - 图片提取后转 PNG 传 R2，以 <img> 绝对定位渲染
    - 输出 plainText = strip_html(html)，供 KG 流水线用
    """
    if max_pages is None:
        max_pages = _settings.max_pdf_pages

    try:
        doc = fitz.open(stream=buffer, filetype="pdf")
    except Exception as e:
        detail = str(e)
        print(f"[pdf_parser] Failed to load PDF: {detail}", flush=True)
        raise RuntimeError(f"Failed to parse the PDF file: {detail}")

    # 从 PDF 元数据提取标题（优先级高于正文第一行）
    pdf_title: str | None = None
    try:
        meta = doc.metadata or {}
        raw_title = meta.get("title") or ""
        raw_title = raw_title.strip()
        if raw_title and 5 <= len(raw_title) <= 200:
            pdf_title = raw_title
    except Exception:
        pass

    page_count = min(doc.page_count, max_pages)
    page_html_parts: list[str] = []
    total_image_count = 0

    try:
        for i in range(page_count):
            page = doc[i]
            # 页面尺寸（point 单位，1 point = 1 px @ 72dpi）
            page_rect = page.rect
            page_width = page_rect.width
            page_height = page_rect.height

            # 提取文本行（按 y 分组后的 span 列表）
            lines = _extract_text_lines(page)

            # 提取图片
            images = await _extract_images_from_page(doc, page, i, user_id)
            total_image_count += len(images)

            # 构建页面 HTML
            page_html = _build_page_html(lines, images, i, page_width, page_height)
            if page_html:
                page_html_parts.append(page_html)
    finally:
        doc.close()

    html = "\n\n".join(page_html_parts)
    plain_text = strip_html(html)

    if not plain_text.strip():
        print("[pdf_parser] No text content extracted (may be scanned).", flush=True)

    return ParseResult(
        html=html,
        plain_text=plain_text,
        image_count=total_image_count,
        page_count=page_count,
        title=pdf_title,
    )
