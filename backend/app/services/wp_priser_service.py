"""R2-06 — karat/metal fiyatlarının TEK kaynağı: WordPress "Priser" sayfası.

seroguld.dk'daki "Sølv og guldpriser" bloğu (8 karat guld pr. gram 280,00 …)
WP REST API üzerinden (wp/v2/pages, mevcut WP app-parolasıyla) okunur ve
etiketli satırlar ayrıştırılır. Sayfa scrape edilmez — REST'in döndürdüğü
rendered içerik alanı ayrıştırılır. Çekilemeyen değer sessizce atlanır;
mevcut profil değeri korunur (AFG fiyatları asla sıfırlanmaz).

metals.dev bu karar ile tamamen devre dışıdır (kullanıcı kararı, Tur 2).
"""

from __future__ import annotations

import logging
import re
from decimal import Decimal, InvalidOperation
from html import unescape
from typing import Any

import httpx

from app.config import get_settings
from app.utils.helpers import quantize_2, utc_now

LOGGER = logging.getLogger(__name__)

# "8 karat guld pr. gram 280,00" / "14 karat 490,00" / "21,6 karat …"
_GOLD_LINE = re.compile(
    r"(?P<karat>\d{1,2}(?:[.,]\d)?)\s*karat[^0-9]{0,40}?(?P<price>\d{1,3}(?:\.\d{3})*,\d{2})",
    re.IGNORECASE,
)
# Gümüş etiketleri → profil anahtarı
_SILVER_LABELS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"fins[øo]lv[^0-9]{0,40}?(\d{1,3}(?:\.\d{3})*,\d{2})", re.IGNORECASE), "999"),
    (re.compile(r"sterling[^0-9]{0,40}?(\d{1,3}(?:\.\d{3})*,\d{2})", re.IGNORECASE), "925"),
    (re.compile(r"3\s*t[åa]rnet[^0-9]{0,40}?(\d{1,3}(?:\.\d{3})*,\d{2})", re.IGNORECASE), "830"),
)


def _danish_to_decimal(raw: str) -> Decimal | None:
    try:
        return quantize_2(Decimal(raw.replace(".", "").replace(",", ".")))
    except (InvalidOperation, AttributeError):
        return None


def parse_priser_content(html: str) -> dict[str, Any]:
    """Rendered sayfa içeriğinden karat/gümüş fiyat haritası çıkarır (saf, test edilebilir)."""
    text = unescape(re.sub(r"<[^>]+>", " ", html or ""))
    gold: dict[str, str] = {}
    for match in _GOLD_LINE.finditer(text):
        karat_key = match.group("karat").replace(",", ".")
        # profil anahtarları: 8, 9, 10, 14, 18, 21, 21.6, 22, 24 (+ ikinci 22K ayrı ele alınır)
        value = _danish_to_decimal(match.group("price"))
        if value is not None and value > 0 and karat_key not in gold:
            gold[karat_key] = str(value)
    silver: dict[str, str] = {}
    for pattern, key in _SILVER_LABELS:
        found = pattern.search(text)
        if found:
            value = _danish_to_decimal(found.group(1))
            if value is not None and value > 0:
                silver[key] = str(value)
    return {"gold_rates_dkk": gold, "silver_rates_dkk": silver}


async def fetch_wp_priser_rates() -> dict[str, Any]:
    """WP REST'ten Priser sayfasını çekip ayrıştırır.

    Dönen: {gold_rates_dkk, silver_rates_dkk, fetched_at, page_id, page_title}
    Hata durumunda anlamlı mesajla ValueError yükseltir (çağıran HTTP'ye çevirir).
    """
    settings = get_settings()
    base = (settings.wordpress_base_url or "").strip().rstrip("/")
    if not base:
        raise ValueError("WordPress adresi (WORDPRESS_BASE_URL) yapılandırılmamış.")
    auth = None
    if settings.wp_app_username and settings.wp_app_password:
        auth = (settings.wp_app_username, settings.wp_app_password)
    async with httpx.AsyncClient(timeout=20.0, auth=auth) as client:
        response = await client.get(
            f"{base}/wp-json/wp/v2/pages",
            params={"search": "priser", "per_page": 20, "_fields": "id,title,content"},
        )
        response.raise_for_status()
        pages = response.json()
    if not isinstance(pages, list) or not pages:
        raise ValueError("WP'de 'priser' araması sayfa döndürmedi.")

    best: dict[str, Any] | None = None
    best_parsed: dict[str, Any] | None = None
    for page in pages:
        content = ((page.get("content") or {}).get("rendered")) or ""
        parsed = parse_priser_content(content)
        score = len(parsed["gold_rates_dkk"]) + len(parsed["silver_rates_dkk"])
        if score and (best_parsed is None or score > len(best_parsed["gold_rates_dkk"]) + len(best_parsed["silver_rates_dkk"])):
            best, best_parsed = page, parsed
    if best is None or best_parsed is None:
        raise ValueError("Priser sayfalarında ayrıştırılabilir karat fiyatı bulunamadı.")

    return {
        **best_parsed,
        "fetched_at": utc_now().isoformat(),
        "page_id": best.get("id"),
        "page_title": ((best.get("title") or {}).get("rendered")) or "",
    }
