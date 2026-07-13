"""One-off SendGrid test — run: python send_test_email.py"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

load_dotenv(Path(__file__).parent / ".env")

TO_EMAIL = "arslanahmad0397@gmail.com"
FROM_EMAIL = os.getenv("SENDGRID_FROM_EMAIL", TO_EMAIL).strip()
API_KEY = os.getenv("SENDGRID_API_KEY", "").strip()


def main() -> int:
    if not API_KEY:
        print("SENDGRID_API_KEY is missing from backend/.env")
        return 1
    if not FROM_EMAIL:
        print("SENDGRID_FROM_EMAIL is missing from backend/.env")
        return 1

    message = Mail(
        from_email=FROM_EMAIL,
        to_emails=TO_EMAIL,
        subject="VAT Portal — SendGrid test",
        html_content=(
            "<p>This is a test email from the <strong>VAT Submission Portal</strong>.</p>"
            "<p>If you received this, SendGrid is configured correctly.</p>"
        ),
    )

    try:
        client = SendGridAPIClient(API_KEY)
        response = client.send(message)
        print(f"Status: {response.status_code}")
        print(f"To: {TO_EMAIL}")
        print(f"From: {FROM_EMAIL}")
        if response.status_code in (200, 201, 202):
            print("SendGrid accepted the message. Check the inbox (and spam).")
            return 0
        print(f"Response body: {response.body}")
        return 1
    except Exception as exc:
        print(f"Send failed: {exc}")
        if hasattr(exc, "body"):
            print(f"Response body: {exc.body}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
