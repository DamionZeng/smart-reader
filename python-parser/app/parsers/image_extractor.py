"""
图片提取统一逻辑 + 解析结果类型。

PDF 图片：PyMuPDF (fitz) 提取 + PIL 转 PNG
DOCX 图片：python-docx 关系提取
统一调用 storage.upload_image() 上传到 R2。
"""
import io
from dataclasses import dataclass

from PIL import Image

from app import storage


@dataclass
class ParseResult:
    """PDF/DOCX 解析统一输出，与 TS 版本 PdfToHtmlResult/DocxConvertResult 对齐。"""
    html: str
    plain_text: str
    image_count: int
    page_count: int
    title: str | None = None


def extract_pdf_image_to_png(image_bytes: bytes, fmt: str = "png") -> bytes:
    """把 PDF 中提取的图片字节转成 PNG 字节。

    PyMuPDF 的 doc.extract_image() 返回的图片可能是多种格式
    （PNG/JPEG/CMYK/...），统一用 PIL 转成 PNG 以兼容前端 <img>。
    """
    img = Image.open(io.BytesIO(image_bytes))
    # 处理 CMYK 等非 RGB 模式
    if img.mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def upload_image_bytes(image_bytes: bytes, mime: str, user_id: str) -> str:
    """上传图片字节到 R2，返回公开 URL。"""
    return await storage.upload_image(image_bytes, mime, user_id)


def skip_tiny_image(width: int, height: int, min_size: int = 20) -> bool:
    """跳过过小的装饰性图片（< 20x20）。"""
    return width < min_size or height < min_size
