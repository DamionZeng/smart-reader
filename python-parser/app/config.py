"""
应用配置加载（pydantic-settings v2）。

环境变量优先级：真实环境变量 > .env 文件 > 默认值。
所有配置集中在 settings 单例，其他模块从这里读取。
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # === 数据库（与 Next.js 共用同一个 Neon PostgreSQL）===
    database_url: str

    # === LLM（Agnes API，与 src/lib/agnes.ts 对齐）===
    agnes_api_key: str
    agnes_base_url: str = "https://apihub.agnes-ai.com/v1"
    agnes_model: str = "agnes-2.0-flash"
    # 单次 LLM 调用超时（秒）。Agnes API 不稳定时 fail-fast，
    # 避免单个请求挂起整个 Agent 工作流。
    agnes_timeout: int = 60
    agnes_max_retries: int = 2

    # === Cloudflare R2（与 src/lib/storage.ts 对齐）===
    r2_endpoint_url: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket_name: str
    r2_public_url: str

    # === 服务运行 ===
    host: str = "0.0.0.0"
    port: int = 8000

    # === 解析限制（与 Next.js MAX_FILE_BYTES 对齐）===
    max_file_bytes: int = 10 * 1024 * 1024  # 10MB
    max_response_bytes: int = 20 * 1024 * 1024  # 20MB
    max_pdf_pages: int = 80
    max_input_chars: int = 100_000

    @property
    def is_r2_configured(self) -> bool:
        return all([
            self.r2_endpoint_url,
            self.r2_access_key_id,
            self.r2_secret_access_key,
            self.r2_bucket_name,
            self.r2_public_url,
        ])


@lru_cache
def get_settings() -> Settings:
    """单例 settings，避免重复解析环境变量。"""
    return Settings()  # type: ignore[call-arg]
