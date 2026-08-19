from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_admin
from app.config import ROOT_ENV_FILE, get_settings
from app.schemas.settings import (
    AIModelOptionOut,
    AISettingsOut,
    AISettingsUpdateIn,
    WooMappingSettingsOut,
    WooMappingSettingsUpdateIn,
)
from app.utils.env_file import upsert_env_values

router = APIRouter()


AI_MODEL_OPTIONS: list[AIModelOptionOut] = [
    AIModelOptionOut(
        value="gpt-5.4",
        label="GPT-5.4",
        note="(önerilen varsayılan: görsel + metin SEO kalitesinde en güçlü genel seçenek)",
    ),
    AIModelOptionOut(
        value="gpt-5.4-pro",
        label="GPT-5.4 Pro",
        note="(en güçlü kalite, çok pahalı ve yavaş; bazı istekler dakika sürebilir)",
    ),
    AIModelOptionOut(
        value="gpt-5-nano",
        label="GPT-5 Nano",
        note="(en ucuz, çok hızlı; basit içerik üretimi için)",
    ),
    AIModelOptionOut(
        value="gpt-5-mini",
        label="GPT-5 Mini",
        note="(fiyat/performans güçlü; çoğu iş akışı için önerilir)",
    ),
    AIModelOptionOut(
        value="gpt-5",
        label="GPT-5",
        note="(reasoning daha güçlü; maliyet belirgin yüksek)",
    ),
    AIModelOptionOut(
        value="gpt-4.1-nano",
        label="GPT-4.1 Nano",
        note="(çok ucuz, hızlı; temel metin görevleri için)",
    ),
    AIModelOptionOut(
        value="gpt-4.1-mini",
        label="GPT-4.1 Mini",
        note="(fiyat/performans dengesi; günlük üretim için önerilir)",
    ),
    AIModelOptionOut(
        value="gpt-4.1",
        label="GPT-4.1",
        note="(reasoning güçlü; maliyet daha yüksek)",
    ),
    AIModelOptionOut(
        value="gpt-4o-mini",
        label="GPT-4o Mini",
        note="(görsel + metin için ekonomik seçenek)",
    ),
    AIModelOptionOut(
        value="gpt-4o",
        label="GPT-4o",
        note="(görsel algı güçlü; maliyet yüksek)",
    ),
]


def _mask_secret(secret: str) -> str | None:
    if not secret:
        return None
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:6]}...{secret[-4:]}"


def _build_ai_settings_out() -> AISettingsOut:
    settings = get_settings()
    api_key = settings.openai_api_key.strip()
    return AISettingsOut(
        openai_api_key_set=bool(api_key),
        openai_api_key_masked=_mask_secret(api_key),
        openai_base_url=settings.openai_base_url,
        openai_model=settings.openai_model,
        openai_timeout_seconds=float(settings.openai_timeout_seconds),
        model_options=AI_MODEL_OPTIONS,
    )


@router.get("/ai", response_model=AISettingsOut)
async def get_ai_settings(_: object = Depends(require_admin)) -> AISettingsOut:
    return _build_ai_settings_out()


@router.put("/ai", response_model=AISettingsOut)
async def update_ai_settings(
    payload: AISettingsUpdateIn,
    _: object = Depends(require_admin),
) -> AISettingsOut:
    model_name = payload.openai_model.strip()
    if not model_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Model seçimi boş bırakılamaz.",
        )

    base_url = payload.openai_base_url.strip()
    if not (base_url.startswith("http://") or base_url.startswith("https://")):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Base URL http:// veya https:// ile başlamalı.",
        )

    updates: dict[str, str] = {
        "OPENAI_BASE_URL": base_url.rstrip("/"),
        "OPENAI_MODEL": model_name,
        "OPENAI_TIMEOUT_SECONDS": str(float(payload.openai_timeout_seconds)),
    }
    if payload.openai_api_key is not None and payload.openai_api_key.strip():
        updates["OPENAI_API_KEY"] = payload.openai_api_key.strip()

    upsert_env_values(ROOT_ENV_FILE, updates)
    get_settings.cache_clear()
    return _build_ai_settings_out()


def _build_woo_mapping_settings_out() -> WooMappingSettingsOut:
    settings = get_settings()
    return WooMappingSettingsOut(
        category_map_json=settings.woocommerce_category_map_json,
        stonex_meta_map_json=settings.woocommerce_stonex_meta_map_json,
        badge_meta_json=settings.woocommerce_badge_meta_json,
        desc_footer_html=settings.woocommerce_desc_footer_html,
        desc_footer_enabled=settings.woocommerce_desc_footer_enabled,
        primary_term_meta_key=settings.woocommerce_primary_term_meta_key,
    )


def _validated_json_field(label: str, raw: str, expected: type) -> str:
    text = raw.strip()
    if not text:
        return ""
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{label} geçerli JSON değil: {exc.msg} (satır {exc.lineno})",
        ) from exc
    if not isinstance(parsed, expected):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{label} bir JSON {'nesnesi' if expected is dict else 'listesi'} olmalı.",
        )
    # Env dosyası tek satır ister; doğrulanmış JSON kompakt yazılır.
    return json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))


@router.get("/woocommerce", response_model=WooMappingSettingsOut)
async def get_woo_mapping_settings(_: object = Depends(require_admin)) -> WooMappingSettingsOut:
    return _build_woo_mapping_settings_out()


@router.put("/woocommerce", response_model=WooMappingSettingsOut)
async def update_woo_mapping_settings(
    payload: WooMappingSettingsUpdateIn,
    _: object = Depends(require_admin),
) -> WooMappingSettingsOut:
    updates = {
        "WOOCOMMERCE_CATEGORY_MAP_JSON": _validated_json_field("Kategori haritası", payload.category_map_json, dict),
        "WOOCOMMERCE_STONEX_META_MAP_JSON": _validated_json_field("StoneX meta haritası", payload.stonex_meta_map_json, dict),
        "WOOCOMMERCE_BADGE_META_JSON": _validated_json_field("Badge meta tanımı", payload.badge_meta_json, dict),
        # Env tek satır: çok satırlı HTML boşluğa indirgenir (görüntüde fark yaratmaz).
        "WOOCOMMERCE_DESC_FOOTER_HTML": " ".join(payload.desc_footer_html.split()),
        "WOOCOMMERCE_DESC_FOOTER_ENABLED": "true" if payload.desc_footer_enabled else "false",
        "WOOCOMMERCE_PRIMARY_TERM_META_KEY": payload.primary_term_meta_key.strip() or "_yoast_wpseo_primary_product_cat",
    }
    upsert_env_values(ROOT_ENV_FILE, updates)
    get_settings.cache_clear()
    return _build_woo_mapping_settings_out()
