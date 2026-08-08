"""Uniconta Web API HTTP client.

Token-based async client for https://api.uniconta.com.

Auth flow:
  POST /login {"Username": "00<CompanyId>/<Username>", "Password": "..."}
  -> { token (JWT, 1h), refreshToken (uuid, 7d), refreshTokenExpiry }

Subsequent requests use `Authorization: Bearer <token>`.
Refresh via POST /refresh with the refresh token string as JSON body.

Entity queries: POST /Query/Get/{EntityName}, body = filter array; pagination
QueryFilter.Skip/Take içinde (URL ?top= çalışmıyor). Entity adları
CompanyClient, DebtorClient, DebtorInvoiceClient, InvItemClient, etc.

Invoice PDF: Uniconta JSON string olarak base64-encoded PDF döndürür
(Accept: application/pdf istesek bile). Service base64 decode edip binary
bytes döndürür.
"""

from __future__ import annotations

import asyncio
import base64
import json as _json
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import httpx

from app.config import get_settings
from app.models.enums import PosTradeSideEnum
from app.services.pos_value_helpers import calculate_offer, safe_trade_side
from app.utils.helpers import quantize_2, to_decimal

LOGGER = logging.getLogger(__name__)

UNICONTA_WEB_API_BASE = "https://api.uniconta.com"
TOKEN_LIFETIME = timedelta(minutes=55)  # Uniconta access token: 1h. Refresh early.
REFRESH_LIFETIME_FALLBACK = timedelta(days=6)

# U13 — Retry/backoff parametreleri
RETRY_MAX_ATTEMPTS = 3
RETRY_BASE_DELAY_SEC = 0.5  # ilk gecikme, sonra üs alır
RETRY_MAX_DELAY_SEC = 8.0
RETRYABLE_STATUS_CODES = {500, 502, 503, 504, 408, 429}

# U18 — Friendly error mesaj eşleşmeleri (UI tarafına gönderilir)
ERROR_MESSAGE_TR: dict[str, str] = {
    "GenerateDebtorInvoice 400": "Uniconta fatura oluşturulamadı: payload doğrulama hatası.",
    "Connect aborted": "Uniconta'ya bağlanılamadı. Ağ bağlantınızı kontrol edin.",
    "timeout": "Uniconta yanıt vermedi (timeout). Lütfen tekrar deneyin.",
    "NoCompanyId": "Şirket ID yanlış veya yetkisiz.",
    "Invalid credentials": "Kullanıcı adı veya şifre hatalı.",
    "401": "Uniconta oturumu süresi dolmuş.",
    "403": "Uniconta erişim yetkiniz yok.",
    "404": "Uniconta kaynağı bulunamadı.",
    "500": "Uniconta sunucu hatası.",
    "502": "Uniconta geçici olarak ulaşılamıyor (Bad Gateway).",
    "503": "Uniconta bakımda (Service Unavailable).",
}


def friendly_uniconta_error(raw: str | None) -> str:
    """UI'ya gönderilecek Türkçe friendly mesaja çevirir; eşleşme yoksa raw'ı döner."""
    if not raw:
        return "Bilinmeyen Uniconta hatası."
    for key, friendly in ERROR_MESSAGE_TR.items():
        if key.lower() in raw.lower():
            return friendly
    return raw[:200]


def _decode_pdf_response(raw: bytes) -> bytes:
    """Uniconta Invoice PDF response'unu binary PDF bytes'a çevirir.

    Uniconta `Accept: application/pdf` olsa bile JSON string olarak
    base64-encoded PDF döndürüyor (örn `"JVBERi0xLjQ..."` = `%PDF-1.4...`).
    Eğer cevap zaten binary PDF ise olduğu gibi döner.
    """
    if not raw:
        return raw
    # Zaten gerçek PDF binary mi?
    if raw[:5] == b"%PDF-":
        return raw
    text = raw.decode("utf-8", errors="ignore").strip()
    # JSON string ("...") gelmişse dış tırnakları ayıkla
    if text.startswith('"') and text.endswith('"'):
        try:
            text = _json.loads(text)
        except _json.JSONDecodeError:
            text = text[1:-1]
    # Base64 decode dene
    try:
        decoded = base64.b64decode(text, validate=False)
        if decoded[:5] == b"%PDF-":
            return decoded
    except Exception:
        pass
    return raw  # son çare: olduğu gibi döndür, çağıran log'lasın


class UnicontaError(RuntimeError):
    """Uniconta API genel hata."""


class UnicontaCredentialsMissing(UnicontaError):
    """Username/Password/CompanyId eksik."""


class UnicontaAuthFailed(UnicontaError):
    """Login başarısız (kimlik bilgileri yanlış)."""


class UnicontaClient:
    """Async Uniconta Web API client.

    Token cache process-bellek içinde. Single-process uvicorn için yeterli.
    Çoklu worker / multi-host için Redis/DB cache eklenmeli.

    PRODUCTION NOTU (U16):
    --------------------------------------------------------------------------
    Bu client process-singleton'dır. `_default_client`, `_debtor_cache` ve
    `_access_token`/`_refresh_token` her uvicorn worker'ında ayrı yaşar.
    Multi-worker çalıştırmada her worker bağımsız login yapar; Uniconta
    bir hesabın çok-eşzamanlı login sayısını sınırlamadığı için fonksiyonel
    risk yok ama:
      - Eşzamanlı refresh çağrıları aynı anda fırlayabilir (gereksiz).
      - DebtorClient cache her worker'ta ayrı (cache miss oranı artar).
      - Health snapshot her worker'a göre değişir (UI tutarsız görür).

    Önerilen prod konfigürasyon: `uvicorn --workers 1` veya
    nginx upstream + sticky session. Multi-worker mecbur ise Redis
    backed token + debtor cache implementasyonu gerekli.
    --------------------------------------------------------------------------
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        company_id: str | None = None,
        username: str | None = None,
        password: str | None = None,
        timeout: float = 20.0,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or UNICONTA_WEB_API_BASE).rstrip("/")
        self.company_id = (company_id or settings.uniconta_company_id).strip()
        self.username = (username or settings.uniconta_username).strip()
        self.password = (password or settings.uniconta_password).strip()
        self.timeout = timeout

        self._access_token: str | None = None
        self._access_expires_at: datetime | None = None
        self._refresh_token: str | None = None
        self._refresh_expires_at: datetime | None = None
        self._lock = asyncio.Lock()
        # U11 — Health metrics
        self._last_call_at: datetime | None = None
        self._last_call_ok: bool | None = None

    def get_health_snapshot(self) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        minutes_to_expiry: int | None = None
        if self._access_expires_at is not None:
            minutes_to_expiry = int((self._access_expires_at - now).total_seconds() / 60)
        return {
            "configured": self.has_credentials,
            "has_token": bool(self._access_token),
            "access_expires_at": (
                self._access_expires_at.isoformat() if self._access_expires_at else None
            ),
            "refresh_expires_at": (
                self._refresh_expires_at.isoformat() if self._refresh_expires_at else None
            ),
            "last_call_at": self._last_call_at.isoformat() if self._last_call_at else None,
            "last_call_ok": self._last_call_ok,
            "minutes_to_expiry": minutes_to_expiry,
        }

    @property
    def has_credentials(self) -> bool:
        return bool(
            self.base_url
            and self.company_id
            and self.username
            and self.password
        )

    def _login_username(self) -> str:
        """Uniconta Web API Username format: `00<CompanyId>/<Username>`."""
        return f"00{self.company_id}/{self.username}"

    async def _login(self, client: httpx.AsyncClient) -> None:
        if not self.has_credentials:
            raise UnicontaCredentialsMissing(
                "Uniconta credential'ları eksik (.env: UNICONTA_USERNAME, UNICONTA_PASSWORD, UNICONTA_COMPANY_ID)."
            )
        payload = {"Username": self._login_username(), "Password": self.password}
        response = await client.post(
            f"{self.base_url}/login",
            json=payload,
            headers={"Accept": "application/json"},
            timeout=self.timeout,
        )
        if response.status_code != 200:
            raise UnicontaAuthFailed(
                f"Login başarısız ({response.status_code}): {response.text[:300]}"
            )
        body = response.json()
        if isinstance(body, str):
            # API string-error döndürüyor (örn "NoCompanyId")
            raise UnicontaAuthFailed(f"Uniconta login reddedildi: {body}")
        token = body.get("token")
        refresh = body.get("refreshToken")
        if not token or not refresh:
            raise UnicontaAuthFailed("Token alınamadı (response boş).")
        self._access_token = token
        self._access_expires_at = datetime.now(timezone.utc) + TOKEN_LIFETIME
        self._refresh_token = refresh
        expiry_raw = body.get("refreshTokenExpiry")
        if expiry_raw:
            try:
                normalized = expiry_raw.replace("Z", "+00:00")
                self._refresh_expires_at = datetime.fromisoformat(normalized)
            except ValueError:
                self._refresh_expires_at = (
                    datetime.now(timezone.utc) + REFRESH_LIFETIME_FALLBACK
                )
        else:
            self._refresh_expires_at = datetime.now(timezone.utc) + REFRESH_LIFETIME_FALLBACK
        LOGGER.info("Uniconta login OK (company=%s, user=%s)", self.company_id, self.username)

    async def _refresh_token_call(self, client: httpx.AsyncClient) -> None:
        if not self._refresh_token:
            await self._login(client)
            return
        if (
            self._refresh_expires_at
            and datetime.now(timezone.utc) >= self._refresh_expires_at
        ):
            await self._login(client)
            return
        # Uniconta /refresh body: refresh token string (JSON-encoded)
        import json as _json


        response = await client.post(
            f"{self.base_url}/refresh",
            content=_json.dumps(self._refresh_token),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=self.timeout,
        )
        if response.status_code != 200:
            LOGGER.warning(
                "Uniconta refresh failed (%s) — full login fallback", response.status_code
            )
            await self._login(client)
            return
        body = response.json()
        token = body.get("token") if isinstance(body, dict) else None
        if not token:
            await self._login(client)
            return
        self._access_token = token
        self._access_expires_at = datetime.now(timezone.utc) + TOKEN_LIFETIME
        new_refresh = body.get("refreshToken")
        if new_refresh:
            self._refresh_token = new_refresh
            expiry_raw = body.get("refreshTokenExpiry")
            if expiry_raw:
                try:
                    self._refresh_expires_at = datetime.fromisoformat(
                        expiry_raw.replace("Z", "+00:00")
                    )
                except ValueError:
                    pass

    async def ensure_token(self, client: httpx.AsyncClient) -> str:
        async with self._lock:
            now = datetime.now(timezone.utc)
            needs_login = (
                not self._access_token
                or not self._access_expires_at
                or now >= self._access_expires_at
            )
            if needs_login:
                if self._refresh_token:
                    await self._refresh_token_call(client)
                else:
                    await self._login(client)
            return self._access_token or ""

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """HTTP isteği — 401 re-auth, 5xx/timeout için exponential backoff.

        U13: Max 3 deneme; gecikme = min(MAX, BASE * 2^attempt) + küçük jitter.
        Sadece RETRYABLE_STATUS_CODES ve timeout/connection error retry edilir.
        """
        import random

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            url = f"{self.base_url}/{path.lstrip('/')}"

            last_exc: Exception | None = None
            last_response: httpx.Response | None = None

            for attempt in range(RETRY_MAX_ATTEMPTS):
                token = await self.ensure_token(client)
                headers = {
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                }
                try:
                    response = await client.request(
                        method, url, json=json_body, params=params, headers=headers
                    )
                except (httpx.TimeoutException, httpx.NetworkError) as exc:
                    last_exc = exc
                    last_response = None
                    if attempt < RETRY_MAX_ATTEMPTS - 1:
                        delay = min(
                            RETRY_MAX_DELAY_SEC,
                            RETRY_BASE_DELAY_SEC * (2 ** attempt),
                        ) + random.uniform(0, 0.25)
                        LOGGER.warning(
                            "Uniconta %s %s network error (%s), retry in %.2fs (attempt %d/%d)",
                            method, path, exc, delay, attempt + 1, RETRY_MAX_ATTEMPTS,
                        )
                        await asyncio.sleep(delay)
                        continue
                    raise UnicontaError(
                        f"Uniconta {method} {path}: ağ hatası ({exc})"
                    ) from exc

                if response.status_code == 401:
                    async with self._lock:
                        self._access_token = None
                        self._access_expires_at = None
                    # 401 retry — re-login, attempt counter ilerletmiyoruz
                    if attempt < RETRY_MAX_ATTEMPTS - 1:
                        continue
                    raise UnicontaError(
                        f"Uniconta {method} {path}: oturum yenileme başarısız (401)"
                    )

                if response.status_code in RETRYABLE_STATUS_CODES:
                    last_response = response
                    if attempt < RETRY_MAX_ATTEMPTS - 1:
                        delay = min(
                            RETRY_MAX_DELAY_SEC,
                            RETRY_BASE_DELAY_SEC * (2 ** attempt),
                        ) + random.uniform(0, 0.25)
                        LOGGER.warning(
                            "Uniconta %s %s status=%d, retry in %.2fs (attempt %d/%d)",
                            method, path, response.status_code, delay,
                            attempt + 1, RETRY_MAX_ATTEMPTS,
                        )
                        await asyncio.sleep(delay)
                        continue

                if response.status_code >= 400:
                    self._last_call_at = datetime.now(timezone.utc)
                    self._last_call_ok = False
                    raise UnicontaError(
                        f"Uniconta {method} {path} {response.status_code}: {response.text[:300]}"
                    )
                self._last_call_at = datetime.now(timezone.utc)
                self._last_call_ok = True
                if not response.content:
                    return None
                return response.json()

            # Loop bitti, hala fail
            self._last_call_at = datetime.now(timezone.utc)
            self._last_call_ok = False
            if last_response is not None:
                raise UnicontaError(
                    f"Uniconta {method} {path} {last_response.status_code} (retry exhausted): "
                    f"{last_response.text[:300]}"
                )
            if last_exc is not None:
                raise UnicontaError(f"Uniconta {method} {path}: ağ hatası ({last_exc})")
            raise UnicontaError(f"Uniconta {method} {path}: retry exhausted")

    async def query(
        self,
        entity: str,
        *,
        filters: list[dict[str, Any]] | None = None,
        top: int = 100,
        skip: int = 0,
        order_by_desc: bool = False,
    ) -> list[dict[str, Any]]:
        """Uniconta /Query/Get/{Entity}.

        Pagination Uniconta QueryFilter body'sinde (Skip+Take), URL query
        parametresi DEĞİL. En az bir QueryFilter objesi bulunmalı (filtersiz
        olsa bile boş dict yeterli).
        """
        body: list[dict[str, Any]] = list(filters) if filters else [{}]
        if not body:
            body = [{}]
        first = body[0] if isinstance(body[0], dict) else {}
        first.setdefault("Skip", skip)
        first.setdefault("Take", top)
        if order_by_desc:
            first.setdefault("OrderByDescending", True)
        body[0] = first
        result = await self._request("POST", f"/Query/Get/{entity}", json_body=body)
        if isinstance(result, list):
            return result
        return []

    async def get_company_info(self) -> dict[str, Any] | None:
        rows = await self.query("CompanyClient", top=1)
        return rows[0] if rows else None

    async def get_debtors(self, top: int = 200) -> list[dict[str, Any]]:
        return await self.query("DebtorClient", top=top)

    async def get_sale_invoices(self, top: int = 200) -> list[dict[str, Any]]:
        return await self.query("DebtorInvoiceClient", top=top)

    async def generate_debtor_invoice(
        self,
        *,
        order: dict[str, Any],
        lines: list[dict[str, Any]],
        invoice_date: datetime | None = None,
        simulate: bool = False,
        send_email: bool = False,
        send_xml: bool = False,
        order_number: int | None = None,
    ) -> dict[str, Any]:
        """Uniconta'da DebtorInvoice oluşturur ve sonuç JSON'unu döndürür.

        Endpoint: POST /Invoice/GenerateDebtorInvoice
        Body: DebtorInvoiceParameters
        Response: application/json — { InvoiceNumber, JournalPostedlId, Err, ErrorProperty, ErrorValue, ... }

        PDF için ayrı `get_invoice_pdf(invoice_number=..., account=..., date=...)`
        çağrılmalıdır (canlı kanıt: GenerateDebtorInvoice PDF dönmüyor).
        """
        body: dict[str, Any] = {
            "Order": order,
            "Lines": lines,
            "Date": (invoice_date or datetime.now(timezone.utc)).isoformat(),
            "Simulate": simulate,
            "SendEmail": send_email,
            "SendXML": send_xml,
        }
        if order_number is not None:
            body["OrderNumber"] = order_number

        async with httpx.AsyncClient(timeout=max(self.timeout, 60.0)) as client:
            token = await self.ensure_token(client)
            response = await client.post(
                f"{self.base_url}/Invoice/GenerateDebtorInvoice",
                json=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/pdf",
                    "Content-Type": "application/json",
                },
            )
            if response.status_code == 401:
                async with self._lock:
                    self._access_token = None
                token = await self.ensure_token(client)
                response = await client.post(
                    f"{self.base_url}/Invoice/GenerateDebtorInvoice",
                    json=body,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/pdf",
                        "Content-Type": "application/json",
                    },
                )
            if response.status_code >= 400:
                raise UnicontaError(
                    f"GenerateDebtorInvoice {response.status_code}: {response.text[:300]}"
                )
            try:
                result = response.json()
            except ValueError as exc:
                raise UnicontaError(
                    f"GenerateDebtorInvoice JSON parse hatası: {exc}; raw={response.text[:200]}"
                ) from exc
            err_code = result.get("Err") or 0
            if err_code:
                err_prop = result.get("ErrorProperty") or ""
                err_val = result.get("ErrorValue") or ""
                raise UnicontaError(
                    f"GenerateDebtorInvoice Err={err_code} property={err_prop!r} value={err_val!r}"
                )
            return result

    async def get_invoice_pdf(
        self,
        *,
        invoice_number: int | None = None,
        account: str | None = None,
        date: str | None = None,
        guid: str | None = None,
    ) -> bytes:
        """Var olan bir DebtorInvoice'ın PDF'ini Uniconta'dan çeker.

        Iki yol var:
          - guid varsa:   GET /Invoice/GetInvoicePDF/{guid}
          - aksi halde:   GET /Invoice/GetInvoicePDF?Account=&Date=&InvoiceNumber=
        """
        async with httpx.AsyncClient(timeout=max(self.timeout, 60.0)) as client:
            token = await self.ensure_token(client)
            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/pdf",
            }
            if guid:
                url = f"{self.base_url}/Invoice/GetInvoicePDF/{guid}"
                response = await client.get(url, headers=headers)
            else:
                if not (invoice_number and account and date):
                    raise UnicontaError(
                        "PDF çekmek için (guid) veya (account+date+invoice_number) gerek."
                    )
                response = await client.get(
                    f"{self.base_url}/Invoice/GetInvoicePDF",
                    params={
                        "Account": account,
                        "Date": date,
                        "InvoiceNumber": invoice_number,
                    },
                    headers=headers,
                )
            if response.status_code == 401:
                async with self._lock:
                    self._access_token = None
                token = await self.ensure_token(client)
                headers["Authorization"] = f"Bearer {token}"
                if guid:
                    response = await client.get(
                        f"{self.base_url}/Invoice/GetInvoicePDF/{guid}", headers=headers
                    )
                else:
                    response = await client.get(
                        f"{self.base_url}/Invoice/GetInvoicePDF",
                        params={
                            "Account": account,
                            "Date": date,
                            "InvoiceNumber": invoice_number,
                        },
                        headers=headers,
                    )
            if response.status_code >= 400:
                raise UnicontaError(
                    f"GetInvoicePDF {response.status_code}: {response.text[:300]}"
                )
            return _decode_pdf_response(response.content)

    async def test_connection(self) -> dict[str, Any]:
        """Login + company info fetch ile gerçek bağlantı testi.

        Returns: { ok, message, company, debtorCount?, invoiceCount? }
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                await self._login(client)
            except UnicontaCredentialsMissing as exc:
                return {"ok": False, "message": str(exc), "company": None}
            except UnicontaAuthFailed as exc:
                return {"ok": False, "message": str(exc), "company": None}
            except httpx.HTTPError as exc:
                return {
                    "ok": False,
                    "message": f"Uniconta'ya bağlanılamadı: {exc}",
                    "company": None,
                }
        try:
            company = await self.get_company_info()
        except UnicontaError as exc:
            return {
                "ok": False,
                "message": f"Login OK ama company verisi alınamadı: {exc}",
                "company": None,
            }
        company_name = (company or {}).get("CompanyName") or "—"
        return {
            "ok": True,
            "message": f"Uniconta bağlandı: {company_name}",
            "company": company,
        }


# ----- module-level cached client -----

_default_client: UnicontaClient | None = None


def get_uniconta_client() -> UnicontaClient:
    global _default_client
    if _default_client is None:
        _default_client = UnicontaClient()
    return _default_client


def reset_uniconta_client() -> None:
    """Settings (env) değişikliğinden sonra client cache'ini temizle.

    NOT: Process-singleton. Multi-worker uvicorn'da her worker'ın ayrı
    token + debtor cache'i olur. Prod'da `--workers 1` zorunlu veya
    Redis backed cache eklenmeli.
    """
    global _default_client
    _default_client = None
    _debtor_cache_invalidate()


# ----- CRM PosDocument → Uniconta DebtorInvoice sync orchestrator -----

DEFAULT_UNICONTA_CURRENCY = "DKK"
DEFAULT_UNICONTA_COUNTRY = 57  # Denmark

# U14 — DebtorClient cache. TTL 1h; ensure_debtor_for_customer her
# finalize'da Uniconta query yapmasın diye account lookup'ı cache'liyoruz.
_DEBTOR_CACHE_TTL = timedelta(hours=1)
_debtor_cache: dict[str, tuple[str, datetime]] = {}


def _debtor_cache_get(account: str) -> str | None:
    entry = _debtor_cache.get(account)
    if entry is None:
        return None
    cached_account, expires_at = entry
    if datetime.now(timezone.utc) >= expires_at:
        _debtor_cache.pop(account, None)
        return None
    return cached_account


def _debtor_cache_set(account: str) -> None:
    _debtor_cache[account] = (account, datetime.now(timezone.utc) + _DEBTOR_CACHE_TTL)


def _debtor_cache_invalidate(account: str | None = None) -> None:
    """Belirli account veya tüm cache'i temizle."""
    if account is None:
        _debtor_cache.clear()
    else:
        _debtor_cache.pop(account, None)


def _build_uniconta_account_for_customer(customer_id: str | int | None) -> str:
    """CRM customer_id'sinden Uniconta-friendly Account kodu üret."""
    if customer_id is None:
        return ""
    return f"CRM-{str(customer_id)[:30]}"


async def ensure_debtor_for_customer(
    client: "UnicontaClient",
    *,
    customer_id: str | None,
    name: str,
    phone: str | None = None,
    email: str | None = None,
    address: str | None = None,
    postal_code: str | None = None,
    city: str | None = None,
    cpr: str | None = None,
) -> str:
    """CRM müşterisini Uniconta'da Debtor olarak ensure et.

    Account = CRM-{customer_id}. Mevcut Debtor varsa olduğu gibi döner;
    yoksa Crud/Insert/DebtorClient ile yeni kayıt yaratır.

    U14: Hot-path cache (1h TTL) — son 1 saat içinde verify edilmiş
    Account'lar Uniconta'ya tekrar query atmaz.
    """
    account = _build_uniconta_account_for_customer(customer_id)
    if not account or not name:
        raise UnicontaError("Müşteri bilgileri eksik (id veya name).")
    # cache hit?
    if _debtor_cache_get(account):
        LOGGER.debug("DebtorClient cache hit: %s", account)
        return account
    # var mı kontrol
    try:
        rows = await client.query(
            "DebtorClient",
            filters=[{"PropertyName": "Account", "FilterValue": account}],
            top=1,
        )
    except UnicontaError:
        rows = []
    if rows:
        _debtor_cache_set(account)
        return account
    payload = {
        "Account": account,
        "Name": name[:200],
        "Currency": DEFAULT_UNICONTA_CURRENCY,
        "Country": DEFAULT_UNICONTA_COUNTRY,
        "VatZone": "Domestic",
    }
    if phone:
        payload["Phone"] = phone[:30]
    if email:
        payload["ContactEmail"] = email[:200]
        payload["InvoiceEmail"] = email[:200]
    if address:
        payload["Address1"] = address[:200]
    if postal_code:
        payload["ZipCode"] = postal_code[:20]
    if city:
        payload["City"] = city[:100]
    await client._request(
        "POST", "/Crud/Insert/DebtorClient", json_body=payload
    )
    _debtor_cache_set(account)
    return account


def _pos_line_net_offer_dkk(
    line: Any,
    *,
    trade_side: PosTradeSideEnum,
) -> Decimal | None:
    """Satırın kanonik net teklif tutarı (margin uygulanmış, 2dp ROUND_HALF_UP).

    DATA-001 invariantı: CRM net offer == TransactionLine total == AFG/PDF
    total == Uniconta line total. Kaynak doğruluk sırası:
      1) `line_offer_dkk` (CRM'in müşteriye gösterdiği, finalize'da TransactionLine
         ve PosDocument tutarının toplandığı kanonik alan),
      2) alan boşsa `calculate_offer` ile margin uygulanmış yeniden hesap.
    `rate_dkk` TEK BAŞINA ASLA kullanılmaz — margin-öncesi kurdur ve CRM/PDF
    tutarından øre seviyesinde sapar.
    """
    offer = getattr(line, "line_offer_dkk", None)
    if offer is not None:
        return quantize_2(to_decimal(offer))
    weight = getattr(line, "weight_grams", None)
    purity = getattr(line, "purity_percentage", None)
    rate = getattr(line, "rate_dkk", None)
    if weight is None or purity is None or rate is None:
        return None
    margin = getattr(line, "margin_percent_internal", None)
    return calculate_offer(
        weight_grams=to_decimal(weight),
        purity_percentage=to_decimal(purity),
        active_rate=to_decimal(rate),
        trade_side=trade_side,
        margin_percent=to_decimal(margin) if margin is not None else Decimal("0"),
    )


def build_uniconta_lines_from_pos_lines(
    pos_lines: list[Any],
    *,
    trade_side: PosTradeSideEnum | str | None = None,
) -> list[dict[str, Any]]:
    """CRM PosSessionLine list'inden Uniconta line payload'u inşa et.

    Free-text pattern: Item=None, Text + Qty + Price.

    DATA-001 parity: Uniconta line total'ı (Qty * Price) CRM satır net teklifiyle
    birebir aynı olmalı. Bu yüzden net offer hesaplanabildiğinde Qty=1 ve
    Price=margin-uygulanmış satır net tutarı gönderilir — böylece Uniconta'nın
    kendi Qty*Price yuvarlaması ne olursa olsun satır toplamı øre-paritelidir.
    Gram/karat detayı Text'te korunur.
    """
    resolved_side = safe_trade_side(trade_side) or PosTradeSideEnum.BUY_FROM_CUSTOMER
    out: list[dict[str, Any]] = []
    for line in pos_lines:
        metal = getattr(line, "metal_type", None)
        metal_name = getattr(metal, "value", str(metal or "")).lower()
        is_gold = "gold" in metal_name
        is_silver = "silver" in metal_name or "sølv" in metal_name
        label = "Guld" if is_gold else ("Sølv" if is_silver else "Vare")
        karat = getattr(line, "purity_karat", None)
        purity_pct = getattr(line, "purity_percentage", None)
        weight = getattr(line, "weight_grams", None) or 0
        rate = getattr(line, "rate_dkk", None) or 0
        karat_text = f"{karat}K" if karat else ""
        purity_text = f"{purity_pct}‰" if purity_pct else ""
        text_parts = [label, karat_text, purity_text, f"{weight}g"]
        text = " · ".join(p for p in text_parts if p)

        net_offer = _pos_line_net_offer_dkk(line, trade_side=resolved_side)
        if net_offer is not None:
            # Kanonik yol: Qty=1, Price=CRM satır net teklifi → øre parity garantili.
            out.append(
                {
                    "Item": None,
                    "Text": text,
                    "Qty": 1.0,
                    "Price": float(net_offer),
                }
            )
            continue

        # Legacy fallback (net offer hiç hesaplanamıyor): margin-uygulanmamış
        # kur üzerinden gram başına fiyat. Normal akışta buraya düşülmez.
        if rate:
            try:
                rate_value = float(rate)
            except (TypeError, ValueError):
                rate_value = 0.0
        else:
            rate_value = 0.0
        try:
            qty = float(weight)
        except (TypeError, ValueError):
            qty = 0.0
        out.append(
            {
                "Item": None,
                "Text": text,
                "Qty": qty,
                "Price": round(rate_value, 2),
            }
        )
    return out


async def sync_pos_document_to_uniconta(
    db_session: Any,
    pos_document: Any,
    *,
    pos_session: Any,
    pos_lines: list[Any] | None = None,
    pdf_cache_dir: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Finalize sonrası PosDocument'ı Uniconta'ya DebtorInvoice olarak gönderir.

    Hybrid mode: hata fırlatmaz; PosDocument.uniconta_sync_status üstünden
    sonuç gözlenir. Returns {ok, message, invoice_number?, pdf_path?}.

    Idempotency (R1):
      - Eğer `pos_document.uniconta_sync_status == 'synced'` ve invoice_number
        doluysa Uniconta'ya tekrar gönderim yapılmaz, mevcut bilgi döner.
      - `force=True` ile bu koruma bypass edilir (manuel override için).
    """
    from datetime import datetime as _dt
    from pathlib import Path as _Path

    # R1 — Idempotency guard
    existing_status = getattr(pos_document, "uniconta_sync_status", None)
    existing_invoice = getattr(pos_document, "uniconta_invoice_number", None)
    if not force and existing_status == "synced" and existing_invoice:
        LOGGER.info(
            "Uniconta sync skipped (idempotent): PosDocument seq=%s already synced as invoice=%s",
            pos_document.sequence_no,
            existing_invoice,
        )
        return {
            "ok": True,
            "message": "already synced (idempotent)",
            "invoice_number": existing_invoice,
            "pdf_path": getattr(pos_document, "uniconta_pdf_path", None),
            "idempotent": True,
        }

    client = get_uniconta_client()
    if not client.has_credentials:
        pos_document.uniconta_sync_status = "skipped"
        pos_document.uniconta_sync_error = "Uniconta credential'ları eksik."
        return {"ok": False, "message": "credentials missing"}

    try:
        # R2 — Customer zorunlu; AFG finalize zaten check ediyor, defansif fallback
        customer = getattr(pos_session, "customer", None)
        customer_id_raw = getattr(customer, "id", None) or getattr(pos_session, "customer_id", None)
        if not customer_id_raw:
            pos_document.uniconta_sync_status = "skipped"
            pos_document.uniconta_sync_error = (
                "Müşteri kimliği yok (PosSession.customer_id boş). Uniconta sync atlandı."
            )
            return {"ok": False, "message": "customer_id missing"}
        customer_id = str(customer_id_raw)
        name = (
            getattr(customer, "name", None)
            or pos_document.customer_name
            or "Müşteri"
        )
        phone = getattr(customer, "phone", None) or pos_document.customer_phone
        email = getattr(customer, "email", None) or pos_document.customer_email
        address = pos_document.customer_address
        postal = getattr(customer, "postal_code", None) if customer else None

        # R3 — City field: önce User.city varsa al; yoksa PosSession.notes'tan
        # `workspace_customer_city` JSON anahtarını oku (UI bunu doldurur).
        city = (getattr(customer, "city", None) if customer else None) or None
        if not city:
            notes_raw = getattr(pos_session, "notes", None)
            if notes_raw:
                try:
                    note_payload = _json.loads(notes_raw) if isinstance(notes_raw, str) else (notes_raw or {})
                    if isinstance(note_payload, dict):
                        city_val = note_payload.get("workspace_customer_city")
                        if city_val:
                            city = str(city_val).strip() or None
                except Exception:  # noqa: BLE001
                    city = None

        account = await ensure_debtor_for_customer(
            client,
            customer_id=customer_id,
            name=name,
            phone=phone,
            email=email,
            address=address,
            postal_code=postal,
            city=city,
        )

        invoice_date = _dt.now(timezone.utc).date().isoformat()
        order_payload: dict[str, Any] = {
            "Account": account,
            "Name": name[:200],
            "Date": invoice_date,
            "Currency": DEFAULT_UNICONTA_CURRENCY,
        }
        if address:
            order_payload["Address1"] = address[:200]
        if postal:
            order_payload["ZipCode"] = postal[:20]
        if city:
            order_payload["City"] = str(city)[:100]

        line_trade_side = safe_trade_side(getattr(pos_session, "trade_side", None))
        lines_payload = build_uniconta_lines_from_pos_lines(
            pos_lines or [],
            trade_side=line_trade_side or PosTradeSideEnum.BUY_FROM_CUSTOMER,
        )
        if not lines_payload:
            lines_payload = [
                {
                    "Item": None,
                    "Text": pos_document.notes or "AFG Satin Alma",
                    "Qty": 1.0,
                    "Price": float(pos_document.gross_amount_dkk or 0),
                }
            ]

        settings = get_settings()
        gen_result = await client.generate_debtor_invoice(
            order=order_payload,
            lines=lines_payload,
            invoice_date=_dt.now(timezone.utc),
            simulate=False,
            send_email=bool(getattr(settings, "uniconta_send_email_on_finalize", False)),
            send_xml=bool(getattr(settings, "uniconta_send_xml_on_finalize", False)),
        )
        raw_invoice_no = gen_result.get("InvoiceNumber")
        if raw_invoice_no is None:
            raise UnicontaError(
                f"GenerateDebtorInvoice InvoiceNumber yok: raw={gen_result!r}"
            )
        invoice_number = str(raw_invoice_no)

        # PDF'i ayrı endpoint'ten çek (GenerateDebtorInvoice PDF dönmüyor)
        pdf_path: str | None = None
        if pdf_cache_dir:
            try:
                pdf_bytes = await client.get_invoice_pdf(
                    invoice_number=int(raw_invoice_no),
                    account=account,
                    date=invoice_date,
                )
                if pdf_bytes and pdf_bytes[:5] == b"%PDF-":
                    target = _Path(pdf_cache_dir)
                    target.mkdir(parents=True, exist_ok=True)
                    fname = target / f"{invoice_number}.pdf"
                    fname.write_bytes(pdf_bytes)
                    pdf_path = str(fname)
                else:
                    LOGGER.warning(
                        "Uniconta PDF beklenmedik format (invoice=%s): magic=%r",
                        invoice_number,
                        pdf_bytes[:10] if pdf_bytes else None,
                    )
            except (UnicontaError, OSError) as exc:
                LOGGER.warning("PDF cache/fetch hatası (invoice=%s): %s", invoice_number, exc)

        pos_document.uniconta_sync_status = "synced"
        pos_document.uniconta_invoice_number = invoice_number
        pos_document.uniconta_account = account
        pos_document.uniconta_invoice_date = invoice_date
        pos_document.uniconta_pdf_path = pdf_path
        pos_document.uniconta_synced_at = _dt.now(timezone.utc)
        pos_document.uniconta_sync_error = None
        return {
            "ok": True,
            "message": "Uniconta DebtorInvoice oluşturuldu.",
            "invoice_number": invoice_number,
            "pdf_path": pdf_path,
        }
    except UnicontaError as exc:
        LOGGER.warning("Uniconta sync hatası (PosDoc %s): %s", pos_document.sequence_no, exc)
        pos_document.uniconta_sync_status = "failed"
        pos_document.uniconta_sync_error = str(exc)[:1000]
        return {"ok": False, "message": str(exc)}
    except Exception as exc:  # pragma: no cover - defansif
        LOGGER.exception("Uniconta sync beklenmedik hata")
        pos_document.uniconta_sync_status = "failed"
        pos_document.uniconta_sync_error = f"unexpected: {exc!s}"[:1000]
        return {"ok": False, "message": str(exc)}


# ----- Uniconta -> CRM fatura formatına dönüştürücü -----

def map_uniconta_invoice_to_dto(record: dict[str, Any]) -> dict[str, Any]:
    """Uniconta DebtorInvoiceClient kaydını frontend Fatura tipine yakın bir dict'e çevirir.

    Frontend schema (types.ts): fakturanummer, fakturadato, type, konto, kunde, total, valuta.
    """
    invoice_no_raw = record.get("InvoiceNumber") or record.get("Voucher") or record.get("PrimaryKeyId")
    date_raw = record.get("Date") or record.get("DueDate")
    if isinstance(date_raw, str) and "T" in date_raw:
        date_str = date_raw.split("T", 1)[0]
    else:
        date_str = str(date_raw or "")
    return {
        "id": str(record.get("PrimaryKeyId") or invoice_no_raw or ""),
        "fakturanummer": str(invoice_no_raw or ""),
        "ordrenummer": str(record.get("OrderNumber") or ""),
        "type": "Salgsfaktura",
        "fakturadato": date_str,
        "konto": str(record.get("Account") or ""),
        "kunde": {
            "id": str(record.get("Account") or ""),
            "navn": str(record.get("Name") or ""),
            "cvr": "",
            "email": "",
            "telefon": "",
            "adresse": "",
            "postnr": "",
        },
        "kalemler": [],
        "subtotal": float(record.get("NetAmount") or 0.0),
        "momsTotal": float(record.get("VatAmount") or 0.0),
        "total": float(record.get("TotalAmount") or 0.0),
        "valuta": "DKK",
        "unicontaRef": str(record.get("PrimaryKeyId") or ""),
    }
