"""Aquamark process endpoint test (mocks remote API)."""

from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app

pdf = Path(__file__).resolve().parent.parent / "test-files" / "aquamark-test-3pages.pdf"
client = TestClient(app)

MOCK_ITEMS = [
    {
        "name": "Nationwide_Alpha_Deal1_t_Watermarked.pdf",
        "data": pdf.read_bytes(),
        "original": "t.pdf",
        "recipient": "Alpha",
    },
    {
        "name": "Nationwide_Beta_Deal1_t_Watermarked.pdf",
        "data": pdf.read_bytes(),
        "original": "t.pdf",
        "recipient": "Beta",
    },
]


def test_process_returns_recipients():
    with patch("main.aquamark_configured", return_value=True):
        with patch("main.process_batch", return_value=MOCK_ITEMS):
            res = client.post(
                "/api/aquamark/process",
                data={
                    "brand_name": "Nationwide",
                    "deal_name": "Deal1",
                    "aquamark_user_email": "christina@aquamark.io",
                    "recipients": '[{"name":"Alpha","email":"a@x.com"},{"name":"Beta","email":"b@x.com"}]',
                },
                files=[("files", ("t.pdf", pdf.read_bytes(), "application/pdf"))],
            ).json()

    assert res["ok"] is True
    assert res["source"] == "aquamark"
    assert len(res["files"]) == 2
    assert set(res["recipients"]) == {"Alpha", "Beta"}
    print("PASS", res["files"][0]["name"], res["files"][1]["name"])


def test_aquamark_error_no_fallback():
    with patch("main.aquamark_configured", return_value=True):
        with patch("main.process_batch", side_effect=RuntimeError("Aquamark API 402: Paid Subscription Required")):
            res = client.post(
                "/api/aquamark/process",
                data={
                    "brand_name": "Nationwide",
                    "deal_name": "Deal1",
                    "aquamark_user_email": "christina@aquamark.io",
                    "recipients": '[{"name":"Alpha","email":"a@x.com"}]',
                },
                files=[("files", ("t.pdf", pdf.read_bytes(), "application/pdf"))],
            )

    assert res.status_code == 502
    assert "Aquamark error" in res.json()["detail"]
    print("PASS error returned:", res.json()["detail"])


if __name__ == "__main__":
    test_process_returns_recipients()
    test_aquamark_error_no_fallback()
