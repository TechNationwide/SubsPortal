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
        "jpeg_quality": 85,
        "garbage": 3,
        "deflate": True,
    },
    CompressionPreset.BALANCED: {
        "jpeg_quality": 75,
        "garbage": 4,
        "deflate": True,
    },
    CompressionPreset.AGGRESSIVE: {
        "jpeg_quality": 60,
        "garbage": 4,
        "deflate": True,
    },
    CompressionPreset.MAXIMUM: {
        "jpeg_quality": 45,
        "garbage": 4,
        "deflate": True,
    },
}


def _recompress_images_pymupdf(data: bytes, preset: CompressionPreset) -> bytes:
    """Re-encode embedded images via PyMuPDF's built-in image rewriter.

    A hand-rolled version of this used to build a scaled/re-encoded Pixmap and
    write its JPEG bytes into the image xref with ``Document.update_stream``.
    That call only replaces the raw stream bytes — it doesn't update the
    image XObject's /Filter, /Width or /Height — so viewers kept decoding the
    new JPEG data as if it were the old (differently sized, differently
    encoded) raw samples, which rendered as solid garbage fills instead of
    the original page content. ``rewrite_images`` is PyMuPDF's own
    replacement for this and keeps the image dictionary consistent with the
    new stream.
    """
    settings = PRESET_SETTINGS[preset]
    doc = fitz.open(stream=data, filetype="pdf")
    doc.rewrite_images(quality=settings["jpeg_quality"])

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

    Flattening / aqua workflows often rasterize vectors into large raster
    images, causing outsized file bloat. This pipeline:
      1. Re-encodes embedded images at target JPEG quality (PyMuPDF)
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
