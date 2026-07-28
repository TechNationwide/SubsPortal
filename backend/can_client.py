"""
CAN Capital Partner API client.

Docs: CLSI-Partner API External Documentation.pdf + the AJ Nationwide
pre-prod doc (see repo root, gitignored folder
"2 - CAN -Processing AJ Nationwide"). OAuth 2.0 Bearer token, 60-minute
expiry, cached in-process (safe: this app runs as a single pm2 process,
no cluster mode).

Environment (backend/.env):
  CAN_API_BASE_URL — optional; default sandbox host
  CAN_EMAIL         — partner login email
  CAN_PASSWORD      — partner login password

Neither is set anywhere today — can_configured() returns False until
they're deliberately added, which is the safety gate that keeps this
module from ever making a real call before the client is ready to test.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_BASE = "https://partner-api-sandbox.cancapital.com"
MAX_DOCUMENT_BYTES = 12 * 1024 * 1024

_token_cache: dict[str, Any] = {"token": None, "expires_at": 0.0}


def _base_url() -> str:
    return (os.getenv("CAN_API_BASE_URL") or DEFAULT_BASE).rstrip("/")


def can_configured() -> bool:
    return bool(os.getenv("CAN_EMAIL") and os.getenv("CAN_PASSWORD"))


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


def _mask_token(token: str) -> str:
    if len(token) <= 8:
        return "Bearer ***"
    return f"Bearer ...{token[-4:]}"


def _raw_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    data: bytes | None = None,
    timeout: int = 120,
    log_label: str = "CAN",
) -> tuple[int, bytes, str]:
    req = Request(url, data=data, method=method)
    for key, value in headers.items():
        req.add_header(key, value)

    print("\n" + "=" * 72)
    print(f"[{log_label}] >>> {method} {url}")
    log_headers = {
        k: (_mask_token(v[7:]) if k.lower() == "authorization" and v.startswith("Bearer ") else v)
        for k, v in headers.items()
    }
    print(f"[{log_label}] Request headers: {log_headers}")

    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            content_type = resp.headers.get("Content-Type", "")
            print(f"[{log_label}] <<< {resp.status} {method}")
            print(f"[{log_label}] Response body:")
            print(_format_response_body(raw, content_type))
            print("=" * 72 + "\n")
            return resp.status, raw, content_type
    except HTTPError as exc:
        err_body = exc.read()
        content_type = exc.headers.get("Content-Type", "") if exc.headers else ""
        print(f"[{log_label}] <<< {exc.code} {method} (HTTP error)")
        print(f"[{log_label}] Response body:")
        print(_format_response_body(err_body, content_type))
        print("=" * 72 + "\n")
        raise RuntimeError(
            f"CAN Capital API {exc.code}:\n{_format_response_body(err_body, content_type)}"
        ) from exc
    except URLError as exc:
        print(f"[{log_label}] <<< UNREACHABLE {method}")
        print(f"[{log_label}] Error: {exc}")
        print("=" * 72 + "\n")
        raise RuntimeError(f"CAN Capital API unreachable ({method} {url}): {exc}") from exc


def _fetch_token() -> tuple[str, float]:
    email = os.getenv("CAN_EMAIL") or ""
    password = os.getenv("CAN_PASSWORD") or ""
    body = json.dumps({"email": email, "password": password}).encode()
    _, raw, _ = _raw_request(
        "POST",
        f"{_base_url()}/api/auth/token",
        headers={"Content-Type": "application/json"},
        data=body,
    )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError("CAN Capital token response was not valid JSON.") from None
    details = data.get("details") or {}
    token = details.get("Token")
    if not token:
        raise RuntimeError(f"CAN Capital token request failed:\n{json.dumps(data, indent=2)}")
    expires_in = float(details.get("ExpiresIn") or 3600)
    return token, time.monotonic() + expires_in


def _get_token(*, force_refresh: bool = False) -> str:
    if not force_refresh and _token_cache["token"] and time.monotonic() < _token_cache["expires_at"] - 60:
        return _token_cache["token"]
    token, expires_at = _fetch_token()
    _token_cache["token"] = token
    _token_cache["expires_at"] = expires_at
    return token


def _authed_request(
    method: str, path: str, *, body: dict[str, Any] | None = None, content_type: str = "application/json"
) -> tuple[int, bytes, str]:
    """Authenticated call to CAN's own API (not the Wasabi upload host).
    Retries once with a fresh token on a 401 (handles clock-drift expiry)."""
    url = f"{_base_url()}{path}"
    data = json.dumps(body).encode() if body is not None else None
    token = _get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": content_type}
    try:
        return _raw_request(method, url, headers=headers, data=data)
    except RuntimeError as exc:
        if "CAN Capital API 401" not in str(exc):
            raise
        token = _get_token(force_refresh=True)
        headers["Authorization"] = f"Bearer {token}"
        return _raw_request(method, url, headers=headers, data=data)


def create_application(
    business: dict[str, Any],
    owner: dict[str, Any],
    loan: dict[str, Any],
    rep_name: str,
    rep_email: str,
) -> dict[str, Any]:
    """POST /api/can/createapplication — uses owners[0] only (CAN's schema
    has a single primary contact, unlike OnDeck's up-to-2-owner model)."""
    payload = {
        "loanDetails": {
            "loanPurpose": loan.get("loan_purpose", ""),
            "loanAmount": f"{float(loan.get('requested_amount') or 0):.2f}",
        },
        "partnerDetails": {
            "brokerSalesRepName": rep_name,
            "brokerSalesRepEmail": rep_email,
        },
        "accountDetails": {
            "name": business["legal_name"],
            "phone": business.get("phone", ""),
            "industry": business.get("industry_naics_code") or "Other",
            "taxId": business.get("tax_id", ""),
            "dba": business.get("dba") or business["legal_name"],
            "businessStructureName": business.get("entity_type", ""),
            "stateOfFormation": business.get("state_of_formation", ""),
            "bizStartDate": business.get("business_start_date", ""),
            "billingStreet": business.get("billing_street", ""),
            "billingBuildingNumber": "",
            "billingCity": business.get("billing_city", ""),
            "billingState": business.get("billing_state", ""),
            "billingPostalCode": business.get("billing_postal_code", ""),
            "billingCountry": business.get("billing_country", "US"),
        },
        "contactDetails": [
            {
                "title": owner.get("title") or "Owner",
                "firstName": owner["first_name"],
                "lastName": owner["last_name"],
                "email": owner.get("email", ""),
                "phone": owner.get("phone", ""),
                "birthDate": owner.get("date_of_birth", ""),
                "socialSecurityNumber": owner.get("ssn", ""),
                "mailingStreet": owner.get("mailing_street", ""),
                "mailingBuildingNumber": "",
                "mailingCity": owner.get("mailing_city", ""),
                "mailingState": owner.get("mailing_state", ""),
                "mailingCountry": owner.get("mailing_country", "US"),
                "mailingPostalCode": owner.get("mailing_postal_code", ""),
            }
        ],
    }
    _, raw, content_type = _authed_request("POST", "/api/can/createapplication", body=payload)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"CAN createapplication returned invalid JSON:\n{_format_response_body(raw, content_type)}"
        ) from None
    entry = data[0] if isinstance(data, list) and data else {}
    application_name = (entry.get("ApplicationDetails") or {}).get("Name")
    if not application_name:
        raise RuntimeError(f"CAN createapplication did not return an application name:\n{json.dumps(data, indent=2)}")
    return {"application_name": application_name, "raw": data}


def upload_document(
    application_name: str,
    filename: str,
    data: bytes,
    document_type: str = "Bank Statements",
) -> dict[str, Any]:
    """Two-step upload: request a presigned URL, then POST the raw bytes
    directly to Wasabi. The presigned URL is short-lived (10 min) and is
    never persisted."""
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValueError(
            f"{filename} is {len(data) / 1024 / 1024:.1f}MB — CAN Capital's limit is 12MB per document."
        )

    _, raw, content_type = _authed_request(
        "POST",
        "/api/can/uploaddocs",
        body={"application": application_name, "documentType": document_type, "documentName": filename},
        content_type="text/plain",
    )
    try:
        resp = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"CAN uploaddocs returned invalid JSON:\n{_format_response_body(raw, content_type)}"
        ) from None

    presigned = ((resp.get("response") or {}).get("presigned_url")) or {}
    upload_url = presigned.get("url")
    fields = presigned.get("fields") or {}
    if not upload_url or not fields.get("key"):
        raise RuntimeError(f"CAN uploaddocs did not return a usable presigned URL:\n{json.dumps(resp, indent=2)}")

    # S3-style POST policy uploads require the file field last, after all
    # other policy fields, per AWS/Wasabi convention shown in the CLSI doc.
    # Wasabi actually returns SigV4 fields (x-amz-algorithm/credential/date +
    # policy + x-amz-signature), not the SigV2 shape (AWSAccessKeyId/signature)
    # originally assumed here - hardcoding those SigV2 names sent an
    # unsigned-looking request that Wasabi rejected mid-upload (surfaced as
    # a broken pipe once we started streaming the file body). Forwarding
    # whatever fields the presigned response actually contains keeps this
    # correct regardless of which signing scheme is in play.
    boundary = uuid.uuid4().hex
    ordered_fields = [("key", fields["key"])]
    ordered_fields += [(k, v) for k, v in fields.items() if k != "key"]
    ordered_fields.append(("Content-Type", "application/pdf"))
    parts: list[bytes] = []
    for name, value in ordered_fields:
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/pdf\r\n\r\n".encode()
        + data
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)

    status, _, _ = _raw_request(
        "POST",
        upload_url,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        data=body,
        log_label="CAN-Wasabi",
    )
    return {"ok": status in (200, 204), "status": status, "key": fields["key"]}


def process_application(application_name: str, consent_accepted: bool) -> dict[str, Any]:
    if consent_accepted is not True:
        raise ValueError("CAN Capital requires explicit consent (consent_accepted=True) to process an application.")
    _, raw, content_type = _authed_request(
        "POST",
        "/api/can/processapplication",
        body={"application": application_name, "consentAccepted": True},
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"CAN processapplication returned invalid JSON:\n{_format_response_body(raw, content_type)}"
        ) from None


def get_application_status(application_name: str) -> dict[str, Any]:
    _, raw, content_type = _authed_request("GET", f"/api/can/applicationstatus?application={application_name}")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"CAN applicationstatus returned invalid JSON:\n{_format_response_body(raw, content_type)}"
        ) from None


def calculate_pricing(application_name: str, term: int) -> dict[str, Any]:
    _, raw, content_type = _authed_request(
        "GET", f"/api/can/calculatepricing?application={application_name}&term={term}"
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"CAN calculatepricing returned invalid JSON:\n{_format_response_body(raw, content_type)}"
        ) from None


def describe_integration() -> dict[str, Any]:
    return {
        "configured": can_configured(),
        "api_url": _base_url(),
        "email_set": bool(os.getenv("CAN_EMAIL")),
    }
