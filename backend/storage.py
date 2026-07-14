"""Portal configuration persistence.

Local dev: a JSON file under data/ (unchanged from before).
Render (or anywhere with no persistent disk): set MONGODB_URI and this
switches to a single document in MongoDB Atlas's free tier instead, since
Render's free web services lose local disk contents on every restart.
"""

from __future__ import annotations

import json
import os
import threading
from copy import deepcopy
from pathlib import Path
from typing import Any

from defaults import DEFAULT_BRANDS, DEFAULT_FUNDERS, DEFAULT_TEAMS

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
STORE_PATH = DATA_DIR / "store.json"
_lock = threading.Lock()

_MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
_mongo_collection = None


def _get_mongo_collection():
    global _mongo_collection
    if _mongo_collection is None:
        from pymongo import MongoClient  # lazy import: not required for local JSON-file dev

        db_name = os.getenv("MONGODB_DB", "subsportal")
        client = MongoClient(_MONGODB_URI)
        _mongo_collection = client[db_name]["config"]
    return _mongo_collection


def _default_store() -> dict[str, Any]:
    return {
        "brands": deepcopy(DEFAULT_BRANDS),
        "funders": deepcopy(DEFAULT_FUNDERS),
        "teams": deepcopy(DEFAULT_TEAMS),
    }


def load_store() -> dict[str, Any]:
    if _MONGODB_URI:
        with _lock:
            doc = _get_mongo_collection().find_one({"_id": "store"})
            if doc is None:
                store = _default_store()
                save_store(store)
                return store
            doc.pop("_id", None)
            return doc

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STORE_PATH.is_file():
        store = _default_store()
        save_store(store)
        return store
    with _lock:
        return json.loads(STORE_PATH.read_text(encoding="utf-8"))


def save_store(store: dict[str, Any]) -> None:
    if _MONGODB_URI:
        with _lock:
            _get_mongo_collection().replace_one({"_id": "store"}, {**store, "_id": "store"}, upsert=True)
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _lock:
        STORE_PATH.write_text(json.dumps(store, indent=2), encoding="utf-8")


def _normalize_brand(brand: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in brand.items() if k != "logo"}
    out["aquamark_email"] = str(out.get("aquamark_email") or "").strip()
    return out


def get_brands() -> list[dict[str, Any]]:
    return [_normalize_brand(b) for b in load_store()["brands"]]


def save_brands(brands: list[dict[str, Any]]) -> list[dict[str, Any]]:
    store = load_store()
    store["brands"] = [_normalize_brand(b) for b in brands]
    save_store(store)
    return brands


def _normalize_cc_members(funder: dict[str, Any]) -> list[dict[str, str]]:
    raw = funder.get("cc_members")
    if isinstance(raw, list):
        members: list[dict[str, str]] = []
        for item in raw:
            if isinstance(item, dict):
                name = str(item.get("name") or "").strip()
                email = str(item.get("email") or "").strip()
                if name or email:
                    members.append({"name": name, "email": email})
        return members
    legacy = str(funder.get("cc") or "").strip()
    if legacy:
        members = []
        for part in legacy.replace(";", ",").split(","):
            email = part.strip()
            if email:
                members.append({"name": "", "email": email})
        return members
    return []


def _normalize_funder(funder: dict[str, Any]) -> dict[str, Any]:
    raw_brands = funder.get("brands")
    brands: list[int] = []
    if isinstance(raw_brands, list):
        brands = sorted({int(b) for b in raw_brands if isinstance(b, (int, float)) and int(b) >= 0})
    return {
        "name": str(funder.get("name") or "").strip(),
        "email": str(funder.get("email") or "").strip(),
        "cc_members": _normalize_cc_members(funder),
        "brands": brands,
    }


def get_funders() -> list[dict[str, Any]]:
    return [_normalize_funder(f) for f in load_store()["funders"]]


def save_funders(funders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    store = load_store()
    store["funders"] = [_normalize_funder(f) for f in funders]
    save_store(store)
    return funders


def get_teams() -> list[dict[str, Any]]:
    return load_store()["teams"]


def save_teams(teams: list[dict[str, Any]]) -> list[dict[str, Any]]:
    store = load_store()
    store["teams"] = teams
    save_store(store)
    return teams


def sync_funders_after_brand_removal(removed_index: int) -> None:
    funders = get_funders()
    for funder in funders:
        funder["brands"] = [
            bi - 1 if bi > removed_index else bi
            for bi in funder.get("brands", [])
            if bi != removed_index
        ]
    save_funders(funders)
