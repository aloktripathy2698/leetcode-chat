from functools import lru_cache, cached_property
import re
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Central application configuration loaded from environment variables.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    project_name: str = Field(default="LeetCode Assistant Backend", validation_alias="PROJECT_NAME")
    environment: str = Field(default="development", validation_alias="APP_ENV")
    api_v1_prefix: str = Field(default="/api/v1", validation_alias="API_V1_PREFIX")

    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@postgres:5432/leetcode_assistant",
        validation_alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://redis:6379/0", validation_alias="REDIS_URL")

    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4o-mini", validation_alias="OPENAI_MODEL")
    embedding_model: str = Field(default="text-embedding-3-large", validation_alias="OPENAI_EMBEDDING_MODEL")

    cache_ttl_seconds: int = Field(default=300, validation_alias="CACHE_TTL_SECONDS")
    sqlalchemy_echo: bool = Field(default=False, validation_alias="SQLALCHEMY_ECHO")

    cors_origins_raw: str = Field(
        default="http://localhost:5173,chrome-extension://*",
        validation_alias="BACKEND_CORS_ORIGINS",
    )

    @cached_property
    def _cors_entries(self) -> list[str]:
        if not self.cors_origins_raw:
            return []
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]

    @property
    def cors_origins(self) -> list[str]:
        return [origin for origin in self._cors_entries if "*" not in origin]

    @property
    def cors_origin_regex(self) -> str | None:
        patterns: list[str] = []
        for origin in self._cors_entries:
            if "*" not in origin:
                continue
            escaped = re.escape(origin).replace("\\*", ".*")
            patterns.append(f"^{escaped}$")
        if not patterns:
            return None
        return "|".join(patterns)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
