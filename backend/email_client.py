"""SendGrid email delivery for deal submission emails."""

from __future__ import annotations

import base64
import html
import os
import re
from typing import Any

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import (
    Attachment,
    Cc,
    Content,
    Disposition,
    Email,
    FileContent,
    FileName,
    FileType,
    Mail,
    To,
)

_EMAIL_SPLIT = re.compile(r"[,;]")


def sendgrid_configured() -> bool:
    return bool(os.getenv("SENDGRID_API_KEY", "").strip())


def parse_recipients(value: str) -> list[str]:
    return [part.strip() for part in _EMAIL_SPLIT.split(value or "") if part.strip()]


def send_email(
    *,
    from_email: str,
    to_email: str,
    cc: str = "",
    subject: str,
    body: str,
    attachments: list[tuple[str, bytes]] | None = None,
) -> dict[str, Any]:
    api_key = os.getenv("SENDGRID_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("SendGrid is not configured. Set SENDGRID_API_KEY in backend/.env.")

    sender = from_email.strip()
    recipient = to_email.strip()
    if not sender:
        raise ValueError("From email is required.")
    if not recipient:
        raise ValueError("To email is required.")

    message = Mail(
        from_email=Email(sender),
        to_emails=To(recipient),
        subject=subject.strip() or "NEW DEAL",
    )

    text = body.strip() or "Please Underwrite"
    message.add_content(Content("text/plain", text))
    message.add_content(
        Content(
            "text/html",
            f'<pre style="font-family:inherit;white-space:pre-wrap">{html.escape(text)}</pre>',
        )
    )

    cc_list = parse_recipients(cc)
    if cc_list:
        message.cc = [Cc(addr) for addr in cc_list]

    for filename, data in attachments or []:
        if not data:
            continue
        encoded = base64.b64encode(data).decode()
        attachment = Attachment()
        attachment.file_content = FileContent(encoded)
        attachment.file_name = FileName(filename)
        attachment.file_type = FileType("application/pdf")
        attachment.disposition = Disposition("attachment")
        message.add_attachment(attachment)

    client = SendGridAPIClient(api_key)
    response = client.send(message)
    if response.status_code not in (200, 201, 202):
        raise RuntimeError(f"SendGrid returned {response.status_code}: {response.body}")

    return {"status_code": response.status_code}
