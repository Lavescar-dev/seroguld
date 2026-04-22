from __future__ import annotations

from decimal import Decimal
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict


class AppBaseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


T = TypeVar("T")


class PaginatedResponse(AppBaseModel, Generic[T]):
    items: list[T]
    page: int
    page_size: int
    total: int
    total_pages: int
