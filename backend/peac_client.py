"""
PEAC Working Capital client.

Docs: no written API spec exists - this module is built directly from a
working Zoho CRM Deluge function (`Dev - Send_Lead_to_PEAC`) provided by the
client, saved at repo root in the gitignored folder
"4 - PEAC Channel iDea Zoho Reference". PEAC's API is a single-call
submission: business + owner details + every document (base64-encoded
inline) all go in one POST - there is no separate document-upload step,
which matches the client's own spec of one button ("Submit to PEAC").

Environment (backend/.env):
  PEAC_API_BASE_URL   — optional; default the host seen in the Zoho function
  PEAC_USERNAME        — Basic Auth username
  PEAC_PASSWORD        — Basic Auth password
  PEAC_API_KEY         — separate x-api-key header
  PEAC_PARTNER_ID      — partner id string
  PEAC_BROKER_NUMBER   — broker number string

None of these are set anywhere today — peac_configured() returns False until
they're deliberately added, which is the safety gate that keeps this module
from ever making a real call before the client is ready to test.
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_BASE = "https://devportal.marlincapitalsolutions.com:8077"

_ENTITY_TYPE_MAP = {
    "sole proprietorship": "Sole proprietorship",
    "sole prop": "Sole proprietorship",
    "llc": "Limited Liability Company (LLC)",
    "corporation": "Corporation",
    "corp": "Corporation",
}


def _base_url() -> str:
    return (os.getenv("PEAC_API_BASE_URL") or DEFAULT_BASE).rstrip("/")


def peac_configured() -> bool:
    return bool(
        os.getenv("PEAC_USERNAME")
        and os.getenv("PEAC_PASSWORD")
        and os.getenv("PEAC_API_KEY")
        and os.getenv("PEAC_PARTNER_ID")
    )


def _format_response_body(raw: bytes, content_type: str) -> str:
    if not raw:
        return "(empty)"
    try:
        text = raw.decode("utf-8")
        parsed = json.loads(text)
        formatted = json.dumps(parsed, indent=2)
        if len(formatted) > 4000:
            return formatted[:4000] + "\n... (truncated)"
        return formatted
    except (json.JSONDecodeError, UnicodeDecodeError):
        text = raw.decode(errors="replace")
        if len(text) > 2000:
            return text[:2000] + "\n... (truncated)"
        return text


def _auth_headers() -> dict[str, str]:
    username = os.getenv("PEAC_USERNAME") or ""
    password = os.getenv("PEAC_PASSWORD") or ""
    api_key = os.getenv("PEAC_API_KEY") or ""
    token = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
    return {"Authorization": f"Basic {token}", "x-api-key": api_key}


def _request(method: str, path: str, *, body: dict[str, Any], timeout: int = 120) -> tuple[int, bytes, str]:
    url = f"{_base_url()}{path}"
    data = json.dumps(body).encode()
    req = Request(url, data=data, method=method)
    for key, value in _auth_headers().items():
        req.add_header(key, value)
    req.add_header("Content-Type", "application/json")

    log_body = dict(body)
    if "Document Details" in log_body:
        log_body["Document Details"] = f"<{len(log_body['Document Details'])} document(s), base64 omitted>"
    print("\n" + "=" * 72)
    print(f"[PEAC] >>> {method} {url}")
    print(f"[PEAC] Request body: {json.dumps(log_body, indent=2)}")

    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            content_type = resp.headers.get("Content-Type", "")
            print(f"[PEAC] <<< {resp.status} {method}")
            print(f"[PEAC] Response body: {_format_response_body(raw, content_type)}")
            print("=" * 72 + "\n")
            return resp.status, raw, content_type
    except HTTPError as exc:
        err_body = exc.read()
        content_type = exc.headers.get("Content-Type", "") if exc.headers else ""
        print(f"[PEAC] <<< {exc.code} {method} (HTTP error)")
        print(f"[PEAC] Response body: {_format_response_body(err_body, content_type)}")
        print("=" * 72 + "\n")
        raise RuntimeError(f"PEAC API {exc.code}:\n{_format_response_body(err_body, content_type)}") from exc
    except URLError as exc:
        print(f"[PEAC] <<< UNREACHABLE {method}")
        print(f"[PEAC] Error: {exc}")
        print("=" * 72 + "\n")
        raise RuntimeError(f"PEAC API unreachable ({method} {path}): {exc}") from exc


def _build_business_details(business: dict[str, Any], owner: dict[str, Any]) -> dict[str, Any]:
    entity_type = _ENTITY_TYPE_MAP.get((business.get("entity_type") or "").strip().lower(), business.get("entity_type") or "")
    return {
        "Legal Business Name": business.get("legal_name", ""),
        "Business Tax ID": business.get("tax_id", ""),
        "Business Type": entity_type,
        "Business Address Line 1": business.get("billing_street", ""),
        "Business Address Line 2": "",
        "City": business.get("billing_city", ""),
        "State": business.get("billing_state", "CA"),
        "Zipcode": business.get("billing_postal_code", ""),
        "Business Phone": business.get("phone", ""),
        "Business Email": owner.get("email", ""),
        "Contact Name": f"{owner.get('first_name', '')} {owner.get('last_name', '')}".strip(),
        "Contact Phone": owner.get("phone", ""),
        "Phone Type": "Mobile",
    }


def _build_owner_details(owner: dict[str, Any]) -> dict[str, Any]:
    return {
        "Business Owner Name": f"{owner.get('first_name', '')} {owner.get('last_name', '')}".strip(),
        "Ownership": owner.get("ownership_percentage", 100),
        "Home Address Line 1": owner.get("mailing_street", ""),
        "City": owner.get("mailing_city", ""),
        "State": owner.get("mailing_state", ""),
        "Zipcode": owner.get("mailing_postal_code", ""),
        "Date of Birth": owner.get("date_of_birth", ""),
        "Social Security Number": owner.get("ssn", ""),
        "Business Owner Email": owner.get("email", ""),
        "Business Owner Phone": owner.get("phone", ""),
    }


def submit_application(
    business: dict[str, Any],
    owners: list[dict[str, Any]],
    loan: dict[str, Any],
    lead_id: str,
    files: list[tuple[str, bytes, str]],
) -> dict[str, Any]:
    """One-shot submission - business/owner details plus every document
    (base64-encoded inline) in a single POST. `files` is a list of
    (filename, data, document_type_label) - document_type_label matching
    PEAC's own conventions, e.g. "FS - Bank Statements - Jan" or
    "FS - Credit Application" (see the reference Deluge function)."""
    owner = owners[0] if owners else {}
    doc_list = [
        {
            "Attachment": filename,
            "FileDataEncoded": base64.b64encode(data).decode("ascii"),
            "FileExtension": ".pdf",
            "Document Type": doc_type,
            "Description": doc_type,
        }
        for filename, data, doc_type in files
    ]

    payload = {
        "PartnerId": os.getenv("PEAC_PARTNER_ID") or "",
        "Broker Number": os.getenv("PEAC_BROKER_NUMBER") or "",
        "Partner Reference Id": lead_id,
        "Business Details": _build_business_details(business, owner),
        "Amount Needed": str(loan.get("requested_amount") or ""),
        "Estimated Annual Revenue": str(loan.get("average_monthly_revenue") or ""),
        "Purpose of Loan": loan.get("loan_purpose") or "Expansion",
        "Owner Details": [_build_owner_details(owner)],
        "Document Details": doc_list,
    }

    _, raw, content_type = _request("POST", "/ws/rest/wcl/v1/createWclApi/", body=payload)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(f"PEAC submission returned invalid JSON:\n{_format_response_body(raw, content_type)}") from None

    status = str(data.get("Status", "")).lower()
    message = data.get("Message")
    if status in ("true", "success") or message == "Success":
        return {"ok": True, "raw": data}
    raise RuntimeError(f"PEAC API error: {message or json.dumps(data)}")


def describe_integration() -> dict[str, Any]:
    return {
        "configured": peac_configured(),
        "api_url": _base_url(),
        "username_set": bool(os.getenv("PEAC_USERNAME")),
        "partner_id_set": bool(os.getenv("PEAC_PARTNER_ID")),
    }
