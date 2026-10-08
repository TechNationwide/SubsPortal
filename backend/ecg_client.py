"""
Expansion Capital Group Partner Portal API client.

Docs: https://api.expansioncapitalgroup.com/ (document 3.0.1) and the
Partner Portal API appendix. Auth is the x-authtoken header.

Environments:
  https://api.dev.ecg.com      — testing only; deals are not worked
  https://api.preview.ecg.com  — pre-production code, production data, WILL be worked
  https://api.prod.ecg.com     — production, WILL be worked

Default base URL is Development. Do not point this at Preview or Production
until Keith explicitly switches environments.

Environment (backend/.env):
  ECG_API_BASE_URL   — optional; default Development host
  ECG_AUTH_TOKEN     — Dev or Production token from ECG IT
  ECG_PARTNER_EMAIL  — ISO email registered with Expansion
  ECG_PARTNER_REP    — optional fallback if the logged-in user has no name

ecg_configured() stays False until the token and partner email are set, so
this module cannot make a network call before those exist.
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_BASE = "https://api.dev.ecg.com"
MAX_DOCUMENT_BYTES = 60 * 1024 * 1024
_DISALLOWED_EXTENSIONS = {".exe", ".dll"}

# ECG standard industry names. They do not accept a NAICS code.
ECG_INDUSTRIES = (
    "Accounting & Tax Preparation",
    "Agriculture",
    "Automotive",
    "Construction",
    "Consulting",
    "Cosmetology",
    "Custodial & Janitorial",
    "Education & Training",
    "Financial Services",
    "General Services",
    "Health & Fitness",
    "Hospitality",
    "Insurance",
    "IT",
    "Law",
    "Leisure & Entertainment",
    "Manufacturing",
    "Marketing",
    "Medical",
    "Nursery & Landscaping",
    "Other",
    "Pest Control",
    "Real Estate",
    "Restaurant & Bar Establishments",
    "Retail",
    "Security",
    "Staffing",
    "Telcom",
    "Transportation & Delivery",
    "Wholesale",
)

_ENTITY_TYPE_MAP = {
    "corporation": "Corporation",
    "corp": "Corporation",
    "c-corp": "Corporation",
    "c corp": "Corporation",
    "s-corp": "Corporation",
    "s corp": "Corporation",
    "llc": "LLC",
    "llp": "LLP",
    "partnership": "Partnership",
    "general partnership": "Partnership",
    "sole proprietorship": "Sole Proprietor",
    "sole proprietor": "Sole Proprietor",
    "sole prop": "Sole Proprietor",
    "sp": "Sole Proprietor",
}


def _base_url() -> str:
    return (os.getenv("ECG_API_BASE_URL") or DEFAULT_BASE).rstrip("/")


def ecg_configured() -> bool:
    return bool(os.getenv("ECG_AUTH_TOKEN") and os.getenv("ECG_PARTNER_EMAIL"))


def describe_integration() -> dict[str, Any]:
    return {
        "configured": ecg_configured(),
        "api_url": _base_url(),
        "token_set": bool(os.getenv("ECG_AUTH_TOKEN")),
        "partner_email_set": bool(os.getenv("ECG_PARTNER_EMAIL")),
        "docs": "https://api.expansioncapitalgroup.com/",
    }


def _digits(value: Any, length: int) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) == length + 1 and digits.startswith("1") and length == 10:
        digits = digits[1:]
    return digits[:length]


def _entity_type(value: Any) -> str:
    return _ENTITY_TYPE_MAP.get(str(value or "").strip().lower(), "Other")


def _require_industry(value: Any) -> str:
    industry = str(value or "").strip()
    if industry not in ECG_INDUSTRIES:
        raise ValueError(
            "Expansion requires an industry from their list (not a NAICS code). "
            "Pick the Expansion industry on the form."
        )
    return industry


def _owner_payload(owner: dict[str, Any]) -> dict[str, str]:
    return {
        "ownership_percentage": str(int(float(owner.get("ownership_percentage") or 0))),
        "first_name": str(owner.get("first_name") or "").strip(),
        "last_name": str(owner.get("last_name") or "").strip(),
        "street": str(owner.get("mailing_street") or "").strip(),
        "city": str(owner.get("mailing_city") or "").strip(),
        "state": str(owner.get("mailing_state") or "").strip().upper()[:2],
        "zip": _digits(owner.get("mailing_postal_code"), 5),
        "ssn": _digits(owner.get("ssn"), 9),
        "dob": str(owner.get("date_of_birth") or "").strip(),
        "phone": _digits(owner.get("phone"), 10),
        "email": str(owner.get("email") or "").strip(),
    }


def _validate_owners(owners: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not owners:
        raise ValueError("Expansion requires at least one owner.")
    if len(owners) > 2:
        raise ValueError("Expansion accepts at most 2 owners. Remove the extras before submitting.")
    ranked = sorted(owners, key=lambda o: float(o.get("ownership_percentage") or 0), reverse=True)
    total = sum(float(o.get("ownership_percentage") or 0) for o in ranked)
    if total <= 0 or total > 100:
        raise ValueError(
            f"Expansion owner percentages must add up to 100% or less (currently {total:.0f}%)."
        )
    payloads = [_owner_payload(o) for o in ranked]
    for owner in payloads:
        missing = [k for k, v in owner.items() if not v]
        if missing:
            raise ValueError(f"Expansion owner is missing {', '.join(missing)}.")
        if len(owner["ssn"]) != 9:
            raise ValueError("Expansion owner SSN must be 9 digits.")
        if len(owner["phone"]) != 10:
            raise ValueError("Expansion owner phone must be 10 digits.")
        if len(owner["zip"]) != 5:
            raise ValueError("Expansion owner ZIP must be 5 digits.")
        if len(owner["state"]) != 2:
            raise ValueError("Expansion owner state must be a 2-letter code.")
    return payloads


def _business_payload(
    business: dict[str, Any],
    owners: list[dict[str, Any]],
    *,
    rep_name: str,
    rep_email: str,
) -> dict[str, Any]:
    name = str(business.get("legal_name") or "").strip()
    if not name:
        raise ValueError("Expansion requires a legal business name.")
    tax_id = _digits(business.get("tax_id"), 9)
    phone = _digits(business.get("phone"), 10)
    state = str(business.get("billing_state") or "").strip().upper()[:2]
    zip_code = _digits(business.get("billing_postal_code"), 5)
    if len(tax_id) != 9:
        raise ValueError("Expansion tax ID must be 9 digits.")
    if len(phone) != 10:
        raise ValueError("Expansion business phone must be 10 digits.")
    if len(state) != 2:
        raise ValueError("Expansion billing state must be a 2-letter code.")
    if len(zip_code) != 5:
        raise ValueError("Expansion billing ZIP must be 5 digits.")
    start = str(business.get("business_start_date") or "").strip()
    if not start:
        raise ValueError("Expansion requires a business start date.")
    payload: dict[str, Any] = {
        "partner_rep": rep_name.strip() or "Portal User",
        "partner_email": rep_email.strip(),
        "name": name,
        "dba": str(business.get("dba") or "").strip() or name,
        "type": _entity_type(business.get("entity_type")),
        "street": str(business.get("billing_street") or "").strip(),
        "city": str(business.get("billing_city") or "").strip(),
        "state": state,
        "zip": zip_code,
        "tax_id": tax_id,
        "industry": _require_industry(business.get("ecg_industry")),
        "start_date": start,
        "phone": phone,
    }
    email = str(business.get("email") or "").strip()
    if email:
        payload["email"] = email
    if not payload["street"] or not payload["city"]:
        raise ValueError("Expansion requires a billing street and city.")
    if owners:
        payload["owners"] = owners
    return payload


def _format_body(raw: bytes) -> str:
    if not raw:
        return "(empty)"
    try:
        text = raw.decode("utf-8")
        parsed = json.loads(text)
        formatted = json.dumps(parsed, indent=2)
        return formatted[:4000]
    except (json.JSONDecodeError, UnicodeDecodeError):
        return raw.decode(errors="replace")[:1500]


def _find_id(node: Any) -> str:
    if isinstance(node, dict):
        for key in ("id", "submission_id", "submissionId"):
            value = node.get(key)
            if value not in (None, ""):
                return str(value)
        for value in node.values():
            found = _find_id(value)
            if found:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _find_id(item)
            if found:
                return found
    return ""


def _request(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    data: bytes | None = None,
    content_type: str | None = None,
    timeout: float = 90,
) -> tuple[int, bytes, str]:
    token = os.getenv("ECG_AUTH_TOKEN") or ""
    if not token:
        raise RuntimeError("Expansion Capital is not configured.")
    headers = {"x-authtoken": token, "Accept": "application/json"}
    payload = data
    if body is not None:
        payload = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    elif content_type:
        headers["Content-Type"] = content_type
    req = Request(f"{_base_url()}{path}", data=payload, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), resp.headers.get("Content-Type", "")
    except HTTPError as exc:
        raw = exc.read()
        raise RuntimeError(f"Expansion API {exc.code}:\n{_format_body(raw)}") from exc
    except URLError as exc:
        raise RuntimeError(f"Expansion API unreachable: {exc.reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError(f"Expansion API timed out after {timeout:.0f}s") from exc


def submit_application(
    business: dict[str, Any],
    owners: list[dict[str, Any]],
    *,
    rep_name: str,
    rep_email: str,
) -> dict[str, Any]:
    """POST /api/v1/submissions. Raises ValueError before any network call."""
    owner_payloads = _validate_owners(owners)
    payload = _business_payload(business, owner_payloads, rep_name=rep_name, rep_email=rep_email)
    status, raw, _content_type = _request("POST", "/api/v1/submissions", body=payload)
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        data = {"raw": _format_body(raw)}
    submission_id = _find_id(data)
    if not submission_id:
        raise RuntimeError(
            f"Expansion create returned {status} but no submission id:\n{_format_body(raw)}"
        )
    owners_warning = ""
    if status == 207:
        try:
            add_owners(submission_id, owner_payloads)
        except RuntimeError as exc:
            owners_warning = str(exc)
    return {
        "submission_id": submission_id,
        "http_status": status,
        "owners_warning": owners_warning,
        "raw": data,
    }


def add_owners(submission_id: str, owners: list[dict[str, Any]]) -> dict[str, Any]:
    status, raw, _content_type = _request(
        "POST",
        f"/api/v1/submissions/{submission_id}/owners",
        body={"owners": owners},
    )
    return {"http_status": status, "raw": _format_body(raw)}


def upload_document(submission_id: str, filename: str, data: bytes, *, tag: str, note: str = "") -> dict[str, Any]:
    ext = os.path.splitext(filename)[1].lower()
    if ext in _DISALLOWED_EXTENSIONS:
        raise ValueError(f"{filename} is not an allowed Expansion file type.")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValueError(f"{filename} is over Expansion's 60MB limit.")
    boundary = uuid.uuid4().hex
    fields = {"name": filename, "tag": tag}
    if note:
        fields["note"] = note
    chunks: list[bytes] = []
    for key, value in fields.items():
        chunks.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode()
        )
    # PDF must be application/pdf — a guessed/odd Content-Type on the file part
    # can cause Expansion to accept the upload but not attach it underwriting-side.
    mime = "application/pdf" if ext == ".pdf" else (mimetypes.guess_type(filename)[0] or "application/octet-stream")
    chunks.append(
        (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n"
        ).encode()
        + data
        + b"\r\n"
    )
    chunks.append(f"--{boundary}--\r\n".encode())
    status, raw, _content_type = _request(
        "POST",
        f"/api/v1/submissions/{submission_id}/documents",
        data=b"".join(chunks),
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    return {"http_status": status, "raw": _format_body(raw)}


def get_status(submission_id: str) -> dict[str, Any]:
    status, raw, _content_type = _request("GET", f"/api/v1/submissions/{submission_id}", timeout=45)
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        data = {"raw": _format_body(raw)}
    stage = ""
    if isinstance(data, dict):
        stage = str(data.get("status") or data.get("submission_status") or "").strip()
    notes = ""
    # Notes are optional UI sugar — never let a slow notes call stretch the
    # request past Cloudflare's ~100s origin limit (causes "Connection lost").
    try:
        _note_status, note_raw, _note_type = _request(
            "GET",
            f"/api/v1/submissions/{submission_id}/notes",
            timeout=8,
        )
        note_data = json.loads(note_raw) if note_raw else {}
        notes = _note_preview(note_data)
    except (RuntimeError, TimeoutError, json.JSONDecodeError):
        notes = ""
    return {"http_status": status, "status": stage, "notes": notes, "raw": data}


def _note_preview(node: Any) -> str:
    texts: list[str] = []

    def walk(value: Any) -> None:
        if len(texts) >= 3:
            return
        if isinstance(value, dict):
            for key in ("note", "content", "text", "message", "body"):
                item = value.get(key)
                if isinstance(item, str) and item.strip():
                    texts.append(item.strip())
                    return
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(node)
    return " | ".join(texts)[:500]
