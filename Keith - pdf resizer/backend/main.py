"""FastAPI backend for PDF compression demo."""

from __future__ import annotations

import io
import os
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from compressor import CompressionPreset, compress_pdf

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "data" / "uploads"
OUTPUT_DIR = BASE_DIR / "data" / "outputs"
FRONTEND_DIR = BASE_DIR / "frontend"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Set KEITH_API_KEY before exposing this service publicly (e.g. for Zoho's
# invokeurl calls). Left unset, the API stays open - fine for local dev only.
API_KEY = os.environ.get("KEITH_API_KEY")


async def require_api_key(x_api_key: str | None = Header(default=None)):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(401, "Invalid or missing X-API-Key header.")


app = FastAPI(title="PDF Resizer", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job store for demo (replace with S3/DynamoDB later)
jobs: dict[str, dict] = {}


class JobResponse(BaseModel):
    job_id: str
    status: str
    original_filename: str
    original_bytes: int
    compressed_bytes: int | None = None
    reduction_percent: float | None = None
    size_multiplier: float | None = None
    page_count: int | None = None
    method: str | None = None
    preset: str
    created_at: str
    download_url: str | None = None


class HealthResponse(BaseModel):
    status: str
    ghostscript_available: bool


@app.get("/api/health", response_model=HealthResponse)
async def health():
    import shutil

    gs = shutil.which("gswin64c") or shutil.which("gswin32c") or shutil.which("gs")
    return HealthResponse(status="ok", ghostscript_available=gs is not None)


@app.post("/api/compress", response_model=JobResponse, dependencies=[Depends(require_api_key)])
async def compress_endpoint(
    file: UploadFile = File(...),
    preset: str = Form(default="balanced"),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Please upload a PDF file.")

    try:
        compression_preset = CompressionPreset(preset)
    except ValueError:
        raise HTTPException(400, f"Invalid preset. Choose: {[p.value for p in CompressionPreset]}")

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(400, "Uploaded file is empty.")
    if len(raw) > 100 * 1024 * 1024:
        raise HTTPException(400, "File too large for demo (max 100 MB).")

    job_id = str(uuid.uuid4())
    original_path = UPLOAD_DIR / f"{job_id}_original.pdf"
    original_path.write_bytes(raw)

    try:
        result, compressed_data = compress_pdf(raw, compression_preset)
    except Exception as exc:
        raise HTTPException(422, f"Could not process PDF: {exc}") from exc

    output_path = OUTPUT_DIR / f"{job_id}_compressed.pdf"
    output_path.write_bytes(compressed_data)

    job = {
        "job_id": job_id,
        "status": "completed",
        "original_filename": file.filename,
        "original_bytes": result.original_bytes,
        "compressed_bytes": result.compressed_bytes,
        "reduction_percent": result.reduction_percent,
        "size_multiplier": result.size_multiplier,
        "page_count": result.page_count,
        "method": result.method,
        "preset": result.preset,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "output_path": str(output_path),
        "original_path": str(original_path),
    }
    jobs[job_id] = job

    return JobResponse(
        **{k: v for k, v in job.items() if k not in ("output_path", "original_path")},
        download_url=f"/api/download/{job_id}",
    )


@app.post("/api/compress-and-download", dependencies=[Depends(require_api_key)])
async def compress_and_download_endpoint(
    file: UploadFile = File(...),
    preset: str = Form(default="balanced"),
):
    """
    One-call version of compress + download for callers that can't do a
    two-step job/download flow easily (e.g. Zoho Deluge invokeurl). Returns
    the compressed PDF bytes directly; stats are in response headers.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Please upload a PDF file.")

    try:
        compression_preset = CompressionPreset(preset)
    except ValueError:
        raise HTTPException(400, f"Invalid preset. Choose: {[p.value for p in CompressionPreset]}")

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(400, "Uploaded file is empty.")
    if len(raw) > 100 * 1024 * 1024:
        raise HTTPException(400, "File too large for demo (max 100 MB).")

    try:
        result, compressed_data = compress_pdf(raw, compression_preset)
    except Exception as exc:
        raise HTTPException(422, f"Could not process PDF: {exc}") from exc

    stem = Path(file.filename).stem
    return Response(
        content=compressed_data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{stem}_compressed.pdf"',
            "X-Original-Bytes": str(result.original_bytes),
            "X-Compressed-Bytes": str(result.compressed_bytes),
            "X-Reduction-Percent": str(result.reduction_percent),
            "X-Page-Count": str(result.page_count),
        },
    )


@app.get("/api/jobs/{job_id}", response_model=JobResponse, dependencies=[Depends(require_api_key)])
async def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    return JobResponse(
        **{k: v for k, v in job.items() if k not in ("output_path", "original_path")},
        download_url=f"/api/download/{job_id}",
    )


@app.get("/api/download/{job_id}", dependencies=[Depends(require_api_key)])
async def download(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    path = Path(job["output_path"])
    if not path.exists():
        raise HTTPException(404, "Compressed file not found.")
    stem = Path(job["original_filename"]).stem
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=f"{stem}_compressed.pdf",
    )


@app.get("/api/download/{job_id}/original", dependencies=[Depends(require_api_key)])
async def download_original(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    path = Path(job["original_path"])
    if not path.exists():
        raise HTTPException(404, "Original file not found.")
    return FileResponse(path, media_type="application/pdf", filename=job["original_filename"])


@app.post("/api/batch-download", dependencies=[Depends(require_api_key)])
async def batch_download(job_ids: list[str] = Body(...)):
    found = []
    for jid in job_ids:
        job = jobs.get(jid)
        if job and Path(job["output_path"]).exists():
            found.append((job["original_filename"], job["output_path"]))

    if not found:
        raise HTTPException(404, "No completed jobs found.")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for original_name, out_path in found:
            stem = Path(original_name).stem
            zf.write(out_path, f"{stem}_compressed.pdf")
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="keith_compressed.zip"'},
    )


if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
