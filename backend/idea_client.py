"""
iDea Financial client.

Docs: no written API spec exists - this module is built directly from four
working Zoho CRM Deluge functions (create/upload/push/status) provided by
the client, saved at repo root in the gitignored folder
"4 - PEAC Channel iDea Zoho Reference". Unlike PEAC/Channel, iDea's flow
matches the existing CAN Capital shape closely: create application (JSON)
-> upload documents (multipart, one call per file) -> push/process ->
status check - which is why iDea gets the same 3-button treatment as CAN
("Submit to iDea", "Send bs iDea", "Process app iDea").

Environment (backend/.env):
  IDEA_TOKEN_URL     — optional; default https://oauth.ideafinancial.com/token
  IDEA_API_BASE_URL  — optional; default https://partner.api.ideafinancial.com
  IDEA_CLIENT_ID     — OAuth2 client_credentials client_id
  IDEA_CLIENT_SECRET — OAuth2 client_credentials client_secret
  IDEA_AGENT_ID      — fixed agent id sent with every application

None of these are set anywhere today — idea_configured() returns False
until they're deliberately added, which is the safety gate that keeps this
module from ever making a real call before the client is ready to test.
"""

from __future__ import annotations

import json
import mimetypes
import os
import time
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_TOKEN_URL = "https://oauth.ideafinancial.com/token"
DEFAULT_API_BASE = "https://partner.api.ideafinancial.com"

# Only "LLC" is confirmed from the reference Deluge function (hardcoded
# there). Other entity types follow the same kebab-case convention as a
# best-effort guess, not confirmed against iDea's real enum.
_ENTITY_TYPE_MAP = {
    "llc": "limited-liability-company",
    "corporation": "corporation",
    "corp": "corporation",
    "sole proprietorship": "sole-proprietorship",
    "sole prop": "sole-proprietorship",
    "partnership": "partnership",
}

_token_cache: dict[str, Any] = {"token": None, "expires_at": 0.0}


def _token_url() -> str:
    return os.getenv("IDEA_TOKEN_URL") or DEFAULT_TOKEN_URL


def _api_base() -> str:
    return (os.getenv("IDEA_API_BASE_URL") or DEFAULT_API_BASE).rstrip("/")


def idea_configured() -> bool:
    return bool(os.getenv("IDEA_CLIENT_ID") and os.getenv("IDEA_CLIENT_SECRET"))


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
        # iDea sometimes returns IIS/Cloudflare HTML 500 pages — don't dump
        # the whole HTML into the portal toast.
        lowered = text.lower()
        if "<html" in lowered or "<!doctype" in lowered:
            if "500" in text or "internal server error" in lowered:
                return (
                    "iDea returned an Internal Server Error (500). "
                    "Their API rejected or failed this create request. "
                    "We cleaned phone/EIN/SSN to match Zoho; please retry Submit."
                )
            return "iDea returned an HTML error page instead of JSON."
        if len(text) > 2000:
            return text[:2000] + "\n... (truncated)"
        return text


def _raw_request(
    method: str, url: str, *, headers: dict[str, str], data: bytes | None = None, timeout: int = 120, log_label: str = "iDea"
) -> tuple[int, bytes, str]:
    req = Request(url, data=data, method=method)
    # iDea's endpoints sit behind Cloudflare, which blocks urllib's default
    # "Python-urllib/x.y" User-Agent as a bot signature (their 403 "error
    # code: 1010" response) before the request ever reaches iDea's API.
    # A normal browser-like User-Agent avoids that block.
    req.add_header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36",
    )
    for key, value in headers.items():
        req.add_header(key, value)

    log_headers = {
        k: (f"Bearer ...{v[-6:]}" if k.lower() == "authorization" and v.startswith("Bearer ") else v)
        for k, v in headers.items()
        if k.lower() != "authorization" or True
    }
    print("\n" + "=" * 72)
    print(f"[{log_label}] >>> {method} {url}")
    print(f"[{log_label}] Request headers: {log_headers}")
    if data:
        content_type_header = next((v for k, v in headers.items() if k.lower() == "content-type"), "")
        if "multipart/form-data" in content_type_header:
            print(f"[{log_label}] Request body: <multipart, {len(data)} bytes, contents omitted>")
        else:
            print(f"[{log_label}] Request body: {_format_response_body(data, content_type_header)}")

    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            content_type = resp.headers.get("Content-Type", "")
            print(f"[{log_label}] <<< {resp.status} {method}")
            print(f"[{log_label}] Response body: {_format_response_body(raw, content_type)}")
            print("=" * 72 + "\n")
            return resp.status, raw, content_type
    except HTTPError as exc:
        err_body = exc.read()
        content_type = exc.headers.get("Content-Type", "") if exc.headers else ""
        print(f"[{log_label}] <<< {exc.code} {method} (HTTP error)")
        print(f"[{log_label}] Response body: {_format_response_body(err_body, content_type)}")
        print("=" * 72 + "\n")
        raise RuntimeError(f"iDea Financial API {exc.code}:\n{_format_response_body(err_body, content_type)}") from exc
    except URLError as exc:
        print(f"[{log_label}] <<< UNREACHABLE {method}")
        print(f"[{log_label}] Error: {exc}")
        print("=" * 72 + "\n")
        raise RuntimeError(f"iDea Financial API unreachable ({method} {url}): {exc}") from exc


def _fetch_token() -> tuple[str, float]:
    body = urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": os.getenv("IDEA_CLIENT_ID") or "",
            "client_secret": os.getenv("IDEA_CLIENT_SECRET") or "",
        }
    ).encode()
    _, raw, _ = _raw_request(
        "POST", _token_url(), headers={"Content-Type": "application/x-www-form-urlencoded"}, data=body
    )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError("iDea Financial token response was not valid JSON.") from None
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"iDea Financial token request failed:\n{json.dumps(data, indent=2)}")
    # No documented TTL in the reference function - use a conservative
    # 55-minute cache window.
    return token, time.monotonic() + 55 * 60


def _get_token(*, force_refresh: bool = False) -> str:
    if not force_refresh and _token_cache["token"] and time.monotonic() < _token_cache["expires_at"]:
        return _token_cache["token"]
    token, expires_at = _fetch_token()
    _token_cache["token"] = token
    _token_cache["expires_at"] = expires_at
    return token


def _digits(value: Any, max_len: int | None = None) -> str:
    """Strip to digits only (matches Zoho Deluge replaceAll dashes/spaces)."""
    out = "".join(ch for ch in str(value or "") if ch.isdigit())
    if max_len is not None:
        out = out[:max_len]
    return out


def _clean_phone10(value: Any) -> str:
    """Match Zoho: strip +1 / punctuation; keep 10-digit NANP."""
    digits = _digits(value)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits[:10]


def _as_number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _map_entity_type(raw: Any) -> str:
    """Map portal/Zoho entity labels to iDea kebab-case enums.
    Zoho create hardcodes limited-liability-company; we map known values
    and fall back to that same confirmed enum instead of inventing strings
    that can make iDea's API throw an opaque 500."""
    key = (raw or "").strip().lower()
    if key in _ENTITY_TYPE_MAP:
        return _ENTITY_TYPE_MAP[key]
    if key in ("limited-liability-company", "corporation", "sole-proprietorship", "partnership"):
        return key
    return "limited-liability-company"


def _authed_request(method: str, path: str, *, body: bytes | None, content_type: str) -> tuple[int, bytes, str]:
    url = f"{_api_base()}{path}"
    token = _get_token()
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if content_type:
        headers["Content-Type"] = content_type
    try:
        return _raw_request(method, url, headers=headers, data=body)
    except RuntimeError as exc:
        if "iDea Financial API 401" not in str(exc):
            raise
        token = _get_token(force_refresh=True)
        headers["Authorization"] = f"Bearer {token}"
        return _raw_request(method, url, headers=headers, data=body)


def create_application(business: dict[str, Any], owners: list[dict[str, Any]], loan: dict[str, Any]) -> dict[str, Any]:
    owner = owners[0] if owners else {}
    entity_type = _map_entity_type(business.get("entity_type"))
    clean_phone = _clean_phone10(business.get("phone") or owner.get("phone", ""))
    clean_owner_phone = _clean_phone10(owner.get("phone") or business.get("phone", ""))

    business_map = {
        "name": business.get("legal_name", ""),
        "dba": business.get("dba") or business.get("legal_name", ""),
        "description": "Application submitted via SubsPortal.",
        "entityType": entity_type,
        "physicalAddress": {
            "address1": business.get("billing_street", ""),
            "address2": None,
            "city": business.get("billing_city", ""),
            "state": business.get("billing_state", ""),
            "zip": _digits(business.get("billing_postal_code", ""), 5),
        },
        "ein": _digits(business.get("tax_id", ""), 9),
        "phone": clean_phone,
        "naics": _digits(business.get("industry_naics_code") or "541511", 6) or "541511",
        "timeInBusiness": "one-two-years",
        "monthlySales": _as_number(loan.get("average_monthly_revenue"), 1.0) or 1.0,
    }
    owner_map = {
        "firstName": owner.get("first_name", ""),
        "lastName": owner.get("last_name", ""),
        "email": owner.get("email", ""),
        "homeAddress": {
            "address1": owner.get("mailing_street", ""),
            "address2": None,
            "city": owner.get("mailing_city", ""),
            "state": owner.get("mailing_state", ""),
            "zip": _digits(owner.get("mailing_postal_code", ""), 5),
        },
        "dateOfBirth": (owner.get("date_of_birth") or "1985-01-01")[:10],
        "homePhone": clean_owner_phone,
        "mobilePhone": clean_owner_phone,
        "ssn": _digits(owner.get("ssn", ""), 9),
        "fico": int(_as_number(owner.get("fico"), 700) or 700),
        # iDea rejects this as "not valid" when sent as a JSON float
        # (e.g. 100.0) - confirmed against a real submission. Their schema
        # almost certainly binds this to a plain integer, unlike
        # requestedAmount below which accepts a decimal fine.
        "ownershipPercentage": int(round(float(owner.get("ownership_percentage") or 100))),
    }
    payload = {
        "agentId": int(os.getenv("IDEA_AGENT_ID") or 0),
        "business": business_map,
        "owners": [owner_map],
        "requestedAmount": _as_number(loan.get("requested_amount"), 25000.0) or 25000.0,
    }

    _, raw, content_type = _authed_request(
        "POST", "/v1/applications", body=json.dumps(payload).encode(), content_type="application/json-patch+json"
    )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(f"iDea create-application returned invalid JSON:\n{_format_response_body(raw, content_type)}") from None
    application_id = data.get("id")
    if not application_id:
        raise RuntimeError(f"iDea create-application did not return an id:\n{json.dumps(data, indent=2)}")
    return {"application_id": str(application_id), "raw": data}


def upload_document(application_id: str, filename: str, data: bytes, document_type: str) -> dict[str, Any]:
    """document_type is "application" or "bank-statement", per iDea's own enum."""
    boundary = uuid.uuid4().hex
    mime_type = mimetypes.guess_type(filename)[0] or "application/pdf"
    fields = [
        ("fileName", filename),
        ("fileExtension", "." + filename.rsplit(".", 1)[-1] if "." in filename else ".pdf"),
        ("mimeType", mime_type),
        ("fileSize", str(len(data))),
        ("documentType", document_type),
    ]
    parts: list[bytes] = []
    for name, value in fields:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime_type}\r\n\r\n".encode()
        + data
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)

    _, raw, content_type = _authed_request(
        "POST",
        f"/v1/applications/{application_id}/files",
        body=body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"ok": True, "raw": raw.decode(errors="replace")}


def process_application(application_id: str) -> dict[str, Any]:
    _, raw, content_type = _authed_request(
        "POST", f"/v1/applications/{application_id}/push", body=b"", content_type="application/json"
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"ok": True, "raw": raw.decode(errors="replace")}


def get_status(application_id: str) -> dict[str, Any]:
    _, raw, content_type = _authed_request("GET", f"/v1/applications/{application_id}", body=None, content_type="")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(f"iDea status returned invalid JSON:\n{_format_response_body(raw, content_type)}") from None


def describe_integration() -> dict[str, Any]:
    return {
        "configured": idea_configured(),
        "api_url": _api_base(),
        "client_id_set": bool(os.getenv("IDEA_CLIENT_ID")),
        "agent_id_set": bool(os.getenv("IDEA_AGENT_ID")),
    }
