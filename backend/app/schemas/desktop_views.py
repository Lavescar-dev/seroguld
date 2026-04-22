from __future__ import annotations

from app.schemas.base import AppBaseModel


class DashboardRecentPurchaseOut(AppBaseModel):
    id: str
    afregningsnr: str
    dato: str
    musteri: str
    total: float
    paymentMethod: str | None = None


class DashboardMonthlyPurchasePointOut(AppBaseModel):
    ay: str
    adet: int
    kr: float


class DashboardRecentCustomerOut(AppBaseModel):
    id: str
    navn: str
    kayitTarihi: str


class DashboardCategorySpotOut(AppBaseModel):
    name: str
    gram: float
    spot: float
    color: str


class DashboardScreenOut(AppBaseModel):
    alisSayisi: int
    alisToplamKr: float
    sonAlislar: list[DashboardRecentPurchaseOut]
    aylikAlis: list[DashboardMonthlyPurchasePointOut]
    musteriSayisi: int
    sonMusteriler: list[DashboardRecentCustomerOut]
    depoToplamItem: int
    depoSpotDeger: float
    depoAlisDeger: float
    depoByCat: list[DashboardCategorySpotOut]
    wooHazir: int
    wooFoto: int
    wooLisitlendi: int
    logSayisi: int
    ayirmaSayisi: int
    eritmeSayisi: int
    eritmeToplamHasAltin: float
    eritmeToplamPayout: float
    goldPrice: float
    silverPrice: float
    platinPrice: float
    palladyumPrice: float
    opmcYuksek: int
    opmcOrta: int
    opmcDusuk: int
    opmcBelirsiz: int
    opmcManuel: int
    faturaAdedi: int
    faturaToplamKr: float


class SettingsScreenOut(AppBaseModel):
    openai_api_key: str
    openai_model: str
    openai_max_tokens: str
    opmc_api_url: str
    opmc_api_key: str
    opmc_webhook_secret: str
    woo_store_url: str
    woo_consumer_key: str
    woo_consumer_secret: str
    woo_webhook_secret: str
    wp_site_url: str
    wp_username: str
    wp_app_password: str
    uniconta_api_url: str
    uniconta_username: str
    uniconta_password: str
    uniconta_company_id: str
    uniconta_api_key: str
    market_gold: str
    market_silver: str
    market_platin: str
    market_palladyum: str
    firma_adi: str
    firma_cvr: str
    firma_telefon: str
    firma_email: str
    firma_adres: str


class SettingsScreenUpdateIn(SettingsScreenOut):
    pass


class UnicontaConfigOut(AppBaseModel):
    companyId: str
    username: str
    password: str
    env: str
    apiUrl: str
    apiKey: str
    connectionStatus: str
    configured: bool
    lastRefreshedAt: str | None = None
    message: str | None = None


class UnicontaConnectIn(AppBaseModel):
    companyId: str
    username: str
    password: str
    env: str
    apiUrl: str
    apiKey: str


class UnicontaConnectOut(AppBaseModel):
    connectionStatus: str
    configured: bool
    message: str
    config: UnicontaConfigOut


class UnicontaInvoiceCustomerOut(AppBaseModel):
    id: str
    navn: str
    email: str | None = None
    telefon: str | None = None
    adresse: str | None = None
    postnr: str | None = None
    cvr: str | None = None


class UnicontaInvoiceLineOut(AppBaseModel):
    id: str
    beskrivelse: str
    antal: float
    enhedspris: float
    rabat: float
    moms: float
    liniepris: float


class UnicontaInvoiceOut(AppBaseModel):
    id: str
    fakturanummer: str
    ordrenummer: str | None = None
    type: str
    fakturadato: str
    konto: str
    mailSendt: str | None = None
    eFakturaSendt: str | None = None
    kunde: UnicontaInvoiceCustomerOut
    kalemler: list[UnicontaInvoiceLineOut]
    subtotal: float
    momsTotal: float
    total: float
    valuta: str
    note: str | None = None
    wooOrderId: str | None = None
    unicontaRef: str | None = None


class UnicontaInvoicesOut(AppBaseModel):
    source: str
    generatedAt: str
    invoices: list[UnicontaInvoiceOut]
