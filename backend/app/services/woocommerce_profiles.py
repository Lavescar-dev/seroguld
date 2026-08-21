from __future__ import annotations

from typing import Any

# WooCommerce yayın profilleri — ürün tipine göre "Yderligere information"
# tablosu, spec şeridi, açıklama alt bloğu ve AI açısı farklılaşır (referans
# seroguld.dk ürünlerinden türetildi: takı / külçe / sikke / platin).
#
# Şekiller:
#   jewelry    — Guldsmykker/Sølvsmykker: Karat+Renhed(kesir)+Vægt+ölçüler
#   bar        — Guldbarrer/Sølvbarrer: Vægt(gram)+Karat(çıplak)+Renhed(promille)
#   coin       — Guldmønter/Sølvmønter: +Diameter/Tykkelse +Årstal
#   platinum   — Platin/Palladium: Ædelmetal (Karat yok)

PROFILE_JEWELRY = "jewelry"
PROFILE_BAR = "bar"
PROFILE_COIN = "coin"
PROFILE_PLATINUM = "platinum"

VALID_PROFILES = (PROFILE_JEWELRY, PROFILE_BAR, PROFILE_COIN, PROFILE_PLATINUM)

# Operatörün UI'dan seçebileceği override etiketleri.
PROFILE_LABELS_DA = {
    PROFILE_JEWELRY: "Smykke",
    PROFILE_BAR: "Barre (investering)",
    PROFILE_COIN: "Mønt",
    PROFILE_PLATINUM: "Platin / Palladium",
}

# Her şeklin özellikleri: hangi footer, spec şeridi modu, yatırım mı (promille/
# çıplak karat), ölçü içerir mi, yıl (Årstal) içerir mi, Ædelmetal mı.
_PROFILE_TRAITS: dict[str, dict[str, Any]] = {
    PROFILE_JEWELRY: {
        "footer_key": "jewelry",
        "spec_strip_mode": "dimensions",
        "investment": False,
        "dimensions": True,
        "year": False,
        "aedelmetal": False,
    },
    PROFILE_BAR: {
        "footer_key": "investment",
        "spec_strip_mode": "weight",
        "investment": True,
        "dimensions": False,
        "year": False,
        "aedelmetal": False,
    },
    PROFILE_COIN: {
        "footer_key": "investment",
        "spec_strip_mode": "weight",
        "investment": True,
        "dimensions": True,
        "year": True,
        "aedelmetal": False,
    },
    PROFILE_PLATINUM: {
        "footer_key": "investment",
        "spec_strip_mode": "weight",
        "investment": True,
        "dimensions": False,
        "year": False,
        "aedelmetal": True,
    },
}


def profile_traits(profile: str) -> dict[str, Any]:
    return _PROFILE_TRAITS.get(profile, _PROFILE_TRAITS[PROFILE_JEWELRY])


def _metal_key(product: Any) -> str:
    metal = getattr(product, "metal_type", None)
    return str(getattr(metal, "value", metal) or "").lower()


def _product_type_key(product: Any) -> str:
    ptype = getattr(product, "product_type", None)
    return str(getattr(ptype, "value", ptype) or "").lower()


def _inventory_subcategory(product: Any) -> str:
    sub = getattr(product, "inventory_subcategory", None)
    return str(sub or "").lower()


def resolve_publish_profile(product: Any) -> str:
    """Ürünün varsayılan yayın profili (enum'a bağımlı değil; hem gerçek ürün
    hem SimpleNamespace ile çalışır). Operatör override'ı ayrı ele alınır."""
    metal = _metal_key(product)
    if metal in {"platinum", "palladium"}:
        return PROFILE_PLATINUM

    category = str(getattr(product, "inventory_category", "") or "").lower()
    sub = _inventory_subcategory(product)
    ptype = _product_type_key(product)

    # inventory_category boşsa metal+tipten türet (infer_inventory_categories
    # ile aynı kural, enum karşılaştırması olmadan).
    if not category:
        if metal == "silver":
            category = "gumus"
            sub = sub or ("barrer" if ptype == "bar" else "smykker")
        elif ptype == "bar":
            category = "kulce"
        else:
            category = "taki"

    if category == "kulce":
        return PROFILE_BAR
    if category == "gumus":
        if sub == "barrer":
            return PROFILE_BAR
        if sub in {"monter", "mønter"}:
            return PROFILE_COIN
        return PROFILE_JEWELRY
    if category == "platin_pd":
        return PROFILE_PLATINUM
    # taki (gold coins CRM'de taki'ye düşer — operatör override ile 'coin' seçer)
    return PROFILE_JEWELRY


def effective_publish_profile(product: Any) -> str:
    """Override öncelikli etkin profil."""
    override = str(getattr(product, "woocommerce_publish_profile", "") or "").strip().lower()
    if override in VALID_PROFILES:
        return override
    return resolve_publish_profile(product)
