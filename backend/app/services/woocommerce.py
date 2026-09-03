from __future__ import annotations

import mimetypes
import re
import html
import json
from decimal import Decimal, ROUND_DOWN
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.config import get_settings
from app.models.product import Product
from app.services.photo_service import sorted_photos_for_publish
from app.services.woocommerce_profiles import effective_publish_profile, profile_traits
from app.utils.helpers import quantize_2, to_decimal, utc_now


PRODUCT_TYPE_DA = {
    "bracelet": "Armbånd",
    "ring": "Ring",
    "necklace": "Halskæde",
    "earring": "Øreringe",
    "chain": "Kæde",
    "bar": "Barre",
    "jewelry": "Smykke",
}

METAL_TYPE_DA = {
    "yellow_gold": "Gult Guld",
    "white_gold": "Hvidguld",
    "silver": "Sølv",
    "platinum": "Platin",
    "palladium": "Palladium",
}

PRODUCT_TYPE_SLUG_DA = {
    "bracelet": "armbaand",
    "ring": "ring",
    "necklace": "halskaede",
    "earring": "oereringe",
    "chain": "kaede",
    "bar": "barre",
    "jewelry": "smykke",
}

METAL_TYPE_SLUG_DA = {
    "yellow_gold": "gult-guld",
    "white_gold": "hvidguld",
    "silver": "soelv",
    "platinum": "platin",
    "palladium": "palladium",
}

SEO_SECTION_KEYS = {
    "SEO_TITLE": "seo_title",
    "SHORT_DESCRIPTION": "short_description",
    "LONG_DESCRIPTION_HTML": "long_description_html",
    "META_DESCRIPTION": "meta_description",
    "URL_SLUG": "url_slug",
}

REQUIRED_SEO_FIELDS: list[tuple[str, str]] = [
    ("seo_title", "SEO Title"),
    ("short_description", "Kısa Açıklama"),
    ("long_description_html", "Uzun Açıklama (HTML)"),
    ("meta_description", "Meta Description"),
    ("url_slug", "URL Slug"),
]


def _strip_code_fence(value: str) -> str:
    text = value.strip()
    match = re.match(r"^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$", text)
    if match:
        return match.group(1).strip()
    return text


def _sanitize_slug(value: str) -> str:
    slug = value.strip().lower()
    if not slug:
        return ""

    replacements = {
        "æ": "ae",
        "ø": "oe",
        "å": "aa",
        "ä": "a",
        "ö": "o",
        "ü": "u",
        "é": "e",
        "è": "e",
        "ê": "e",
        "ë": "e",
    }
    for source, target in replacements.items():
        slug = slug.replace(source, target)

    slug = re.sub(r"[^a-z0-9-]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug


def _normalize_long_description_html(value: str) -> str:
    text = value.strip()
    if not text:
        return text

    lines = text.splitlines()
    normalized: list[str] = []
    paragraph_buffer: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph_buffer:
            return
        content = " ".join(part.strip() for part in paragraph_buffer if part.strip()).strip()
        paragraph_buffer.clear()
        if content:
            normalized.append(f"<p>{html.escape(content, quote=False)}</p>")

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            continue

        if line.startswith("<"):
            flush_paragraph()
            normalized.append(line)
            continue

        paragraph_buffer.append(line)

    flush_paragraph()
    return "\n".join(normalized).strip()


def _parse_seo_bundle_json(text: str) -> dict[str, str] | None:
    """JSON schema structured output (yeni format). Geçersizse None döner ve
    çağıran eski bölüm-metni parse'ına düşer (geriye dönük uyum)."""
    stripped = (text or "").strip()
    if not stripped.startswith("{"):
        return None
    try:
        data = json.loads(stripped)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    wanted = ("seo_title", "short_description", "long_description_html", "meta_description", "url_slug")
    clean: dict[str, str] = {}
    for key in wanted:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            clean[key] = value.strip()
    if "url_slug" in clean:
        clean["url_slug"] = _sanitize_slug(clean["url_slug"])
        if not clean["url_slug"]:
            clean.pop("url_slug", None)
    if "long_description_html" in clean:
        clean["long_description_html"] = _normalize_long_description_html(
            _strip_code_fence(clean["long_description_html"])
        )
    return clean


def _parse_ai_description_seo_bundle(text: str) -> dict[str, str]:
    if not text or not text.strip():
        return {}

    as_json = _parse_seo_bundle_json(text)
    if as_json is not None:
        return as_json

    parsed: dict[str, str] = {}
    current_key: str | None = None
    buffer: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        section_match = re.match(
            r"^\s*(SEO_TITLE|SHORT_DESCRIPTION|LONG_DESCRIPTION_HTML|META_DESCRIPTION|URL_SLUG)\s*:\s*(.*)$",
            line,
        )
        if section_match:
            if current_key is not None:
                parsed[current_key] = _strip_code_fence("\n".join(buffer).strip())
            current_key = SEO_SECTION_KEYS[section_match.group(1)]
            inline_value = section_match.group(2).strip()
            buffer = [inline_value] if inline_value else []
            continue

        if current_key is not None:
            buffer.append(line)

    if current_key is not None:
        parsed[current_key] = _strip_code_fence("\n".join(buffer).strip())

    clean = {key: value.strip() for key, value in parsed.items() if value and value.strip()}
    if "url_slug" in clean:
        clean["url_slug"] = _sanitize_slug(clean["url_slug"])
        if not clean["url_slug"]:
            clean.pop("url_slug", None)
    if "long_description_html" in clean:
        clean["long_description_html"] = _normalize_long_description_html(clean["long_description_html"])
    return clean


def parse_ai_description_seo_bundle(text: str) -> dict[str, str]:
    return _parse_ai_description_seo_bundle(text)


def missing_required_seo_fields(text: str) -> list[str]:
    bundle = _parse_ai_description_seo_bundle(text)
    missing: list[str] = []
    for key, label in REQUIRED_SEO_FIELDS:
        if not str(bundle.get(key) or "").strip():
            missing.append(label)
    return missing


# Takı ürünlerinin uzun açıklamasının sonuna eklenen sabit blok (kullanıcı
# dokümanındaki tam metin). Settings > WooCommerce Eşlemeleri'nden override
# edilebilir; marker'lar çift eklemeyi önler.
DESC_FOOTER_MARKER_START = "<!-- sg-footer -->"
DESC_FOOTER_MARKER_END = "<!-- /sg-footer -->"
DESC_FOOTER_DA_DEFAULT = (
    "<h3>Vi garanterer altid p\u00e6ne varer</h3>"
    "<p>Hos Sero Guld kan du altid regne med at f\u00e5 rene og fine smykker hjem til d\u00f8ren, "
    "som er poleret og ultralydsrenset. Ved polering fjerner vi de v\u00e6rste m\u00e6rker og ridser "
    "p\u00e5 smykkerne, s\u00e5 smykkerne st\u00e5r p\u00e6ne igen - n\u00e6sten som helt nye. Efter poleringen "
    "bliver smykkerne ultralydsrenset og f\u00e5r dermed det sidste finish. Ved k\u00f8b af et smykke, "
    "giver vi en fin lille guldpose til smykket gratis.</p>"
    "<p>Alle vores smykker er testet med vores X-Ray maskine, hvorved karaten er pr\u00e6ciseret.</p>"
    "<h3>St\u00f8rrelsesguide</h3>"
    "<p>Nedenfor kan du l\u00e6se lidt om de forskellige st\u00f8rrelser der findes p\u00e5 de forskellige "
    "smykker. Er du i tvivl om en st\u00f8rrelse, eller \u00f8nsker at pr\u00f8ve smykket f\u00f8r du k\u00f8ber det, "
    "er du velkommen til at booke en tid hos os, og komme ned og pr\u00f8ve det inden du k\u00f8ber det.</p>"
    "<p><strong>Armb\u00e5nd:</strong> Typisk l\u00e6ngdem\u00e5l er 18 eller 19 cm. Nogle armb\u00e5nd er da "
    "mindre eller st\u00f8rre.</p>"
    "<p><strong>Armringe:</strong> Armringe m\u00e5les i diameter.</p>"
    "<p><strong>Halsk\u00e6der:</strong> En halsk\u00e6des l\u00e6ngde er meget varierende. Standart m\u00e5l p\u00e5 "
    "halsk\u00e6der er; 38cm for b\u00f8rn, 42 og 45cm for kvinder og 50cm for m\u00e6nd. Lange k\u00e6der er "
    "typisk: 60, 70, 80, 90, 100, 110 eller 120 cm. Vi har et stort udvalg af halsk\u00e6der i "
    "forskellige l\u00e6ngder. Halsk\u00e6dens l\u00e6ngde kan l\u00e6ses under specifikationer.</p>"
    "<p><strong>Dameringe:</strong> De findes typisk i st\u00f8rrelser fra 47-60 og herreringe mellem "
    "60-70.</p>"
    "<h3>F\u00e5 hj\u00e6lp</h3>"
    "<p>Ud over dette smykke tilbyder vi et fint udvalg af guldsmykker i forskellig designs. "
    "Vi garanterer altid kvalitet hos Sero Guld, og st\u00e5r gerne til r\u00e5dighed og vejleder gerne "
    "ved sp\u00f8rgsm\u00e5l.</p>"
)


# Yatırım ürünleri (külçe/sikke/platin) için açıklama alt bloğu — Valcambi/
# sikke referans dilinden; Størrelsesguide yok. Ayarlar'dan düzenlenebilir.
DESC_FOOTER_INVESTMENT_DA_DEFAULT = (
    "<h3>Investering i ædelmetal</h3>"
    "<p>Hos Sero Guld handler du ædelmetal fra anerkendte producenter. Varen "
    "leveres forsikret og kan afhentes i Valby efter aftale.</p>"
    "<p>Renheden er oplyst i promille under specifikationer. Barrer og mønter er "
    "præget og forseglet, og mange leveres med et certificeret unikt nummer, som "
    "stemmer overens med varen.</p>"
    "<p>Ædelmetal er en håndgribelig og likvid måde at sprede sin opsparing på. "
    "Vi yder ikke investeringsrådgivning, men står gerne til rådighed med "
    "produktinformation og vejledning ved spørgsmål.</p>"
)


def _renhed_promille(product: Product) -> str | None:
    """purity_percentage'dan 'NNN,N promille (NN,NN%)' üretir (yatırım şekli)."""
    pct = getattr(product, "purity_percentage", None)
    if pct is None:
        return None
    try:
        percent = Decimal(str(pct))
    except (TypeError, ValueError):
        return None
    promille = (percent * Decimal("10")).quantize(Decimal("0.1"))
    pct_q = percent.quantize(Decimal("0.01"))
    return f"{_danish_number(promille)} promille ({_danish_number(pct_q)}%)"


def _load_json_setting(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _danish_number(value: Any) -> str:
    text = str(value).strip()
    return text.replace(".", ",")


def _metal_group(product: Product) -> str:
    metal = getattr(product.metal_type, "value", str(product.metal_type))
    if metal in {"yellow_gold", "white_gold"}:
        return "gold"
    return metal  # silver / platinum / palladium


def _karat_number(product: Product) -> str:
    raw = str(product.purity_karat or "").upper().replace("K", "").strip()
    return raw


def _product_inventory_category(product: Product) -> str:
    if product.inventory_category:
        return str(product.inventory_category)
    from app.services.product_service import infer_inventory_categories

    return infer_inventory_categories(product.metal_type, product.product_type)[0]


def _resolve_categories(
    product: Product, category_map: dict[str, Any]
) -> tuple[list[dict[str, int]], int | None, list[str]]:
    """Sitenin GERÇEK kategori ID'lerine çözer; kategori YARATMAZ.

    Harita boş/eksikse kategori gönderilmez ve uyarı üretilir (eski davranış
    isimle arayıp bulamayınca 'Gult Guld' gibi çöp kategoriler yaratıyordu).
    """
    warnings: list[str] = []
    if not category_map:
        return [], None, ["Kategori haritası boş — kategori gönderilmedi (probe aracıyla doldurun)."]

    inventory_category = _product_inventory_category(product)
    metal_group = _metal_group(product)
    primary_section = category_map.get("primary") or {}
    per_category = primary_section.get(inventory_category) or {}
    primary_id = per_category.get(metal_group)
    if primary_id is None and metal_group in {"platinum", "palladium"}:
        primary_id = per_category.get("platinum_pd") or per_category.get("platin_pd")

    categories: list[dict[str, int]] = []
    if primary_id is None:
        warnings.append(
            f"Kategori haritasında '{inventory_category}/{metal_group}' için ID yok — kategori gönderilmedi."
        )
    else:
        categories.append({"id": int(primary_id)})

    # Karat kategorisi yalnız altın takıda ("14 kt. guld" vb.).
    if inventory_category == "taki" and metal_group == "gold":
        karat = _karat_number(product)
        karat_map = category_map.get("karat") or {}
        karat_id = karat_map.get(karat)
        if karat_id is not None:
            categories.append({"id": int(karat_id)})
        elif karat:
            warnings.append(f"Karat kategorisi haritada yok: {karat} — yalnız primer kategori gönderildi.")

    primary_int = int(primary_id) if primary_id is not None else None
    return categories, primary_int, warnings


def _aedelmetal_name(product: Product) -> str | None:
    metal = getattr(product.metal_type, "value", str(product.metal_type))
    return {"platinum": "Platin", "palladium": "Palladium"}.get(metal)


def _jewelry_attributes(product: Product) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    karat = _karat_number(product)
    if karat:
        # Sitedeki tablo b\u00fcy\u00fck harfle yazar: "14 Karat".
        entries.append(("Karat", f"{karat} Karat"))
    if product.purity_percentage is not None:
        fraction = (Decimal(str(product.purity_percentage)) / Decimal("100")).quantize(Decimal("0.001"))
        entries.append(("Renhed", _danish_number(fraction)))
    if product.weight_grams is not None:
        entries.append(("V\u00e6gt", f"{_danish_number(quantize_2(product.weight_grams))}g"))
    if getattr(product, "length_cm", None):
        entries.append(("L\u00e6ngde", _length_text(product.length_cm)))
    if getattr(product, "width_mm", None) is not None:
        entries.append(("Bredde", f"{_danish_number(quantize_2(product.width_mm))}mm"))
    if getattr(product, "thickness_mm", None) is not None:
        entries.append(("Tykkelse", f"{_danish_number(quantize_2(product.thickness_mm))}mm"))
    if getattr(product, "diameter_mm", None) is not None:
        entries.append(("Diameter", f"{_danish_number(quantize_2(product.diameter_mm))}mm"))
    if getattr(product, "producer", None):
        entries.append(("Producent", str(product.producer)))
    reference = (product.reference_number or product.product_number or "").strip()
    if reference:
        entries.append(("Vare nr.", reference))
    return entries


def _investment_attributes(product: Product, traits: dict[str, Any]) -> list[tuple[str, str]]:
    """K\u00fcl\u00e7e/sikke/platin: V\u00e6gt(gram) + Karat/\u00c6delmetal + Renhed(promille) +
    (sikke) Diameter/Tykkelse/\u00c5rstal + Producent."""
    entries: list[tuple[str, str]] = []
    if product.weight_grams is not None:
        entries.append(("V\u00e6gt", f"{_danish_number(quantize_2(product.weight_grams))} gram"))
    if traits.get("aedelmetal"):
        metal = _aedelmetal_name(product)
        if metal:
            entries.append(("\u00c6delmetal", metal))
    else:
        karat = _karat_number(product)
        if karat:
            entries.append(("Karat", karat))
    promille = _renhed_promille(product)
    if promille:
        entries.append(("Renhed", promille))
    if traits.get("dimensions"):
        if getattr(product, "diameter_mm", None) is not None:
            entries.append(("Diameter", f"{_danish_number(quantize_2(product.diameter_mm))}mm"))
        if getattr(product, "thickness_mm", None) is not None:
            entries.append(("Tykkelse", f"{_danish_number(quantize_2(product.thickness_mm))}mm"))
    if getattr(product, "producer", None):
        entries.append(("Producent", str(product.producer)))
    if traits.get("year") and getattr(product, "production_year", None):
        entries.append(("\u00c5rstal", str(int(product.production_year))))
    return entries


def _build_attributes(product: Product) -> list[dict[str, Any]]:
    """Sitedeki 'Yderligere information' spec tablosu \u2014 YAYIN PROF\u0130L\u0130NE g\u00f6re."""
    profile = effective_publish_profile(product)
    traits = profile_traits(profile)
    if traits.get("investment"):
        entries = _investment_attributes(product, traits)
    else:
        entries = _jewelry_attributes(product)
    return [
        {"name": name, "visible": True, "options": [value]}
        for name, value in entries
    ]


_STONEX_LOGICAL_FIELDS = {
    "metal_type",
    "metal_weight",
    "metal_purity",
    "length",
    "width",
    "thickness",
    "diameter",
    "producer",
    "reference",
    # R1-28/R1-33: metal eklentisi fiyat alanları (harita anahtarı varsa yazılır)
    "markup_percent",
    "minimum_price",
}


def _stonex_logical_value(product: Product, logical: str, settings=None) -> str | None:
    if logical == "metal_type":
        return METAL_TYPE_DA.get(getattr(product.metal_type, "value", str(product.metal_type)))
    if logical == "metal_weight":
        return _danish_number(quantize_2(product.weight_grams)) if product.weight_grams is not None else None
    if logical == "metal_purity":
        karat = _karat_number(product)
        return f"{karat} karat" if karat else None
    if logical == "length":
        return str(product.length_cm) if getattr(product, "length_cm", None) else None
    if logical == "width":
        return _danish_number(quantize_2(product.width_mm)) if getattr(product, "width_mm", None) is not None else None
    if logical == "thickness":
        return _danish_number(quantize_2(product.thickness_mm)) if getattr(product, "thickness_mm", None) is not None else None
    if logical == "diameter":
        return _danish_number(quantize_2(product.diameter_mm)) if getattr(product, "diameter_mm", None) is not None else None
    if logical == "producer":
        return str(product.producer) if getattr(product, "producer", None) else None
    if logical == "reference":
        reference = (product.reference_number or product.product_number or "").strip()
        return reference or None
    if logical == "markup_percent":
        # Ayarlardaki merkezi markup oranı (R1-31); ürün bazlı ezme ileride.
        raw = str(getattr(settings, "woocommerce_metal_markup_percent", "") or "").strip() if settings else ""
        return raw or None
    if logical == "minimum_price":
        # R1-33: alış maliyeti + minimum marj kuralı.
        purchase = getattr(product, "purchase_price_dkk", None)
        if purchase is None:
            return None
        try:
            margin = Decimal(str(getattr(settings, "woocommerce_minimum_margin_percent", "0") or "0"))
        except Exception:
            margin = Decimal("0")
        minimum = quantize_2(to_decimal(purchase) * (Decimal("1") + margin / Decimal("100")))
        return str(minimum)
    return None


def _build_stonex_meta(product: Product, stonex_map: dict[str, Any], settings=None) -> tuple[list[dict[str, str]], list[str]]:
    if not stonex_map:
        return [], ["StoneX meta haritası boş — sitenin spot fiyat alanları doldurulmadı (probe aracıyla doldurun)."]
    meta: list[dict[str, str]] = []
    warnings: list[str] = []
    for logical, meta_key in stonex_map.items():
        if logical not in _STONEX_LOGICAL_FIELDS:
            warnings.append(f"StoneX haritasında bilinmeyen alan: {logical} — atlandı.")
            continue
        value = _stonex_logical_value(product, str(logical), settings)
        if value is None:
            continue
        meta.append({"key": str(meta_key), "value": value})
    return meta, warnings


def _build_badge_meta(badge_config: dict[str, Any], *, now=None) -> tuple[list[dict[str, Any]], list[str]]:
    entries = badge_config.get("entries") if isinstance(badge_config, dict) else None
    if not entries:
        return [], []
    now = now or utc_now()
    meta: list[dict[str, Any]] = []
    warnings: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get("key"):
            warnings.append("Badge tanımında key'siz kayıt atlandı.")
            continue
        kind = str(entry.get("value_kind") or "static")
        if kind == "static":
            meta.append({"key": str(entry["key"]), "value": entry.get("value", "")})
            continue
        if kind == "publish_date":
            moment = now
        elif kind == "publish_date_plus_days":
            from datetime import timedelta

            moment = now + timedelta(days=int(entry.get("days") or 0))
        else:
            warnings.append(f"Badge tanımında bilinmeyen value_kind: {kind} — atlandı.")
            continue
        fmt = str(entry.get("format") or "iso_date")
        if fmt == "iso_datetime":
            value: Any = moment.isoformat()
        elif fmt == "epoch":
            value = str(int(moment.timestamp()))
        else:
            value = moment.date().isoformat()
        meta.append({"key": str(entry["key"]), "value": value})
    return meta, warnings


def _build_new_badge_meta(mark_as_new: bool | None, settings, *, now=None) -> tuple[list[dict[str, Any]], list[str]]:
    """R1-21: Nyhed rozet meta'ları. True → _sg_nyhed=1 + _sg_nyhed_until;
    False → boş değerlerle AÇIK temizleme; None → hiç yazma (mevcut rozet
    olduğu gibi kalır — alanı göndermeyen çağrılar rozeti silmesin)."""
    if mark_as_new is None:
        return [], []
    if not mark_as_new:
        return [{"key": "_sg_nyhed", "value": ""}, {"key": "_sg_nyhed_until", "value": ""}], []
    now = now or utc_now()
    try:
        days = int(getattr(settings, "woocommerce_new_badge_days", 30) or 30)
    except (TypeError, ValueError):
        days = 30
    from datetime import timedelta

    until = (now + timedelta(days=days)).date().isoformat()
    return (
        [{"key": "_sg_nyhed", "value": "1"}, {"key": "_sg_nyhed_until", "value": until}],
        [],
    )


SPEC_STRIP_MARKER_START = "<!-- sg-spec -->"
SPEC_STRIP_MARKER_END = "<!-- /sg-spec -->"


def _length_text(length: Any) -> str:
    """length_cm serbest metindir (or. "1,40cm" / "18-19cm"). X5: birimsiz ham
    sayi girildiyse 'cm' eklenir — "1.8" tek basina cm/mm belirsizligi
    yaratirdi; alanin kanonik birimi cm'dir. Spec seridi VE attribute tablosu
    ayni kurali kullanir (sitedeki 'Yderligere information' ile uyumlu)."""
    text = str(length).strip()
    if text and not any(ch.isalpha() for ch in text):
        text = f"{text}cm"
    return text


def _spec_strip_text(product: Product) -> str:
    """Yayin profiline gore yesil kutu seridi.

    jewelry: 'Vare nr. : 1201 V\u00e6gt: 1,15g L\u00e6ngde: 1,40cm Bredde: 1,10mm Tykkelse: 5,22mm'
    (Vare nr. + doldurulmus olculer). investment (bar/coin/platin): olcu yok;
    spec_strip_mode='weight' ise 'Vare nr. : X V\u00e6gt: N gram', 'none' ise bos.
    Birimler bosluksuz; sayilar Danca ondalik virgulle.

    2026-09-01: canli sitenin guncel S-serisi (1590-1617) virgulsuz tek bosluk
    formati kullaniyor ("Vare nr. : 1617 V\u00e6gt: 2,39g L\u00e6ngde: 40,00cm Bredde:
    1,91mm Tykkelse: 0,29mm"); eski 1427 virgulluydu, R2-18 referansi guncellendi.
    """
    ref = (product.reference_number or product.product_number or "").strip()
    if not ref:
        return ""
    base = f"Vare nr. : {ref}"
    traits = profile_traits(effective_publish_profile(product))
    mode = traits.get("spec_strip_mode", "dimensions")

    if traits.get("investment"):
        if mode == "none":
            return base
        if product.weight_grams is not None:
            return f"{base} Vægt: {_danish_number(quantize_2(product.weight_grams))} gram"
        return base

    # Vægt vare nr.'dan HEMEN sonra gelir, virgulsuz (canli site: "Vare nr. :
    # 1617 Vægt: 2,39g Længde: 40,00cm Bredde: 1,91mm Tykkelse: 0,29mm").
    if product.weight_grams is not None:
        base = f"{base} Vægt: {_danish_number(quantize_2(product.weight_grams))}g"
    dims: list[str] = []
    length = getattr(product, "length_cm", None)
    if length:
        dims.append(f"L\u00e6ngde: {_length_text(length)}")
    if getattr(product, "width_mm", None) is not None:
        dims.append(f"Bredde: {_danish_number(quantize_2(product.width_mm))}mm")
    if getattr(product, "thickness_mm", None) is not None:
        dims.append(f"Tykkelse: {_danish_number(quantize_2(product.thickness_mm))}mm")
    if getattr(product, "diameter_mm", None) is not None:
        dims.append(f"Diameter: {_danish_number(quantize_2(product.diameter_mm))}mm")
    return f"{base} {' '.join(dims)}" if dims else base


def _strip_spec_block(value: str) -> str:
    base = value or ""
    start = base.find(SPEC_STRIP_MARKER_START)
    if start >= 0:
        end = base.find(SPEC_STRIP_MARKER_END)
        if end >= 0:
            base = base[:start] + base[end + len(SPEC_STRIP_MARKER_END):]
        else:
            base = base[:start]
    return base.lstrip()


def _apply_spec_strip(value: str, strip_text: str) -> str:
    """Spec şeridini idempotent marker'la içeriğin SONUNA ekler.

    A2 kararı: canlı referans sırası "paragraf → yeşil kutu → 'Detaljeret…'" —
    şerit AI paragrafının ALTINA gelir (kapanış satırı daha sonra en alta
    eklenir). Marker'lar konumdan bağımsız idempotentlik sağlar: eski başta
    duran blok önce sökülür, sona yeniden yazılır.
    """
    base = _strip_spec_block(value)
    if not strip_text:
        return base
    # R1-13/R1-32: şerit referans sitedeki YEŞİL KUTU görünümüyle basılır —
    # düz metin değil. Inline stil tema bağımsız çalışır; marker idempotentliği korur.
    block = (
        f"{SPEC_STRIP_MARKER_START}"
        '<div class="sg-spec-box" style="background:#e7f4ec;border:1px solid #bfe3cc;'
        'border-left:4px solid #2f9e5f;padding:10px 14px;margin:12px 0;border-radius:4px;">'
        f"<p style=\"margin:0;\">{strip_text}</p></div>"
        f"{SPEC_STRIP_MARKER_END}"
    )
    return f"{base.rstrip()}\n{block}" if base else block


def _apply_description_footer(description: str, footer_html: str) -> str:
    """Footer'ı idempotent marker'la ekler; mevcut marker bloğu önce sökülür."""
    base = description or ""
    start = base.find(DESC_FOOTER_MARKER_START)
    if start >= 0:
        end = base.find(DESC_FOOTER_MARKER_END)
        if end >= 0:
            base = base[:start] + base[end + len(DESC_FOOTER_MARKER_END):]
        else:
            base = base[:start]
    base = base.rstrip()
    return f"{base}\n{DESC_FOOTER_MARKER_START}{footer_html}{DESC_FOOTER_MARKER_END}"


def _default_name_for(product: Product) -> str:
    product_type = PRODUCT_TYPE_DA.get(getattr(product.product_type, "value", str(product.product_type)), "Smykke")
    metal_type = METAL_TYPE_DA.get(getattr(product.metal_type, "value", str(product.metal_type)), "\u00c6delmetal")
    return f"{product_type} - {metal_type} #{product.product_number}"


def _default_slug_for(product: Product) -> str:
    product_type_key = getattr(product.product_type, "value", str(product.product_type))
    metal_type_key = getattr(product.metal_type, "value", str(product.metal_type))
    product_token = PRODUCT_TYPE_SLUG_DA.get(product_type_key, "smykke")
    metal_token = METAL_TYPE_SLUG_DA.get(metal_type_key, "aedelmetal")
    karat_token = _sanitize_slug(str(product.purity_karat or "").replace(" ", ""))

    weight_token = ""
    if getattr(product, "weight_grams", None) is not None:
        weight_token = f"{str(product.weight_grams).replace('.', '-') }g"
        weight_token = _sanitize_slug(weight_token)

    ref = (product.reference_number or product.product_number or "").strip()
    ref_token = _sanitize_slug(f"ref-{ref}") if ref else ""

    parts = [metal_token, product_token, karat_token, weight_token, ref_token]
    slug = "-".join(part for part in parts if part)
    return _sanitize_slug(slug)


def _slug_consistent(slug: str, product: Product) -> bool:
    product_type_key = getattr(product.product_type, "value", str(product.product_type))
    expected_token = PRODUCT_TYPE_SLUG_DA.get(product_type_key, "")
    if not expected_token:
        return True
    return expected_token in slug


def compute_suggested_shop_price(product: Product) -> tuple[Decimal | None, str | None]:
    """R1-31/R1-26 — Butikspris önerisi: spot(karat) × gram × (1 + markup%).

    Kaynak: global piyasa profili (tek canlı kaynak). Hesaplanamıyorsa (None,
    neden) döner; asla sessizce 0 önermez. Minimum fiyat kuralı (alış +
    minimum marj) taban olarak uygulanır.
    """
    from app.config import get_settings as _gs
    from app.services.market_rate_profile import get_effective_market_rate_profile_cached

    settings = _gs()
    weight = to_decimal(product.weight_grams) if product.weight_grams is not None else None
    if weight is None or weight <= 0:
        return None, "Ağırlık (gram) girilmemiş."
    rates = get_effective_market_rate_profile_cached()
    metal = getattr(product.metal_type, "value", str(product.metal_type or ""))
    rate: Decimal | None = None
    if metal in ("yellow_gold", "white_gold"):
        karat_key = str(product.purity_karat or "").upper().removesuffix("K").strip()
        raw = (rates.get("gold_rates_dkk") or {}).get(karat_key)
        if raw is None:
            return None, f"Karat oranı bulunamadı ({product.purity_karat or 'karat yok'})."
        rate = to_decimal(raw)
    elif metal == "silver":
        raw = rates.get("silver_dkk")
        purity = to_decimal(product.purity_percentage or 0)
        if raw is None or purity <= 0:
            return None, "Gümüş oranı/saflığı eksik."
        rate = to_decimal(raw) * purity / Decimal("99.9")
    elif metal in ("platinum", "palladium"):
        rate = to_decimal(rates.get("platinum_dkk" if metal == "platinum" else "palladium_dkk") or 0)
        # Spot fiyatı %100 saf metale göredir; alaşım ürün (ör. Pd %50)
        # saflık oranıyla ölçeklenir. Saflık girilmemişse tam spot kalır.
        purity = to_decimal(product.purity_percentage or 0)
        if purity > 0:
            rate = rate * purity / Decimal("100")
    if rate is None or rate <= 0:
        return None, "Bu metal için güncel oran yok."
    try:
        markup = Decimal(str(getattr(settings, "woocommerce_metal_markup_percent", "0") or "0"))
    except Exception:
        markup = Decimal("0")
    price = quantize_2(rate * weight * (Decimal("1") + markup / Decimal("100")))
    # Minimum fiyat tabanı: alış + minimum marj (R1-33 kuralıyla aynı).
    if product.purchase_price_dkk is not None:
        try:
            min_margin = Decimal(str(getattr(settings, "woocommerce_minimum_margin_percent", "0") or "0"))
        except Exception:
            min_margin = Decimal("0")
        floor = quantize_2(to_decimal(product.purchase_price_dkk) * (Decimal("1") + min_margin / Decimal("100")))
        if price < floor:
            price = floor
    return price, None


# WP "Live Gold Price" eklentisinin beklediği _metal_* meta sözleşmesi:
# CRM metal enum'ları → eklenti metal adları.
_WOO_METAL_TYPE_KEYS = {
    "yellow_gold": "gold",
    "white_gold": "gold",
    "silver": "silver",
    "platinum": "platinum",
    "palladium": "palladium",
}


def _build_metal_pricing_meta(product: Product, settings) -> list[dict[str, str]]:
    """Woo otomatik metal fiyatı meta grubu.

    Operatör wp-admin'de bu alanları doldurunca eklenti canlı spotla ürün
    fiyatını otomatik güncelliyor; CRM'den yayın yapılırken aynı alanları
    basıyoruz ki fiyat WP tarafında da otomatik kalsın. Markup ondalık
    fraksiyondur (0.37 = %37); ürün bazlı değeri yoksa settings
    (woocommerce_metal_markup_percent) default'u kullanılır.
    """
    metal = getattr(product.metal_type, "value", str(product.metal_type or ""))
    woo_metal = _WOO_METAL_TYPE_KEYS.get(metal)
    weight = to_decimal(product.weight_grams) if product.weight_grams is not None else None
    purity = to_decimal(product.purity_percentage) if product.purity_percentage is not None else None
    markup = getattr(product, "woo_markup_rate", None)
    if markup is None:
        try:
            markup = Decimal(str(getattr(settings, "woocommerce_metal_markup_percent", "0") or "0")) / Decimal("100")
        except Exception:
            markup = None
    if not woo_metal or weight is None or weight <= 0 or purity is None or purity <= 0:
        return []
    # Markup 0/null ve taban fiyat yoksa meta seti boş kalır: eklentiye
    # anlamsız "_markup_rate: 0" basılmaz, mevcut golden testler bozulmaz.
    min_price = getattr(product, "woo_min_price_dkk", None)
    if (markup is None or markup <= 0) and min_price is None:
        return []

    # 99.99% → 999.9 promille; yuvarlama yukarı taşıp "g.1000" üretemesin:
    # eklenti sözleşmesi üç hanedir (g.999 = en saf kabul). Aşağı yuvarlanır
    # ve 999'da sıkıştırılır — saflık asla fazla bildirilmez.
    promille = min(int((purity * Decimal("10")).quantize(Decimal("1"), rounding=ROUND_DOWN)), 999)
    meta: list[dict[str, str]] = [
        {"key": "_metal_type", "value": woo_metal},
        {"key": "_metal_weight", "value": str(weight)},
        {"key": "_metal_weight_unit", "value": "g"},
        {"key": "_metal_purity", "value": f"g.{promille:03d}"},
        {"key": "_markup_rate", "value": str(markup)},
        {"key": "_markup_rate_2", "value": "0"},
    ]
    if min_price is not None:
        meta.append({"key": "_metal_min_price", "value": str(quantize_2(to_decimal(min_price)))})
    return meta


def build_publish_payload(
    *,
    product: Product,
    regular_price_dkk: Decimal,
    name: str | None,
    images: list[dict[str, Any]],
    settings,
    mark_as_new: bool | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Ağ erişimi olmayan saf payload kurulumu (golden-test edilebilir).

    Kategori/StoneX/badge eşlemeleri Settings JSON haritalarından gelir;
    boş harita ilgili özelliği atlar ve uyarı üretir (graceful degrade).
    """
    warnings: list[str] = []

    category_map = _load_json_setting(settings.woocommerce_category_map_json)
    stonex_map = _load_json_setting(settings.woocommerce_stonex_meta_map_json)
    badge_config = _load_json_setting(settings.woocommerce_badge_meta_json)

    # Üründe kategori override'ı varsa (yayın panelindeki seçici) haritayı ezer.
    override_ids = [
        int(value)
        for value in (getattr(product, "woocommerce_category_ids", None) or [])
        if str(value).strip().isdigit() or isinstance(value, int)
    ]
    if override_ids:
        categories: list[dict[str, int]] = [{"id": cid} for cid in override_ids]
        primary_category_id: int | None = override_ids[0]
    else:
        categories, primary_category_id, category_warnings = _resolve_categories(product, category_map)
        warnings.extend(category_warnings)

    ai_text = (product.ai_description or "").strip()
    seo_bundle = _parse_ai_description_seo_bundle(ai_text)
    description_value = seo_bundle.get("long_description_html") or ai_text
    short_description_value = seo_bundle.get("short_description")
    slug_value = seo_bundle.get("url_slug")
    meta_description_value = seo_bundle.get("meta_description")
    seo_title_value = seo_bundle.get("seo_title")
    if not slug_value or not _slug_consistent(slug_value, product):
        slug_value = _default_slug_for(product)

    # Sabit Danca alt blok YAYIN PROFİLİNE göre; DB'deki ai_description'a asla
    # yazılmaz, yalnız giden payload'da birleştirilir. jewelry → Størrelsesguide,
    # investment (külçe/sikke/platin) → yatırım bloğu.
    if settings.woocommerce_desc_footer_enabled:
        footer_key = profile_traits(effective_publish_profile(product)).get("footer_key")
        if footer_key == "jewelry":
            footer_html = (settings.woocommerce_desc_footer_html or "").strip() or DESC_FOOTER_DA_DEFAULT
            description_value = _apply_description_footer(description_value, footer_html)
        elif footer_key == "investment":
            footer_html = (
                getattr(settings, "woocommerce_desc_footer_investment_html", "") or ""
            ).strip() or DESC_FOOTER_INVESTMENT_DA_DEFAULT
            description_value = _apply_description_footer(description_value, footer_html)

    # Referans sitedeki spec şeridi ("Vare nr. : X Vægt: Yg Diameter: Zmm")
    # A2: iki açıklamada da paragrafın ALTINA idempotent eklenir
    # (paragraf → yeşil kutu → kapanış satırı).
    spec_text = _spec_strip_text(product)
    if spec_text:
        description_value = _apply_spec_strip(description_value, spec_text)
        short_description_value = _apply_spec_strip(short_description_value or "", spec_text)

    # R1-34: kısa açıklamanın EN ALTINDA sabit kapanış satırı (jewelry).
    closing_line = "Detaljeret oplysninger ses længere nede under specifikationer."
    if (
        profile_traits(effective_publish_profile(product)).get("footer_key") == "jewelry"
        and short_description_value
        and closing_line not in short_description_value
    ):
        short_description_value = f"{short_description_value.rstrip()}\n<p>{closing_line}</p>"

    resolved_name = name.strip() if name and name.strip() else (seo_title_value or _default_name_for(product))
    payload: dict[str, Any] = {
        "name": resolved_name,
        "description": description_value,
        "regular_price": str(quantize_2(regular_price_dkk)),
        "categories": categories,
        "status": "publish",
        "meta_data": [{"key": "crm_product_id", "value": str(product.id)}],
        # R1-29: tekil parça mağazası — stok takibi açık, adet 1, tek satış.
        "manage_stock": True,
        "stock_quantity": 1,
        "stock_status": "instock",
        "sold_individually": True,
    }
    sku_value = (product.reference_number or "").strip()
    if sku_value:
        payload["sku"] = sku_value
    else:
        warnings.append("Varenummer (SKU) boş: ürünün referans/lager numarası yok.")

    attributes = _build_attributes(product)
    if attributes:
        payload["attributes"] = attributes

    if short_description_value:
        payload["short_description"] = short_description_value
    if slug_value:
        payload["slug"] = slug_value
    if seo_title_value:
        # Sitenin Yoast şablonu "{name} - Seroguld" — manuel SEO title override
        # şablonu ezer, marka son eki kaybolur. Sığdığında kod tarafında eklenir
        # (AI prompt'u son eki bilmez; 70 karakter SEO üst sınırı korunur).
        seo_title_full = seo_title_value.strip()
        if "seroguld" not in seo_title_full.lower() and len(seo_title_full) + 11 <= 70:
            seo_title_full = f"{seo_title_full} - Seroguld"
        payload["meta_data"].extend(
            [
                {"key": "_yoast_wpseo_title", "value": seo_title_full},
                {"key": "rank_math_title", "value": seo_title_full},
            ]
        )
    if meta_description_value:
        payload["meta_data"].extend(
            [
                {"key": "_yoast_wpseo_metadesc", "value": meta_description_value},
                {"key": "rank_math_description", "value": meta_description_value},
                {"key": "crm_meta_description", "value": meta_description_value},
            ]
        )
    if primary_category_id is not None and settings.woocommerce_primary_term_meta_key:
        payload["meta_data"].append(
            {"key": settings.woocommerce_primary_term_meta_key, "value": str(primary_category_id)}
        )

    stonex_meta, stonex_warnings = _build_stonex_meta(product, stonex_map, settings)
    payload["meta_data"].extend(stonex_meta)
    warnings.extend(stonex_warnings)

    badge_meta, badge_warnings = _build_badge_meta(badge_config)
    payload["meta_data"].extend(badge_meta)
    warnings.extend(badge_warnings)

    # Woo otomatik metal fiyatı: WP eklentisi bu meta'larla canlı spotla
    # fiyatı güncellemeye devam eder.
    payload["meta_data"].extend(_build_metal_pricing_meta(product, settings))

    # R1-21: "Nyhed" rozeti — checkbox işaretliyse _sg_nyhed=1 + bitiş tarihi
    # (yayın + woocommerce_new_badge_days gün); değilse republish rozetini
    # temizler (boş değer). Tema/snippet bu meta'ları okuyarak rozeti çizer.
    nyhed_meta, nyhed_warnings = _build_new_badge_meta(mark_as_new, settings)
    payload["meta_data"].extend(nyhed_meta)
    warnings.extend(nyhed_warnings)

    if images:
        payload["images"] = images

    return payload, warnings


class WooCommerceService:
    def __init__(self) -> None:
        settings = get_settings()
        self.wc_base_url = settings.woocommerce_base_url.rstrip("/")
        self.consumer_key = settings.woocommerce_consumer_key.strip()
        self.consumer_secret = settings.woocommerce_consumer_secret.strip()
        self.timeout = max(5.0, float(settings.woocommerce_timeout_seconds))

        wp_base = settings.wordpress_base_url.rstrip("/")
        if not wp_base and self.wc_base_url:
            wp_base = self.wc_base_url.split("/wp-json/")[0].rstrip("/")
        self.wp_base_url = wp_base
        self.wp_app_username = settings.wp_app_username.strip()
        self.wp_app_password = settings.wp_app_password.replace(" ", "").strip()

    def _ensure_wc_config(self) -> None:
        if not self.wc_base_url or not self.consumer_key or not self.consumer_secret:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="WooCommerce ayarları eksik (WOOCOMMERCE_BASE_URL / KEY / SECRET).",
            )

    def _can_upload_media(self) -> bool:
        return bool(self.wp_base_url and self.wp_app_username and self.wp_app_password)

    async def _wc_request(
        self,
        method: str,
        path: str,
        *,
        json_payload: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any] | list[Any]:
        response = await self._wc_response(
            method,
            path,
            json_payload=json_payload,
            params=params,
        )
        return response.json()

    async def _wc_response(
        self,
        method: str,
        path: str,
        *,
        json_payload: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> httpx.Response:
        self._ensure_wc_config()
        url = f"{self.wc_base_url}/{path.lstrip('/')}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(
                    method,
                    url,
                    auth=(self.consumer_key, self.consumer_secret),
                    json=json_payload,
                    params=params,
                    headers={"User-Agent": "SeroGuldCRM/1.0"},
                )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"WooCommerce bağlantı hatası: {exc}",
            ) from exc

        if response.status_code >= 400:
            upstream_message = response.text[:500]
            try:
                payload = response.json()
            except json.JSONDecodeError:
                payload = None

            if isinstance(payload, dict):
                candidate = str(payload.get("message") or "").strip()
                if candidate:
                    upstream_message = candidate

            if response.status_code == status.HTTP_404_NOT_FOUND:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=upstream_message or "WooCommerce kaynağı bulunamadı.",
                )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"WooCommerce hata ({response.status_code}): {upstream_message}",
            )

        return response

    async def _load_photo_bytes(self, photo_url: str) -> tuple[bytes, str]:
        if photo_url.startswith("http://") or photo_url.startswith("https://"):
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(photo_url, follow_redirects=True)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "application/octet-stream")
                return response.content, content_type

        path_value = photo_url[7:] if photo_url.startswith("file://") else photo_url
        local_path = Path(path_value).expanduser().resolve()
        if not local_path.exists():
            raise FileNotFoundError(f"Fotoğraf bulunamadı: {local_path}")
        content = local_path.read_bytes()
        content_type = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
        return content, content_type

    async def _upload_media(self, photo_item: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
        """Tek fotoğrafı WP medya kütüphanesine yükler → ({"id": ...}, uyarı).

        Daha önce yüklenmiş medya (wc_media_id) yeniden yüklenmez — duplicate
        attachment birikimi biter. Hatalar yutulmaz; publish yanıtına ve sync
        log'una uyarı olarak taşınır (eskiden üç noktada sessiz None dönüyordu
        ve ürün 'yayınlandı' görünürken sitede hiç görsel olmuyordu).
        """
        photo_label = str(photo_item.get("filename") or photo_item.get("id") or "fotoğraf")
        existing_media_id = photo_item.get("wc_media_id")
        if existing_media_id:
            return {"id": int(existing_media_id)}, None

        # Siteye AVIF BİRİNCİL gönderilir (CRM yüklemede zaten AVIF üretir).
        # WP'nin AVIF kabulü kuruluma bağlı olduğundan, AVIF reddedilirse
        # otomatik olarak yedek formata (orijinal jpeg/webp) düşülür — "ne olur
        # ne olmaz" ikinci format. İlk WP'nin kabul ettiği kaynak kullanılır.
        candidates: list[str] = []
        for key in ("avif_path", "avif_url", "original_path", "original_url", "url"):
            value = str(photo_item.get(key) or "").strip()
            if value and value not in candidates:
                candidates.append(value)
        if not candidates:
            return None, f"{photo_label}: dosya yolu kayıtlı değil, atlandı."

        attempt_warnings: list[str] = []
        for photo_url in candidates:
            uploaded, warning = await self._post_wp_media(photo_label, photo_url)
            if uploaded is not None:
                photo_item["wc_media_id"] = int(uploaded["id"])
                photo_item["wc_media_uploaded_at"] = utc_now().isoformat()
                return uploaded, None
            if warning:
                attempt_warnings.append(warning)
        return None, "; ".join(attempt_warnings) or f"{photo_label}: hiçbir format WP tarafından kabul edilmedi."

    async def _post_wp_media(self, photo_label: str, photo_url: str) -> tuple[dict[str, Any] | None, str | None]:
        try:
            content, content_type = await self._load_photo_bytes(photo_url)
        except Exception as exc:  # noqa: BLE001 - uyarı olarak yüzeye taşınır
            return None, f"{photo_label}: dosya okunamadı ({exc})."

        source_name = Path(photo_url.split("?")[0]).name or "seroguld-product.jpg"
        guessed_type = mimetypes.guess_type(source_name)[0]
        if guessed_type:
            content_type = guessed_type

        media_url = f"{self.wp_base_url}/wp-json/wp/v2/media"
        headers = {
            "Content-Disposition": f'attachment; filename="{source_name}"',
            "Content-Type": content_type,
            "User-Agent": "SeroGuldCRM/1.0",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    media_url,
                    auth=(self.wp_app_username, self.wp_app_password),
                    headers=headers,
                    content=content,
                )
        except Exception as exc:  # noqa: BLE001
            return None, f"{photo_label} ({source_name}): WP medya isteği başarısız ({exc})."

        if response.status_code >= 400:
            body_head = response.text[:200]
            return None, f"{photo_label} ({source_name}): WP medya {response.status_code} döndürdü: {body_head}"

        payload = response.json()
        media_id = payload.get("id")
        if not media_id:
            return None, f"{photo_label} ({source_name}): WP medya yanıtında id yok."
        return {"id": int(media_id)}, None

    def _default_name(self, product: Product) -> str:
        return _default_name_for(product)

    def _default_slug(self, product: Product) -> str:
        return _default_slug_for(product)

    def _is_slug_consistent(self, slug: str, product: Product) -> bool:
        return _slug_consistent(slug, product)

    async def publish_product(
        self,
        *,
        product: Product,
        regular_price_dkk: Decimal,
        name: str | None = None,
        mark_as_new: bool | None = None,
    ) -> tuple[dict[str, Any], list[str]]:
        warnings: list[str] = []

        # is_primary önce → Woo images[0] öne çıkan görsel olur.
        photos = sorted_photos_for_publish(product)
        images: list[dict[str, Any]] = []
        if photos and not self._can_upload_media():
            warnings.append(
                "WP uygulama parolası eksik (WORDPRESS_BASE_URL / WP_APP_USERNAME / WP_APP_PASSWORD) — fotoğraflar gönderilmedi."
            )
        else:
            for photo_item in photos:
                uploaded, warning = await self._upload_media(photo_item)
                if uploaded:
                    images.append(uploaded)
                if warning:
                    warnings.append(warning)
        if photos and not images and self._can_upload_media():
            warnings.append("Hiçbir fotoğraf yüklenemedi — ürün görselsiz yayınlandı.")

        payload, payload_warnings = build_publish_payload(
            product=product,
            regular_price_dkk=regular_price_dkk,
            name=name,
            images=images,
            settings=get_settings(),
            mark_as_new=mark_as_new,
        )
        warnings.extend(payload_warnings)

        try:
            if product.woocommerce_product_id:
                result = await self._wc_request(
                    "PUT",
                    f"/products/{product.woocommerce_product_id}",
                    json_payload=payload,
                )
            else:
                result = await self._wc_request("POST", "/products", json_payload=payload)
        except HTTPException as exc:
            # Sitede elle silinmiş medya: kayıtlı wc_media_id'ler geçersizse
            # Woo "invalid image id" döner — id'leri temizleyip TEK yeniden
            # yükleme denemesi yapılır; ikinci hata normal akışla yükselir.
            detail = str(exc.detail).lower()
            reused_ids = [photo for photo in photos if photo.get("wc_media_id")]
            if not reused_ids or ("image" not in detail and "attachment" not in detail):
                raise
            warnings.append("Sitedeki medya kayıtları geçersizdi; fotoğraflar yeniden yüklendi.")
            for photo_item in reused_ids:
                photo_item.pop("wc_media_id", None)
                photo_item.pop("wc_media_uploaded_at", None)
            retry_images: list[dict[str, Any]] = []
            for photo_item in photos:
                uploaded, warning = await self._upload_media(photo_item)
                if uploaded:
                    retry_images.append(uploaded)
                if warning:
                    warnings.append(warning)
            if retry_images:
                payload["images"] = retry_images
            else:
                payload.pop("images", None)
            if product.woocommerce_product_id:
                result = await self._wc_request(
                    "PUT",
                    f"/products/{product.woocommerce_product_id}",
                    json_payload=payload,
                )
            else:
                result = await self._wc_request("POST", "/products", json_payload=payload)
        return result, warnings

    async def list_categories(self) -> list[dict[str, Any]]:
        """Sitedeki TÜM ürün kategorilerini sayfalayarak çeker (probe kalıbı)."""
        categories: list[dict[str, Any]] = []
        page = 1
        while True:
            batch = await self._wc_request(
                "GET", "/products/categories", params={"per_page": 100, "page": page}
            )
            if not isinstance(batch, list) or not batch:
                break
            categories.extend(item for item in batch if isinstance(item, dict))
            if len(batch) < 100:
                break
            page += 1
        return categories

    async def unpublish_product(self, wc_product_id: int) -> dict[str, Any]:
        return await self._wc_request(
            "PUT",
            f"/products/{wc_product_id}",
            json_payload={"status": "draft"},
        )

    async def fetch_recent_published_products(self, *, limit: int = 100) -> list[dict[str, Any]]:
        target = max(1, min(int(limit or 0), 100))
        payload = await self._wc_request(
            "GET",
            "/products",
            params={
                "status": "publish",
                "per_page": target,
                "page": 1,
                "orderby": "date",
                "order": "desc",
            },
        )
        if not isinstance(payload, list):
            return []
        return [item for item in payload[:target] if isinstance(item, dict)]

    async def fetch_published_products_page(self, *, page: int, per_page: int = 100) -> list[dict[str, Any]]:
        """Return one read-only page of the published remote catalog.

        Catalog synchronization intentionally uses an explicit page API so it
        does not silently truncate stores with more than 100 products.
        """

        payload = await self._wc_request(
            "GET",
            "/products",
            params={
                "status": "publish",
                "per_page": max(1, min(int(per_page or 0), 100)),
                "page": max(1, int(page or 0)),
                "orderby": "id",
                "order": "asc",
            },
        )
        if not isinstance(payload, list):
            return []
        return [item for item in payload if isinstance(item, dict)]

    async def fetch_published_product_count(self) -> int:
        """Read the published count with a one-row Woo request.

        WooCommerce exposes the total in ``X-WP-Total``.  The status endpoint
        must not download and normalize the complete catalog merely to render
        a connection badge.
        """

        response = await self._wc_response(
            "GET",
            "/products",
            params={
                "status": "publish",
                "per_page": 1,
                "page": 1,
                "orderby": "id",
                "order": "asc",
            },
        )
        total_header = str(response.headers.get("X-WP-Total") or "").strip()
        if total_header.isdigit():
            return int(total_header)
        payload = response.json()
        return len(payload) if isinstance(payload, list) else 0

    async def fetch_product(self, *, wc_product_id: int) -> dict[str, Any]:
        payload = await self._wc_request("GET", f"/products/{int(wc_product_id)}")
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="WooCommerce ürün yanıtı beklenen formatta değil.",
            )
        return payload

    async def fetch_recent_orders(
        self,
        *,
        days: int = 7,
        per_page: int = 50,
        statuses: str = "processing,completed",
    ) -> list[dict[str, Any]]:
        page_size = max(1, min(per_page, 100))
        params: dict[str, Any] = {
            "status": statuses,
            "per_page": page_size,
            "orderby": "date",
            "order": "desc",
        }
        if days > 0:
            from datetime import timedelta
            from app.utils.helpers import utc_now

            after = (utc_now() - timedelta(days=days)).isoformat()
            params["after"] = after

        rows: list[dict[str, Any]] = []
        seen_page_ids: set[tuple[Any, ...]] = set()
        # Woo paginates orders; stopping at the first page corrupts period totals.
        page = 1
        while True:
            params["page"] = page
            payload = await self._wc_request("GET", "/orders", params=params)
            if not isinstance(payload, list):
                break
            page_rows = [item for item in payload if isinstance(item, dict)]
            page_ids = tuple(item.get("id") for item in page_rows)
            if page_ids and page_ids in seen_page_ids:
                break
            if page_ids:
                seen_page_ids.add(page_ids)
            rows.extend(page_rows)
            if len(payload) < page_size:
                break
            page += 1
        return rows

    async def fetch_order_notes(self, *, order_id: int, per_page: int = 20) -> list[dict[str, Any]]:
        payload = await self._wc_request(
            "GET",
            f"/orders/{int(order_id)}/notes",
            params={
                "per_page": max(1, min(per_page, 100)),
                "orderby": "date",
                "order": "desc",
            },
        )
        if not isinstance(payload, list):
            return []
        return [item for item in payload if isinstance(item, dict)]

    async def fetch_order(self, *, order_id: int) -> dict[str, Any]:
        payload = await self._wc_request("GET", f"/orders/{int(order_id)}")
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="WooCommerce sipariş yanıtı beklenen formatta değil.",
            )
        return payload

    async def update_order_meta(
        self,
        *,
        order_id: int,
        meta_key: str,
        value: Any,
    ) -> dict[str, Any]:
        """Tek bir meta_data alanını günceller (upsert).

        Önce mevcut order'ı çekip aynı `meta_key`'i bulup günceller; yoksa ekler.
        Diğer meta'ları korumak için PUT /orders/{id} `meta_data` array'ini
        gönderir.
        """
        existing = await self.fetch_order(order_id=order_id)
        meta_list = existing.get("meta_data") or []
        if not isinstance(meta_list, list):
            meta_list = []
        updated_list: list[dict[str, Any]] = []
        found = False
        for item in meta_list:
            if not isinstance(item, dict):
                updated_list.append(item)  # passthrough
                continue
            if str(item.get("key") or "") == meta_key:
                updated_list.append({**item, "key": meta_key, "value": value})
                found = True
            else:
                updated_list.append(item)
        if not found:
            updated_list.append({"key": meta_key, "value": value})

        payload = await self._wc_request(
            "PUT",
            f"/orders/{int(order_id)}",
            json_payload={"meta_data": updated_list},
        )
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="WooCommerce sipariş güncelleme yanıtı beklenen formatta değil.",
            )
        return payload

    async def fetch_customers(self, *, limit: int = 1000) -> list[dict[str, Any]]:
        target = max(1, min(int(limit or 0), 5000))
        per_page = min(100, target)
        page = 1
        customers: list[dict[str, Any]] = []

        while len(customers) < target:
            payload = await self._wc_request(
                "GET",
                "/customers",
                params={
                    "per_page": per_page,
                    "page": page,
                    "orderby": "registered_date",
                    "order": "desc",
                },
            )
            if not isinstance(payload, list) or not payload:
                break

            chunk = [item for item in payload if isinstance(item, dict)]
            customers.extend(chunk)
            if len(payload) < per_page:
                break
            page += 1

        return customers[:target]

    @staticmethod
    def _normalize_customer_phone(value: str | None) -> str:
        return "".join(ch for ch in str(value or "") if ch.isdigit())

    async def fetch_customer_by_id(self, *, customer_id: int) -> dict[str, Any] | None:
        try:
            payload = await self._wc_request("GET", f"/customers/{int(customer_id)}")
        except HTTPException as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                return None
            raise
        if not isinstance(payload, dict):
            return None
        return payload

    async def _find_matching_customers(
        self,
        *,
        email: str | None,
        phone: str | None,
    ) -> list[dict[str, Any]]:
        normalized_email = str(email or "").strip().lower()
        normalized_phone = self._normalize_customer_phone(phone)
        candidates: list[dict[str, Any]] = []

        if normalized_email:
            payload = await self._wc_request(
                "GET",
                "/customers",
                params={"search": normalized_email, "per_page": 100},
            )
            if isinstance(payload, list):
                candidates.extend(item for item in payload if isinstance(item, dict))

        if not candidates and normalized_phone:
            candidates = await self.fetch_customers(limit=500)

        matched: list[dict[str, Any]] = []
        seen_ids: set[int] = set()
        for item in candidates:
            item_id = int(item.get("id") or 0)
            if item_id and item_id in seen_ids:
                continue
            item_email = str(item.get("email") or "").strip().lower()
            billing = item.get("billing") if isinstance(item.get("billing"), dict) else {}
            item_phone = self._normalize_customer_phone(str((billing or {}).get("phone") or ""))
            email_match = bool(normalized_email and item_email == normalized_email)
            phone_match = bool(normalized_phone and item_phone == normalized_phone)
            if not email_match and not phone_match:
                continue
            if item_id:
                seen_ids.add(item_id)
            matched.append(item)
        return matched

    async def _resolve_privacy_customer_match(
        self,
        *,
        woocommerce_customer_id: str | None,
        email: str | None,
        phone: str | None,
    ) -> dict[str, Any]:
        explicit_id = str(woocommerce_customer_id or "").strip()
        if explicit_id:
            explicit_customer = await self.fetch_customer_by_id(customer_id=int(explicit_id))
            if explicit_customer is None:
                return {
                    "status": "no_match",
                    "matched_by": "woocommerce_customer_id",
                    "matches": [],
                    "warnings": [f"Woo customer bulunamadı: {explicit_id}"],
                }
            return {
                "status": "matched",
                "matched_by": "woocommerce_customer_id",
                "matches": [explicit_customer],
                "warnings": [],
            }

        normalized_email = str(email or "").strip().lower()
        if normalized_email:
            email_matches = await self._find_matching_customers(email=normalized_email, phone=None)
            if len(email_matches) == 1:
                return {
                    "status": "matched",
                    "matched_by": "email",
                    "matches": email_matches,
                    "warnings": [],
                }
            if len(email_matches) > 1:
                return {
                    "status": "ambiguous",
                    "matched_by": "email",
                    "matches": email_matches,
                    "warnings": [f"Woo email eşleşmesi birden fazla sonuç döndürdü ({len(email_matches)})."],
                }

        normalized_phone = self._normalize_customer_phone(phone)
        if normalized_phone:
            phone_matches = await self._find_matching_customers(email=None, phone=normalized_phone)
            if len(phone_matches) == 1:
                return {
                    "status": "matched",
                    "matched_by": "phone",
                    "matches": phone_matches,
                    "warnings": [],
                }
            if len(phone_matches) > 1:
                return {
                    "status": "ambiguous",
                    "matched_by": "phone",
                    "matches": phone_matches,
                    "warnings": [f"Woo telefon eşleşmesi birden fazla sonuç döndürdü ({len(phone_matches)})."],
                }

        return {
            "status": "no_match",
            "matched_by": None,
            "matches": [],
            "warnings": ["Woo tarafında benzersiz müşteri eşleşmesi bulunamadı."],
        }

    async def pseudonymize_customer(
        self,
        *,
        woocommerce_customer_id: str | None,
        email: str | None,
        phone: str | None,
        placeholder_email: str | None,
    ) -> dict[str, Any]:
        resolution = await self._resolve_privacy_customer_match(
            woocommerce_customer_id=woocommerce_customer_id,
            email=email,
            phone=phone,
        )
        if resolution["status"] != "matched":
            return {
                "status": resolution["status"],
                "matched_by": resolution.get("matched_by"),
                "updated_ids": [],
                "warnings": resolution.get("warnings", []),
            }

        placeholder = str(placeholder_email or "").strip().lower() or None
        updated_ids: list[int] = []
        for item in resolution["matches"]:
            customer_id = int(item["id"])
            payload: dict[str, Any] = {
                "first_name": "GDPR",
                "last_name": "Redacted",
                "billing": {
                    "first_name": "GDPR",
                    "last_name": "Redacted",
                    "company": "",
                    "address_1": "",
                    "address_2": "",
                    "city": "",
                    "state": "",
                    "postcode": "",
                    "country": "",
                    "phone": "",
                    "email": placeholder or str(item.get("email") or "").strip().lower(),
                },
                "shipping": {
                    "first_name": "GDPR",
                    "last_name": "Redacted",
                    "company": "",
                    "address_1": "",
                    "address_2": "",
                    "city": "",
                    "state": "",
                    "postcode": "",
                    "country": "",
                },
                "meta_data": [
                    {"key": "seroguld_gdpr_status", "value": "pseudonymized"},
                ],
            }
            if placeholder:
                payload["email"] = placeholder
            await self._wc_request("PUT", f"/customers/{customer_id}", json_payload=payload)
            updated_ids.append(customer_id)
        return {
            "status": "synced",
            "matched_by": resolution.get("matched_by"),
            "updated_ids": updated_ids,
            "warnings": [],
        }

    async def marketing_opt_out_customer(
        self,
        *,
        woocommerce_customer_id: str | None,
        email: str | None,
        phone: str | None,
    ) -> dict[str, Any]:
        resolution = await self._resolve_privacy_customer_match(
            woocommerce_customer_id=woocommerce_customer_id,
            email=email,
            phone=phone,
        )
        if resolution["status"] != "matched":
            return {
                "status": resolution["status"],
                "matched_by": resolution.get("matched_by"),
                "updated_ids": [],
                "warnings": resolution.get("warnings", []),
            }

        updated_ids: list[int] = []
        for item in resolution["matches"]:
            customer_id = int(item["id"])
            payload = {
                "meta_data": [
                    {"key": "seroguld_marketing_opt_out", "value": "true"},
                ]
            }
            await self._wc_request("PUT", f"/customers/{customer_id}", json_payload=payload)
            updated_ids.append(customer_id)
        return {
            "status": "synced",
            "matched_by": resolution.get("matched_by"),
            "updated_ids": updated_ids,
            "warnings": [],
        }
