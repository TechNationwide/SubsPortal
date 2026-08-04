"""
Aquamark Broker API — async job + polling + ZIP download.

Docs: Broker API (watermark-broker-funder)
  POST {base}/watermark-broker-funder
  GET  {base}/job-status/:job_id
  GET  {base}/download/:job_id

Environment (backend/.env):
  AQUAMARK_API_KEY       — Bearer token (test key works immediately per Aquamark docs)
  AQUAMARK_USER_EMAIL    — optional fallback Aquamark account email when brand has none set
  AQUAMARK_API_URL       — optional; default https://aquamark-broker-funder.onrender.com
  AQUAMARK_WATERMARK_TYPE — optional; full (default) | funder_only
  AQUAMARK_POLL_INTERVAL — seconds between status polls (default 10)
  AQUAMARK_POLL_TIMEOUT  — max wait seconds (default 600)
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import time
import zipfile
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_BASE = "https://aquamark-broker-funder.onrender.com"


def _base_url() -> str:
    return (os.getenv("AQUAMARK_API_URL") or DEFAULT_BASE).rstrip("/")


def aquamark_configured() -> bool:
    return bool(os.getenv("AQUAMARK_API_KEY"))


def _funder_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower().strip())
    return slug.strip("-")


def _normalize_funder_names(funders: list[str]) -> list[str]:
    """Aquamark truncates funder names to 40 characters."""
    seen: set[str] = set()
    out: list[str] = []
    for name in funders:
        clean = name.strip()[:40]
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return out


def _mask_auth_header(value: str) -> str:
    if value.startswith("Bearer "):
        token = value[7:]
        if len(token) <= 8:
            return "Bearer ***"
        return f"Bearer ...{token[-4:]}"
    return "***"


def _mask_sensitive_header(key: str, value: str) -> str:
    lower = key.lower()
    if lower == "authorization":
        return _mask_auth_header(value)
    if lower in ("x-user-email", "user-email", "x-api-key", "api-key"):
        return value
    return value


def _format_headers(headers: Any) -> str:
    lines: list[str] = []
    for key, value in headers.items():
        display = _mask_sensitive_header(key, value)
        lines.append(f"  {key}: {display}")
    return "\n".join(lines) if lines else "  (none)"


def _aquamark_error_message(status: int, err_body: bytes, content_type: str = "") -> str:
    body_text = _format_response_body(err_body, content_type)
    return f"Aquamark API {status}:\n{body_text}"


def _sanitize_body_for_log(body: dict[str, Any] | None) -> Any:
    if not body:
        return None
    out = dict(body)
    files = out.get("files")
    if isinstance(files, list):
        out["files"] = [
            {
                **item,
                "data": f"<base64 {len(item.get('data', ''))} chars>",
            }
            if isinstance(item, dict) and "data" in item
            else item
            for item in files
        ]
    return out


def _format_response_body(raw: bytes, content_type: str) -> str:
    if not raw:
        return "(empty)"
    if "zip" in content_type.lower() or raw.startswith(b"PK"):
        return f"<binary zip, {len(raw)} bytes>"
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


def _with_retry(label: str, fn, *, attempts: int | None = None):
    """Retry transient Aquamark/Render cold-start failures (unreachable, 5xx, timeouts)."""
    attempts = attempts or int(os.getenv("AQUAMARK_RETRY_ATTEMPTS", "3"))
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except RuntimeError as exc:
            last_exc = exc
            msg = str(exc).lower()
            transient = any(
                token in msg
                for token in (
                    "unreachable",
                    "timed out",
                    "timeout",
                    "temporarily",
                    "api 500",
                    "api 502",
                    "api 503",
                    "api 504",
                    "connection reset",
                    "broken pipe",
                )
            )
            if not transient or attempt >= attempts:
                raise
            wait = min(2 ** (attempt - 1), 8)
            print(f"[Aquamark] retry {attempt}/{attempts} after {label}: {exc} (sleep {wait}s)")
            time.sleep(wait)
    assert last_exc is not None
    raise last_exc


def _validate_pdf_bytes(name: str, data: bytes) -> None:
    if not data:
        raise ValueError(f"{name}: file is empty — Aquamark cannot process it.")
    # Some PDFs have a UTF-8 BOM or leading whitespace; strip only whitespace.
    head = data.lstrip()[:8]
    if not head.startswith(b"%PDF"):
        raise ValueError(
            f"{name}: not a valid PDF (missing %PDF header). "
            "Corrupt/encrypted/non-PDF files commonly cause 'Aquamark processing failed'."
        )


def _api_request(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    accept: str = "application/json",
    timeout: int = 120,
    user_email: str = "",
) -> tuple[int, bytes, str]:
    api_key = os.getenv("AQUAMARK_API_KEY") or ""
    url = f"{_base_url()}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {api_key}")
    email = user_email.strip()
    if email:
        req.add_header("X-User-Email", email)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    req.add_header("Accept", accept)

    print("\n" + "=" * 72)
    print(f"[Aquamark] >>> {method} {url}")
    print("[Aquamark] Request headers:")
    print(_format_headers(req.headers))
    if body is not None:
        print("[Aquamark] Request body:")
        print(json.dumps(_sanitize_body_for_log(body), indent=2))

    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            content_type = resp.headers.get("Content-Type", "")
            print(f"[Aquamark] <<< {resp.status} {method} {path}")
            print("[Aquamark] Response headers:")
            print(_format_headers(resp.headers))
            print("[Aquamark] Response body:")
            print(_format_response_body(raw, content_type))
            print("=" * 72 + "\n")
            return resp.status, raw, content_type
    except HTTPError as exc:
        err_body = exc.read()
        content_type = exc.headers.get("Content-Type", "") if exc.headers else ""
        print(f"[Aquamark] <<< {exc.code} {method} {path} (HTTP error)")
        print("[Aquamark] Response headers:")
        print(_format_headers(exc.headers) if exc.headers else "  (none)")
        print("[Aquamark] Response body:")
        print(_format_response_body(err_body, content_type))
        print("=" * 72 + "\n")
        raise RuntimeError(_aquamark_error_message(exc.code, err_body, content_type)) from exc
    except URLError as exc:
        print(f"[Aquamark] <<< UNREACHABLE {method} {path}")
        print(f"[Aquamark] Error: {exc}")
        print("=" * 72 + "\n")
        raise RuntimeError(f"Aquamark API unreachable ({method} {path}): {exc}") from exc


def _submit_job(
    files: list[tuple[str, bytes]],
    funders: list[str],
    metadata: dict[str, Any] | None,
    user_email: str,
) -> str:
    attributed_funders = _normalize_funder_names(funders)
    if not attributed_funders:
        raise ValueError("At least one funder name is required for recipient attribution.")

    email = user_email.strip()
    if not email:
        raise ValueError("Aquamark user email is required.")

    payload: dict[str, Any] = {
        "user_email": email,
        "funder": attributed_funders,
        "files": [
            {"name": name, "data": base64.b64encode(data).decode("ascii")}
            for name, data in files
        ],
        "metadata": {
            "recipients": attributed_funders,
            **(metadata or {}),
        },
    }
    wm_type = os.getenv("AQUAMARK_WATERMARK_TYPE", "full")
    if wm_type in ("full", "funder_only"):
        payload["watermark_type"] = wm_type

    # Large multi-PDF base64 bodies + Render cold starts need a longer timeout.
    def _do_submit():
        return _api_request(
            "POST",
            "/watermark-broker-funder",
            body=payload,
            user_email=email,
            timeout=int(os.getenv("AQUAMARK_SUBMIT_TIMEOUT", "180")),
        )

    _, raw, content_type = _with_retry("submit", _do_submit)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"Aquamark submit returned invalid JSON:\n{_format_response_body(raw, content_type)}"
        ) from None
    job_id = data.get("job_id")
    if not job_id:
        raise RuntimeError(
            f"Aquamark submit failed:\n{json.dumps(data, indent=2)}"
        )
    return str(job_id)


def _poll_until_complete(job_id: str, user_email: str) -> dict[str, Any]:
    interval = float(os.getenv("AQUAMARK_POLL_INTERVAL", "10"))
    timeout = float(os.getenv("AQUAMARK_POLL_TIMEOUT", "600"))
    deadline = time.monotonic() + timeout

    while time.monotonic() < deadline:
        _, raw, content_type = _with_retry(
            "job-status",
            lambda: _api_request(
                "GET",
                f"/job-status/{job_id}",
                timeout=30,
                user_email=user_email,
            ),
        )
        try:
            status = json.loads(raw)
        except json.JSONDecodeError:
            raise RuntimeError(
                f"Aquamark job-status returned invalid JSON:\n"
                f"{_format_response_body(raw, content_type)}"
            ) from None
        state = status.get("status")
        if state == "complete":
            return status
        if state == "error":
            raise RuntimeError(
                f"Aquamark job failed:\n{json.dumps(status, indent=2)}"
            )
        time.sleep(interval)

    raise RuntimeError(f"Aquamark job timed out while polling (job_id: {job_id}).")


def _download_zip(job_id: str, user_email: str) -> bytes:
    _, data, content_type = _with_retry(
        "download",
        lambda: _api_request(
            "GET",
            f"/download/{job_id}",
            accept="application/zip, application/octet-stream, */*",
            timeout=300,
            user_email=user_email,
        ),
    )
    if not data.startswith(b"PK") and "zip" not in content_type.lower():
        raise RuntimeError(
            f"Aquamark download did not return a ZIP file:\n"
            f"{_format_response_body(data, content_type)}"
        )
    return data


def _match_zip_entry(
    zip_name: str,
    uploaded: list[tuple[str, bytes]],
    funders: list[str],
) -> tuple[str, str | None]:
    """Map Aquamark ZIP member to (original_filename, funder_name)."""
    lower = zip_name.lower()
    for funder in funders:
        slug = _funder_slug(funder)
        suffix = f"-{slug}.pdf"
        if lower.endswith(suffix):
            base_stem = zip_name[: -len(suffix)]
            for orig_name, _ in uploaded:
                orig_stem = re.sub(r"\.pdf$", "", orig_name, flags=re.I)
                if orig_stem.lower() == base_stem.lower():
                    return orig_name, funder
            return f"{base_stem}.pdf", funder
    for orig_name, _ in uploaded:
        stem = re.sub(r"\.pdf$", "", orig_name, flags=re.I)
        if lower == f"{stem.lower()}-protected.pdf" or lower == orig_name.lower():
            return orig_name, None
    return zip_name, None


def process_batch(
    files: list[tuple[str, bytes]],
    *,
    funders: list[str],
    brand_name: str,
    deal_name: str,
    user_email: str,
    metadata: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Submit all PDFs + funders to Aquamark, poll, download ZIP, return extracted files.
    Each item: {name, data, original, recipient}
    """
    meta = {
        "brand_name": brand_name,
        "deal_name": deal_name,
        "recipients": _normalize_funder_names(funders),
        **(metadata or {}),
    }
    attributed = _normalize_funder_names(funders)
    for name, data in files:
        _validate_pdf_bytes(name, data)
    job_id = _submit_job(files, attributed, meta, user_email)
    _poll_until_complete(job_id, user_email)
    zip_bytes = _download_zip(job_id, user_email)

    results: list[dict[str, Any]] = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name
            if not name.lower().endswith(".pdf"):
                continue
            data = zf.read(info)
            original, recipient = _match_zip_entry(name, files, attributed)
            results.append(
                {
                    "name": name,
                    "data": data,
                    "original": original,
                    "recipient": recipient,
                }
            )
    if not results:
        raise RuntimeError("Aquamark ZIP contained no PDF files.")
    return results


def describe_integration() -> dict[str, Any]:
    return {
        "configured": aquamark_configured(),
        "api_url": _base_url(),
        "api_key_set": bool(os.getenv("AQUAMARK_API_KEY")),
        "user_email_set": bool(os.getenv("AQUAMARK_USER_EMAIL")),
        "watermark_type": os.getenv("AQUAMARK_WATERMARK_TYPE", "full"),
        "flatten": os.getenv("AQUAMARK_FLATTEN", "true").lower() in ("1", "true", "yes"),
        "docs": "https://www.aquamark.io/broker",
    }
