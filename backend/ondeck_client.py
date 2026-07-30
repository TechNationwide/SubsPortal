"""
OnDeck Partner API client.

Docs: Full OnDeck Partner API Documentation.pdf (see repo root, gitignored
folder "1 - OnDeck"). Auth requires BOTH headers together (per the API
Partner FAQ): Authorization: Basic base64(username:password), and a
separate Apikey header.

Environment (backend/.env):
  ONDECK_API_BASE_URL — optional; default staging host
  ONDECK_USERNAME      — partner login username
  ONDECK_PASSWORD      — partner login password
  ONDECK_API_KEY       — separate numeric API key (Apikey header)

None of these are set anywhere today — ondeck_configured() returns False
until they're deliberately added, which is the safety gate that keeps this
module from ever making a real call before the client is ready to test.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

DEFAULT_BASE = "https://stagingpartners.ondeckcapital.com/api"

_ENTITY_TYPE_MAP = {
    "sole proprietorship": "SP",
    "sole prop": "SP",
    "llc": "LLC",
    "corporation": "CORP",
    "corp": "CORP",
    "general partnership": "GP",
    "limited partnership": "LP",
    "llp": "LLP",
    "trust": "TRST",
}


def _base_url() -> str:
    return (os.getenv("ONDECK_API_BASE_URL") or DEFAULT_BASE).rstrip("/")


def ondeck_configured() -> bool:
    return bool(
        os.getenv("ONDECK_USERNAME") and os.getenv("ONDECK_PASSWORD") and os.getenv("ONDECK_API_KEY")
    )


def _mask_auth_header(value: str) -> str:
    if value.startswith("Basic "):
        return "Basic ***"
    return "***"


def _format_headers(headers: Any) -> str:
    lines: list[str] = []
    for key, value in headers.items():
        display = _mask_auth_header(value) if key.lower() in ("authorization", "apikey") else value
        lines.append(f"  {key}: {display}")
    return "\n".join(lines) if lines else "  (none)"


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
    username = os.getenv("ONDECK_USERNAME") or ""
    password = os.getenv("ONDECK_PASSWORD") or ""
    api_key = os.getenv("ONDECK_API_KEY") or ""
    token = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
    return {"Authorization": f"Basic {token}", "Apikey": api_key}


def _multipart_body(
    fields: dict[str, str], files: list[tuple[str, str, bytes]]
) -> tuple[bytes, str]:
    """Builds a multipart/form-data body by hand (no `requests` dependency
    in this codebase). `files` is a list of (field_name, filename, data)."""
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    for field_name, filename, data in files:
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{field_name}"; '
            f'filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n'.encode()
            + data
            + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def _request(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    raw_body: bytes | None = None,
    content_type: str | None = None,
    query: dict[str, str] | None = None,
    timeout: int = 120,
) -> tuple[int, bytes, str]:
    url = f"{_base_url()}{path}"
    if query:
        qs = "&".join(f"{k}={quote(v)}" for k, v in query.items() if v)
        if qs:
            url = f"{url}?{qs}"

    data: bytes | None
    if raw_body is not None:
        data = raw_body
    elif body is not None:
        data = json.dumps(body).encode()
    else:
        data = None

    req = Request(url, data=data, method=method)
    for key, value in _auth_headers().items():
        req.add_header(key, value)
    if raw_body is not None and content_type:
        req.add_header("Content-Type", content_type)
    elif body is not None:
        req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")

    print("\n" + "=" * 72)
    print(f"[OnDeck] >>> {method} {url}")
    print("[OnDeck] Request headers:")
    print(_format_headers(req.headers))
    if body is not None:
        print("[OnDeck] Request body:")
        print(json.dumps(body, indent=2))

    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            resp_content_type = resp.headers.get("Content-Type", "")
            print(f"[OnDeck] <<< {resp.status} {method} {path}")
            print("[OnDeck] Response body:")
            print(_format_response_body(raw, resp_content_type))
            print("=" * 72 + "\n")
            return resp.status, raw, resp_content_type
    except HTTPError as exc:
        err_body = exc.read()
        resp_content_type = exc.headers.get("Content-Type", "") if exc.headers else ""
        print(f"[OnDeck] <<< {exc.code} {method} {path} (HTTP error)")
        print("[OnDeck] Response body:")
        print(_format_response_body(err_body, resp_content_type))
        print("=" * 72 + "\n")
        raise RuntimeError(
            f"OnDeck API {exc.code}:\n{_format_response_body(err_body, resp_content_type)}"
        ) from exc
    except URLError as exc:
        print(f"[OnDeck] <<< UNREACHABLE {method} {path}")
        print(f"[OnDeck] Error: {exc}")
        print("=" * 72 + "\n")
        raise RuntimeError(f"OnDeck API unreachable ({method} {path}): {exc}") from exc


def _address(street: str, city: str, state: str, postal_code: str) -> dict[str, str]:
    return {
        "addressLine1": street[:64],
        "city": city[:64],
        "state": state[:2].upper(),
        "zipCode": re.sub(r"[^0-9]", "", postal_code)[:5],
    }


def _build_business(business: dict[str, Any], loan_purpose: str) -> dict[str, Any]:
    return {
        "name": business["legal_name"][:120],
        "doingBusinessAs": (business.get("dba") or "")[:225],
        "phone": re.sub(r"[^0-9]", "", business.get("phone", ""))[:10],
        "taxID": re.sub(r"[^0-9]", "", business.get("tax_id", ""))[:9],
        "legalEntity": _ENTITY_TYPE_MAP.get((business.get("entity_type") or "").strip().lower(), "UNKNOWN"),
        "businessInceptionDate": business.get("business_start_date", ""),
        "industryNAICSCode": business.get("industry_naics_code", ""),
        "loanPurpose": loan_purpose[:50],
        "address": _address(
            business.get("billing_street", ""),
            business.get("billing_city", ""),
            business.get("billing_state", ""),
            business.get("billing_postal_code", ""),
        ),
    }


def _build_owner(owner: dict[str, Any]) -> dict[str, Any]:
    name = f"{owner['first_name']} {owner['last_name']}".strip()
    phone = re.sub(r"[^0-9]", "", owner.get("phone", ""))[:10]
    return {
        "name": name,
        "email": (owner.get("email") or "")[:80],
        "dateOfBirth": owner.get("date_of_birth", ""),
        "ssn": re.sub(r"[^0-9]", "", owner.get("ssn", ""))[:9],
        "cellPhoneNumber": phone,
        "homePhone": phone,
        "ownershipPercentage": int(owner.get("ownership_percentage") or 0),
        "homeAddress": _address(
            owner.get("mailing_street", ""),
            owner.get("mailing_city", ""),
            owner.get("mailing_state", ""),
            owner.get("mailing_postal_code", ""),
        ),
    }


def submit_application(
    business: dict[str, Any], owners: list[dict[str, Any]], loan: dict[str, Any], external_customer_id: str | None = None
) -> dict[str, Any]:
    """POST /v2/application — full underwriting submission.

    Raises ValueError (no network call made) if combined owner ownership is
    below 50%, since OnDeck auto-declines those applications — no sense
    burning a real submission on a guaranteed decline once live testing
    starts.
    """
    total_ownership = sum(float(o.get("ownership_percentage") or 0) for o in owners)
    if total_ownership < 50:
        raise ValueError(
            f"Combined owner ownership is {total_ownership:.0f}% — OnDeck requires "
            "at least 50% combined ownership among listed owners or the application "
            "will be auto-declined. Add another owner or correct the percentages."
        )

    revenue = loan.get("average_monthly_revenue")
    avg_balance = loan.get("average_daily_balance")
    if revenue is None or avg_balance is None:
        raise ValueError(
            "OnDeck requires both average monthly revenue and average daily balance "
            "for a full application submission."
        )

    payload = {
        "business": _build_business(business, loan.get("loan_purpose", "")),
        "owners": [_build_owner(o) for o in owners],
        "selfReported": {
            "revenue": revenue,
            "averageBalance": avg_balance,
            "desiredLoanAmount": loan.get("requested_amount"),
            "desiredLoanTerm": loan.get("desired_term_months"),
        },
    }
    if external_customer_id:
        # Lets OnDeck correlate a submission back to our own record if it
        # ever comes up in a support conversation - confirmed as a real
        # field from a working (if outdated/staging) Zoho function, not
        # currently required but harmless to include.
        payload["externalCustomerId"] = external_customer_id
    _, raw, content_type = _request("POST", "/v2/application", body=payload)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"OnDeck submit-application returned invalid JSON:\n{_format_response_body(raw, content_type)}"
        ) from None
    business_id = data.get("businessID")
    if not business_id:
        raise RuntimeError(f"OnDeck submit-application did not return a businessID:\n{json.dumps(data, indent=2)}")
    return {"business_id": business_id, "raw": data}


def upload_documents(
    business_id: str, files: list[tuple[str, bytes]], document_need: str = "CollectVerify"
) -> dict[str, Any]:
    """POST /v2/application/{businessID}/documents — multipart, one or more files.

    documentNeed only accepts 'CollectVerify' or 'Closing' (confirmed from a
    real 400 response) - "Bank Statements" was never a valid value here."""
    if not files:
        raise ValueError("At least one file is required for document upload.")
    body, content_type = _multipart_body(
        {},
        [("file", filename, data) for filename, data in files],
    )
    _, raw, resp_content_type = _request(
        "POST",
        f"/v2/application/{business_id}/documents",
        raw_body=body,
        content_type=content_type,
        query={"documentNeed": document_need},
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"OnDeck document upload returned invalid JSON:\n{_format_response_body(raw, resp_content_type)}"
        ) from None


def get_status(business_id: str) -> dict[str, Any]:
    _, raw, content_type = _request("GET", f"/v2/application/{business_id}/status")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"OnDeck status returned invalid JSON:\n{_format_response_body(raw, content_type)}"
        ) from None


def get_offer(business_id: str) -> dict[str, Any]:
    _, raw, content_type = _request("GET", f"/v2/application/{business_id}/offer")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"OnDeck offer returned invalid JSON:\n{_format_response_body(raw, content_type)}"
        ) from None


def describe_integration() -> dict[str, Any]:
    return {
        "configured": ondeck_configured(),
        "api_url": _base_url(),
        "username_set": bool(os.getenv("ONDECK_USERNAME")),
        "api_key_set": bool(os.getenv("ONDECK_API_KEY")),
        "docs": "https://stagingpartners.ondeckcapital.com/api-docs/documentation",
    }
