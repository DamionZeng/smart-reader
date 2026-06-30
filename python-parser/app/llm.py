"""
LLM 客户端 + 语言指令（对应 src/lib/agnes.ts + src/lib/ai-settings.ts）。

- 用 openai.AsyncOpenAI 指向 Agnes API
- 提供 SOURCE_LANGUAGE_INSTRUCTION 常量
- 提供 get_lang_instruction() 查询用户偏好语言
"""
from functools import lru_cache
from typing import Optional

from openai import AsyncOpenAI
from sqlalchemy import text

from app.config import get_settings
from app.db import get_db_session

_settings = get_settings()

# 语言代码 → 语言名称映射（对应 ai-settings.ts 的 LANGUAGE_NAMES）
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "zh": "Chinese (Simplified)",
    "ja": "Japanese",
    "ko": "Korean",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "pt": "Portuguese",
    "ru": "Russian",
    "ar": "Arabic",
}

DEFAULT_LANGUAGE = "en"

# Paper 管线：输出语言跟随原文（对应 ai-settings.ts 的 SOURCE_LANGUAGE_INSTRUCTION）
SOURCE_LANGUAGE_INSTRUCTION = (
    "\n\nIMPORTANT: You must write ALL your output (including concept labels, "
    "descriptions, cluster names, and any other text) in the SAME language as "
    "the source text provided. If the source text is in Chinese, write everything "
    "in Chinese. If in English, write in English. If in Japanese, write everything "
    "in Japanese. Always match the dominant language of the source text. You may "
    "use the original language verbatim when quoting evidence."
)


@lru_cache
def get_llm() -> AsyncOpenAI:
    """获取 OpenAI 客户端单例，指向 Agnes API。"""
    return AsyncOpenAI(
        api_key=_settings.agnes_api_key,
        base_url=_settings.agnes_base_url,
        timeout=_settings.agnes_timeout,
        max_retries=_settings.agnes_max_retries,
    )


def get_language_instruction(language: str) -> str:
    """构建语言指令字符串（对应 ai-settings.ts 的 getLanguageInstruction）。

    英文返回空字符串（默认），其他语言返回指令。
    """
    if not language or language == DEFAULT_LANGUAGE:
        return ""
    lang_name = LANGUAGE_NAMES.get(language, language)
    return (
        f"\n\nIMPORTANT: You must write ALL your output (including node titles, "
        f"descriptions, explanations, analogies, reviews, and any other text) in "
        f"{lang_name}. Do not use English unless you are quoting source material verbatim."
    )


def _detect_browser_language(accept_language: str) -> str:
    """从 Accept-Language header 检测首选语言（对应 i18n-config.ts 的 detectBrowserLanguage）。

    简化实现：取第一个 q>0 的语言代码，映射到支持的语言。
    """
    if not accept_language:
        return DEFAULT_LANGUAGE
    # 解析 "zh-CN,zh;q=0.9,en;q=0.8" 格式
    parts = []
    for item in accept_language.split(","):
        item = item.strip()
        if not item:
            continue
        if ";q=" in item:
            code, q_str = item.split(";q=", 1)
            try:
                q = float(q_str)
            except ValueError:
                q = 1.0
        else:
            code = item
            q = 1.0
        if q > 0:
            parts.append((q, code))
    parts.sort(key=lambda x: -x[0])
    for _, code in parts:
        primary = code.split("-")[0].lower()
        if primary in LANGUAGE_NAMES:
            return primary
    return DEFAULT_LANGUAGE


async def get_ai_output_language(
    user_id: str, accept_language: Optional[str] = None
) -> str:
    """获取用户偏好 AI 输出语言（对应 ai-settings.ts 的 getAIOutputLanguage）。

    优先级：
      1. user_settings.aiOutputLanguage（用户主动设置）
      2. Accept-Language header（浏览器语言）
      3. DEFAULT_LANGUAGE ("en")
    """
    try:
        async with get_db_session() as session:
            result = await session.execute(
                text("SELECT ai_output_language FROM user_settings WHERE user_id = :uid LIMIT 1"),
                {"uid": user_id},
            )
            row = result.first()
            if row and row[0]:
                return row[0]
    except Exception as e:
        # 表可能不存在（迁移未完成），降级到浏览器语言
        print(f"[llm] get_ai_output_language fallback: {e}", flush=True)
    if accept_language:
        return _detect_browser_language(accept_language)
    return DEFAULT_LANGUAGE


async def get_lang_instruction_for_user(
    user_id: str, accept_language: Optional[str] = None
) -> str:
    """获取用户的语言指令（对应 ai-settings.ts 的 getLanguageInstructionForUser）。"""
    lang = await get_ai_output_language(user_id, accept_language)
    return get_language_instruction(lang)


async def get_lang_instruction(
    doc_type: str,
    user_id: str,
    accept_language: Optional[str] = None,
) -> str:
    """根据文档类型返回语言指令。

    - paper: 返回 SOURCE_LANGUAGE_INSTRUCTION（输出语言跟随原文）
    - code: 查用户偏好，返回 get_language_instruction(lang)
    """
    if doc_type == "paper":
        return SOURCE_LANGUAGE_INSTRUCTION
    return await get_lang_instruction_for_user(user_id, accept_language)
