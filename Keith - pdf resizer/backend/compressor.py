"""PDF compression utilities for post-flatten / aqua workflow bloat."""

from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

import fitz  # PyMuPDF
import pikepdf


class CompressionPreset(str, Enum):
    """Compression strength vs quality trade-offs."""

    LIGHT = "light"
    BALANCED = "balanced"
    AGGRESSIVE = "aggressive"
    MAXIMUM = "maximum"


@dataclass
class CompressionResult:
    original_bytes: int
    compressed_bytes: int
    method: str
    preset: str
    page_count: int

    @property
    def reduction_percent(self) -> float:
        if self.original_bytes == 0:
            return 0.0
        return round((1 - self.compressed_bytes / self.original_bytes) * 100, 1)

    @property
    def size_multiplier(self) -> float:
        if self.original_bytes == 0:
            return 1.0
        return round(self.compressed_bytes / self.original_bytes, 2)


PRESET_SETTINGS: dict[CompressionPreset, dict] = {
    CompressionPreset.LIGHT: {
        "image_dpi": 200,
        "jpeg_quality": 85,
        "garbage": 3,
        "deflate": True,
    },
    CompressionPreset.BALANCED: {
        "image_dpi": 150,
        "jpeg_quality": 75,
        "garbage": 4,
        "deflate": True,
    },
    CompressionPreset.AGGRESSIVE: {
        "image_dpi": 120,
        "jpeg_quality": 60,
        "garbage": 4,
        "deflate": True,
    },
    CompressionPreset.MAXIMUM: {
        "image_dpi": 96,
        "jpeg_quality": 45,
        "garbage": 4,
        "deflate": True,
    },
}


def _recompress_images_pymupdf(data: bytes, preset: CompressionPreset) -> bytes:
    """Re-encode embedded images and strip redundant objects via PyMuPDF."""
    settings = PRESET_SETTINGS[preset]
    doc = fitz.open(stream=data, filetype="pdf")

    for page in doc:
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            try:
                base = doc.extract_image(xref)
            except Exception:
                continue

            width = base.get("width", 0)
            height = base.get("height", 0)
            if width == 0 or height == 0:
                continue

            max_dim = max(width, height)
            target_dpi = settings["image_dpi"]
            # Heuristic: assume ~72 DPI baseline for oversized flattened rasters
            scale = min(1.0, (target_dpi * 11) / max_dim)
            if scale >= 0.99:
                scale = 1.0

            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.n - pix.alpha > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)

                if scale < 1.0:
                    new_w = max(1, int(pix.width * scale))
                    new_h = max(1, int(pix.height * scale))
                    pix = fitz.Pixmap(pix, new_w, new_h)

                img_bytes = pix.tobytes("jpeg", jpg_quality=settings["jpeg_quality"])
                doc.update_stream(
                    xref,
                    img_bytes,
                    new=True,
                    compress=True,
                )
            except Exception:
                continue

    buf = io.BytesIO()
    doc.save(
        buf,
        garbage=settings["garbage"],
        deflate=settings["deflate"],
        clean=True,
        pretty=False,
    )
    doc.close()
    return buf.getvalue()


def _optimize_pikepdf(data: bytes) -> bytes:
    """Structural optimization: dedupe streams, compress, linearize."""
    with pikepdf.open(io.BytesIO(data)) as pdf:
        buf = io.BytesIO()
        pdf.save(
            buf,
            compress_streams=True,
            object_stream_mode=pikepdf.ObjectStreamMode.generate,
            linearize=True,
        )
        return buf.getvalue()


def _ghostscript_compress(data: bytes, preset: CompressionPreset) -> bytes | None:
    """Optional Ghostscript pass — best for flattened print PDFs when installed."""
    gs = shutil.which("gswin64c") or shutil.which("gswin32c") or shutil.which("gs")
    if not gs:
        return None

    pdf_setting_map = {
        CompressionPreset.LIGHT: "/printer",
        CompressionPreset.BALANCED: "/ebook",
        CompressionPreset.AGGRESSIVE: "/ebook",
        CompressionPreset.MAXIMUM: "/screen",
    }

    with tempfile.TemporaryDirectory() as tmp:
        inp = Path(tmp) / "in.pdf"
        out = Path(tmp) / "out.pdf"
        inp.write_bytes(data)

        cmd = [
            gs,
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            f"-dPDFSETTINGS={pdf_setting_map[preset]}",
            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH",
            "-dDetectDuplicateImages=true",
            "-dCompressFonts=true",
            "-dSubsetFonts=true",
            f"-sOutputFile={out}",
            str(inp),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=120)
            if out.exists() and out.stat().st_size > 0:
                return out.read_bytes()
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            return None
    return None


def compress_pdf(
    data: bytes, preset: CompressionPreset = CompressionPreset.BALANCED
) -> tuple[CompressionResult, bytes]:
    """
    Multi-stage compression pipeline for bloated flattened PDFs.

    Flattening / aqua workflows often rasterize vectors at 300+ DPI,
    causing 10–30x size increases. This pipeline:
      1. Re-encodes images at target DPI/quality (PyMuPDF)
      2. Structural optimization (pikepdf)
      3. Ghostscript pass if available (often yields largest wins)
    """
    original_size = len(data)
    page_count = 0
    try:
        with fitz.open(stream=data, filetype="pdf") as doc:
            page_count = doc.page_count
    except Exception:
        pass

    current = _recompress_images_pymupdf(data, preset)
    current = _optimize_pikepdf(current)

    method = "pymupdf+pikepdf"
    gs_result = _ghostscript_compress(current, preset)
    if gs_result and len(gs_result) < len(current):
        current = gs_result
        method = "pymupdf+pikepdf+ghostscript"

    # If still larger than original (rare), keep best effort
    if len(current) >= original_size and len(_optimize_pikepdf(data)) < len(current):
        fallback = _recompress_images_pymupdf(data, CompressionPreset.AGGRESSIVE)
        if len(fallback) < len(current):
            current = fallback
            method = "pymupdf-aggressive-fallback"

    return CompressionResult(
        original_bytes=original_size,
        compressed_bytes=len(current),
        method=method,
        preset=preset.value,
        page_count=page_count,
    ), current
