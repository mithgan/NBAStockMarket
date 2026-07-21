from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class ApiSettings(BaseSettings):
    """Runtime settings. Secrets come from the process environment only."""

    model_config = SettingsConfigDict(
        env_prefix="NBA_STOCK_",
        extra="ignore",
        case_sensitive=False,
    )

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite+pysqlite:///./nba-stock-market.db"
    auto_create_schema: bool = False
    seed_file: Path | None = None
    cors_origins: list[str] = Field(default_factory=list)
    supabase_url: str | None = None
    supabase_publishable_key: SecretStr | None = None
    supabase_jwt_audience: str = "authenticated"

    @field_validator("database_url")
    @classmethod
    def supported_database_url(cls, value: str) -> str:
        if not value.startswith(("sqlite+pysqlite://", "postgresql+psycopg://")):
            raise ValueError(
                "database_url must use sqlite+pysqlite or postgresql+psycopg"
            )
        return value

    @field_validator("supabase_url")
    @classmethod
    def normalize_supabase_url(cls, value: str | None) -> str | None:
        return value.rstrip("/") if value else None
