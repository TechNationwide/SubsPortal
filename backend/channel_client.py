"""
Channel Partners client.

Docs: no written API spec exists - this module is built directly from a
working Zoho CRM Deluge function (`Send_Lead_to_Channel`) provided by the
client, saved at repo root in the gitignored folder
"4 - PEAC Channel iDea Zoho Reference". Channel's API is a single logical
submission made of 4 sequential calls (start application, add each file,
add business, add contact) - matching the client's spec of one button
("Submit to Channel").

Environment (backend/.env):
  CHANNEL_API_BASE_URL — optional; default https://apponboarding.cpcapi.com
  CHANNEL_API_TOKEN     — static long-lived Bearer token (not a login flow -
                          Channel issued this directly; refresh manually if
                          it ever expires)
  CHANNEL_USER_EMAIL    — email passed as UserEmailAddress on application start

None of these are set anywhere today — channel_configured() returns False
until they're deliberately added, which is the safety gate that keeps this
module from ever making a real call before the client is ready to test.
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_BASE = "https://apponboarding.cpcapi.com"

# Business structure -> Channel's numeric BusinessType code. Only these
# three are confirmed from the reference Deluge function - anything else
# raises rather than guessing a wrong code.
_BUSINESS_TYPE_CODES = {
    "corporation": 7,
    "corp": 7,
    "llc": 8,
    "sole proprietorship": 10,
    "sole prop": 10,
}

_STATE_NAME_TO_CODE = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
    "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI",
    "wyoming": "WY",
}


def _base_url() -> str:
    return (os.getenv("CHANNEL_API_BASE_URL") or DEFAULT_BASE).rstrip("/")


def channel_configured() -> bool:
    return bool(os.getenv("CHANNEL_API_TOKEN") and os.getenv("CHANNEL_USER_EMAIL"))


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


def _request(method: str, path: str, *, body: dict[str, Any], timeout: int = 120) -> tuple[int, bytes, str]:
    token = os.getenv("CHANNEL_API_TOKEN") or ""
    url = f"{_base_url()}{path}"
    data = json.dumps(body).encode()
    req = Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")

    log_body = dict(body)
    request_field = log_body.get("Request")
    if isinstance(request_field, dict) and "Data" in request_field:
        request_field = {**request_field, "Data": f"<base64, {len(request_field['Data'])} chars>"}
        log_body = {**log_body, "Request": request_field}
    masked_token = f"Bearer ...{token[-6:]}" if len(token) > 6 else "Bearer ***"
    print("\n" + "=" * 72)
    print(f"[Channel] >>> {method} {url}")
    print(f"[Channel] Authorization: {masked_token}")
    print(f"[Channel] Request body: {json.dumps(log_body, indent=2)}")

    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            content_type = resp.headers.get("Content-Type", "")
            print(f"[Channel] <<< {resp.status} {method}")
            print(f"[Channel] Response body: {_format_response_body(raw, content_type)}")
            print("=" * 72 + "\n")
            return resp.status, raw, content_type
    except HTTPError as exc:
        err_body = exc.read()
        content_type = exc.headers.get("Content-Type", "") if exc.headers else ""
        print(f"[Channel] <<< {exc.code} {method} (HTTP error)")
        print(f"[Channel] Response body: {_format_response_body(err_body, content_type)}")
        print("=" * 72 + "\n")
        raise RuntimeError(f"Channel API {exc.code}:\n{_format_response_body(err_body, content_type)}") from exc
    except URLError as exc:
        print(f"[Channel] <<< UNREACHABLE {method}")
        print(f"[Channel] Error: {exc}")
        print("=" * 72 + "\n")
        raise RuntimeError(f"Channel API unreachable ({method} {path}): {exc}") from exc


def _is_success(response_value: Any) -> bool:
    """Channel's API returns "Response" as a JSON boolean `true` on success,
    not the string "true" - Deluge coerces this silently, Python doesn't."""
    return response_value is True or (isinstance(response_value, str) and response_value.lower() == "true")


def _clean_phone(phone: str) -> str:
    phone = (phone or "").strip()
    if phone.startswith("+1"):
        phone = phone[2:]
    return phone.replace("-", "")


def submit_application(
    business: dict[str, Any],
    owners: list[dict[str, Any]],
    loan: dict[str, Any],
    files: list[tuple[str, bytes]],
) -> dict[str, Any]:
    """Runs the full 4-call sequence in one shot: start application, add
    each file, add business (deal), add contact (owner)."""
    owner = owners[0] if owners else {}
    user_email = os.getenv("CHANNEL_USER_EMAIL") or ""

    start_body = {"Request": {"UserEmailAddress": user_email, "ApplicationTypes": [25]}}
    _, raw, content_type = _request("POST", "/application/start?api-version=2.0", body=start_body)
    try:
        start_data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(f"Channel application/start returned invalid JSON:\n{_format_response_body(raw, content_type)}") from None
    if start_data.get("Errors") is not None:
        raise RuntimeError(f"Channel application/start error: {start_data.get('Errors')}")
    application_id = start_data.get("Response")
    if not application_id:
        raise RuntimeError(f"Channel application/start did not return an application id:\n{json.dumps(start_data, indent=2)}")

    for filename, data in files:
        file_body = {"Request": {"Filename": filename, "Category": 1, "Data": base64.b64encode(data).decode("ascii")}}
        _, raw, content_type = _request("POST", f"/application/addfile/{application_id}?api-version=2.0", body=file_body)
        file_resp = json.loads(raw)
        if not _is_success(file_resp.get("Response")) or file_resp.get("Errors") is not None:
            raise RuntimeError(f"Channel addfile failed for {filename}: {json.dumps(file_resp, indent=2)}")

    entity_type = (business.get("entity_type") or "").strip().lower()
    business_type_code = _BUSINESS_TYPE_CODES.get(entity_type)
    if business_type_code is None:
        raise ValueError(
            f"Channel does not have a known BusinessType code for entity type '{business.get('entity_type')}' "
            "(only Corporation/LLC/Sole Proprietorship are confirmed)."
        )
    state_of_formation = _STATE_NAME_TO_CODE.get((business.get("state_of_formation") or "").strip().lower(), business.get("state_of_formation") or "")

    address = {
        "AddressType": "Shipping",
        "Street1": business.get("billing_street", ""),
        "City": business.get("billing_city", ""),
        "State": business.get("billing_state", ""),
        "ZipCode5": business.get("billing_postal_code", ""),
        "IsVerified": True,
    }
    billing_address = {**address, "AddressType": "Billing"}

    deal_body = {
        "Request": {
            "Name": business.get("legal_name", ""),
            "DoingBusinessAs": business.get("dba") or business.get("legal_name", ""),
            "StateOfIncorporation": state_of_formation,
            "FederalTaxId": business.get("tax_id", ""),
            "PhoneNumber": _clean_phone(business.get("phone", "")),
            "AlternatePhone": "",
            "BusinessEmail": owner.get("email", ""),
            "OpportunityComments": "",
            "Website": "",
            # Hardcoded per client request - "General Working Capital" is
            # the exact dropdown option text confirmed from Channel's own
            # portal (not in the reference Zoho function at all). The field
            # name itself ("UseOfFunds") is still an educated guess, not
            # confirmed against Channel's real schema - if Channel silently
            # ignores it, this still needs to be set manually until the
            # correct field name is confirmed with them directly.
            "UseOfFunds": "General Working Capital",
            "BusinessType": business_type_code,
            "InBusinessSince": business.get("business_start_date", ""),
            "Address": [address, billing_address],
        }
    }
    _, raw, content_type = _request("POST", f"/application/addbusiness/{application_id}?api-version=2.0", body=deal_body)
    deal_resp = json.loads(raw)
    if not _is_success(deal_resp.get("Response")) or deal_resp.get("Errors") is not None:
        raise RuntimeError(f"Channel addbusiness failed: {json.dumps(deal_resp, indent=2)}")

    contact_body = {
        "Request": {
            "FirstName": owner.get("first_name", ""),
            "LastName": owner.get("last_name", ""),
            "SocialSecurityNumber": (owner.get("ssn") or "").replace(",", ""),
            "PhoneNumber": _clean_phone(owner.get("phone", "")),
            "PercentageOwned": owner.get("ownership_percentage", 100),
            "Addresses": [
                {
                    "AddressType": "Mailing",
                    "Street1": owner.get("mailing_street", ""),
                    "City": owner.get("mailing_city", ""),
                    "State": owner.get("mailing_state", ""),
                    "ZipCode5": owner.get("mailing_postal_code", ""),
                }
            ],
        }
    }
    _, raw, content_type = _request("POST", f"/application/addcontact/{application_id}?api-version=2.0", body=contact_body)
    contact_resp = json.loads(raw)
    if not _is_success(contact_resp.get("Response")) or contact_resp.get("Errors") is not None:
        raise RuntimeError(f"Channel addcontact failed: {json.dumps(contact_resp, indent=2)}")

    return {"ok": True, "application_id": application_id}


def describe_integration() -> dict[str, Any]:
    return {
        "configured": channel_configured(),
        "api_url": _base_url(),
        "user_email_set": bool(os.getenv("CHANNEL_USER_EMAIL")),
    }
