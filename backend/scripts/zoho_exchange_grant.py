"""
Exchange a Zoho Self-Client grant code for a refresh token, then update backend/.env.

Usage (on the server, from backend/):
  .venv/bin/python scripts/zoho_exchange_grant.py --code '1000.xxxx...'

The grant code is one-time and expires in ~10 minutes. Generate it in:
  Zoho API Console → Self Client → Generate Code
  Scopes: ZohoCRM.modules.ALL,ZohoSearch.securesearch.READ
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"


def _load_env() -> None:
    load_dotenv(ENV_PATH)


def _accounts_url() -> str:
    return (os.getenv("ZOHO_ACCOUNTS_URL") or "https://accounts.zoho.com").rstrip("/")


def exchange(code: str) -> dict:
    client_id = os.environ.get("ZOHO_CLIENT_ID")
    client_secret = os.environ.get("ZOHO_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise SystemExit("ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET missing in backend/.env")

    body = urlencode(
        {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code.strip(),
        }
    ).encode()
    url = f"{_accounts_url()}/oauth/v2/token"
    req = Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except HTTPError as exc:
        raw = exc.read()
        try:
            return json.loads(raw)
        except Exception:
            raise SystemExit(f"HTTP {exc.code}: {raw[:500]!r}") from exc
    except URLError as exc:
        raise SystemExit(f"Unreachable: {exc}") from exc


def update_env_refresh_token(refresh_token: str) -> None:
    text = ENV_PATH.read_text(encoding="utf-8")
    pattern = re.compile(r"^ZOHO_REFRESH_TOKEN=.*$", re.M)
    line = f"ZOHO_REFRESH_TOKEN={refresh_token}"
    if pattern.search(text):
        text = pattern.sub(line, text)
    else:
        if not text.endswith("\n"):
            text += "\n"
        text += line + "\n"
    ENV_PATH.write_text(text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Mint Zoho refresh token from Self Client grant code")
    parser.add_argument("--code", required=True, help="Fresh Self Client grant code (10-minute TTL)")
    parser.add_argument("--dry-run", action="store_true", help="Exchange only; do not write .env")
    args = parser.parse_args()

    _load_env()
    data = exchange(args.code)
    if not data.get("refresh_token"):
        print("Exchange failed:", file=sys.stderr)
        print(json.dumps(data, indent=2), file=sys.stderr)
        return 1

    refresh = data["refresh_token"]
    print("OK — received refresh_token")
    print(f"  length={len(refresh)}")
    print(f"  prefix={refresh[:12]}...")
    print(f"  api_domain={data.get('api_domain')}")
    print(f"  scope={data.get('scope')}")

    if args.dry_run:
        print("Dry-run: .env not modified")
        return 0

    update_env_refresh_token(refresh)
    print(f"Updated {ENV_PATH}")
    print("Restart API: pm2 restart vateam-api")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
