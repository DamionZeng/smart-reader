import fitz
import sys

pdf_path = r'c:\Users\damion.zeng\.trae-cn\attachments\6a4254167854ee4b3186a193\f47b8d10-9159-4b19-b2b3-e1e4059e5fd3_N元语法模型及其与大语言模型的关系.pdf'
doc = fitz.open(pdf_path)

print(f"=== 总页数: {doc.page_count} ===")
print(f"=== 元数据: {doc.metadata} ===")
print()

for i in range(doc.page_count):
    page = doc[i]
    text = page.get_text()
    text_dict = page.get_text("dict")
    
    # 统计 blocks/lines/spans
    n_blocks = len(text_dict.get("blocks", []))
    n_text_blocks = sum(1 for b in text_dict.get("blocks", []) if b.get("type", 0) == 0)
    n_img_blocks = sum(1 for b in text_dict.get("blocks", []) if b.get("type", 0) == 1)
    n_lines = sum(len(b.get("lines", [])) for b in text_dict.get("blocks", []) if b.get("type", 0) == 0)
    n_spans = 0
    for b in text_dict.get("blocks", []):
        if b.get("type", 0) == 0:
            for l in b.get("lines", []):
                n_spans += len(l.get("spans", []))
    
    # 统计图片
    img_list = page.get_images(full=True)
    
    print(f"--- 第 {i+1} 页 ---")
    print(f"  页面尺寸: {page.rect.width:.1f} x {page.rect.height:.1f}")
    print(f"  文本长度: {len(text)} 字符")
    print(f"  blocks: {n_blocks} (文本 {n_text_blocks}, 图片 {n_img_blocks})")
    print(f"  lines: {n_lines}, spans: {n_spans}")
    print(f"  嵌入图片数: {len(img_list)}")
    print(f"  纯文本前 200 字符: {repr(text[:200])}")
    print()

doc.close()
