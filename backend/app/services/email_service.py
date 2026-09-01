"""R2-16/AFG-P2 — AFG tamamlandığında müşteriye otomatik e-posta (PDF ekli).

Transport seçimi `EMAIL_TRANSPORT` ile yapılır:
- ``wp-bridge``: seroguld.dk'daki (WordPress) ``/wp-json/seroguld/v1/send-afg-email``
  ucuna HTTP POST — mail kimlik bilgileri WordPress (WP Mail SMTP) tarafında
  kalır, CRM'e ASLA girmez. Websmtp.simply.com yalnız Simply sunucularından
  erişilebildiği için masaüstü CRM'in tek "şifresiz" gönderim yolu budur.
- ``smtp``: CRM'den direkt SMTP (Simply smtp.simply.com:587, auth zorunlu).
  Fallback: wp-bridge başarısızsa ve SMTP yapılandırılmışsa BİR KEZ SMTP denenir.

Şablon SABİT DANCA'dır (R2-09 kuralı). E-posta adresi yoksa veya transport
yapılandırılmamışsa gönderim SESSİZCE atlanır ve "gönderilmedi" notu döner —
finalize asla e-posta yüzünden başarısız olmaz. PDF, orijinal AFG düzeninde
(cpr_birth_part minimizasyonlu) üretilir.
"""

from __future__ import annotations

import base64
import logging
import smtplib
from email.message import EmailMessage

import httpx

from app.config import get_settings

LOGGER = logging.getLogger(__name__)

# Çeviri katmanı DIŞI — sabit Danca şablon.
AFG_EMAIL_SUBJECT_DA = "Sero Guld — afregningsbilag {document_number}"
AFG_EMAIL_BODY_DA = """Kære {customer_name},

Tak for din handel hos Sero Guld. Vedhæftet finder du dit afregningsbilag
({document_number}).

Med venlig hilsen
Sero Guld og Sølv ApS
Valby Langgade 84, 2500 Valby
Tlf.: 22255504 — info@seroguld.dk — www.seroguld.dk
"""

WP_BRIDGE_TIMEOUT_SECONDS = 20.0


def _bridge_configured() -> bool:
    settings = get_settings()
    return bool((settings.wp_bridge_url or "").strip() and (settings.wp_bridge_secret or "").strip())


def smtp_configured() -> bool:
    settings = get_settings()
    return bool(
        settings.afg_email_enabled
        and (settings.smtp_host or "").strip()
        and (settings.smtp_from_address or "").strip()
    )


def afg_email_transport_ready() -> bool:
    """En az bir transport kullanılabilir mi (finalize'in erken çıkış kapısı)."""
    settings = get_settings()
    if not settings.afg_email_enabled:
        return False
    transport = (settings.email_transport or "smtp").strip().lower()
    if transport == "wp-bridge":
        return _bridge_configured() or smtp_configured()  # bridge yoksa SMTP fallback
    return smtp_configured()


def _send_via_wp_bridge(
    *,
    to_address: str,
    customer_name: str,
    document_number: str,
    pdf_bytes: bytes | None,
) -> tuple[bool, str]:
    """WP bridge REST ucuna base64 PDF POST'lar; wp_mail + WP Mail SMTP gönderir."""
    settings = get_settings()
    payload = {
        "to": to_address.strip(),
        "customer_name": customer_name or "",
        "document_number": document_number,
        "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii") if pdf_bytes else "",
    }
    try:
        response = httpx.post(
            settings.wp_bridge_url,
            json=payload,
            headers={"X-SeroGuld-Bridge-Token": settings.wp_bridge_secret},
            timeout=WP_BRIDGE_TIMEOUT_SECONDS,
            follow_redirects=True,  # www↔apex / http→https alias'larında takılma
        )
    except Exception as exc:  # noqa: BLE001 — finalize'i asla düşürme
        LOGGER.warning("WP bridge'e ulaşılamadı (%s): %s", settings.wp_bridge_url, exc)
        return False, f"WP bridge erişim hatası: {exc}"
    if response.status_code == 200:
        return True, f"E-posta gönderildi (wp-bridge): {to_address.strip()}"
    detail = ""
    try:
        detail = str(response.json().get("error") or "")
    except Exception:  # noqa: BLE001
        detail = response.text[:200]
    return False, f"WP bridge HTTP {response.status_code}: {detail}"


def _send_via_smtp(
    *,
    to_address: str,
    customer_name: str,
    document_number: str,
    pdf_bytes: bytes | None,
) -> tuple[bool, str]:
    settings = get_settings()
    try:
        message = EmailMessage()
        message["Subject"] = AFG_EMAIL_SUBJECT_DA.format(document_number=document_number)
        message["From"] = settings.smtp_from_address
        message["To"] = to_address.strip()
        message.set_content(
            AFG_EMAIL_BODY_DA.format(customer_name=customer_name or "kunde", document_number=document_number)
        )
        if pdf_bytes:
            message.add_attachment(
                pdf_bytes,
                maintype="application",
                subtype="pdf",
                filename=f"afregningsbilag-{document_number}.pdf",
            )
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as client:
            client.starttls()
            if settings.smtp_username:
                client.login(settings.smtp_username, settings.smtp_password)
            client.send_message(message)
        return True, f"E-posta gönderildi (smtp): {to_address.strip()}"
    except Exception as exc:  # noqa: BLE001 — finalize'i asla düşürme
        LOGGER.warning("AFG e-posta gönderilemedi (%s): %s", to_address, exc)
        return False, f"E-posta gönderilemedi: {exc}"


def send_afg_email(
    *,
    to_address: str,
    customer_name: str,
    document_number: str,
    pdf_bytes: bytes | None,
) -> tuple[bool, str]:
    """(gönderildi_mi, sonuç_notu) döner; asla raise etmez.

    Transport: EMAIL_TRANSPORT=wp-bridge ise önce WP bridge; başarısızsa ve
    SMTP yapılandırılmışsa bir kez SMTP fallback. EMAIL_TRANSPORT=smtp ise
    yalnız SMTP.
    """
    settings = get_settings()
    if not settings.afg_email_enabled:
        return False, "AFG e-postası kapalı (AFG_EMAIL_ENABLED=false)."
    if not (to_address or "").strip():
        return False, "Müşterinin e-posta adresi yok."

    transport = (settings.email_transport or "smtp").strip().lower()
    if transport == "wp-bridge":
        if _bridge_configured():
            sent, note = _send_via_wp_bridge(
                to_address=to_address,
                customer_name=customer_name,
                document_number=document_number,
                pdf_bytes=pdf_bytes,
            )
            if sent:
                return sent, note
            if smtp_configured():
                LOGGER.info("WP bridge başarısız, SMTP fallback deneniyor: %s", note)
                return _send_via_smtp(
                    to_address=to_address,
                    customer_name=customer_name,
                    document_number=document_number,
                    pdf_bytes=pdf_bytes,
                )
            return sent, note
        if smtp_configured():
            return _send_via_smtp(
                to_address=to_address,
                customer_name=customer_name,
                document_number=document_number,
                pdf_bytes=pdf_bytes,
            )
        return False, "Ne WP bridge ne SMTP yapılandırılmış."
    return _send_via_smtp(
        to_address=to_address,
        customer_name=customer_name,
        document_number=document_number,
        pdf_bytes=pdf_bytes,
    )
