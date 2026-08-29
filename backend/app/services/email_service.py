"""R2-16 — AFG tamamlandığında müşteriye otomatik e-posta (afregningsbilag PDF ekli).

Gönderim seroguld.dk'nın Simply SMTP hesabıyla yapılır; kimlik bilgileri
Ayarlar'da tutulur. Şablon SABİT DANCA'dır ve çeviri katmanının dışındadır
(R2-09 ile aynı kural). E-posta adresi yoksa veya SMTP yapılandırılmamışsa
gönderim SESSİZCE atlanır ve belge geçmişine "gönderilmedi" düşülür — finalize
asla e-posta yüzünden başarısız olmaz. PDF'te CPR maskeli üretilir (GDPR).
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

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


def smtp_configured() -> bool:
    settings = get_settings()
    return bool(
        settings.afg_email_enabled
        and (settings.smtp_host or "").strip()
        and (settings.smtp_from_address or "").strip()
    )


def send_afg_email(
    *,
    to_address: str,
    customer_name: str,
    document_number: str,
    pdf_bytes: bytes | None,
) -> tuple[bool, str]:
    """(gönderildi_mi, sonuç_notu) döner; asla raise etmez."""
    settings = get_settings()
    if not smtp_configured():
        return False, "SMTP yapılandırılmamış (Ayarlar → e-posta)."
    if not (to_address or "").strip():
        return False, "Müşterinin e-posta adresi yok."
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
        return True, f"E-posta gönderildi: {to_address.strip()}"
    except Exception as exc:  # noqa: BLE001 — finalize'i asla düşürme
        LOGGER.warning("AFG e-posta gönderilemedi (%s): %s", to_address, exc)
        return False, f"E-posta gönderilemedi: {exc}"
