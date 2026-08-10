from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.schemas.base import AppBaseModel


class KdsAddressSearchSuggestionOut(AppBaseModel):
    """A selectable, resolved-address hit from KDS Adressevælger."""

    id: str
    title: str
    type: str = "adresse"
    postal_code: str | None = None
    city: str | None = None


class KdsAddressSearchOut(AppBaseModel):
    # ``available`` lets the UI retain a manual-address path without needing
    # to know anything about the upstream service or its token.
    available: bool = True
    results: list[KdsAddressSearchSuggestionOut] = Field(default_factory=list)


class KdsAddressResolveOut(AppBaseModel):
    id: str
    address: str
    postal_code: str
    city: str
    title: str


class CustomerMatchRequest(AppBaseModel):
    cpr_number: str | None = Field(default=None, max_length=20)
    identity_doc_number: str | None = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def require_identity_value(self) -> "CustomerMatchRequest":
        if not (self.cpr_number or "").strip() and not (self.identity_doc_number or "").strip():
            raise ValueError("CPR veya kimlik belge numarası zorunlu.")
        return self


class CustomerMatchItemOut(AppBaseModel):
    id: str
    name: str
    # The endpoint is deliberately suitable for a duplicate-warning UI: it
    # never emits raw CPR or document numbers.
    cpr_number_masked: str | None = None
    identity_doc_number_masked: str | None = None
    matched_by: str | None = None


class CustomerMatchOut(AppBaseModel):
    status: Literal["none", "single", "conflict"]
    matches: list[CustomerMatchItemOut] = Field(default_factory=list)
