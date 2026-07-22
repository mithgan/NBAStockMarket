from __future__ import annotations

from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

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
    database_url: SecretStr = SecretStr(
        "sqlite+pysqlite:///./nba-stock-market.db"
    )
    auto_create_schema: bool = False
    seed_file: Path | None = None
    cors_origins: list[str] = Field(default_factory=list)
    supabase_url: str | None = None
    supabase_publishable_key: SecretStr | None = None
    supabase_jwt_audience: str = "authenticated"

    @field_validator("supabase_url")
    @classmethod
    def normalize_supabase_url(cls, value: str | None) -> str | None:
        return value.rstrip("/") if value else None

    def validate_runtime(self) -> None:
        database_url = self.database_url.get_secret_value()
        if not database_url.startswith(
            ("sqlite+pysqlite://", "postgresql+psycopg://")
        ):
            raise RuntimeError(
                "database_url must use sqlite+pysqlite or postgresql+psycopg"
            )
        if self.environment != "production":
            return
        if not database_url.startswith("postgresql+psycopg://"):
            raise RuntimeError("production requires a PostgreSQL database")
        if self.auto_create_schema:
            raise RuntimeError("production cannot auto-create the database schema")

        parsed_supabase_url = urlparse(self.supabase_url or "")
        try:
            supabase_port = parsed_supabase_url.port
        except ValueError as exc:
            raise RuntimeError("production requires a valid Supabase auth issuer") from exc
        if (
            parsed_supabase_url.scheme != "https"
            or not parsed_supabase_url.hostname
            or parsed_supabase_url.username is not None
            or parsed_supabase_url.password is not None
            or parsed_supabase_url.path not in ("", "/")
            or parsed_supabase_url.query
            or parsed_supabase_url.fragment
        ):
            raise RuntimeError("production requires a valid HTTPS Supabase auth issuer")

        hostname = parsed_supabase_url.hostname
        canonical_host = f"[{hostname}]" if ":" in hostname else hostname
        canonical_url = f"https://{canonical_host}"
        if supabase_port is not None and supabase_port != 443:
            canonical_url = f"{canonical_url}:{supabase_port}"
        self.supabase_url = canonical_url
