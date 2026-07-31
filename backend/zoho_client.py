"""
Zoho CRM client — pulls/pushes a Lead record between the portal's shared
Business/Owner/Loan shape (see partner_models.py) and the client's Zoho CRM.

Unlike the funder clients in this folder, this isn't a lender submission —
it's a two-way sync with the client's own CRM, where each Lead record IS the
loan application (business + owner + loan fields all living on one Lead).

Auth: Zoho OAuth2 "Self Client" grant. A one-time authorization code was
already exchanged for a refresh token (never expires); this module only ever
uses the refresh token to mint short-lived (1hr) access tokens, cached
in-process (safe: single pm2 process, no cluster mode) — same pattern as
CAN Capital's bearer-token cache in can_client.py.

Environment (backend/.env):
  ZOHO_CLIENT_ID      — Self Client ID
  ZOHO_CLIENT_SECRET  — Self Client secret
  ZOHO_REFRESH_TOKEN  — long-lived refresh token from the one-time grant-code exchange
  ZOHO_ACCOUNTS_URL   — optional; default https://accounts.zoho.com (token endpoint)
  ZOHO_API_DOMAIN      — optional; default https://www.zohoapis.com (CRM data endpoint)

zoho_configured() returns False until all three required vars are set, which
is the safety gate that keeps this module from ever making a real call
before the client is ready to test.

Field mapping — confirmed against the client's own field-map spreadsheet AND
cross-checked against a real live Lead record's actual JSON keys (several
fields share confusingly similar names in the CRM — e.g. both `Ownership`
and `of_Ownership`, both `DOB` and `Date_Of_Birth`, both `Social` and `SSN`
exist on the Leads module — the mapping below picks the one that matches the
spreadsheet's stated label, not the first plausible-looking name):

  business.legal_name            <-> Company
  business.dba                   <-> DBA
  business.phone                 <-> Phone               (business phone)
  business.tax_id                <-> Federal_Tax_ID
  business.entity_type           <-> Business_Type        (multi-select picklist — see note below)
  business.state_of_formation    <-> State_of_Incorporation
  business.business_start_date   <-> Start_Date            (date — normalized both directions)
  business.billing_street        <-> Street
  business.billing_city          <-> City
  business.billing_state         <-> State
  business.billing_postal_code   <-> Zip_Code

  owners[0].first_name           <-> First_Name
  owners[0].last_name            <-> Last_Name
  owners[0].date_of_birth         <-> Date_Of_Birth        (date — normalized both directions)
  owners[0].ssn                  <-> SSN
  owners[0].ownership_percentage <-> of_Ownership          (client-confirmed — see note below)
  owners[0].phone                <-> Owner_Phone           (label confirmed, API field inferred — see note below)
  owners[0].email                <-> Email                 (owner's own email — standard Zoho field)
  owners[0].mailing_street       <-> Owner_Address
  owners[0].mailing_city         <-> Owner_City
  owners[0].mailing_state        <-> Owner_State
  owners[0].mailing_postal_code  <-> Owner_Zip_Code

  loan.average_monthly_revenue   <-> Annual_Revenue        (naming mismatch, pass-through confirmed — see note below)
  loan.average_daily_balance     <-> Average_Bank_Revenue

CLIENT-CONFIRMED (via Waqas, relaying the client):
  - The spreadsheet's field labels (including "% of Ownership" and
    "Phone 2") are copy-pasted word for word from Zoho, not paraphrased —
    which is the basis for picking `of_Ownership` over the separate
    `Ownership` field (Zoho's auto-name behavior strips a leading "%" from
    a label) and `Owner_Phone` for "Phone 2" (no field literally named
    `Phone_2` exists on the live record, so this is confirmed at the label
    level; the underlying API field is still inferred, not
    metadata-verified — the fields-metadata endpoint isn't in this Self
    Client's granted scope).
  - `Annual_Revenue` / `Average_Bank_Revenue`: pass through as-is, no ×12 or
    other conversion. Confirmed directly ("the annual revenue is pass
    through as is") despite the monthly/annual naming mismatch.
  - Push-back: overwrite the mapped fields directly, no separate
    status/outcome field. Confirmed directly ("should not set a status,
    just push pull data") — matches how `update_lead()` already works below.

STILL UNCONFIRMED:
  - `Business_Type` is a multi-select picklist in Zoho (returns a list, e.g.
    `[]` or `["LLC"]`), not free text — this module wraps/unwraps a single
    value into that list. The valid picklist option strings weren't
    confirmed (same metadata-scope limitation as above), so this passes the
    portal's entity_type string straight through as the list's only value.
    If Zoho rejects an unrecognized picklist option, this is the first
    place to look.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_ACCOUNTS_URL = "https://accounts.zoho.com"
DEFAULT_API_DOMAIN = "https://www.zohoapis.com"

_token_cache: dict[str, Any] = {"token": None, "expires_at": 0.0}


def _accounts_url() -> str:
    return (os.getenv("ZOHO_ACCOUNTS_URL") or DEFAULT_ACCOUNTS_URL).rstrip("/")


def _api_domain() -> str:
    return (os.getenv("ZOHO_API_DOMAIN") or DEFAULT_API_DOMAIN).rstrip("/")


def zoho_configured() -> bool:
    return bool(
        os.getenv("ZOHO_CLIENT_ID") and os.getenv("ZOHO_CLIENT_SECRET") and os.getenv("ZOHO_REFRESH_TOKEN")
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


def _mask_token(token: str) -> str:
    if len(token) <= 8:
        return "Zoho-oauthtoken ***"
    return f"Zoho-oauthtoken ...{token[-4:]}"


def _raw_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    data: bytes | None = None,
    timeout: int = 60,
    log_label: str = "Zoho",
) -> tuple[int, bytes, str]:
    req = Request(url, data=data, method=method)
    for key, value in headers.items():
        req.add_header(key, value)

    print("\n" + "=" * 72)
    print(f"[{log_label}] >>> {method} {url}")
    log_headers = {
        k: (_mask_token(v.split(" ", 1)[1]) if k.lower() == "authorization" and v.startswith("Zoho-oauthtoken ") else v)
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
        raise RuntimeError(f"Zoho API {exc.code}:\n{_format_response_body(err_body, content_type)}") from exc
    except URLError as exc:
        print(f"[{log_label}] <<< UNREACHABLE {method}")
        print(f"[{log_label}] Error: {exc}")
        print("=" * 72 + "\n")
        raise RuntimeError(f"Zoho API unreachable ({method} {url}): {exc}") from exc


def _fetch_token() -> tuple[str, float]:
    body = (
        f"refresh_token={os.environ['ZOHO_REFRESH_TOKEN']}"
        f"&client_id={os.environ['ZOHO_CLIENT_ID']}"
        f"&client_secret={os.environ['ZOHO_CLIENT_SECRET']}"
        f"&grant_type=refresh_token"
    ).encode()
    _, raw, _ = _raw_request(
        "POST",
        f"{_accounts_url()}/oauth/v2/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=body,
    )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError("Zoho token response was not valid JSON.") from None
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"Zoho token refresh failed:\n{json.dumps(data, indent=2)}")
    expires_in = float(data.get("expires_in") or 3600)
    return token, time.monotonic() + expires_in


def _get_token(*, force_refresh: bool = False) -> str:
    if not force_refresh and _token_cache["token"] and time.monotonic() < _token_cache["expires_at"] - 60:
        return _token_cache["token"]
    token, expires_at = _fetch_token()
    _token_cache["token"] = token
    _token_cache["expires_at"] = expires_at
    return token


def _authed_request(
    method: str, path: str, *, body: dict[str, Any] | None = None
) -> tuple[int, bytes, str]:
    """Retries once with a fresh token on a 401 (handles clock-drift expiry),
    same pattern as CAN Capital's _authed_request in can_client.py."""
    url = f"{_api_domain()}{path}"
    data = json.dumps(body).encode() if body is not None else None
    token = _get_token()
    headers = {"Authorization": f"Zoho-oauthtoken {token}", "Content-Type": "application/json"}
    try:
        return _raw_request(method, url, headers=headers, data=data)
    except RuntimeError as exc:
        if "Zoho API 401" not in str(exc):
            raise
        token = _get_token(force_refresh=True)
        headers["Authorization"] = f"Zoho-oauthtoken {token}"
        return _raw_request(method, url, headers=headers, data=data)


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_US_DATE_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")


def _to_iso_date(value: str) -> str:
    """Normalize to Zoho's expected yyyy-MM-dd. The portal's own <input
    type="date"> fields always produce ISO already, so this is mostly a
    defensive pass-through/validation — but Zoho CRM data can end up in
    MM/DD/YYYY if it was ever hand-entered through the CRM UI, so that
    shape is converted rather than rejected."""
    value = (value or "").strip()
    if not value:
        return ""
    if _ISO_DATE_RE.match(value):
        return value
    match = _US_DATE_RE.match(value)
    if match:
        month, day, year = match.groups()
        return f"{year}-{month}-{day}"
    raise ValueError(f"Unrecognized date format: {value!r} (expected YYYY-MM-DD or MM/DD/YYYY)")


def _from_iso_date(value: str | None) -> str:
    """Zoho's v2 API always returns Date-type fields as yyyy-MM-dd regardless
    of the org's display locale, so no conversion is needed on read — this
    only guards against a null/missing field."""
    return value or ""


def _lead_to_portal(record: dict[str, Any]) -> dict[str, Any]:
    business_type = record.get("Business_Type") or []
    return {
        "business": {
            "legal_name": record.get("Company") or "",
            "dba": record.get("DBA") or "",
            "phone": record.get("Phone") or "",
            "tax_id": record.get("Federal_Tax_ID") or "",
            "entity_type": business_type[0] if business_type else "",
            "state_of_formation": record.get("State_of_Incorporation") or "",
            "business_start_date": _from_iso_date(record.get("Start_Date")),
            "billing_street": record.get("Street") or "",
            "billing_city": record.get("City") or "",
            "billing_state": record.get("State") or "",
            "billing_postal_code": record.get("Zip_Code") or "",
        },
        "owners": [
            {
                "first_name": record.get("First_Name") or "",
                "last_name": record.get("Last_Name") or "",
                "date_of_birth": _from_iso_date(record.get("Date_Of_Birth")),
                "ssn": record.get("SSN") or "",
                "ownership_percentage": record.get("of_Ownership") or 0,
                "phone": record.get("Owner_Phone") or "",
                "email": record.get("Email") or "",
                "mailing_street": record.get("Owner_Address") or "",
                "mailing_city": record.get("Owner_City") or "",
                "mailing_state": record.get("Owner_State") or "",
                "mailing_postal_code": record.get("Owner_Zip_Code") or "",
            }
        ],
        "loan": {
            "average_monthly_revenue": record.get("Annual_Revenue"),
            "average_daily_balance": record.get("Average_Bank_Revenue"),
        },
    }


def get_lead(lead_id: str) -> dict[str, Any]:
    """GET /crm/v2/Leads/{id} — returns the raw Zoho record alongside the
    same business/owner/loan shape the funder clients already use, so
    calling code doesn't need to know Zoho's field names at all."""
    _, raw, content_type = _authed_request("GET", f"/crm/v2/Leads/{lead_id}")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(f"Zoho Leads GET returned invalid JSON:\n{_format_response_body(raw, content_type)}") from None
    records = data.get("data") or []
    if not records:
        raise RuntimeError(f"Zoho Lead {lead_id} not found.")
    record = records[0]
    mapped = _lead_to_portal(record)
    mapped["raw"] = record
    return mapped


def update_lead(
    lead_id: str,
    business: dict[str, Any],
    owners: list[dict[str, Any]],
    loan: dict[str, Any],
) -> dict[str, Any]:
    """PUT /crm/v2/Leads/{id} — pushes portal edits back onto the Lead.
    Zoho's Leads module is single-contact (no owner1/owner2 split like
    OnDeck), so only owners[0] is written, mirroring CAN Capital's
    single-primary-contact handling in can_client.py."""
    owner = owners[0] if owners else {}
    fields: dict[str, Any] = {
        "Company": business.get("legal_name", ""),
        "DBA": business.get("dba", ""),
        "Phone": business.get("phone", ""),
        "Federal_Tax_ID": business.get("tax_id", ""),
        "State_of_Incorporation": business.get("state_of_formation", ""),
        "Street": business.get("billing_street", ""),
        "City": business.get("billing_city", ""),
        "State": business.get("billing_state", ""),
        "Zip_Code": business.get("billing_postal_code", ""),
        "First_Name": owner.get("first_name", ""),
        "Last_Name": owner.get("last_name", ""),
        "SSN": owner.get("ssn", ""),
        "of_Ownership": owner.get("ownership_percentage", 0),
        "Owner_Phone": owner.get("phone", ""),
        "Email": owner.get("email", ""),
        "Owner_Address": owner.get("mailing_street", ""),
        "Owner_City": owner.get("mailing_city", ""),
        "Owner_State": owner.get("mailing_state", ""),
        "Owner_Zip_Code": owner.get("mailing_postal_code", ""),
        "Annual_Revenue": loan.get("average_monthly_revenue"),
        "Average_Bank_Revenue": loan.get("average_daily_balance"),
    }
    entity_type = (business.get("entity_type") or "").strip()
    if entity_type:
        fields["Business_Type"] = [entity_type]
    start_date = business.get("business_start_date")
    if start_date:
        fields["Start_Date"] = _to_iso_date(start_date)
    dob = owner.get("date_of_birth")
    if dob:
        fields["Date_Of_Birth"] = _to_iso_date(dob)

    _, raw, content_type = _authed_request("PUT", f"/crm/v2/Leads/{lead_id}", body={"data": [fields]})
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(f"Zoho Leads PUT returned invalid JSON:\n{_format_response_body(raw, content_type)}") from None
    result = (data.get("data") or [{}])[0]
    if result.get("status") != "success":
        raise RuntimeError(f"Zoho Leads PUT was rejected:\n{json.dumps(data, indent=2)}")
    return result


def describe_integration() -> dict[str, Any]:
    return {
        "configured": zoho_configured(),
        "api_domain": _api_domain(),
        "accounts_url": _accounts_url(),
        "client_id_set": bool(os.getenv("ZOHO_CLIENT_ID")),
    }
