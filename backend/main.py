"""VAT Portal API — FastAPI backend."""

from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import psycopg2
from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import can_client
import channel_client
import idea_client
import ondeck_client
import peac_client
import zoho_client
from aquamark_client import aquamark_configured, describe_integration, process_batch
from compressor import CompressionPreset, compress_pdf
from db import (
    add_partner_submission_event,
    count_admins,
    create_session,
    create_user,
    delete_partner_submission,
    delete_session,
    delete_user,
    get_brands,
    get_funders,
    get_partner_brand_assignments,
    get_partner_submission,
    get_teams,
    get_user_by_token,
    list_partner_submissions,
    list_users,
    reset_password,
    save_brands,
    save_funders,
    save_teams,
    set_partner_brand_assignment,
    sync_funders_after_brand_removal,
    update_partner_submission,
    update_user,
    verify_login,
    create_partner_submission,
)
from email_client import send_email, sendgrid_configured
from partner_models import (
    BrandAssignmentBody,
    PartnerSubmissionCreateBody,
    ProcessApplicationBody,
    SendDocumentsBody,
)
from pdf_processor import flatten_pdf

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="VAT Portal API", version="1.0.0")


def require_auth(authorization: str = Header(default="")) -> dict[str, Any]:
    token = (
        authorization[7:].strip()
        if authorization.lower().startswith("bearer ")
        else authorization.strip()
    )
    if not token:
        raise HTTPException(401, "Not authenticated.")
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(401, "Session expired or invalid.")
    return user


def require_admin(user: dict[str, Any] = Depends(require_auth)) -> dict[str, Any]:
    if user["role"] != "admin":
        raise HTTPException(403, "Admin access required.")
    return user

# EXTRA_CORS_ORIGINS: comma-separated origins (e.g. a Vercel deployment URL)
# so new frontend hosts can be allowed via an env var instead of a redeploy.
_extra_origins = [
    origin.strip()
    for origin in os.getenv("EXTRA_CORS_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3011",
        "http://127.0.0.1:3011",
        "https://internalportal.nationwideadvance.com",
        "https://watermark.solutions90.com",
        *_extra_origins,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginBody(BaseModel):
    email: str
    password: str = ""


class BrandBody(BaseModel):
    name: str
    email: str = ""
    app: str = ""
    accent: str = "#4f46e5"
    aquamark_email: str = ""


def _brand_payload(body: BrandBody) -> dict[str, Any]:
    payload = body.model_dump()
    payload.pop("logo", None)
    payload["aquamark_email"] = (payload.get("aquamark_email") or "").strip()
    if not payload["app"]:
        payload["app"] = f"{payload['name']} Application"
    return payload


class FunderCcMemberBody(BaseModel):
    name: str = ""
    email: str = ""


class FunderBody(BaseModel):
    name: str
    email: str = ""
    cc_members: list[FunderCcMemberBody] = Field(default_factory=list)
    brands: list[int] = Field(default_factory=list)


def _funder_payload(body: FunderBody) -> dict[str, Any]:
    brands = sorted({int(b) for b in body.brands if isinstance(b, int) and b >= 0})
    cc_members = [
        {"name": m.name.strip(), "email": m.email.strip()}
        for m in body.cc_members
        if m.name.strip() or m.email.strip()
    ]
    return {
        "name": body.name.strip(),
        "email": body.email.strip(),
        "cc_members": cc_members,
        "brands": brands,
    }


class TeamMemberBody(BaseModel):
    name: str
    email: str


class TeamBody(BaseModel):
    name: str
    lead: str = ""
    members: list[TeamMemberBody] = Field(default_factory=list)


class EmailSendBody(BaseModel):
    from_email: str
    to: str
    cc: str = ""
    subject: str = ""
    body: str = ""
    attachments: list[str] = Field(default_factory=list)


class UserBody(BaseModel):
    name: str
    email: str
    role: str


class UserCreateBody(UserBody):
    password: str


class PasswordResetBody(BaseModel):
    password: str


def _validate_role(role: str) -> str:
    role = role.strip().lower()
    if role not in ("admin", "employee"):
        raise HTTPException(400, "Role must be 'admin' or 'employee'.")
    return role


def _parse_attachment_path(path: str) -> tuple[str, str] | None:
    match = re.fullmatch(r"/api/aquamark/download/([a-f0-9]{12})/(.+)", path.strip())
    if not match:
        return None
    return match.group(1), Path(match.group(2)).name


def _remove_job_if_empty(job_id: str) -> None:
    job_dir = OUTPUT_DIR / job_id
    if job_dir.is_dir() and not any(job_dir.iterdir()):
        job_dir.rmdir()


def _delete_processed_file(job_id: str, filename: str) -> bool:
    if not re.fullmatch(r"[a-f0-9]{12}", job_id):
        return False
    file_path = OUTPUT_DIR / job_id / Path(filename).name
    if file_path.is_file():
        file_path.unlink()
    _remove_job_if_empty(job_id)
    return True


def _delete_job(job_id: str) -> bool:
    if not re.fullmatch(r"[a-f0-9]{12}", job_id):
        return False
    job_dir = OUTPUT_DIR / job_id
    if not job_dir.is_dir():
        return False
    shutil.rmtree(job_dir)
    return True


def _cleanup_attachment_paths(paths: list[str]) -> None:
    touched_jobs: set[str] = set()
    for path in paths:
        parsed = _parse_attachment_path(path)
        if not parsed:
            continue
        job_id, filename = parsed
        touched_jobs.add(job_id)
        file_path = OUTPUT_DIR / job_id / filename
        if file_path.is_file():
            file_path.unlink()
    for job_id in touched_jobs:
        _remove_job_if_empty(job_id)


def _resolve_attachment(path: str) -> tuple[str, bytes]:
    parsed = _parse_attachment_path(path)
    if not parsed:
        raise HTTPException(400, f"Invalid attachment path: {path}")
    job_id, safe_name = parsed
    file_path = OUTPUT_DIR / job_id / safe_name
    if not file_path.is_file():
        raise HTTPException(404, f"Attachment not found: {safe_name}")
    return safe_name, file_path.read_bytes()


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/auth/login")
def login(body: LoginBody):
    email = body.email.strip()
    if not email:
        raise HTTPException(400, "Email is required.")
    user = verify_login(email, body.password)
    if not user:
        raise HTTPException(401, "Invalid email or password.")
    token = create_session(user["id"])
    return {"ok": True, "token": token, "user": user}


@app.post("/api/auth/logout")
def logout(authorization: str = Header(default="")):
    token = (
        authorization[7:].strip()
        if authorization.lower().startswith("bearer ")
        else authorization.strip()
    )
    if token:
        delete_session(token)
    return {"ok": True}


@app.get("/api/brands")
def list_brands(_user=Depends(require_auth)):
    return {"ok": True, "data": get_brands()}


@app.post("/api/brands")
def create_brand(body: BrandBody, _admin=Depends(require_admin)):
    brands = get_brands()
    payload = _brand_payload(body)
    brands.append(payload)
    save_brands(brands)
    return {"ok": True, "data": brands, "index": len(brands) - 1}


@app.put("/api/brands/{index}")
def update_brand(index: int, body: BrandBody, _admin=Depends(require_admin)):
    brands = get_brands()
    if index < 0 or index >= len(brands):
        raise HTTPException(404, "Brand not found.")
    brands[index] = _brand_payload(body)
    save_brands(brands)
    return {"ok": True, "data": brands}


@app.delete("/api/brands/{index}")
def delete_brand(index: int, _admin=Depends(require_admin)):
    brands = get_brands()
    if len(brands) <= 1:
        raise HTTPException(400, "At least one brand is required.")
    if index < 0 or index >= len(brands):
        raise HTTPException(404, "Brand not found.")
    brands.pop(index)
    save_brands(brands)
    sync_funders_after_brand_removal(index)
    return {"ok": True, "data": brands}


@app.get("/api/funders")
def list_funders(_user=Depends(require_auth)):
    return {"ok": True, "data": get_funders()}


@app.post("/api/funders")
def create_funder(body: FunderBody, _admin=Depends(require_admin)):
    funders = get_funders()
    funders.append(_funder_payload(body))
    save_funders(funders)
    return {"ok": True, "data": funders, "index": len(funders) - 1}


@app.put("/api/funders/{index}")
def update_funder(index: int, body: FunderBody, _admin=Depends(require_admin)):
    funders = get_funders()
    if index < 0 or index >= len(funders):
        raise HTTPException(404, "Funder not found.")
    funders[index] = _funder_payload(body)
    save_funders(funders)
    return {"ok": True, "data": funders}


@app.delete("/api/funders/{index}")
def delete_funder(index: int, _admin=Depends(require_admin)):
    funders = get_funders()
    if len(funders) <= 1:
        raise HTTPException(400, "At least one funder is required.")
    if index < 0 or index >= len(funders):
        raise HTTPException(404, "Funder not found.")
    funders.pop(index)
    save_funders(funders)
    return {"ok": True, "data": funders}


@app.get("/api/teams")
def list_teams(_user=Depends(require_auth)):
    return {"ok": True, "data": get_teams()}


@app.post("/api/teams")
def create_team(body: TeamBody, _admin=Depends(require_admin)):
    teams = get_teams()
    members = [m.model_dump() for m in body.members]
    if not members:
        raise HTTPException(400, "Add at least one team member.")
    lead = body.lead.strip() or members[0]["name"]
    team = {
        "id": f"team-{uuid.uuid4().hex[:10]}",
        "name": body.name.strip(),
        "lead": lead,
        "members": members,
    }
    teams.append(team)
    save_teams(teams)
    return {"ok": True, "data": teams, "team": team}


@app.put("/api/teams/{team_id}")
def update_team(team_id: str, body: TeamBody, _admin=Depends(require_admin)):
    teams = get_teams()
    idx = next((i for i, t in enumerate(teams) if t["id"] == team_id), None)
    if idx is None:
        raise HTTPException(404, "Team not found.")
    members = [m.model_dump() for m in body.members]
    if not members:
        raise HTTPException(400, "Add at least one team member.")
    lead = body.lead.strip() or members[0]["name"]
    teams[idx] = {
        "id": team_id,
        "name": body.name.strip(),
        "lead": lead,
        "members": members,
    }
    save_teams(teams)
    return {"ok": True, "data": teams, "team": teams[idx]}


@app.delete("/api/teams/{team_id}")
def delete_team(team_id: str, _admin=Depends(require_admin)):
    teams = get_teams()
    if len(teams) <= 1:
        raise HTTPException(400, "At least one team is required.")
    idx = next((i for i, t in enumerate(teams) if t["id"] == team_id), None)
    if idx is None:
        raise HTTPException(404, "Team not found.")
    teams.pop(idx)
    save_teams(teams)
    return {"ok": True, "data": teams}


@app.get("/api/users")
def list_users_endpoint(_admin=Depends(require_admin)):
    return {"ok": True, "data": list_users()}


@app.post("/api/users")
def create_user_endpoint(body: UserCreateBody, _admin=Depends(require_admin)):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    role = _validate_role(body.role)
    name = body.name.strip()
    email = body.email.strip()
    if not name or not email:
        raise HTTPException(400, "Name and email are required.")
    try:
        create_user(name, email, role, body.password)
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(409, "A user with that email already exists.")
    return {"ok": True, "data": list_users()}


@app.put("/api/users/{user_id}")
def update_user_endpoint(user_id: int, body: UserBody, _admin=Depends(require_admin)):
    role = _validate_role(body.role)
    if role != "admin" and count_admins(exclude_user_id=user_id) < 1:
        raise HTTPException(400, "At least one admin is required.")
    name = body.name.strip()
    email = body.email.strip()
    if not name or not email:
        raise HTTPException(400, "Name and email are required.")
    try:
        update_user(user_id, name, email, role)
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(409, "A user with that email already exists.")
    return {"ok": True, "data": list_users()}


@app.delete("/api/users/{user_id}")
def delete_user_endpoint(user_id: int, _admin=Depends(require_admin)):
    if count_admins(exclude_user_id=user_id) < 1:
        raise HTTPException(400, "At least one admin is required.")
    delete_user(user_id)
    return {"ok": True, "data": list_users()}


@app.post("/api/users/{user_id}/reset-password")
def reset_password_endpoint(
    user_id: int, body: PasswordResetBody, _admin=Depends(require_admin)
):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    reset_password(user_id, body.password)
    return {"ok": True}


@app.get("/api/aquamark/status")
def aquamark_status(_user=Depends(require_auth)):
    """Aquamark API integration status."""
    return {"ok": True, **describe_integration()}

@app.post("/api/aquamark/process")
async def process_documents(
    _user=Depends(require_auth),
    brand_name: str = Form(...),
    deal_name: str = Form("Deal"),
    aquamark_user_email: str = Form(""),
    recipients: str = Form("[]"),
    files: list[UploadFile] = File(...),
):
    brand_name = brand_name.strip()
    deal_name = deal_name.strip() or "Deal"
    if not brand_name:
        raise HTTPException(400, "Brand name is required.")
    if not files:
        raise HTTPException(400, "Upload at least one PDF.")

    try:
        recipient_list = json.loads(recipients) if recipients else []
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "Invalid recipients JSON.") from exc

    if not isinstance(recipient_list, list) or not recipient_list:
        raise HTTPException(400, "At least one funder recipient is required.")

    normalized: list[dict[str, str]] = []
    for item in recipient_list:
        if isinstance(item, dict):
            name = str(item.get("name", "")).strip()
            email = str(item.get("email", "")).strip()
        else:
            name = str(item).strip()
            email = ""
        if name:
            normalized.append({"name": name, "email": email})

    if not normalized:
        raise HTTPException(400, "At least one recipient name is required.")

    user_email = aquamark_user_email.strip() or (os.getenv("AQUAMARK_USER_EMAIL") or "").strip()
    if not user_email:
        raise HTTPException(
            400,
            "Aquamark user email is required. Set it on the brand in Brands setup.",
        )

    if not aquamark_configured():
        raise HTTPException(
            503,
            "Aquamark is not configured. Set AQUAMARK_API_KEY in backend/.env.",
        )

    job_id = uuid.uuid4().hex[:12]
    job_dir = OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    uploaded: list[tuple[str, bytes]] = []
    errors: list[str] = []
    for upload in files:
        if not upload.filename:
            continue
        if not upload.filename.lower().endswith(".pdf"):
            errors.append(f"{upload.filename}: only PDF files are supported.")
            continue
        uploaded.append((upload.filename, await upload.read()))

    if not uploaded:
        raise HTTPException(400, "; ".join(errors) or "No valid PDF files.")

    funder_names = [r["name"] for r in normalized]

    def email_for_recipient(recipient: str) -> str:
        for r in normalized:
            full = r["name"].strip()
            if recipient == full or recipient == full[:40]:
                return r.get("email", "")
        return ""

    try:
        batch_items = process_batch(
            uploaded,
            funders=funder_names,
            brand_name=brand_name,
            deal_name=deal_name,
            user_email=user_email,
            metadata={
                "portal_job_id": job_id,
                "recipients": funder_names,
                "brand_name": brand_name,
                "deal_name": deal_name,
                "aquamark_user_email": user_email,
            },
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, str(exc)) from exc

    results: list[dict[str, Any]] = []
    flatten_enabled = os.getenv("AQUAMARK_FLATTEN", "true").lower() in ("1", "true", "yes")
    for item in batch_items:
        out_name = item["name"]
        pdf_bytes = item["data"]
        if flatten_enabled:
            try:
                pdf_bytes = flatten_pdf(pdf_bytes)
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(502, f"PDF flatten failed for {out_name}: {exc}") from exc
        out_path = job_dir / out_name
        out_path.write_bytes(pdf_bytes)
        recipient = item.get("recipient") or ""
        results.append(
            {
                "name": out_name,
                "original": item.get("original", out_name),
                "recipient": recipient,
                "recipient_email": email_for_recipient(recipient),
                "download": f"/api/aquamark/download/{job_id}/{out_name}",
                "size": len(pdf_bytes),
            }
        )

    if not results:
        raise HTTPException(400, "; ".join(errors) or "Processing failed.")

    return {
        "ok": True,
        "job_id": job_id,
        "source": "aquamark",
        "files": results,
        "recipients": funder_names,
        "errors": errors,
        "recipient_count": len(normalized),
        "source_file_count": len(uploaded),
    }


@app.delete("/api/aquamark/job/{job_id}")
def delete_aquamark_job(job_id: str, _user=Depends(require_auth)):
    if not _delete_job(job_id):
        raise HTTPException(404, "Job not found or already removed.")
    return {"ok": True}


@app.delete("/api/aquamark/download/{job_id}/{filename}")
def delete_processed_file(job_id: str, filename: str, _user=Depends(require_auth)):
    safe_name = Path(filename).name
    if not _delete_processed_file(job_id, safe_name):
        raise HTTPException(404, "File not found or already removed.")
    return {"ok": True}


@app.get("/api/aquamark/download/{job_id}/{filename}")
def download_file(job_id: str, filename: str, _user=Depends(require_auth)):
    if not re.fullmatch(r"[a-f0-9]{12}", job_id):
        raise HTTPException(400, "Invalid job id.")
    safe_name = Path(filename).name
    file_path = OUTPUT_DIR / job_id / safe_name
    if not file_path.is_file():
        raise HTTPException(404, "File not found.")
    return FileResponse(file_path, filename=safe_name, media_type="application/pdf")


class CompressResponse(BaseModel):
    ok: bool
    name: str
    original_size: int
    compressed_size: int
    reduction_percent: float
    download: str


@app.post("/api/aquamark/compress/{job_id}/{filename}", response_model=CompressResponse)
def compress_processed_file(
    job_id: str,
    filename: str,
    preset: str = Body("balanced", embed=True),
    _user=Depends(require_auth),
):
    if not re.fullmatch(r"[a-f0-9]{12}", job_id):
        raise HTTPException(400, "Invalid job id.")
    safe_name = Path(filename).name
    file_path = OUTPUT_DIR / job_id / safe_name
    if not file_path.is_file():
        raise HTTPException(404, "File not found.")

    try:
        compression_preset = CompressionPreset(preset)
    except ValueError:
        raise HTTPException(
            400, f"Invalid preset. Choose: {[p.value for p in CompressionPreset]}"
        )

    raw = file_path.read_bytes()
    try:
        result, compressed_data = compress_pdf(raw, compression_preset)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Compression failed: {exc}") from exc

    compressed_name = f"{Path(safe_name).stem}_compressed.pdf"
    (OUTPUT_DIR / job_id / compressed_name).write_bytes(compressed_data)

    return CompressResponse(
        ok=True,
        name=compressed_name,
        original_size=result.original_bytes,
        compressed_size=result.compressed_bytes,
        reduction_percent=result.reduction_percent,
        download=f"/api/aquamark/download/{job_id}/{compressed_name}",
    )


@app.get("/api/email/status")
def email_status(_user=Depends(require_auth)):
    return {"ok": True, "configured": sendgrid_configured()}


@app.post("/api/emails/send")
def send_deal_email(body: EmailSendBody, _user=Depends(require_auth)):
    if not sendgrid_configured():
        raise HTTPException(
            503,
            "SendGrid is not configured. Set SENDGRID_API_KEY in backend/.env.",
        )

    attachment_files: list[tuple[str, bytes]] = []
    for path in body.attachments:
        attachment_files.append(_resolve_attachment(path))

    try:
        result = send_email(
            from_email=body.from_email,
            to_email=body.to,
            cc=body.cc,
            subject=body.subject,
            body=body.body,
            attachments=attachment_files,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"SendGrid error: {exc}") from exc

    _cleanup_attachment_paths(body.attachments)

    return {"ok": True, **result}


# ───────────────────────── API Partners (OnDeck / CAN Capital) ─────────────────────────
#
# Fixed roster of 5 named funder-partner integrations, separate from the
# dynamic `Funders` CRM list above. Only OnDeck and CAN have real client
# modules (ondeck_client.py / can_client.py); channel/peac/idea have no
# client module or credentials anywhere, so there is no code path that
# could ever reach those hosts. Every OnDeck/CAN call-making endpoint below
# checks *_configured() first and 503s before any network call — and
# neither ONDECK_*/CAN_* env vars are set anywhere today, so none of this
# can fire a real request until a human deliberately adds credentials to a
# specific environment for the joint test session with the client.


def _read_processed_file(job_id: str, filename: str) -> bytes:
    if not re.fullmatch(r"[a-f0-9]{12}", job_id):
        raise HTTPException(400, "Invalid job id.")
    file_path = OUTPUT_DIR / job_id / Path(filename).name
    if not file_path.is_file():
        raise HTTPException(404, f"Processed file not found: {filename}")
    return file_path.read_bytes()


def _get_owned_submission(submission_id: int, user: dict[str, Any]) -> dict[str, Any]:
    submission = get_partner_submission(submission_id)
    if not submission or submission["created_by_user_id"] != user["id"]:
        raise HTTPException(404, "Submission not found.")
    return submission


def _log_event(submission_id: int, action: str, ok: bool, http_status: int | None, message: str = "") -> None:
    add_partner_submission_event(submission_id, action=action, ok=ok, http_status=http_status, message=message)


@app.get("/api/partners/status")
def partners_status(_user=Depends(require_auth)):
    return {
        "ok": True,
        "partners": {
            "ondeck": ondeck_client.describe_integration(),
            "can": can_client.describe_integration(),
            "idea": idea_client.describe_integration(),
            "channel": channel_client.describe_integration(),
            "peac": peac_client.describe_integration(),
            "zoho": zoho_client.describe_integration(),
        },
    }


_PARTNER_KEYS = ("ondeck", "can", "idea", "channel", "peac")


@app.get("/api/partners/brand-assignments")
def partners_get_brand_assignments(_user=Depends(require_auth)):
    return {"ok": True, "data": get_partner_brand_assignments()}


@app.put("/api/partners/brand-assignments/{funder_key}")
def partners_set_brand_assignment(funder_key: str, body: BrandAssignmentBody, _admin=Depends(require_admin)):
    if funder_key not in _PARTNER_KEYS:
        raise HTTPException(404, "Unknown partner.")
    try:
        set_partner_brand_assignment(funder_key, body.brand_index)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "data": get_partner_brand_assignments()}


@app.get("/api/partners/submissions")
def partners_list_submissions(status_in: str = "", user=Depends(require_auth)):
    statuses = [s.strip() for s in status_in.split(",") if s.strip()] or None
    return {"ok": True, "data": list_partner_submissions(user["id"], statuses)}


@app.get("/api/partners/submissions/{submission_id}")
def partners_get_submission(submission_id: int, user=Depends(require_auth)):
    return {"ok": True, "data": _get_owned_submission(submission_id, user)}


@app.delete("/api/partners/submissions/{submission_id}")
def partners_delete_submission(submission_id: int, user=Depends(require_auth)):
    _get_owned_submission(submission_id, user)
    delete_partner_submission(submission_id)
    return {"ok": True}


@app.post("/api/partners/ondeck/submit-application")
def ondeck_submit_application(body: PartnerSubmissionCreateBody, user=Depends(require_auth)):
    if not ondeck_client.ondeck_configured():
        raise HTTPException(
            503, "OnDeck is not configured. Set ONDECK_USERNAME/ONDECK_PASSWORD/ONDECK_API_KEY in backend/.env."
        )

    submission = create_partner_submission(
        funder_key="ondeck",
        brand_name=body.brand_name,
        deal_name=body.deal_name,
        created_by_user_id=user["id"],
        business_details=body.business.model_dump(),
        owner_details=[o.model_dump() for o in body.owners],
        loan_details=body.loan.model_dump(),
        aquamark_job_id=body.aquamark_job_id,
    )
    try:
        result = ondeck_client.submit_application(
            body.business.model_dump(),
            [o.model_dump() for o in body.owners],
            body.loan.model_dump(),
            external_customer_id=str(submission["id"]),
        )
    except ValueError as exc:
        _log_event(submission["id"], "ondeck_submit_application", False, None, str(exc))
        update_partner_submission(submission["id"], status="error", last_error=str(exc))
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        _log_event(submission["id"], "ondeck_submit_application", False, None, str(exc))
        update_partner_submission(submission["id"], status="error", last_error=str(exc))
        raise HTTPException(502, str(exc)) from exc

    _log_event(submission["id"], "ondeck_submit_application", True, 201, f"businessID={result['business_id']}")
    updated = update_partner_submission(submission["id"], status="submitted", external_id=result["business_id"])
    return {"ok": True, "data": updated}


@app.post("/api/partners/ondeck/{submission_id}/send-documents")
def ondeck_send_documents(submission_id: int, body: SendDocumentsBody, user=Depends(require_auth)):
    submission = _get_owned_submission(submission_id, user)
    # Checking external_id (not status) on purpose: a failed document upload
    # sets status to "error", and gating on status alone permanently locked
    # out any retry - even though the application itself was submitted fine
    # and only the document step needs another attempt. external_id can only
    # be set once the real OnDeck application was actually created.
    if not submission.get("external_id"):
        raise HTTPException(400, "Submit the application to OnDeck before sending documents.")
    if not ondeck_client.ondeck_configured():
        raise HTTPException(
            503, "OnDeck is not configured. Set ONDECK_USERNAME/ONDECK_PASSWORD/ONDECK_API_KEY in backend/.env."
        )

    files = [(Path(name).name, _read_processed_file(body.job_id, name)) for name in body.filenames]
    try:
        result = ondeck_client.upload_documents(submission["external_id"], files)
    except (ValueError, RuntimeError) as exc:
        _log_event(submission_id, "ondeck_send_documents", False, None, str(exc))
        update_partner_submission(submission_id, status="error", last_error=str(exc))
        raise HTTPException(502, str(exc)) from exc

    _log_event(submission_id, "ondeck_send_documents", True, 200, json.dumps(result))
    updated = update_partner_submission(submission_id, status="docs_sent")
    return {"ok": True, "data": updated}


@app.get("/api/partners/ondeck/{submission_id}/status")
def ondeck_submission_status(submission_id: int, user=Depends(require_auth)):
    submission = _get_owned_submission(submission_id, user)
    if not ondeck_client.ondeck_configured():
        raise HTTPException(503, "OnDeck is not configured.")
    try:
        return {"ok": True, "data": ondeck_client.get_status(submission["external_id"])}
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/partners/can/create-application")
def can_create_application(body: PartnerSubmissionCreateBody, user=Depends(require_auth)):
    if not can_client.can_configured():
        raise HTTPException(503, "CAN Capital is not configured. Set CAN_EMAIL/CAN_PASSWORD in backend/.env.")

    submission = create_partner_submission(
        funder_key="can",
        brand_name=body.brand_name,
        deal_name=body.deal_name,
        created_by_user_id=user["id"],
        business_details=body.business.model_dump(),
        owner_details=[o.model_dump() for o in body.owners],
        loan_details=body.loan.model_dump(),
        aquamark_job_id=body.aquamark_job_id,
    )
    try:
        result = can_client.create_application(
            body.business.model_dump(),
            body.owners[0].model_dump(),
            body.loan.model_dump(),
            rep_name=user["name"],
            # Fixed per client request - CAN's status/decline notifications
            # should always land in this inbox, not whichever SubsPortal
            # account happens to be logged in when the submit button is hit.
            rep_email="processing@ajnationwide.com",
        )
    except RuntimeError as exc:
        _log_event(submission["id"], "can_create_application", False, None, str(exc))
        update_partner_submission(submission["id"], status="error", last_error=str(exc))
        raise HTTPException(502, str(exc)) from exc

    _log_event(submission["id"], "can_create_application", True, 200, f"application={result['application_name']}")
    updated = update_partner_submission(
        submission["id"], status="submitted", external_id=result["application_name"]
    )
    return {"ok": True, "data": updated}


@app.post("/api/partners/can/{submission_id}/send-documents")
async def can_send_documents(
    submission_id: int,
    job_id: str = Form(...),
    filenames: str = Form(...),
    application_document: UploadFile | None = File(None),
    user=Depends(require_auth),
):
    submission = _get_owned_submission(submission_id, user)
    # See the matching comment in ondeck_send_documents - checking
    # external_id, not status, so a failed upload attempt can be retried.
    if not submission.get("external_id"):
        raise HTTPException(400, "Create the CAN application before sending documents.")
    if not can_client.can_configured():
        raise HTTPException(503, "CAN Capital is not configured. Set CAN_EMAIL/CAN_PASSWORD in backend/.env.")

    try:
        filename_list = json.loads(filenames)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid filenames JSON.") from None
    if not filename_list:
        raise HTTPException(400, "At least one filename is required.")

    # CAN's uploaddocs endpoint accepts one document per request (CLSI docs).
    # Upload EVERY bank-statement file the portal watermarked for this partner
    # (at least one required; brokers typically send 3-4 months), then the
    # optional Application PDF. Mirrors the working Zoho Deluge flow:
    # createapplication -> uploaddocs (each file) -> processapplication.
    upload_results: list[dict] = []
    try:
        for raw_name in filename_list:
            bs_filename = Path(raw_name).name
            bs_data = _read_processed_file(job_id, bs_filename)
            result = can_client.upload_document(
                submission["external_id"], bs_filename, bs_data, document_type="Bank Statements"
            )
            upload_results.append(
                {"filename": bs_filename, "document_type": "Bank Statements", **result}
            )
            _log_event(
                submission_id,
                "can_send_bank_statement",
                True,
                result.get("status"),
                json.dumps({"filename": bs_filename, **result}),
            )

        # Application document (if provided) is sent as-is - no
        # watermark/flatten/compress - as its own "Application" document
        # type, separate from the bank statements above.
        if application_document is not None and application_document.filename:
            app_filename = Path(application_document.filename).name
            app_bytes = await application_document.read()
            app_result = can_client.upload_document(
                submission["external_id"], app_filename, app_bytes, document_type="Application"
            )
            upload_results.append(
                {"filename": app_filename, "document_type": "Application", **app_result}
            )
            _log_event(
                submission_id,
                "can_send_application_document",
                True,
                app_result.get("status"),
                json.dumps({"filename": app_filename, **app_result}),
            )
    except (ValueError, RuntimeError) as exc:
        _log_event(submission_id, "can_send_documents", False, None, str(exc))
        update_partner_submission(submission_id, status="error", last_error=str(exc))
        raise HTTPException(502, str(exc)) from exc

    _log_event(
        submission_id,
        "can_send_documents",
        True,
        200,
        json.dumps(
            {
                "bank_statement_count": len(filename_list),
                "uploaded": upload_results,
            }
        ),
    )
    updated = update_partner_submission(submission_id, status="docs_sent")
    return {"ok": True, "data": updated}


@app.post("/api/partners/can/{submission_id}/process-application")
def can_process_application(submission_id: int, body: ProcessApplicationBody, user=Depends(require_auth)):
    submission = _get_owned_submission(submission_id, user)
    # Also allow retrying from "error" - a failed process attempt (e.g. a
    # transient network error) shouldn't need documents re-sent from
    # scratch just to try processing again.
    if submission["status"] not in ("docs_sent", "error"):
        raise HTTPException(400, "Send documents to CAN before processing the application.")
    if not can_client.can_configured():
        raise HTTPException(503, "CAN Capital is not configured. Set CAN_EMAIL/CAN_PASSWORD in backend/.env.")

    try:
        result = can_client.process_application(submission["external_id"], body.consent_accepted)
    except (ValueError, RuntimeError) as exc:
        _log_event(submission_id, "can_process_application", False, None, str(exc))
        update_partner_submission(submission_id, status="error", last_error=str(exc))
        raise HTTPException(400 if isinstance(exc, ValueError) else 502, str(exc)) from exc

    _log_event(submission_id, "can_process_application", True, 200, json.dumps(result))
    updated = update_partner_submission(submission_id, status="processed")
    return {"ok": True, "data": updated}


@app.get("/api/partners/can/{submission_id}/status")
def can_submission_status(submission_id: int, user=Depends(require_auth)):
    submission = _get_owned_submission(submission_id, user)
    if not can_client.can_configured():
        raise HTTPException(503, "CAN Capital is not configured.")
    try:
        return {"ok": True, "data": can_client.get_application_status(submission["external_id"])}
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


def _parse_partner_payload(payload: str) -> PartnerSubmissionCreateBody:
    try:
        return PartnerSubmissionCreateBody.model_validate_json(payload)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Invalid payload JSON: {exc}") from exc


def _parse_filenames(filenames: str) -> list[str]:
    try:
        parsed = json.loads(filenames)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid filenames JSON.") from None
    if not isinstance(parsed, list) or not parsed:
        raise HTTPException(400, "At least one filename is required.")
    return [str(f) for f in parsed]


@app.post("/api/partners/peac/submit-application")
async def peac_submit_application(
    payload: str = Form(...),
    job_id: str = Form(""),
    filenames: str = Form("[]"),
    application_document: UploadFile | None = File(None),
    user=Depends(require_auth),
):
    if not peac_client.peac_configured():
        raise HTTPException(
            503, "PEAC is not configured. Set PEAC_USERNAME/PEAC_PASSWORD/PEAC_API_KEY/PEAC_PARTNER_ID in backend/.env."
        )
    body = _parse_partner_payload(payload)

    submission = create_partner_submission(
        funder_key="peac",
        brand_name=body.brand_name,
        deal_name=body.deal_name,
        created_by_user_id=user["id"],
        business_details=body.business.model_dump(),
        owner_details=[o.model_dump() for o in body.owners],
        loan_details=body.loan.model_dump(),
        aquamark_job_id=job_id,
    )

    # PEAC's Document Type is a fixed picklist confirmed from the reference
    # Zoho function - month abbreviations, not sequence numbers, and only
    # four slots exist (Bank_Statement..Bank_Statement_4). Extra files past
    # the fourth reuse "Apr" since PEAC has no fifth label.
    _peac_bs_months = ["Jan", "Feb", "Mar", "Apr"]
    files: list[tuple[str, bytes, str]] = []
    filename_list = json.loads(filenames) if filenames else []
    for idx, name in enumerate(filename_list):
        bs_name = Path(str(name)).name
        data = _read_processed_file(job_id, bs_name)
        month = _peac_bs_months[min(idx, len(_peac_bs_months) - 1)]
        files.append((bs_name, data, f"FS - Bank Statements - {month}"))
    if application_document is not None and application_document.filename:
        app_name = Path(application_document.filename).name
        app_bytes = await application_document.read()
        files.append((app_name, app_bytes, "FS - Credit Application"))

    try:
        result = peac_client.submit_application(
            body.business.model_dump(), [o.model_dump() for o in body.owners], body.loan.model_dump(),
            lead_id=str(submission["id"]), files=files,
        )
    except (ValueError, RuntimeError) as exc:
        _log_event(submission["id"], "peac_submit_application", False, None, str(exc))
        update_partner_submission(submission["id"], status="error", last_error=str(exc))
        raise HTTPException(400 if isinstance(exc, ValueError) else 502, str(exc)) from exc

    _log_event(submission["id"], "peac_submit_application", True, 200, json.dumps(result))
    updated = update_partner_submission(submission["id"], status="submitted", external_id=f"peac-{submission['id']}")
    return {"ok": True, "data": updated}


@app.post("/api/partners/channel/submit-application")
async def channel_submit_application(
    payload: str = Form(...),
    job_id: str = Form(""),
    filenames: str = Form("[]"),
    application_document: UploadFile | None = File(None),
    user=Depends(require_auth),
):
    if not channel_client.channel_configured():
        raise HTTPException(503, "Channel is not configured. Set CHANNEL_API_TOKEN/CHANNEL_USER_EMAIL in backend/.env.")
    body = _parse_partner_payload(payload)

    submission = create_partner_submission(
        funder_key="channel",
        brand_name=body.brand_name,
        deal_name=body.deal_name,
        created_by_user_id=user["id"],
        business_details=body.business.model_dump(),
        owner_details=[o.model_dump() for o in body.owners],
        loan_details=body.loan.model_dump(),
        aquamark_job_id=job_id,
    )

    bank_statement_files: list[tuple[str, bytes]] = []
    filename_list = json.loads(filenames) if filenames else []
    for name in filename_list:
        bs_name = Path(str(name)).name
        bank_statement_files.append((bs_name, _read_processed_file(job_id, bs_name)))
    application_file: tuple[str, bytes] | None = None
    if application_document is not None and application_document.filename:
        app_name = Path(application_document.filename).name
        application_file = (app_name, await application_document.read())

    try:
        result = channel_client.submit_application(
            body.business.model_dump(),
            [o.model_dump() for o in body.owners],
            body.loan.model_dump(),
            bank_statement_files=bank_statement_files,
            application_file=application_file,
        )
    except (ValueError, RuntimeError) as exc:
        _log_event(submission["id"], "channel_submit_application", False, None, str(exc))
        update_partner_submission(submission["id"], status="error", last_error=str(exc))
        raise HTTPException(400 if isinstance(exc, ValueError) else 502, str(exc)) from exc

    _log_event(submission["id"], "channel_submit_application", True, 200, json.dumps(result))
    updated = update_partner_submission(
        submission["id"], status="submitted", external_id=str(result.get("application_id", ""))
    )
    return {"ok": True, "data": updated}


@app.post("/api/partners/idea/create-application")
def idea_create_application(body: PartnerSubmissionCreateBody, user=Depends(require_auth)):
    if not idea_client.idea_configured():
        raise HTTPException(503, "iDea Financial is not configured. Set IDEA_CLIENT_ID/IDEA_CLIENT_SECRET in backend/.env.")

    submission = create_partner_submission(
        funder_key="idea",
        brand_name=body.brand_name,
        deal_name=body.deal_name,
        created_by_user_id=user["id"],
        business_details=body.business.model_dump(),
        owner_details=[o.model_dump() for o in body.owners],
        loan_details=body.loan.model_dump(),
        aquamark_job_id=body.aquamark_job_id,
    )
    try:
        result = idea_client.create_application(
            body.business.model_dump(), [o.model_dump() for o in body.owners], body.loan.model_dump()
        )
    except RuntimeError as exc:
        _log_event(submission["id"], "idea_create_application", False, None, str(exc))
        update_partner_submission(submission["id"], status="error", last_error=str(exc))
        raise HTTPException(502, str(exc)) from exc

    _log_event(submission["id"], "idea_create_application", True, 200, f"application_id={result['application_id']}")
    updated = update_partner_submission(submission["id"], status="submitted", external_id=result["application_id"])
    return {"ok": True, "data": updated}


@app.post("/api/partners/idea/{submission_id}/send-documents")
async def idea_send_documents(
    submission_id: int,
    job_id: str = Form(...),
    filenames: str = Form(...),
    application_document: UploadFile | None = File(None),
    user=Depends(require_auth),
):
    submission = _get_owned_submission(submission_id, user)
    # See the matching comment in ondeck_send_documents - checking
    # external_id, not status, so a failed upload attempt can be retried.
    if not submission.get("external_id"):
        raise HTTPException(400, "Create the iDea application before sending documents.")
    if not idea_client.idea_configured():
        raise HTTPException(503, "iDea Financial is not configured. Set IDEA_CLIENT_ID/IDEA_CLIENT_SECRET in backend/.env.")

    filename_list = _parse_filenames(filenames)
    try:
        if application_document is not None and application_document.filename:
            app_bytes = await application_document.read()
            # Sending the real uploaded filename (long, with spaces/parens/
            # commas from watermarking) caused a raw 500 "error occurred
            # while saving the entity changes" - an EF/DB-level failure, not
            # a validation error, meaning iDea's fileName column doesn't
            # tolerate it. The reference Zoho function never sends the real
            # filename either - it always uses a short fixed label
            # ("Application_Form", "Month_N_Bank_Statement") - so this
            # switches to the same safe convention.
            idea_client.upload_document(submission["external_id"], "Application_Form.pdf", app_bytes, document_type="application")
        for idx, name in enumerate(filename_list, start=1):
            bs_name = Path(name).name
            data = _read_processed_file(job_id, bs_name)
            idea_client.upload_document(
                submission["external_id"], f"Month_{idx}_Bank_Statement.pdf", data, document_type="bank-statement"
            )
    except (ValueError, RuntimeError) as exc:
        _log_event(submission_id, "idea_send_documents", False, None, str(exc))
        update_partner_submission(submission_id, status="error", last_error=str(exc))
        raise HTTPException(502, str(exc)) from exc

    _log_event(submission_id, "idea_send_documents", True, 200, "uploaded")
    updated = update_partner_submission(submission_id, status="docs_sent")
    return {"ok": True, "data": updated}


@app.post("/api/partners/idea/{submission_id}/process-application")
def idea_process_application(submission_id: int, body: ProcessApplicationBody, user=Depends(require_auth)):
    submission = _get_owned_submission(submission_id, user)
    # Also allow retrying from "error" - see the matching comment in
    # can_process_application.
    if submission["status"] not in ("docs_sent", "error"):
        raise HTTPException(400, "Send documents to iDea before processing the application.")
    if not idea_client.idea_configured():
        raise HTTPException(503, "iDea Financial is not configured. Set IDEA_CLIENT_ID/IDEA_CLIENT_SECRET in backend/.env.")
    if body.consent_accepted is not True:
        raise HTTPException(400, "Consent is required to process an application.")

    try:
        result = idea_client.process_application(submission["external_id"])
    except RuntimeError as exc:
        _log_event(submission_id, "idea_process_application", False, None, str(exc))
        update_partner_submission(submission_id, status="error", last_error=str(exc))
        raise HTTPException(502, str(exc)) from exc

    _log_event(submission_id, "idea_process_application", True, 200, json.dumps(result))
    updated = update_partner_submission(submission_id, status="processed")
    return {"ok": True, "data": updated}


@app.get("/api/partners/idea/{submission_id}/status")
def idea_submission_status(submission_id: int, user=Depends(require_auth)):
    submission = _get_owned_submission(submission_id, user)
    if not idea_client.idea_configured():
        raise HTTPException(503, "iDea Financial is not configured.")
    try:
        return {"ok": True, "data": idea_client.get_status(submission["external_id"])}
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


class ZohoBusinessBody(BaseModel):
    """Deliberately separate from BusinessDetailsBody: a Zoho Lead has no
    industry_naics_code or billing_country field, and none of these should
    be required — this is a partial update of whatever fields the user
    actually edited, not a full funder-submission payload."""

    legal_name: str = ""
    dba: str = ""
    phone: str = ""
    tax_id: str = ""
    entity_type: str = ""
    state_of_formation: str = ""
    business_start_date: str = ""
    billing_street: str = ""
    billing_city: str = ""
    billing_state: str = ""
    billing_postal_code: str = ""


class ZohoOwnerBody(BaseModel):
    first_name: str = ""
    last_name: str = ""
    date_of_birth: str = ""
    ssn: str = ""
    ownership_percentage: float = 0
    phone: str = ""
    email: str = ""
    mailing_street: str = ""
    mailing_city: str = ""
    mailing_state: str = ""
    mailing_postal_code: str = ""


class ZohoLoanBody(BaseModel):
    average_monthly_revenue: float | None = None
    average_daily_balance: float | None = None


class ZohoLeadUpdateBody(BaseModel):
    business: ZohoBusinessBody
    owners: list[ZohoOwnerBody] = Field(min_length=1, max_length=1)
    loan: ZohoLoanBody


@app.get("/api/zoho/leads/{lead_id}")
def zoho_get_lead(lead_id: str, _user=Depends(require_auth)):
    if not zoho_client.zoho_configured():
        raise HTTPException(503, "Zoho CRM is not configured.")
    try:
        return {"ok": True, "data": zoho_client.get_lead(lead_id)}
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.put("/api/zoho/leads/{lead_id}")
def zoho_update_lead(lead_id: str, body: ZohoLeadUpdateBody, _user=Depends(require_auth)):
    if not zoho_client.zoho_configured():
        raise HTTPException(503, "Zoho CRM is not configured.")
    try:
        result = zoho_client.update_lead(
            lead_id,
            body.business.model_dump(),
            [o.model_dump() for o in body.owners],
            body.loan.model_dump(),
        )
        return {"ok": True, "data": result}
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(502, str(exc)) from exc
