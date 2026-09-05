from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import UnknownHashError

from app.config import get_settings

settings = get_settings()

logger = logging.getLogger(__name__)
# bcrypt-sha256 prehashes UTF-8 input before bcrypt, so newly chosen desktop
# passwords are not subject to bcrypt's 72-byte limit.  Plain bcrypt remains
# accepted for databases created by older Sero Guld releases.
pwd_context = CryptContext(schemes=["bcrypt_sha256", "bcrypt"], deprecated="auto")


class TokenError(Exception):
    pass


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except (UnknownHashError, TypeError, ValueError):
        # A malformed/unsupported legacy row is an authentication failure,
        # never an unhandled 500 that masquerades as a backend outage.
        return False


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(subject: str, role: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_expire_minutes)
    payload = {
        "sub": subject,
        "role": role,
        "type": "access",
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_access_secret, algorithm="HS256")


def create_refresh_token(subject: str, role: str) -> str:
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(days=settings.jwt_refresh_expire_days)
    payload = {
        "sub": subject,
        "role": role,
        "type": "refresh",
        # Şifre değişimi, değişimden ÖNCE verilmiş refresh token'ları geçersiz
        # kılmak için kullanılır: auth.refresh, iat'ı user.password_changed_at
        # ile karşılaştırır (token_version alanı User şemasına eklenmeden aynı
        # garantiyi verir).
        "iat": int(issued_at.timestamp()),
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_refresh_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_access_secret, algorithms=["HS256"])
    except JWTError as exc:
        raise TokenError("Invalid access token") from exc
    if payload.get("type") != "access":
        raise TokenError("Invalid token type")
    return payload


def decode_refresh_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_refresh_secret, algorithms=["HS256"])
    except JWTError as exc:
        raise TokenError("Invalid refresh token") from exc
    if payload.get("type") != "refresh":
        raise TokenError("Invalid token type")
    return payload


def _aesgcm() -> AESGCM:
    return AESGCM(settings.encryption_key_bytes())


def encrypt_field(value: str | None) -> str | None:
    if value is None:
        return None
    nonce = secrets.token_bytes(12)
    ciphertext = _aesgcm().encrypt(nonce, value.encode("utf-8"), None)
    payload = {"n": base64.urlsafe_b64encode(nonce).decode("utf-8"), "c": base64.urlsafe_b64encode(ciphertext).decode("utf-8")}
    return base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")


def decrypt_field(value: str | None) -> str | None:
    """Decrypt an ``encrypt_field`` payload; corrupt/undecryptable rows yield None.

    A single malformed row (legacy format, key rotation, manual edit) must never
    turn every workspace/display/receipt/login flow that touches it into an
    unhandled 500 — the same convention as verify_password above.  Failures are
    logged as a warning with a content fingerprint so the affected rows can be
    located and re-encrypted, without ever writing plaintext or ciphertext to
    the log.
    """

    if not value:
        return None
    try:
        decoded = base64.urlsafe_b64decode(value.encode("utf-8"))
        payload = json.loads(decoded.decode("utf-8"))
        nonce = base64.urlsafe_b64decode(payload["n"].encode("utf-8"))
        ciphertext = base64.urlsafe_b64decode(payload["c"].encode("utf-8"))
        plaintext = _aesgcm().decrypt(nonce, ciphertext, None)
        return plaintext.decode("utf-8")
    except (ValueError, KeyError, TypeError, InvalidTag) as exc:
        # binascii.Error/JSONDecodeError/UnicodeDecodeError are ValueError
        # subclasses; InvalidTag covers AES-GCM authentication failure.
        fingerprint = hashlib.sha256(value.encode("utf-8", "replace")).hexdigest()[:12]
        logger.warning(
            "decrypt_field failed for encrypted value (fingerprint=%s, length=%d): %s",
            fingerprint,
            len(value),
            exc,
        )
        return None


def hash_sensitive_value(value: str | None) -> str | None:
    if not value:
        return None
    digest = hmac.new(settings.encryption_key_bytes(), value.encode("utf-8"), hashlib.sha256)
    return digest.hexdigest()


def mask_last4(value: str | None) -> str | None:
    if not value:
        return None
    clean = "".join(ch for ch in value if ch.isalnum())
    if not clean:
        return None
    if len(clean) <= 4:
        return "*" * len(clean)
    return "*" * (len(clean) - 4) + clean[-4:]


def hash_cpr(cpr_number: str | None) -> str | None:
    return hash_sensitive_value(cpr_number)


def mask_cpr(cpr_number: str | None) -> str | None:
    return mask_last4(cpr_number)
