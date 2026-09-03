"""R2-06 — karat/metal fiyatlarının TEK kaynağı: WordPress "Priser" sayfaları.

seroguld.dk'daki fiyat tabloları (Guldpriser + Sølvpriser sayfaları) WP REST
API üzerinden okunur ve tablo satırlarından ayrıştırılır:

    <td>8 karat</td><td>333%</td><td>280.00 DKK</td>
    <td>Sølv – 3 tårnet</td><td>830%</td><td>10.20 DKK</td>
    <td>Guldbarre</td><td>999,9%</td><td>873.00 DKK</td>
    <td>Pletsølv</td><td></td><td>20 kr/kg</td>

Sayfa scrape edilmez — REST'in döndürdüğü rendered içerik ayrıştırılır.
Fiyat hücresi DKK/kr. son eki olmadan kabul edilmez; "kr/kg" ekli hücreler
kilogram fiyatı sayılır ve 1000'e bölünerek gram fiyatına çevrilir (yalnız
Pletsølv hedefine). Makullük bantlarının dışındaki değerler (ör. saflık
metninden gelen "9,16" gibi) reddedilir. Çekilemeyen değer sessizce atlanır;
mevcut profil değeri korunur (AFG fiyatları asla sıfırlanmaz).

metals.dev bu karar ile tamamen devre dışıdır (kullanıcı kararı, Tur 2).
"""

from __future__ import annotations

import logging
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from html import unescape
from typing import Any

import httpx

from app.config import get_settings
from app.utils.helpers import quantize_2, utc_now

LOGGER = logging.getLogger(__name__)

# Canlı site: https://seroguld.dk/guldpriser/ ve /soelvpriser/ (wp/v2/pages).
GOLD_PAGE_SLUG = "guldpriser"
SILVER_PAGE_SLUG = "soelvpriser"

# Altın satırı: ilk hücre "8 karat" / "21,6 karat" biçimindedir.
_GOLD_ROW = re.compile(r"^\s*(?P<karat>\d{1,2}(?:[.,]\d)?)\s*karat\b", re.IGNORECASE)
# Gümüş etiketleri → profil anahtarı (satır ilk hücresinde aranır).
_SILVER_ROWS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"fins[øo]lv", re.IGNORECASE), "999"),
    (re.compile(r"sterling", re.IGNORECASE), "925"),
    (re.compile(r"3\s*-?\s*t[åa]rnet", re.IGNORECASE), "830"),
)
# Skaler metal satırları → profil anahtarı. Sıra önemli: "palladium" önce
# denenir ki "platin" deseni onu yakalamasın (savunma; ^platin\b zaten
# "Pletsølv"ü eşlemez).
_SCALAR_ROWS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^guldbarre\b", re.IGNORECASE), "gold_bar_dkk"),
    (re.compile(r"^s[øo]lvbarre\b", re.IGNORECASE), "silver_bar_dkk"),
    (re.compile(r"^plets[øo]lv\b", re.IGNORECASE), "plet_dkk"),
    (re.compile(r"^palladium\b", re.IGNORECASE), "palladium_dkk"),
    (re.compile(r"^platin\b", re.IGNORECASE), "platinum_dkk"),
)
# Fiyat hücresi: DKK/kr. eki zorunlu. 280.00 / 1.234,56 / 1 234,56 biçimleri.
_PRICE_CELL = re.compile(
    r"(?P<num>\d{1,4}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?)\s*(?:dkk|kr\.?)\b",
    re.IGNORECASE,
)
# Kilogram fiyatı hücresi: "20 kr/kg", "20 kr./kg", "20,00 kr/kg".
# Değer /1000 ile DKK/g'ye çevrilir (plet gibi gram başına çok küçük
# fiyatlı metallerde 1000× şişirme tuzağını kapatan dönüşüm).
_PRICE_CELL_PER_KG = re.compile(
    r"(?P<num>\d{1,6}(?:[.,]\d{1,2})?)\s*(?:dkk|kr\.?)\s*/\s*kg\b",
    re.IGNORECASE,
)
# Prose yedeği: aynı fiyat kalıbı, karat etiketiyle AYNI metin parçasında.
_PROSE_GOLD = re.compile(
    r"(?P<karat>\d{1,2}(?:[.,]\d)?)\s*karat[^0-9]{0,40}?"
    r"(?P<num>\d{1,4}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?)\s*(?:dkk|kr\.?)\b",
    re.IGNORECASE,
)
_PROSE_SILVER: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (
        re.compile(
            label + r"[^0-9]{0,40}?(?P<num>\d{1,4}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?)\s*(?:dkk|kr\.?)\b",
            re.IGNORECASE,
        ),
        key,
    )
    for label, key in (
        (r"fins[øo]lv", "999"),
        (r"sterling", "925"),
        (r"3\s*-?\s*t[åa]rnet", "830"),
    )
)

# Makullük bantları — tablo dışı metinlerden gelen saflık/ölçü benzeri
# değerlerin profile sızmasını engeller (ör. "22 karat 9,16" saflık notu).
GOLD_MIN_DKK = Decimal("100")
GOLD_MAX_DKK = Decimal("10000")
SILVER_MIN_DKK = Decimal("1")
SILVER_MAX_DKK = Decimal("1000")
# Skaler metal bantları (DKK/g). Plet bandı özellikle dar (canlı ~0.02):
# per-kg → per-gram dönüşümü kaçsa ya da birim karışsa bile 5× üstündeki
# değerler profile sızamaz (ör. 500 kr/kg = 0.5 DKK/g RED).
_SCALAR_BANDS: dict[str, tuple[Decimal, Decimal]] = {
    "gold_bar_dkk": (Decimal("100"), Decimal("10000")),
    "silver_bar_dkk": (Decimal("1"), Decimal("1000")),
    "platinum_dkk": (Decimal("50"), Decimal("10000")),
    "palladium_dkk": (Decimal("20"), Decimal("10000")),
    "plet_dkk": (Decimal("0.001"), Decimal("0.10")),
}


def _price_to_decimal(raw: str) -> Decimal | None:
    """Fiyat hücresini Decimal'e çevirir; ondalık/binlik ayırıcılarını çözümler.

    "280.00" → 280.00 (2 haneli kuyruk = ondalık nokta), "1.234" → 1234
    (3 haneli kuyruk = binlik), "1.234,56" → 1234.56, "280,00" → 280.00.
    """
    match = _PRICE_CELL.search(raw or "")
    if not match:
        return None
    num = match.group("num").replace(" ", "")
    if "," in num and "." in num:
        if num.rfind(",") > num.rfind("."):
            num = num.replace(".", "").replace(",", ".")
        else:
            num = num.replace(",", "")
    elif "," in num:
        num = num.replace(",", ".")
    else:
        parts = num.split(".")
        if len(parts) > 1 and len(parts[-1]) == 3:
            num = num.replace(".", "")
    try:
        value = Decimal(num)
    except InvalidOperation:
        return None
    return value if value.is_finite() and value > 0 else None


def _row_cells(html: str) -> list[list[str]]:
    """Rendered HTML'deki tablo satırlarını hücre metni listesi olarak döndürür."""
    rows: list[list[str]] = []
    for row in re.finditer(r"<tr[^>]*>(.*?)</tr>", html or "", re.S | re.I):
        cells: list[str] = []
        for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row.group(1), re.S | re.I):
            text = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", cell))).strip()
            if text:
                cells.append(text)
        if cells:
            rows.append(cells)
    return rows


def _per_kg_to_decimal(raw: str) -> Decimal | None:
    """Kilogram fiyatı hücresini DKK/g Decimal'ine çevirir (4 hane).

    "20 kr/kg" → 0.0200. Dönüşüm kaçarsa (birim karışıklığı tuzağı) bant
    reddi 1000× şişmiş değeri zaten durdurur.
    """
    match = _PRICE_CELL_PER_KG.search(raw or "")
    if not match:
        return None
    num = match.group("num").replace(" ", "")
    if "," in num:
        num = num.replace(",", ".")
    try:
        value = Decimal(num)
    except InvalidOperation:
        return None
    if not value.is_finite() or value <= 0:
        return None
    return (value / Decimal("1000")).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _row_price(cells: list[str]) -> tuple[Decimal | None, bool]:
    """Satır fiyatını (ters sırada ilk eşleşen hücre) döndürür.

    İkinci eleman per_kg: hücre "kr/kg" ekliyse True'dur ve değer DKK/g'ye
    çevrilmiş olur. Per-kg değer yalnız Pletsølv hedefine kabul edilir —
    başka satırda per-kg hücre görünürse satır atlanır.
    """
    for cell in reversed(cells):
        per_kg_value = _per_kg_to_decimal(cell)
        if per_kg_value is not None:
            return per_kg_value, True
        value = _price_to_decimal(cell)
        if value is not None:
            return value, False
    return None, False


def _extract_table_rates(html: str) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    gold: dict[str, str] = {}
    silver: dict[str, str] = {}
    scalars: dict[str, str] = {}
    for cells in _row_cells(html):
        first = cells[0]
        gold_match = _GOLD_ROW.match(first)
        if gold_match:
            key = gold_match.group("karat").replace(",", ".")
            value, per_kg = _row_price(cells[1:])
            if (
                not per_kg
                and value is not None
                and GOLD_MIN_DKK <= value <= GOLD_MAX_DKK
                and key not in gold
            ):
                gold[key] = str(quantize_2(value))
            continue
        for pattern, key in _SILVER_ROWS:
            if pattern.search(first):
                value, per_kg = _row_price(cells[1:])
                if (
                    not per_kg
                    and value is not None
                    and SILVER_MIN_DKK <= value <= SILVER_MAX_DKK
                    and key not in silver
                ):
                    silver[key] = str(quantize_2(value))
                break
        else:
            for pattern, key in _SCALAR_ROWS:
                if pattern.match(first):
                    value, per_kg = _row_price(cells[1:])
                    if value is not None and key not in scalars:
                        low, high = _SCALAR_BANDS[key]
                        if low <= value <= high:
                            scalars[key] = (
                                str(value) if key == "plet_dkk" else str(quantize_2(value))
                            )
                    break
    return gold, silver, scalars


def _extract_prose_rates(html: str) -> tuple[dict[str, str], dict[str, str]]:
    """Tablosuz sayfalar için yedek: aynı metin parçasında etiket + DKK'lı fiyat."""
    text = unescape(re.sub(r"<[^>]+>", " ", html or ""))
    gold: dict[str, str] = {}
    for match in _PROSE_GOLD.finditer(text):
        key = match.group("karat").replace(",", ".")
        value = _price_to_decimal(match.group("num") + " dkk")
        if value is not None and GOLD_MIN_DKK <= value <= GOLD_MAX_DKK and key not in gold:
            gold[key] = str(quantize_2(value))
    silver: dict[str, str] = {}
    for pattern, key in _PROSE_SILVER:
        found = pattern.search(text)
        if found:
            value = _price_to_decimal(found.group("num") + " dkk")
            if value is not None and SILVER_MIN_DKK <= value <= SILVER_MAX_DKK and key not in silver:
                silver[key] = str(quantize_2(value))
    return gold, silver


def parse_priser_content(html: str) -> dict[str, Any]:
    """Rendered sayfa içeriğinden karat/gümüş/skaler metal fiyatlarını çıkarır.

    Önce tablo satırları (canlı sitenin biçimi), bulunamazsa DKK-ekli prose
    yedeği denenir (yalnız karat/gümüş için — "Platin"/"Guldbarre" kelimeleri
    sayfa gövde metninde de geçtiğinden skalerler prose'dan ÇEKİLMEZ).
    Fiyat hücresi DKK/kr. eki taşımadan asla kabul edilmez.

    Skaler alanlar (gold_bar_dkk, silver_bar_dkk, platinum_dkk,
    palladium_dkk, plet_dkk) tabloda satır yoksa anahtarda bulunmaz.
    """
    gold, silver, scalars = _extract_table_rates(html)
    prose_gold, prose_silver = _extract_prose_rates(html)
    for key, value in prose_gold.items():
        gold.setdefault(key, value)
    for key, value in prose_silver.items():
        silver.setdefault(key, value)
    result: dict[str, Any] = {"gold_rates_dkk": gold, "silver_rates_dkk": silver}
    result.update(scalars)
    return result


async def fetch_wp_priser_rates() -> dict[str, Any]:
    """WP REST'ten fiyat sayfalarını çekip ayrıştırır.

    Önce bilinen slug'lar (guldpriser + soelvpriser) doğrudan istenir; slug
    değişmişse "priser" aramasıyla (per_page=100) en yüksek skorlu sayfalar
    seçilir. Dönen: {gold_rates_dkk, silver_rates_dkk, fetched_at, page_id,
    page_title, silver_page_id}. Hata durumunda anlamlı mesajla ValueError
    yükseltir (çağıran HTTP'ye çevirir).
    """
    settings = get_settings()
    base = (settings.wordpress_base_url or "").strip().rstrip("/")
    if not base:
        raise ValueError("WordPress adresi (WORDPRESS_BASE_URL) yapılandırılmamış.")
    auth = None
    if settings.wp_app_username and settings.wp_app_password:
        auth = (settings.wp_app_username, settings.wp_app_password)

    async with httpx.AsyncClient(timeout=20.0, auth=auth) as client:
        candidates: list[dict[str, Any]] = []
        for slug in (GOLD_PAGE_SLUG, SILVER_PAGE_SLUG):
            response = await client.get(
                f"{base}/wp-json/wp/v2/pages",
                params={"slug": slug, "_fields": "id,title,content"},
            )
            response.raise_for_status()
            pages = response.json()
            if isinstance(pages, list):
                candidates.extend(pages)

        slug_parsed = [parse_priser_content(_rendered(p)) for p in candidates]
        if not (
            any(p["gold_rates_dkk"] for p in slug_parsed)
            and any(p["silver_rates_dkk"] for p in slug_parsed)
        ):
            response = await client.get(
                f"{base}/wp-json/wp/v2/pages",
                params={"search": "priser", "per_page": 100, "_fields": "id,title,content"},
            )
            response.raise_for_status()
            pages = response.json()
            if isinstance(pages, list):
                candidates.extend(pages)

    if not candidates:
        raise ValueError("WP'de fiyat sayfası bulunamadı (guldpriser/soelvpriser slug'ları boş).")

    best_gold: tuple[dict[str, Any], dict[str, Any]] | None = None
    best_silver: tuple[dict[str, Any], dict[str, Any]] | None = None
    best_scalars: dict[str, Any] | None = None
    scalar_keys = ("gold_bar_dkk", "silver_bar_dkk", "platinum_dkk", "palladium_dkk", "plet_dkk")
    for page in candidates:
        parsed = parse_priser_content(_rendered(page))
        if parsed["gold_rates_dkk"] and (
            best_gold is None
            or len(parsed["gold_rates_dkk"]) > len(best_gold[1]["gold_rates_dkk"])
        ):
            best_gold = (page, parsed)
        if parsed["silver_rates_dkk"] and (
            best_silver is None
            or len(parsed["silver_rates_dkk"]) > len(best_silver[1]["silver_rates_dkk"])
        ):
            best_silver = (page, parsed)
        scalar_count = sum(1 for key in scalar_keys if parsed.get(key))
        if scalar_count and (best_scalars is None or scalar_count > best_scalars["_count"]):
            best_scalars = {**{key: parsed.get(key) for key in scalar_keys}, "_count": scalar_count}

    if best_gold is None and best_silver is None:
        raise ValueError("Fiyat sayfalarında DKK etiketli karat fiyatı bulunamadı.")

    gold_parsed = (best_gold or (None, {"gold_rates_dkk": {}}))[1]
    silver_parsed = (best_silver or (None, {"silver_rates_dkk": {}}))[1]
    primary = best_gold or best_silver
    assert primary is not None
    title = ((primary[0].get("title") or {}).get("rendered")) or ""
    if best_silver is not None and best_gold is not None and best_silver[0].get("id") != best_gold[0].get("id"):
        silver_title = ((best_silver[0].get("title") or {}).get("rendered")) or ""
        if silver_title and silver_title not in title:
            title = f"{title} + {silver_title}".strip(" +")

    result: dict[str, Any] = {
        "gold_rates_dkk": gold_parsed["gold_rates_dkk"],
        "silver_rates_dkk": silver_parsed["silver_rates_dkk"],
        "fetched_at": utc_now().isoformat(),
        "page_id": primary[0].get("id"),
        "page_title": title,
    }
    if best_scalars is not None:
        result.update({key: best_scalars.get(key) for key in scalar_keys})
    return result


def _rendered(page: dict[str, Any]) -> str:
    return ((page.get("content") or {}).get("rendered")) or ""