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

from partner_industry import validate_industry_for_ondeck

DEFAULT_BASE = "https://stagingpartners.ondeckcapital.com/api"

# Portal + Zoho picklist labels → OnDeck legalEntity enums.
# "Partnership" (portal dropdown) must map to GP — previously fell through to
# UNKNOWN. Full state names / short EIN/phone/SSN/ZIP also used to be sent
# half-cleaned and can make OnDeck return an opaque HTTP 500 "System error."
_ENTITY_TYPE_MAP = {
    "sole proprietorship": "SP",
    "sole proprietor": "SP",
    "sole prop": "SP",
    "llc": "LLC",
    "corporation": "CORP",
    "corp": "CORP",
    "c-corp": "CORP",
    "c corp": "CORP",
    "s-corp": "CORP",
    "s corp": "CORP",
    "partnership": "GP",
    "general partnership": "GP",
    "limited partnership": "LP",
    "llp": "LLP",
    "trust": "TRST",
}

_STATE_NAME_TO_CODE = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "district of columbia": "DC",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI",
    "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN",
    "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}

_US_STATE_CODES = frozenset(_STATE_NAME_TO_CODE.values()) | {"DC"}
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_US_DATE_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")


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
        formatted = _format_response_body(err_body, resp_content_type)
        # OnDeck's generic 500 body is not actionable — say so explicitly so
        # the portal toast is not mistaken for a portal crash.
        if exc.code >= 500 and "system error" in formatted.lower():
            raise RuntimeError(
                f"OnDeck API {exc.code}: their server returned a generic "
                f'"System error." (not a portal failure). Retry once; if it '
                f"keeps failing on this deal only, check EIN/SSN/phone/ZIP/"
                f"state/dates on the form — incomplete values often trigger this.\n"
                f"{formatted}"
            ) from exc
        raise RuntimeError(f"OnDeck API {exc.code}:\n{formatted}") from exc
    except URLError as exc:
        print(f"[OnDeck] <<< UNREACHABLE {method} {path}")
        print(f"[OnDeck] Error: {exc}")
        print("=" * 72 + "\n")
        raise RuntimeError(f"OnDeck API unreachable ({method} {path}): {exc}") from exc


def _field_error(field: str, reason: str) -> ValueError:
    """Frontend toast shows this string as-is — keep field name first."""
    return ValueError(f"OnDeck — {field}: {reason}")


def _normalize_state(value: Any, *, field: str) -> str:
    """OnDeck requires exactly 2-char state. Full names from Zoho used to be
    silently truncated (Virginia → VI), which is deal-specific poison."""
    raw = str(value or "").strip()
    if not raw:
        raise _field_error(field, "required — use a 2-letter code (e.g. VA).")
    lower = raw.lower()
    if lower in _STATE_NAME_TO_CODE:
        return _STATE_NAME_TO_CODE[lower]
    code = raw.upper()
    if len(code) == 2 and code in _US_STATE_CODES:
        return code
    raise _field_error(
        field,
        f'"{raw}" is not a valid US state. Use a 2-letter code (e.g. VA) or the full name.',
    )


def _normalize_zip(value: Any, *, field: str) -> str:
    digits = re.sub(r"[^0-9]", "", str(value or ""))
    if len(digits) >= 5:
        return digits[:5]
    raise _field_error(field, f"must be exactly 5 digits (got {len(digits) or 0}).")


def _normalize_date(value: Any, *, field: str, required: bool = False) -> str:
    raw = str(value or "").strip()
    if not raw:
        if required:
            raise _field_error(field, "required (YYYY-MM-DD).")
        return ""
    if _ISO_DATE_RE.match(raw):
        return raw
    match = _US_DATE_RE.match(raw)
    if match:
        month, day, year = match.groups()
        return f"{year}-{month}-{day}"
    raise _field_error(field, f'must be YYYY-MM-DD (got "{raw}").')


def _digits_exact(value: Any, length: int, *, field: str, required: bool = False) -> str:
    digits = re.sub(r"[^0-9]", "", str(value or ""))
    if not digits:
        if required:
            raise _field_error(field, f"required ({length} digits).")
        return ""
    if len(digits) != length:
        raise _field_error(
            field,
            f"must be exactly {length} digits (got {len(digits)}). Fix this field before retrying.",
        )
    return digits


def _address(
    street: str,
    city: str,
    state: str,
    postal_code: str,
    *,
    street_field: str,
    city_field: str,
    state_field: str,
    zip_field: str,
) -> dict[str, str]:
    street = str(street or "").strip()
    city = str(city or "").strip()
    if not street:
        raise _field_error(street_field, "required.")
    if not city:
        raise _field_error(city_field, "required.")
    return {
        "addressLine1": street[:64],
        "city": city[:64],
        "state": _normalize_state(state, field=state_field),
        "zipCode": _normalize_zip(postal_code, field=zip_field),
    }


def _clean_phone10(value: Any, *, field: str, required: bool = False) -> str:
    """Strip to digits; drop leading NANP country code 1 (matches Zoho Dev2)."""
    digits = re.sub(r"[^0-9]", "", str(value or ""))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if not digits:
        if required:
            raise _field_error(field, "required (10 digits).")
        return ""
    if len(digits) != 10:
        raise _field_error(
            field,
            f"must be exactly 10 digits (got {len(digits)}). Fix this field before retrying.",
        )
    return digits


def _map_legal_entity(value: Any) -> str:
    key = (value or "").strip().lower()
    mapped = _ENTITY_TYPE_MAP.get(key)
    if mapped:
        return mapped
    if not key:
        raise _field_error("Entity type", "required.")
    # Still send UNKNOWN so odd Zoho values do not hard-block, but warn via
    # a known enum — OnDeck accepts UNKNOWN.
    return "UNKNOWN"


def _naics_digits(value: Any) -> str:
    validate_industry_for_ondeck(value)
    return re.sub(r"\D", "", str(value or "").strip())


def _build_business(business: dict[str, Any], loan_purpose: str) -> dict[str, Any]:
    phone = _clean_phone10(business.get("phone", ""), field="Business phone", required=True)
    tax_id = _digits_exact(
        business.get("tax_id"), 9, field="Tax ID (EIN)", required=True
    )
    inception = _normalize_date(
        business.get("business_start_date"), field="Business start date", required=True
    )
    naics = _naics_digits(business.get("industry_naics_code"))
    name = str(business.get("legal_name") or "").strip()
    if not name:
        raise _field_error("Legal business name", "required.")
    if not str(business.get("entity_type") or "").strip():
        raise _field_error("Entity type", "required.")
    payload: dict[str, Any] = {
        "name": name[:120],
        "phone": phone,
        "taxID": tax_id,
        "legalEntity": _map_legal_entity(business.get("entity_type")),
        "businessInceptionDate": inception,
        "address": _address(
            business.get("billing_street", ""),
            business.get("billing_city", ""),
            business.get("billing_state", ""),
            business.get("billing_postal_code", ""),
            street_field="Billing street",
            city_field="Billing city",
            state_field="Billing state",
            zip_field="Billing ZIP",
        ),
    }
    dba = (business.get("dba") or "").strip()
    if dba:
        payload["doingBusinessAs"] = dba[:225]
    if naics:
        payload["industryNAICSCode"] = naics
    purpose = (loan_purpose or "").strip()
    if purpose:
        payload["loanPurpose"] = purpose[:50]
    return payload


def _build_owner(owner: dict[str, Any], *, index: int) -> dict[str, Any]:
    suffix = f" (owner {index})" if index > 1 else ""
    first = str(owner.get("first_name") or "").strip()
    last = str(owner.get("last_name") or "").strip()
    if not first:
        raise _field_error(f"Owner first name{suffix}", "required.")
    if not last:
        raise _field_error(f"Owner last name{suffix}", "required.")
    name = f"{first} {last}".strip()
    phone = _clean_phone10(owner.get("phone", ""), field=f"Owner phone{suffix}", required=True)
    dob = _normalize_date(
        owner.get("date_of_birth"), field=f"Owner date of birth{suffix}", required=True
    )
    ssn = _digits_exact(owner.get("ssn"), 9, field=f"Owner SSN{suffix}", required=True)
    email = (owner.get("email") or "").strip()
    if not email:
        raise _field_error(f"Owner email{suffix}", "required.")
    ownership = int(float(owner.get("ownership_percentage") or 0))
    if ownership < 0 or ownership > 100:
        raise _field_error(
            f"Owner ownership %{suffix}", "must be between 0 and 100."
        )
    payload: dict[str, Any] = {
        "name": name,
        "email": email[:80],
        "dateOfBirth": dob,
        "ssn": ssn,
        "cellPhoneNumber": phone,
        "homePhone": phone,
        "ownershipPercentage": ownership,
        "homeAddress": _address(
            owner.get("mailing_street", ""),
            owner.get("mailing_city", ""),
            owner.get("mailing_state", ""),
            owner.get("mailing_postal_code", ""),
            street_field=f"Owner mailing street{suffix}",
            city_field=f"Owner mailing city{suffix}",
            state_field=f"Owner mailing state{suffix}",
            zip_field=f"Owner mailing ZIP{suffix}",
        ),
    }
    return payload


def submit_application(
    business: dict[str, Any], owners: list[dict[str, Any]], loan: dict[str, Any], external_customer_id: str | None = None
) -> dict[str, Any]:
    """POST /v2/application — full underwriting submission.

    Raises ValueError (no network call made) if combined owner ownership is
    below 50%, since OnDeck auto-declines those applications — no sense
    burning a real submission on a guaranteed decline once live testing
    starts. Also validates phone/EIN/SSN/ZIP/state/dates before calling
    OnDeck so incomplete deal data surfaces as a clear 400 instead of their
    opaque HTTP 500 "System error."
    """
    if not owners:
        raise _field_error("Owners", "at least one owner is required.")
    if len(owners) > 2:
        raise _field_error("Owners", "OnDeck accepts at most 2 owners per application.")

    total_ownership = sum(float(o.get("ownership_percentage") or 0) for o in owners)
    if total_ownership < 50:
        raise _field_error(
            "Owner ownership %",
            f"combined ownership is {total_ownership:.0f}% — OnDeck needs at least 50% "
            "or the application is auto-declined.",
        )

    revenue = loan.get("average_monthly_revenue")
    avg_balance = loan.get("average_daily_balance")
    if revenue is None:
        raise _field_error("Average monthly revenue", "required for OnDeck.")
    if avg_balance is None:
        raise _field_error("Average daily balance", "required for OnDeck.")

    self_reported: dict[str, Any] = {
        "revenue": revenue,
        "averageBalance": avg_balance,
    }
    requested = loan.get("requested_amount")
    if requested is not None:
        self_reported["desiredLoanAmount"] = requested
    term = loan.get("desired_term_months")
    if term is not None:
        # Omit null — Zoho Dev2 never sends this field; some OnDeck builds
        # mishandle JSON null on integer optionals as a 500 System error.
        self_reported["desiredLoanTerm"] = int(term)

    payload: dict[str, Any] = {
        "business": _build_business(business, loan.get("loan_purpose", "")),
        "owners": [_build_owner(o, index=i + 1) for i, o in enumerate(owners)],
        "selfReported": self_reported,
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
    return {
        "business_id": business_id,
        "lead_url": str(data.get("url") or data.get("leadUrl") or ""),
        "app_no": str(data.get("applicationNumber") or data.get("application_number") or ""),
        "raw": data,
    }


def upload_documents(
    business_id: str, files: list[tuple[str, bytes]], document_need: str = "CollectVerify"
) -> dict[str, Any]:
    """POST /v2/application/{businessID}/documents — one call per file.

    documentNeed only accepts 'CollectVerify' or 'Closing' (confirmed from a
    real 400 response) - "Bank Statements" was never a valid value here.

    Originally sent every file bundled into one multipart request - OnDeck's
    own nginx rejected that with a real "413 Request Entity Too Large" once
    several bank-statement PDFs were attached at once. Splitting into one
    POST per file keeps each request small regardless of how many months of
    statements get attached."""
    if not files:
        raise ValueError("At least one file is required for document upload.")
    results: list[dict[str, Any]] = []
    for filename, data in files:
        body, content_type = _multipart_body({}, [("file", filename, data)])
        _, raw, resp_content_type = _request(
            "POST",
            f"/v2/application/{business_id}/documents",
            raw_body=body,
            content_type=content_type,
            query={"documentNeed": document_need},
        )
        try:
            results.append(json.loads(raw))
        except json.JSONDecodeError:
            raise RuntimeError(
                f"OnDeck document upload returned invalid JSON for {filename}:\n"
                f"{_format_response_body(raw, resp_content_type)}"
            ) from None
    return {"ok": True, "results": results}


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
