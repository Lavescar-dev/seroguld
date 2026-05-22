from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import EmailStr, Field

from app.models.enums import IdentityDocTypeEnum
from app.schemas.base import AppBaseModel, PaginatedResponse


class CustomerCreate(AppBaseModel):
    name: str = Field(min_length=2, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = None
    postal_code: str | None = Field(default=None, max_length=20)
    cpr_number: str | None = Field(default=None, max_length=20)
    identity_doc_type: IdentityDocTypeEnum | None = None
    identity_doc_number: str | None = Field(default=None, max_length=50)
    identity_doc_country: str | None = Field(default=None, max_length=8)
    identity_photo_refs: list[str] = Field(default_factory=list)
    password: str | None = Field(default=None, min_length=8)


class CustomerUpdate(AppBaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = None
    postal_code: str | None = Field(default=None, max_length=20)
    cpr_number: str | None = Field(default=None, max_length=20)
    identity_doc_type: IdentityDocTypeEnum | None = None
    identity_doc_number: str | None = Field(default=None, max_length=50)
    identity_doc_country: str | None = Field(default=None, max_length=8)
    identity_photo_refs: list[str] | None = None
    is_active: bool | None = None


class CustomerWooImportRequest(AppBaseModel):
    limit: int = Field(default=1000, ge=1, le=5000)
    replace_mock_seed: bool = True


class CustomerWooImportResponse(AppBaseModel):
    fetched: int
    created: int
    updated: int
    skipped: int
    deleted_mock_seed: int
    imported_customer_ids: list[str]
    errors: list[str]


class CustomerOut(AppBaseModel):
    id: UUID
    email: str
    name: str
    phone: str | None
    address: str | None
    postal_code: str | None
    cpr_number: str | None
    cpr_number_masked: str | None
    identity_doc_type: IdentityDocTypeEnum | None = None
    identity_doc_number: str | None = None
    identity_doc_number_masked: str | None = None
    identity_doc_country: str | None = None
    identity_photo_refs: list[str] = Field(default_factory=list)
    gdpr_status: str = "active"
    gdpr_pseudonymized_at: datetime | None = None
    marketing_opt_out_at: datetime | None = None
    is_active: bool
    created_at: datetime


class CustomerStats(AppBaseModel):
    total_sold_to_shop: int
    total_bought_from_shop: int
    total_purchase_value_dkk: str
    total_sale_value_dkk: str


class CustomerRiskOut(AppBaseModel):
    score: int
    level: str
    warnings: list[str] = Field(default_factory=list)
    transactions_30d: int
    distinct_addresses_30d: int
    distinct_identity_docs_30d: int
    melted_items_30d: int


class CustomerDetailOut(CustomerOut):
    stats: CustomerStats
    risk: CustomerRiskOut


class CustomerListResponse(PaginatedResponse[CustomerOut]):
    pass


class CustomerAlisSummaryOut(AppBaseModel):
    customer_id: str
    total_documents: int
    total_amount_dkk: str
    total_weight_grams: str
    last_purchase_at: str | None = None
    first_purchase_at: str | None = None
    avg_amount_dkk: str
    last_30d_documents: int
    last_30d_amount_dkk: str
    last_365d_documents: int
    last_365d_amount_dkk: str
