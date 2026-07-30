"""Postgres-backed persistence + auth. Replaces storage.py.

Brands/funders are still addressed by list index externally (same contract
the frontend already uses) - "index" here just means ordinal position in
`ORDER BY id`. funder_brands stores the real (funder_id, brand_id) pair, so
get_funders() translates ids -> current indices at read time and
save_funders() translates indices -> ids at write time.

save_brands() is careful to only touch rows that actually changed instead of
wiping the whole table on every save: funder_brands' ON DELETE CASCADE means
a naive "delete everything, reinsert everything" would silently destroy every
funder's brand associations, not just the one for the brand actually being
removed/edited.
"""

from __future__ import annotations

import bcrypt
import os
import secrets
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

import json

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

psycopg2.extras.register_default_jsonb(loads=json.loads)

DATABASE_URL = os.getenv("DATABASE_URL", "")
SESSION_TTL = timedelta(days=30)
_pool: ThreadedConnectionPool | None = None


def _get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        if not DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not set (backend/.env).")
        _pool = ThreadedConnectionPool(minconn=2, maxconn=10, dsn=DATABASE_URL)
    return _pool


@contextmanager
def _cursor():
    pool = _get_pool()
    conn = pool.getconn()
    broken = False
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur
        conn.commit()
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        # The connection itself died (server closed it after being idle,
        # network blip, etc.) - rolling back on a dead connection just
        # raises again, and returning it to the pool as if it were healthy
        # means the next caller gets the same dead connection, and the one
        # after that, until the pool is full of connections that all raise
        # immediately - which looks like "pool exhausted" once every slot
        # is holding a broken connection nobody can use.
        broken = True
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn, close=broken)


# ───────────────────────── brands ─────────────────────────

_BRAND_COLUMNS = ("name", "email", "app", "accent", "aquamark_email")


def _brand_content(row: dict[str, Any]) -> dict[str, Any]:
    return {k: row[k] for k in _BRAND_COLUMNS}


def _brand_values(b: dict[str, Any]) -> tuple:
    return (
        b["name"],
        b.get("email", ""),
        b.get("app", ""),
        b.get("accent", "#4f46e5"),
        b.get("aquamark_email", ""),
    )


def get_brands() -> list[dict[str, Any]]:
    with _cursor() as cur:
        cur.execute(f"SELECT {', '.join(_BRAND_COLUMNS)} FROM brands ORDER BY id")
        return [dict(r) for r in cur.fetchall()]


def save_brands(brands: list[dict[str, Any]]) -> list[dict[str, Any]]:
    with _cursor() as cur:
        cur.execute(f"SELECT id, {', '.join(_BRAND_COLUMNS)} FROM brands ORDER BY id")
        current = [dict(r) for r in cur.fetchall()]
        current_ids = [r["id"] for r in current]
        current_content = [_brand_content(r) for r in current]
        n_old, n_new = len(current_ids), len(brands)

        if n_new == n_old + 1 and current_content == brands[:n_old]:
            # Pure append (create_brand) - existing rows untouched.
            cur.execute(
                f"INSERT INTO brands ({', '.join(_BRAND_COLUMNS)}) VALUES (%s,%s,%s,%s,%s)",
                _brand_values(brands[-1]),
            )
        elif n_new == n_old - 1:
            # One removed (delete_brand) - delete only the row that's actually
            # gone; every surviving brand keeps its id, so funder_brands for
            # everything else stays intact automatically.
            idx = next((i for i in range(n_new) if current_content[i] != brands[i]), n_new)
            cur.execute("DELETE FROM brands WHERE id=%s", (current_ids[idx],))
        elif n_new == n_old:
            # Edit in place (update_brand) - update only the changed row(s).
            for i in range(n_new):
                if current_content[i] != brands[i]:
                    cur.execute(
                        f"UPDATE brands SET {', '.join(f'{c}=%s' for c in _BRAND_COLUMNS)} WHERE id=%s",
                        _brand_values(brands[i]) + (current_ids[i],),
                    )
        else:
            # Unexpected shape - conservative fallback: update overlapping
            # positions that changed, drop extra trailing rows, append new ones.
            for i in range(min(n_old, n_new)):
                if current_content[i] != brands[i]:
                    cur.execute(
                        f"UPDATE brands SET {', '.join(f'{c}=%s' for c in _BRAND_COLUMNS)} WHERE id=%s",
                        _brand_values(brands[i]) + (current_ids[i],),
                    )
            for extra_id in current_ids[n_new:]:
                cur.execute("DELETE FROM brands WHERE id=%s", (extra_id,))
            for b in brands[n_old:]:
                cur.execute(
                    f"INSERT INTO brands ({', '.join(_BRAND_COLUMNS)}) VALUES (%s,%s,%s,%s,%s)",
                    _brand_values(b),
                )
    return brands


def sync_funders_after_brand_removal(removed_index: int) -> None:
    """No-op under Postgres.

    funder_brands has ON DELETE CASCADE on brand_id, and get_funders()
    recomputes each funder's brand indices from the *current* brand ordering
    at read time - so removing a brand automatically drops any funder's
    association with it and shifts remaining indices down, with no separate
    bookkeeping pass required (unlike the old JSON-file implementation).
    """


# ───────────────────────── funders ─────────────────────────

def get_funders() -> list[dict[str, Any]]:
    with _cursor() as cur:
        cur.execute("SELECT id FROM brands ORDER BY id")
        brand_index = {row["id"]: i for i, row in enumerate(cur.fetchall())}

        cur.execute("SELECT id, name, email, cc_members FROM funders ORDER BY id")
        funders = [dict(r) for r in cur.fetchall()]

        cur.execute("SELECT funder_id, brand_id FROM funder_brands")
        by_funder: dict[int, list[int]] = {}
        for row in cur.fetchall():
            by_funder.setdefault(row["funder_id"], []).append(row["brand_id"])

    result = []
    for f in funders:
        indices = sorted(
            brand_index[bid] for bid in by_funder.get(f["id"], []) if bid in brand_index
        )
        result.append(
            {
                "name": f["name"],
                "email": f["email"],
                "cc_members": f["cc_members"] or [],
                "brands": indices,
            }
        )
    return result


def save_funders(funders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    with _cursor() as cur:
        cur.execute("SELECT id FROM brands ORDER BY id")
        brand_ids = [r["id"] for r in cur.fetchall()]

        cur.execute("DELETE FROM funders")  # cascades funder_brands
        for f in funders:
            cur.execute(
                "INSERT INTO funders (name, email, cc_members) VALUES (%s,%s,%s) RETURNING id",
                (f["name"], f.get("email", ""), psycopg2.extras.Json(f.get("cc_members", []))),
            )
            funder_id = cur.fetchone()["id"]
            for idx in f.get("brands", []):
                if isinstance(idx, int) and 0 <= idx < len(brand_ids):
                    cur.execute(
                        "INSERT INTO funder_brands (funder_id, brand_id) VALUES (%s,%s)",
                        (funder_id, brand_ids[idx]),
                    )
    return funders


# ───────────────────────── teams ─────────────────────────

def get_teams() -> list[dict[str, Any]]:
    with _cursor() as cur:
        cur.execute("SELECT id, name, lead FROM teams ORDER BY id")
        teams = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT team_id, name, email FROM team_members ORDER BY team_id, position")
        members_by_team: dict[str, list[dict[str, str]]] = {}
        for row in cur.fetchall():
            members_by_team.setdefault(row["team_id"], []).append(
                {"name": row["name"], "email": row["email"]}
            )
    for t in teams:
        t["members"] = members_by_team.get(t["id"], [])
    return teams


def save_teams(teams: list[dict[str, Any]]) -> list[dict[str, Any]]:
    with _cursor() as cur:
        cur.execute("SELECT id FROM teams")
        existing_ids = {r["id"] for r in cur.fetchall()}
        incoming_ids = {t["id"] for t in teams}
        for stale_id in existing_ids - incoming_ids:
            cur.execute("DELETE FROM teams WHERE id=%s", (stale_id,))  # cascades team_members

        for t in teams:
            cur.execute(
                "INSERT INTO teams (id, name, lead) VALUES (%s,%s,%s) "
                "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, lead=EXCLUDED.lead",
                (t["id"], t["name"], t.get("lead", "")),
            )
            cur.execute("DELETE FROM team_members WHERE team_id=%s", (t["id"],))
            for pos, m in enumerate(t.get("members", [])):
                cur.execute(
                    "INSERT INTO team_members (team_id, name, email, position) VALUES (%s,%s,%s,%s)",
                    (t["id"], m.get("name", ""), m.get("email", ""), pos),
                )
    return teams


# ───────────────────────── users / auth ─────────────────────────

def verify_login(email: str, password: str) -> dict[str, Any] | None:
    with _cursor() as cur:
        cur.execute(
            "SELECT id, name, email, password_hash, role FROM users "
            "WHERE lower(email) = lower(%s) AND is_active = true",
            (email,),
        )
        row = cur.fetchone()
    if not row or not bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
        return None
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + SESSION_TTL
    with _cursor() as cur:
        cur.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (%s,%s,%s)",
            (token, user_id, expires),
        )
    return token


def get_user_by_token(token: str) -> dict[str, Any] | None:
    with _cursor() as cur:
        cur.execute(
            "SELECT u.id, u.name, u.email, u.role, u.is_active, s.expires_at "
            "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = %s",
            (token,),
        )
        row = cur.fetchone()
        if not row or not row["is_active"] or row["expires_at"] < datetime.now(timezone.utc):
            return None
        cur.execute("UPDATE sessions SET last_seen_at = now() WHERE token = %s", (token,))
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}


def delete_session(token: str) -> None:
    with _cursor() as cur:
        cur.execute("DELETE FROM sessions WHERE token = %s", (token,))


def count_admins(exclude_user_id: int | None = None) -> int:
    with _cursor() as cur:
        if exclude_user_id is not None:
            cur.execute(
                "SELECT count(*) AS c FROM users WHERE role='admin' AND is_active=true AND id != %s",
                (exclude_user_id,),
            )
        else:
            cur.execute("SELECT count(*) AS c FROM users WHERE role='admin' AND is_active=true")
        return cur.fetchone()["c"]


def list_users() -> list[dict[str, Any]]:
    with _cursor() as cur:
        cur.execute("SELECT id, name, email, role, is_active FROM users ORDER BY id")
        return [dict(r) for r in cur.fetchall()]


def create_user(name: str, email: str, role: str, password: str) -> dict[str, Any]:
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
    with _cursor() as cur:
        cur.execute(
            "INSERT INTO users (name, email, role, password_hash) VALUES (%s,%s,%s,%s) "
            "RETURNING id, name, email, role, is_active",
            (name, email, role, pw_hash),
        )
        return dict(cur.fetchone())


def update_user(user_id: int, name: str, email: str, role: str) -> None:
    with _cursor() as cur:
        cur.execute(
            "UPDATE users SET name=%s, email=%s, role=%s, updated_at=now() WHERE id=%s",
            (name, email, role, user_id),
        )


def delete_user(user_id: int) -> None:
    with _cursor() as cur:
        cur.execute("DELETE FROM users WHERE id=%s", (user_id,))


def reset_password(user_id: int, password: str) -> None:
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
    with _cursor() as cur:
        cur.execute(
            "UPDATE users SET password_hash=%s, updated_at=now() WHERE id=%s",
            (pw_hash, user_id),
        )


# ───────────────────────── partner submissions (funder API tab) ─────────────────────────

_PARTNER_SUBMISSION_COLUMNS = (
    "id", "funder_key", "brand_name", "deal_name", "created_by_user_id",
    "aquamark_job_id", "external_id", "status",
    "business_details", "owner_details", "loan_details", "last_error",
    "created_at", "updated_at",
)


def create_partner_submission(
    *,
    funder_key: str,
    brand_name: str,
    deal_name: str,
    created_by_user_id: int,
    business_details: dict[str, Any],
    owner_details: list[dict[str, Any]],
    loan_details: dict[str, Any],
    aquamark_job_id: str = "",
) -> dict[str, Any]:
    with _cursor() as cur:
        cur.execute(
            "INSERT INTO partner_submissions "
            "(funder_key, brand_name, deal_name, created_by_user_id, aquamark_job_id, "
            " business_details, owner_details, loan_details) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
            f"RETURNING {', '.join(_PARTNER_SUBMISSION_COLUMNS)}",
            (
                funder_key,
                brand_name,
                deal_name,
                created_by_user_id,
                aquamark_job_id,
                psycopg2.extras.Json(business_details),
                psycopg2.extras.Json(owner_details),
                psycopg2.extras.Json(loan_details),
            ),
        )
        return dict(cur.fetchone())


def get_partner_submission(submission_id: int) -> dict[str, Any] | None:
    with _cursor() as cur:
        cur.execute(
            f"SELECT {', '.join(_PARTNER_SUBMISSION_COLUMNS)} FROM partner_submissions WHERE id=%s",
            (submission_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def list_partner_submissions(
    created_by_user_id: int, status_in: list[str] | None = None
) -> list[dict[str, Any]]:
    with _cursor() as cur:
        if status_in:
            cur.execute(
                f"SELECT {', '.join(_PARTNER_SUBMISSION_COLUMNS)} FROM partner_submissions "
                "WHERE created_by_user_id=%s AND status = ANY(%s) ORDER BY id DESC",
                (created_by_user_id, status_in),
            )
        else:
            cur.execute(
                f"SELECT {', '.join(_PARTNER_SUBMISSION_COLUMNS)} FROM partner_submissions "
                "WHERE created_by_user_id=%s ORDER BY id DESC",
                (created_by_user_id,),
            )
        return [dict(r) for r in cur.fetchall()]


def update_partner_submission(submission_id: int, **fields: Any) -> dict[str, Any] | None:
    """Patches any subset of external_id/status/last_error/aquamark_job_id."""
    allowed = {"external_id", "status", "last_error", "aquamark_job_id"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return get_partner_submission(submission_id)
    set_clause = ", ".join(f"{k}=%s" for k in updates)
    with _cursor() as cur:
        cur.execute(
            f"UPDATE partner_submissions SET {set_clause}, updated_at=now() WHERE id=%s "
            f"RETURNING {', '.join(_PARTNER_SUBMISSION_COLUMNS)}",
            (*updates.values(), submission_id),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def delete_partner_submission(submission_id: int) -> None:
    with _cursor() as cur:
        cur.execute("DELETE FROM partner_submissions WHERE id=%s", (submission_id,))


def add_partner_submission_event(
    submission_id: int, *, action: str, ok: bool, http_status: int | None, message: str = ""
) -> None:
    with _cursor() as cur:
        cur.execute(
            "INSERT INTO partner_submission_events (submission_id, action, ok, http_status, message) "
            "VALUES (%s,%s,%s,%s,%s)",
            (submission_id, action, ok, http_status, message),
        )


def list_partner_submission_events(submission_id: int) -> list[dict[str, Any]]:
    with _cursor() as cur:
        cur.execute(
            "SELECT id, action, ok, http_status, message, created_at "
            "FROM partner_submission_events WHERE submission_id=%s ORDER BY id",
            (submission_id,),
        )
        return [dict(r) for r in cur.fetchall()]


_PARTNER_KEYS = ("ondeck", "can", "idea", "channel", "peac")


def get_partner_brand_assignments() -> dict[str, dict[str, Any] | None]:
    """Keyed by funder_key; each value is {brand_index, brand_name} or None.

    Brands are addressed by ordinal position (ORDER BY id) everywhere else
    in this API (see get_funders()/save_funders()) - this translates the
    stored real brand_id back to that same "index" contract at read time.
    """
    with _cursor() as cur:
        cur.execute("SELECT id, name FROM brands ORDER BY id")
        ordered = [dict(r) for r in cur.fetchall()]
        index_by_id = {b["id"]: i for i, b in enumerate(ordered)}

        cur.execute("SELECT funder_key, brand_id FROM partner_brand_assignments WHERE brand_id IS NOT NULL")
        assigned = {r["funder_key"]: r["brand_id"] for r in cur.fetchall()}

    result: dict[str, dict[str, Any] | None] = {}
    for key in _PARTNER_KEYS:
        brand_id = assigned.get(key)
        if brand_id is not None and brand_id in index_by_id:
            idx = index_by_id[brand_id]
            result[key] = {"brand_index": idx, "brand_name": ordered[idx]["name"]}
        else:
            result[key] = None
    return result


def set_partner_brand_assignment(funder_key: str, brand_index: int | None) -> None:
    brand_id: int | None = None
    if brand_index is not None:
        with _cursor() as cur:
            cur.execute("SELECT id FROM brands ORDER BY id")
            ids = [r["id"] for r in cur.fetchall()]
        if brand_index < 0 or brand_index >= len(ids):
            raise ValueError("Invalid brand index.")
        brand_id = ids[brand_index]

    with _cursor() as cur:
        cur.execute(
            "INSERT INTO partner_brand_assignments (funder_key, brand_id, updated_at) "
            "VALUES (%s,%s,now()) "
            "ON CONFLICT (funder_key) DO UPDATE SET brand_id=EXCLUDED.brand_id, updated_at=now()",
            (funder_key, brand_id),
        )
