from __future__ import annotations

from app.tools.probe_woocommerce_site import build_category_map_draft


def test_category_map_draft_matches_site_names() -> None:
    categories = [
        {"id": 90, "parent": 0, "name": "Guld", "slug": "guld"},
        {"id": 101, "parent": 90, "name": "Guldsmykker", "slug": "guldsmykker"},
        {"id": 102, "parent": 0, "name": "Sølvsmykker", "slug": "soelvsmykker"},
        {"id": 111, "parent": 90, "name": "Guldbarrer", "slug": "guldbarrer"},
        {"id": 121, "parent": 90, "name": "Guldmønter", "slug": "guldmoenter"},
        {"id": 202, "parent": 90, "name": "14 kt. guld", "slug": "14-kt-guld"},
        {"id": 204, "parent": 90, "name": "22 kt guld", "slug": "22-kt-guld"},
        {"id": 131, "parent": 0, "name": "Platin", "slug": "platin"},
        {"id": 999, "parent": 0, "name": "Pre-owned", "slug": "pre-owned"},
    ]

    draft = build_category_map_draft(categories)

    assert draft["primary"]["taki"] == {"gold": 101, "silver": 102}
    assert draft["primary"]["kulce"] == {"gold": 111}
    assert draft["primary"]["sikke"] == {"gold": 121}
    assert draft["primary"]["platin_pd"] == {"platinum": 131}
    assert draft["karat"] == {"14": 202, "22": 204}
    # Eşleşmeyen adlar (Pre-owned, Guld kökü) taslağa sızmaz.
    all_ids = {v for group in draft["primary"].values() for v in group.values()} | set(draft["karat"].values())
    assert 999 not in all_ids and 90 not in all_ids


def test_category_map_draft_empty_when_nothing_matches() -> None:
    assert build_category_map_draft([{"id": 1, "parent": 0, "name": "Diverse", "slug": "diverse"}]) == {}
