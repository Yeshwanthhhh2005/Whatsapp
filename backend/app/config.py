"""Application settings, loaded once from the environment / .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Core ---------------------------------------------------------------
    env: str = "development"
    app_name: str = "WhatsApp Clone API"

    # No default: a shipped fallback secret is a real vulnerability, so the
    # app refuses to start without one.
    secret_key: str

    database_url: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/whatsapp_clone"
    )

    # --- Auth ---------------------------------------------------------------
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7

    # --- CORS ---------------------------------------------------------------
    # NoDecode is required: without it pydantic-settings tries to JSON-parse
    # any list-typed field straight out of .env and raises before the validator
    # below ever runs, so a plain comma-separated value would be rejected.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://localhost:19720",
            "http://localhost:3000",
        ]
    )

    # --- Uploads ------------------------------------------------------------
    upload_dir: str = "uploads"
    public_base_url: str = "http://localhost:8000"
    max_upload_size_mb: int = 10

    # --- Dev conveniences ---------------------------------------------------
    # Creates tables straight from the models on startup, skipping Alembic.
    # Handy for `pytest` and a first local run; never enable in production.
    auto_create_tables: bool = False

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept either a JSON list or a plain comma-separated string."""
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                return value
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    @field_validator("database_url")
    @classmethod
    def _require_async_driver(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            raise ValueError(
                "DATABASE_URL must use an async driver. "
                "Use 'postgresql+asyncpg://...' instead of 'postgresql://...'."
            )
        return value

    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_dir)
        return path if path.is_absolute() else BASE_DIR / path

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.env.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
