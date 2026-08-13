from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from app.schemas.base import AppBaseModel


DashboardPeriodKey = Literal["7d", "30d", "90d", "12m"]
MarketRateConfirmationMode = Literal["saved", "unchanged"]


class DashboardPurchasePeriodOut(AppBaseModel):
    period: DashboardPeriodKey
    startsAt: datetime
    endsAtExclusive: datetime
    purchaseCount: int
    purchaseNetDkk: Decimal
    purchaseVatDkk: Decimal
    purchaseGrossDkk: Decimal
    newActiveCustomerCount: int


class DashboardInventorySnapshotOut(AppBaseModel):
    activeItemCount: int
    totalPurchaseValueDkk: Decimal
    totalSpotValueDkk: Decimal
    totalPureMetalGrams: Decimal
    totalFineSilverGrams: Decimal
    totalGoldRelatedGrams: Decimal


class DashboardWooCatalogTasksOut(AppBaseModel):
    activeCatalogItemCount: int
    inactiveCatalogItemCount: int
    manualReviewCount: int
    photoMissingCount: int
    unlinkedCount: int
    catalogRevision: int
    remotePublishedCount: int
    lastSyncedAt: datetime | None


class DashboardUnicontaQueueOut(AppBaseModel):
    pendingCount: int
    failedCount: int
    skippedCount: int
    syncedCount: int
    historicalCount: int
    lastSyncedAt: datetime | None
    latestFailedDocumentCreatedAt: datetime | None


class DashboardBackupHealthOut(AppBaseModel):
    latestLocalBackupAt: datetime | None
    localBackupAgeMinutes: int | None
    localBackupRecent: bool
    offsiteEnabled: bool
    lastOffsiteSyncAt: datetime | None
    offsiteAgeMinutes: int | None
    offsiteRecent: bool | None
    lastRestoreDrillAt: datetime | None
    restoreDrillAgeHours: int | None
    restoreDrillRecent: bool


class DashboardFinancialCoverageOut(AppBaseModel):
    companyRevenueDkk: Decimal | None = None
    companyProfitDkk: Decimal | None = None
    complete: bool = False
    reason: str


class DashboardMarketRatesOut(AppBaseModel):
    goldDkk: Decimal
    silverDkk: Decimal
    platinumDkk: Decimal
    palladiumDkk: Decimal


class DashboardMarketRateConfirmationIn(AppBaseModel):
    mode: MarketRateConfirmationMode


class DashboardMarketRateConfirmationOut(AppBaseModel):
    businessDate: date
    timezone: Literal["Europe/Copenhagen"] = "Europe/Copenhagen"
    recorded: bool
    confirmed: bool
    confirmationMode: MarketRateConfirmationMode | None = None
    confirmedAt: datetime | None = None
    confirmedByUserId: str | None = None
    confirmedRates: DashboardMarketRatesOut | None = None
    currentRates: DashboardMarketRatesOut
    matchesCurrentRates: bool | None = None


class DashboardOverviewOut(AppBaseModel):
    generatedAt: datetime
    timezone: Literal["Europe/Copenhagen"] = "Europe/Copenhagen"
    periods: list[DashboardPurchasePeriodOut]
    activeCustomerCount: int
    inventory: DashboardInventorySnapshotOut
    wooCatalogTasks: DashboardWooCatalogTasksOut
    unicontaQueue: DashboardUnicontaQueueOut
    backupHealth: DashboardBackupHealthOut
    marketRateConfirmation: DashboardMarketRateConfirmationOut
    financialCoverage: DashboardFinancialCoverageOut
