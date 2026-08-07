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
import http.client
import json
import os
import re
import ssl
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

from compressor import CompressionPreset, compress_pdf

DEFAULT_BASE = "https://devportal.marlincapitalsolutions.com:8077"
# PEAC takes all docs as inline base64 in one JSON POST. Payloads north of
# ~15-20MB regularly get the connection dropped mid-write (Errno 32 Broken
# pipe). Compress anything over this threshold before encoding.
_COMPRESS_IF_LARGER_THAN = 1_500_000  # 1.5 MB
_RETRY_ATTEMPTS = int(os.getenv("PEAC_RETRY_ATTEMPTS", "3"))
_MAX_PAYLOAD_BYTES = int(os.getenv("PEAC_MAX_PAYLOAD_BYTES", str(18 * 1024 * 1024)))

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


def _is_transient(exc: BaseException) -> bool:
    msg = str(exc).lower()
    tokens = (
        "broken pipe",
        "connection reset",
        "connection aborted",
        "timed out",
        "timeout",
        "temporarily",
        "unreachable",
        "errno 32",
        "errno 104",
        "errno 54",
        "remote end closed",
        "incomplete read",
    )
    return any(t in msg for t in tokens)


def _request_once(method: str, path: str, *, data: bytes, timeout: int) -> tuple[int, bytes, str]:
    """Single POST attempt via http.client (more reliable for large bodies than urllib)."""
    url = f"{_base_url()}{path}"
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise RuntimeError(f"PEAC API URL must be https: {url}")

    headers = {
        **_auth_headers(),
        "Content-Type": "application/json",
        "Content-Length": str(len(data)),
        "Connection": "close",
        "Accept": "application/json",
    }
    port = parsed.port or 443
    ctx = ssl.create_default_context()
    conn = http.client.HTTPSConnection(parsed.hostname, port, timeout=timeout, context=ctx)
    try:
        conn.request(method, parsed.path or "/", body=data, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        content_type = resp.getheader("Content-Type") or ""
        if resp.status >= 400:
            raise RuntimeError(
                f"PEAC API {resp.status}:\n{_format_response_body(raw, content_type)}"
            )
        return resp.status, raw, content_type
    finally:
        conn.close()


def _request(method: str, path: str, *, body: dict[str, Any], timeout: int | None = None) -> tuple[int, bytes, str]:
    url = f"{_base_url()}{path}"
    data = json.dumps(body).encode()
    payload_mb = len(data) / (1024 * 1024)
    # Scale timeout with payload size — large base64 posts need headroom.
    if timeout is None:
        timeout = max(120, int(60 + payload_mb * 15))

    log_body = dict(body)
    if "Document Details" in log_body:
        log_body["Document Details"] = f"<{len(log_body['Document Details'])} document(s), base64 omitted>"
    print("\n" + "=" * 72)
    print(f"[PEAC] >>> {method} {url}")
    print(f"[PEAC] Payload size: {payload_mb:.2f} MB ({len(data)} bytes)")
    print(f"[PEAC] Request body: {json.dumps(log_body, indent=2)}")

    last_exc: BaseException | None = None
    for attempt in range(1, _RETRY_ATTEMPTS + 1):
        try:
            status, raw, content_type = _request_once(method, path, data=data, timeout=timeout)
            print(f"[PEAC] <<< {status} {method} (attempt {attempt}/{_RETRY_ATTEMPTS})")
            print(f"[PEAC] Response body: {_format_response_body(raw, content_type)}")
            print("=" * 72 + "\n")
            return status, raw, content_type
        except RuntimeError as exc:
            # HTTP status errors from PEAC (e.g. "PEAC API 400: ...") are final.
            if str(exc).startswith("PEAC API ") and not _is_transient(exc):
                print(f"[PEAC] <<< HTTP error (attempt {attempt})")
                print(f"[PEAC] Error: {exc}")
                print("=" * 72 + "\n")
                raise
            last_exc = exc
        except (URLError, TimeoutError, ConnectionError, BrokenPipeError, OSError, http.client.HTTPException) as exc:
            last_exc = exc
        except HTTPError as exc:
            err_body = exc.read()
            content_type = exc.headers.get("Content-Type", "") if exc.headers else ""
            print(f"[PEAC] <<< {exc.code} {method} (HTTP error)")
            print(f"[PEAC] Response body: {_format_response_body(err_body, content_type)}")
            print("=" * 72 + "\n")
            raise RuntimeError(f"PEAC API {exc.code}:\n{_format_response_body(err_body, content_type)}") from exc

        assert last_exc is not None
        if attempt >= _RETRY_ATTEMPTS or not _is_transient(last_exc):
            print(f"[PEAC] <<< UNREACHABLE {method}")
            print(f"[PEAC] Error: {last_exc}")
            print("=" * 72 + "\n")
            raise RuntimeError(f"PEAC API unreachable ({method} {path}): {last_exc}") from last_exc
        wait = min(2 ** (attempt - 1), 8)
        print(f"[PEAC] retry {attempt}/{_RETRY_ATTEMPTS} after transient error: {last_exc} (sleep {wait}s)")
        time.sleep(wait)

    assert last_exc is not None
    raise RuntimeError(f"PEAC API unreachable ({method} {path}): {last_exc}") from last_exc


def _shrink_pdf_for_peac(filename: str, data: bytes) -> bytes:
    """Compress oversized PDFs so the single-call PEAC POST stays under PEAC's pipe limit."""
    if not data or len(data) <= _COMPRESS_IF_LARGER_THAN:
        return data
    if not data.lstrip()[:8].startswith(b"%PDF"):
        return data
    try:
        result, compressed = compress_pdf(data, CompressionPreset.BALANCED)
        if len(compressed) < len(data):
            print(
                f"[PEAC] compressed {filename}: "
                f"{result.original_bytes} -> {result.compressed_bytes} bytes "
                f"({result.reduction_percent}% via {result.method})"
            )
            data = compressed
        # Still huge? try aggressive once more.
        if len(data) > 4_000_000:
            result2, compressed2 = compress_pdf(data, CompressionPreset.AGGRESSIVE)
            if len(compressed2) < len(data):
                print(
                    f"[PEAC] re-compressed {filename} aggressively: "
                    f"{result2.original_bytes} -> {result2.compressed_bytes} bytes"
                )
                data = compressed2
    except Exception as exc:
        print(f"[PEAC] compress skipped for {filename}: {exc}")
    return data


def _digits(value: Any, max_len: int | None = None) -> str:
    """PEAC rejects formatted phones/EINs (spaces, dashes, +1). Digits only."""
    out = re.sub(r"[^0-9]", "", str(value or ""))
    if max_len is not None:
        out = out[:max_len]
    return out


def _clean_phone10(value: Any) -> str:
    digits = _digits(value)
    # Strip leading country code 1 when present (11-digit NANP).
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits[:10]


def _build_business_details(business: dict[str, Any], owner: dict[str, Any]) -> dict[str, Any]:
    entity_type = _ENTITY_TYPE_MAP.get((business.get("entity_type") or "").strip().lower(), business.get("entity_type") or "")
    return {
        "Legal Business Name": business.get("legal_name", ""),
        "Business Tax ID": _digits(business.get("tax_id", ""), 9),
        "Business Type": entity_type,
        "Business Address Line 1": business.get("billing_street", ""),
        "Business Address Line 2": "",
        "City": business.get("billing_city", ""),
        "State": business.get("billing_state", "CA"),
        "Zipcode": _digits(business.get("billing_postal_code", ""), 5) or business.get("billing_postal_code", ""),
        "Business Phone": _clean_phone10(business.get("phone", "")),
        "Business Email": owner.get("email", ""),
        "Contact Name": f"{owner.get('first_name', '')} {owner.get('last_name', '')}".strip(),
        "Contact Phone": _clean_phone10(owner.get("phone", "")),
        "Phone Type": "Mobile",
    }


def _as_number(value: Any) -> int:
    """PEAC's live API rejects Amount Needed/Estimated Annual Revenue sent
    as strings ("should be numbers only") - confirmed against a real
    submission. A first fix sending these as JSON floats (e.g. 250000.0)
    still failed the same check - confirmed against a second real
    submission - so PEAC's validator evidently rejects the decimal point
    itself, not just non-numeric strings. Whole integers (250000, no
    ".0") is what the reference Zoho function's string literals ("250000")
    also happen to look like once you strip the quotes, so this is what
    actually matches."""
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return 0


def _build_owner_details(owner: dict[str, Any]) -> dict[str, Any]:
    return {
        "Business Owner Name": f"{owner.get('first_name', '')} {owner.get('last_name', '')}".strip(),
        "Ownership": owner.get("ownership_percentage", 100),
        "Home Address Line 1": owner.get("mailing_street", ""),
        "City": owner.get("mailing_city", ""),
        "State": owner.get("mailing_state", ""),
        "Zipcode": _digits(owner.get("mailing_postal_code", ""), 5) or owner.get("mailing_postal_code", ""),
        "Date of Birth": owner.get("date_of_birth", ""),
        "Social Security Number": _digits(owner.get("ssn", ""), 9),
        "Business Owner Email": owner.get("email", ""),
        "Business Owner Phone": _clean_phone10(owner.get("phone", "")),
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
    doc_list = []
    for filename, data, doc_type in files:
        shrunk = _shrink_pdf_for_peac(filename, data)
        doc_list.append(
            {
                "Attachment": filename,
                "FileDataEncoded": base64.b64encode(shrunk).decode("ascii"),
                "FileExtension": ".pdf",
                "Document Type": doc_type,
                "Description": doc_type,
            }
        )

    payload = {
        "PartnerId": os.getenv("PEAC_PARTNER_ID") or "",
        "Broker Number": os.getenv("PEAC_BROKER_NUMBER") or "",
        "Partner Reference Id": lead_id,
        "Business Details": _build_business_details(business, owner),
        "Amount Needed": _as_number(loan.get("requested_amount")),
        "Estimated Annual Revenue": _as_number(loan.get("average_monthly_revenue")),
        # PEAC's picklist only accepts a fixed set of values, confirmed as
        # "Expansion" in the reference Zoho function - the shared loan_purpose
        # field (free text, e.g. "Working Capital") isn't one of them and
        # gets rejected, so PEAC always sends this literal value regardless
        # of what the form has, unlike every other funder here.
        "Purpose of Loan": "Expansion",
        "Owner Details": [_build_owner_details(owner)],
        "Document Details": doc_list,
    }

    encoded_size = len(json.dumps(payload).encode())
    if encoded_size > _MAX_PAYLOAD_BYTES:
        # Last-resort: aggressively recompress every PDF and rebuild.
        print(
            f"[PEAC] payload {encoded_size} bytes exceeds {_MAX_PAYLOAD_BYTES}; "
            "rebuilding with aggressive compression"
        )
        doc_list = []
        for filename, data, doc_type in files:
            try:
                _, aggressive = compress_pdf(data, CompressionPreset.AGGRESSIVE)
                if len(aggressive) < len(data):
                    data = aggressive
            except Exception as exc:
                print(f"[PEAC] aggressive compress skipped for {filename}: {exc}")
            data = _shrink_pdf_for_peac(filename, data)
            doc_list.append(
                {
                    "Attachment": filename,
                    "FileDataEncoded": base64.b64encode(data).decode("ascii"),
                    "FileExtension": ".pdf",
                    "Document Type": doc_type,
                    "Description": doc_type,
                }
            )
        payload["Document Details"] = doc_list
        encoded_size = len(json.dumps(payload).encode())
        if encoded_size > _MAX_PAYLOAD_BYTES:
            raise RuntimeError(
                f"PEAC payload is still too large after compression "
                f"({encoded_size / (1024 * 1024):.1f} MB). "
                "Please use fewer or smaller bank statements and retry."
            )

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
