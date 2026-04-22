from __future__ import annotations

from pydantic import Field

from app.schemas.base import AppBaseModel


class AIModelOptionOut(AppBaseModel):
    value: str
    label: str
    note: str


class AISettingsOut(AppBaseModel):
    openai_api_key_set: bool
    openai_api_key_masked: str | None = None
    openai_base_url: str
    openai_model: str
    openai_timeout_seconds: float
    model_options: list[AIModelOptionOut]


class AISettingsUpdateIn(AppBaseModel):
    openai_api_key: str | None = Field(
        default=None,
        description="Boş/null gelirse mevcut anahtar korunur. Dolu gelirse güncellenir.",
    )
    openai_base_url: str
    openai_model: str
    openai_timeout_seconds: float = Field(default=20.0, ge=5.0, le=120.0)

