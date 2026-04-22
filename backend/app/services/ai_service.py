from __future__ import annotations

import base64
from dataclasses import dataclass
import mimetypes
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
import httpx
from PIL import Image, ImageFile

from app.config import get_settings
from app.models.product import Product

ImageFile.LOAD_TRUNCATED_IMAGES = True


PRODUCT_TYPE_DA = {
    "bracelet": "armbånd",
    "ring": "ring",
    "necklace": "halskæde",
    "earring": "øreringe",
    "chain": "kæde",
    "bar": "barre",
    "jewelry": "smykke",
}

METAL_TYPE_DA = {
    "yellow_gold": "gult guld",
    "white_gold": "hvidguld",
    "silver": "sølv",
    "platinum": "platin",
    "palladium": "palladium",
}

MODEL_PRICING_USD_PER_1M: dict[str, dict[str, Decimal]] = {
    "gpt-5.4": {
        "input": Decimal("2.50"),
        "output": Decimal("15.00"),
    },
    "gpt-5.4-pro": {
        "input": Decimal("30.00"),
        "output": Decimal("180.00"),
    },
    "gpt-5-nano": {
        "input": Decimal("0.05"),
        "output": Decimal("0.40"),
    },
    "gpt-5-mini": {
        "input": Decimal("0.25"),
        "output": Decimal("2.00"),
    },
    "gpt-5": {
        "input": Decimal("1.25"),
        "output": Decimal("10.00"),
    },
    "gpt-4.1-nano": {
        "input": Decimal("0.10"),
        "output": Decimal("0.40"),
    },
    "gpt-4.1-mini": {
        "input": Decimal("0.40"),
        "output": Decimal("1.60"),
    },
    "gpt-4.1": {
        "input": Decimal("2.00"),
        "output": Decimal("8.00"),
    },
    "gpt-4o-mini": {
        "input": Decimal("0.15"),
        "output": Decimal("0.60"),
    },
    "gpt-4o": {
        "input": Decimal("2.50"),
        "output": Decimal("10.00"),
    },
}


@dataclass(slots=True)
class AIUsageSummary:
    provider: str
    model: str
    pricing_key: str | None
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    input_cost_usd: Decimal
    output_cost_usd: Decimal
    total_cost_usd: Decimal
    raw_usage: dict[str, Any]


class AIService:
    def __init__(self) -> None:
        settings = get_settings()
        self.api_key = settings.openai_api_key.strip()
        self.base_url = settings.openai_base_url.rstrip("/")
        self.model = settings.openai_model
        self.timeout = max(5.0, float(settings.openai_timeout_seconds))
        self.media_root = settings.media_root_path()
        self.max_images = 4

    def _build_prompt(self, product: Product) -> str:
        product_type_key = getattr(product.product_type, "value", str(product.product_type))
        metal_type_key = getattr(product.metal_type, "value", str(product.metal_type))

        product_type = PRODUCT_TYPE_DA.get(product_type_key, "smykke")
        metal_type = METAL_TYPE_DA.get(metal_type_key, "ædelmetal")
        weight = str(product.weight_grams)
        karat = product.purity_karat or "-"
        purity = str(product.purity_percentage) if product.purity_percentage is not None else "-"
        ref = product.reference_number or product.product_number or "-"

        return (
            "Skriv en dansk WooCommerce SEO-pakke for et smykke.\n"
            "Meget vigtigt:\n"
            "- Brug produkttypen naturligt i teksten (fx ring, armband, halskæde, øreringe).\n"
            "- Brug metaltype, vægt, karat og renhed semantisk korrekt.\n"
            "- Brug også visuelle detaljer fra billederne (fx kædetype, sten, mønster, lukning, overflade/stand).\n"
            "- Hvis noget er uklart i billedet, skriv neutralt uden at gætte.\n"
            "- Ingen investeringsråd, ingen garantiløfter, ingen overdrivelser.\n"
            "- Skriv professionelt, klart og salgsvenligt.\n"
            "- Hold sproget naturligt for dansk e-handel.\n\n"
            "Outputformat (følg præcis disse sektioner):\n"
            "SEO_TITLE:\n"
            "<maks 70 tegn>\n\n"
            "SHORT_DESCRIPTION:\n"
            "<1-2 sætninger, 140-220 tegn>\n\n"
            "LONG_DESCRIPTION_HTML:\n"
            "<HTML med 2 korte afsnit + en ul-liste med specifikationer + afsluttende CTA>\n\n"
            "META_DESCRIPTION:\n"
            "<maks 155 tegn>\n\n"
            "URL_SLUG:\n"
            "<kun små bogstaver, tal og bindestreger>\n\n"
            f"Produktdata:\n"
            f"- Produkttype: {product_type}\n"
            f"- Metal: {metal_type}\n"
            f"- Vægt: {weight} g\n"
            f"- Karat: {karat}\n"
            f"- Renhed: {purity}%\n"
            f"- Reference: {ref}\n"
        )

    def _sorted_photos(self, product: Product) -> list[dict[str, Any]]:
        photos = list(product.photos or [])
        photos.sort(
            key=lambda item: (
                0 if bool(item.get("is_primary")) else 1,
                str(item.get("uploaded_at") or ""),
            )
        )
        return photos

    def _resolve_media_path_from_url(self, value: str) -> Path | None:
        text = value.strip()
        if not text:
            return None
        if text.startswith("file://"):
            return Path(text[7:]).expanduser().resolve()
        if text.startswith("/media/"):
            rel = text.removeprefix("/media/").strip("/")
            return (self.media_root / rel).resolve()
        if text.startswith("/"):
            return Path(text).expanduser().resolve()
        return None

    def _read_photo_bytes(self, photo_item: dict[str, Any]) -> tuple[bytes, str] | None:
        candidates = [
            str(photo_item.get("original_path") or ""),
            str(photo_item.get("avif_path") or ""),
            str(photo_item.get("original_url") or ""),
            str(photo_item.get("url") or ""),
        ]

        for candidate in candidates:
            value = candidate.strip()
            if not value:
                continue

            if value.startswith("http://") or value.startswith("https://"):
                try:
                    response = httpx.get(value, timeout=self.timeout, follow_redirects=True)
                    if response.status_code >= 400:
                        continue
                    content_type = (response.headers.get("content-type") or "application/octet-stream").split(";")[0]
                    return response.content, content_type
                except Exception:
                    continue

            path = self._resolve_media_path_from_url(value)
            if not path:
                continue
            try:
                if path.exists():
                    data = path.read_bytes()
                    guessed = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                    return data, guessed
            except Exception:
                continue

        return None

    def _to_jpeg_data_url(self, raw_bytes: bytes) -> str:
        # OpenAI image_url data payload works most reliably with jpeg/png.
        try:
            from io import BytesIO

            with Image.open(BytesIO(raw_bytes)) as img:
                normalized = img.convert("RGB")
                out = BytesIO()
                normalized.save(out, format="JPEG", quality=88, optimize=True)
                payload = base64.b64encode(out.getvalue()).decode("utf-8")
                return f"data:image/jpeg;base64,{payload}"
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Fotoğraf AI analizine hazırlanamadı: {exc}",
            ) from exc

    def _build_user_content(self, product: Product) -> list[dict[str, Any]]:
        content: list[dict[str, Any]] = [{"type": "text", "text": self._build_prompt(product)}]
        photos = self._sorted_photos(product)

        for photo in photos[: self.max_images]:
            loaded = self._read_photo_bytes(photo)
            if not loaded:
                continue
            raw_bytes, _content_type = loaded
            try:
                data_url = self._to_jpeg_data_url(raw_bytes)
            except HTTPException:
                continue
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": data_url},
                }
            )
        return content

    def _safe_int(self, value: Any) -> int:
        try:
            return int(value or 0)
        except Exception:
            return 0

    def _resolve_pricing_key(self, model_name: str) -> str | None:
        normalized = (model_name or "").strip().lower()
        if not normalized:
            return None

        if normalized in MODEL_PRICING_USD_PER_1M:
            return normalized

        for key in sorted(MODEL_PRICING_USD_PER_1M.keys(), key=len, reverse=True):
            if normalized.startswith(key):
                return key
        return None

    def _build_usage_summary(self, response_payload: dict[str, Any]) -> AIUsageSummary:
        usage = response_payload.get("usage") or {}
        model_name = str(response_payload.get("model") or self.model or "").strip()

        prompt_tokens = self._safe_int(usage.get("prompt_tokens", usage.get("input_tokens")))
        completion_tokens = self._safe_int(usage.get("completion_tokens", usage.get("output_tokens")))
        total_tokens = self._safe_int(usage.get("total_tokens")) or (prompt_tokens + completion_tokens)

        pricing_key = self._resolve_pricing_key(model_name)
        input_rate = Decimal("0")
        output_rate = Decimal("0")
        if pricing_key:
            input_rate = MODEL_PRICING_USD_PER_1M[pricing_key]["input"]
            output_rate = MODEL_PRICING_USD_PER_1M[pricing_key]["output"]

        input_cost = (Decimal(prompt_tokens) / Decimal("1000000")) * input_rate
        output_cost = (Decimal(completion_tokens) / Decimal("1000000")) * output_rate
        total_cost = input_cost + output_cost

        return AIUsageSummary(
            provider="openai",
            model=model_name or self.model,
            pricing_key=pricing_key,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            input_cost_usd=input_cost.quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP),
            output_cost_usd=output_cost.quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP),
            total_cost_usd=total_cost.quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP),
            raw_usage=usage if isinstance(usage, dict) else {},
        )

    async def generate_description_with_usage(self, *, product: Product) -> tuple[str, AIUsageSummary]:
        if not self.api_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="OPENAI_API_KEY tanımlı değil. AI açıklama üretilemedi.",
            )

        user_content = self._build_user_content(product)
        payload = {
            "model": self.model,
            "temperature": 0.4,
            "messages": [
                {
                    "role": "system",
                    "content": "Du skriver produkttekster til en dansk WooCommerce-butik.",
                },
                {
                    "role": "user",
                    "content": user_content,
                },
            ],
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"AI servisine bağlanılamadı: {exc}",
            ) from exc

        if response.status_code >= 400:
            detail = response.text[:500]
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"AI servisi hata döndü ({response.status_code}): {detail}",
            )

        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI cevabı boş döndü")

        message = choices[0].get("message") or {}
        content = (message.get("content") or "").strip()
        if not content:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI açıklama metni üretilemedi")

        usage = self._build_usage_summary(data)
        return content, usage

    async def generate_description(self, *, product: Product) -> str:
        content, _usage = await self.generate_description_with_usage(product=product)
        return content
