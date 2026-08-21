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
    openai_reasoning_effort: str
    openai_timeout_seconds: float
    model_options: list[AIModelOptionOut]
    reasoning_effort_options: list[str]


class AISettingsUpdateIn(AppBaseModel):
    openai_api_key: str | None = Field(
        default=None,
        description="Boş/null gelirse mevcut anahtar korunur. Dolu gelirse güncellenir.",
    )
    openai_base_url: str
    openai_model: str
    # Reasoning effort AYRI parametre (model ID'sine yapıştırılmaz). Boş = model default.
    openai_reasoning_effort: str = "high"
    openai_timeout_seconds: float = Field(default=20.0, ge=5.0, le=120.0)



class WooMappingSettingsOut(AppBaseModel):
    category_map_json: str
    stonex_meta_map_json: str
    badge_meta_json: str
    desc_footer_html: str
    desc_footer_enabled: bool
    primary_term_meta_key: str


class WooMappingSettingsUpdateIn(AppBaseModel):
    category_map_json: str = ""
    stonex_meta_map_json: str = ""
    badge_meta_json: str = ""
    desc_footer_html: str = ""
    desc_footer_enabled: bool = True
    primary_term_meta_key: str = "_yoast_wpseo_primary_product_cat"
