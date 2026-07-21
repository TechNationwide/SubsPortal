"""One-time migration: data/store.json -> PostgreSQL.

Usage:
    python migrate_json_to_pg.py            # aborts if target tables aren't empty
    python migrate_json_to_pg.py --force     # wipes and re-migrates anyway

Seeds exactly one admin user matching the current hardcoded credentials
(admin@nationwideadvance.com / Nationwide1!) so the existing admin can log in
immediately after cutover with unchanged credentials.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import bcrypt
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

load_dotenv(BACKEND_DIR / ".env")

SEED_ADMIN_EMAIL = "admin@nationwideadvance.com"
SEED_ADMIN_PASSWORD = "Nationwide1!"


def main() -> None:
    force = "--force" in sys.argv

    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        print("DATABASE_URL is not set (backend/.env).", file=sys.stderr)
        sys.exit(1)

    store_path = REPO_ROOT / "data" / "store.json"
    if not store_path.is_file():
        print(f"No data/store.json found at {store_path}", file=sys.stderr)
        sys.exit(1)

    store = json.loads(store_path.read_text(encoding="utf-8"))
    brands = store.get("brands", [])
    funders = store.get("funders", [])
    teams = store.get("teams", [])

    print(f"Source counts -> brands: {len(brands)}, funders: {len(funders)}, teams: {len(teams)}")

    conn = psycopg2.connect(database_url, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) AS c FROM brands")
            existing_brands = cur.fetchone()["c"]
            cur.execute("SELECT count(*) AS c FROM funders")
            existing_funders = cur.fetchone()["c"]
            cur.execute("SELECT count(*) AS c FROM teams")
            existing_teams = cur.fetchone()["c"]

            if (existing_brands or existing_funders or existing_teams) and not force:
                print(
                    f"Target tables already have data (brands: {existing_brands}, "
                    f"funders: {existing_funders}, teams: {existing_teams}). "
                    "Pass --force to wipe and re-migrate.",
                    file=sys.stderr,
                )
                sys.exit(1)

            if force:
                cur.execute("DELETE FROM funder_brands")
                cur.execute("DELETE FROM funders")
                cur.execute("DELETE FROM brands")
                cur.execute("DELETE FROM team_members")
                cur.execute("DELETE FROM teams")

            # Brands, in order -> ids assigned in the same order (index-based
            # semantics preserved for the API contract).
            brand_ids: list[int] = []
            for b in brands:
                cur.execute(
                    "INSERT INTO brands (name, email, app, accent, aquamark_email) "
                    "VALUES (%s,%s,%s,%s,%s) RETURNING id",
                    (
                        b["name"],
                        b.get("email", ""),
                        b.get("app", ""),
                        b.get("accent", "#4f46e5"),
                        b.get("aquamark_email", ""),
                    ),
                )
                brand_ids.append(cur.fetchone()["id"])

            # Funders + funder_brands join rows.
            for f in funders:
                cur.execute(
                    "INSERT INTO funders (name, email, cc_members) VALUES (%s,%s,%s) RETURNING id",
                    (
                        f["name"],
                        f.get("email", ""),
                        psycopg2.extras.Json(f.get("cc_members", [])),
                    ),
                )
                funder_id = cur.fetchone()["id"]
                for idx in f.get("brands", []):
                    if isinstance(idx, int) and 0 <= idx < len(brand_ids):
                        cur.execute(
                            "INSERT INTO funder_brands (funder_id, brand_id) VALUES (%s,%s)",
                            (funder_id, brand_ids[idx]),
                        )

            # Teams, preserving existing string ids exactly.
            for t in teams:
                cur.execute(
                    "INSERT INTO teams (id, name, lead) VALUES (%s,%s,%s)",
                    (t["id"], t["name"], t.get("lead", "")),
                )
                for pos, m in enumerate(t.get("members", [])):
                    cur.execute(
                        "INSERT INTO team_members (team_id, name, email, position) VALUES (%s,%s,%s,%s)",
                        (t["id"], m.get("name", ""), m.get("email", ""), pos),
                    )

            # Seed the current admin so they aren't locked out post-cutover.
            pw_hash = bcrypt.hashpw(SEED_ADMIN_PASSWORD.encode(), bcrypt.gensalt(rounds=12)).decode()
            cur.execute(
                "INSERT INTO users (name, email, role, password_hash) VALUES (%s,%s,%s,%s) "
                "ON CONFLICT (lower(email)) DO NOTHING",
                ("Admin", SEED_ADMIN_EMAIL, "admin", pw_hash),
            )

            cur.execute("SELECT count(*) AS c FROM brands")
            final_brands = cur.fetchone()["c"]
            cur.execute("SELECT count(*) AS c FROM funders")
            final_funders = cur.fetchone()["c"]
            cur.execute("SELECT count(*) AS c FROM teams")
            final_teams = cur.fetchone()["c"]
            cur.execute("SELECT count(*) AS c FROM users")
            final_users = cur.fetchone()["c"]

        conn.commit()
        print(
            f"Migrated -> brands: {len(brands)} -> {final_brands}, "
            f"funders: {len(funders)} -> {final_funders}, "
            f"teams: {len(teams)} -> {final_teams}, "
            f"users: {final_users} (includes seeded admin)"
        )
        if final_brands != len(brands) or final_funders != len(funders) or final_teams != len(teams):
            print("WARNING: counts do not match source. Investigate before cutting over.", file=sys.stderr)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
