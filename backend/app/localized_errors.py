from __future__ import annotations

from typing import Any
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_MESSAGES = {
    "tr": {
        "http.bad_request": "İstek geçersiz.", "http.unauthorized": "Kimlik doğrulama gerekli.",
        "http.forbidden": "Bu işlem için yetkiniz yok.", "http.not_found": "İstenen kayıt bulunamadı.",
        "http.conflict": "İşlem mevcut durumla çakışıyor.", "http.validation": "Girilen bilgiler doğrulanamadı.",
        "http.rate_limited": "Çok fazla istek gönderildi. Lütfen tekrar deneyin.",
        "http.dependency": "Bağlı servise şu anda ulaşılamıyor.", "http.error": "İşlem tamamlanamadı.",
    },
    "en": {
        "http.bad_request": "The request is invalid.", "http.unauthorized": "Authentication is required.",
        "http.forbidden": "You do not have permission for this action.", "http.not_found": "The requested record was not found.",
        "http.conflict": "The action conflicts with the current state.", "http.validation": "The submitted information could not be validated.",
        "http.rate_limited": "Too many requests were sent. Please try again.",
        "http.dependency": "The connected service is currently unavailable.", "http.error": "The action could not be completed.",
    },
    "da": {
        "http.bad_request": "Anmodningen er ugyldig.", "http.unauthorized": "Godkendelse er påkrævet.",
        "http.forbidden": "Du har ikke tilladelse til denne handling.", "http.not_found": "Den ønskede post blev ikke fundet.",
        "http.conflict": "Handlingen er i konflikt med den aktuelle status.", "http.validation": "De indtastede oplysninger kunne ikke valideres.",
        "http.rate_limited": "Der blev sendt for mange anmodninger. Prøv igen.",
        "http.dependency": "Der kan ikke oprettes forbindelse til den tilknyttede tjeneste.",
        "http.error": "Handlingen kunne ikke gennemføres.",
    },
}

def _locale(request: Request) -> str:
    accepted = request.headers.get("accept-language", "").lower()
    for part in accepted.split(","):
        short = part.strip().split(";")[0].split("-")[0]
        if short in _MESSAGES:
            return short
    return "tr"

def _code(status_code: int) -> str:
    return {
        400: "http.bad_request", 401: "http.unauthorized", 403: "http.forbidden",
        404: "http.not_found", 409: "http.conflict", 422: "http.validation",
        429: "http.rate_limited", 424: "http.dependency", 502: "http.dependency",
        503: "http.dependency", 504: "http.dependency",
    }.get(status_code, "http.error")

def install_localized_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def localized_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        locale, code, raw_detail = _locale(request), _code(exc.status_code), exc.detail
        if isinstance(raw_detail, dict) and raw_detail.get("code"):
            code = str(raw_detail["code"])
        if locale == "tr" and isinstance(raw_detail, str):
            message = raw_detail
        elif isinstance(raw_detail, dict) and locale == "tr" and raw_detail.get("message"):
            message = str(raw_detail["message"])
        else:
            message = _MESSAGES[locale].get(code, _MESSAGES[locale][_code(exc.status_code)])
        params = raw_detail.get("params", {}) if isinstance(raw_detail, dict) else {}
        if not isinstance(params, dict):
            params = {}
        headers = dict(exc.headers or {})
        headers["Content-Language"] = locale
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": message, "error": {"code": code, "message": message, "params": params}},
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def localized_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        locale, errors = _locale(request), exc.errors()
        detail: Any = errors if locale == "tr" else _MESSAGES[locale]["http.validation"]
        field = ".".join(str(part) for part in (errors[0].get("loc", []) if errors else []) if part != "body")
        message = detail if isinstance(detail, str) else _MESSAGES["tr"]["http.validation"]
        return JSONResponse(
            status_code=422,
            content={"detail": detail, "error": {
                "code": "http.validation", "message": message, "params": {"field": field} if field else {},
            }},
            headers={"Content-Language": locale},
        )
