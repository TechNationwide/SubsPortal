"""Watermark PDFs with a brand image and flatten to a single raster layer."""

from __future__ import annotations

import io
from pathlib import Path

import fitz


def _open_watermark(watermark_bytes: bytes) -> fitz.Pixmap:
    last_err = None
    for filetype in ("png", "jpeg", "jpg", "webp"):
        try:
            doc = fitz.open(stream=watermark_bytes, filetype=filetype)
            if doc.page_count == 0:
                doc.close()
                continue
            pix = doc[0].get_pixmap(alpha=True)
            doc.close()
            return pix
        except Exception as exc:  # noqa: BLE001
            last_err = exc
    raise ValueError("Watermark must be a PNG, JPEG, or WebP image.") from last_err


def _text_watermark_pixmap(brand_name: str, width: float, height: float) -> bytes:
    """Fallback watermark when no logo image is uploaded."""
    side = int(min(width, height) * 0.5)
    doc = fitz.open()
    page = doc.new_page(width=side, height=side)
    page.insert_textbox(
        fitz.Rect(8, side * 0.35, side - 8, side * 0.65),
        brand_name.upper(),
        fontsize=14,
        fontname="helv",
        color=(0.45, 0.45, 0.45),
        align=fitz.TEXT_ALIGN_CENTER,
    )
    pix = page.get_pixmap(alpha=True)
    doc.close()
    return pix.tobytes("png")


def watermark_and_flatten(
    pdf_bytes: bytes,
    *,
    brand_name: str,
    watermark_bytes: bytes | None = None,
    scale: float = 0.38,
    flatten_matrix: float = 2.0,
) -> bytes:
    """
    Apply a centered brand watermark to every page, then rasterize each page
    so the watermark is baked into one layer (Adobe pre-flight style).
    """
    src = fitz.open(stream=pdf_bytes, filetype="pdf")
    marked = fitz.open()

    if watermark_bytes:
        wm_pix = _open_watermark(watermark_bytes)
        wm_stream = watermark_bytes
    else:
        first = src[0]
        wm_stream = _text_watermark_pixmap(brand_name, first.rect.width, first.rect.height)
        wm_pix = fitz.Pixmap(wm_stream)

    wm_ratio = wm_pix.height / wm_pix.width if wm_pix.width else 1

    for page in src:
        pr = page.rect
        canvas = marked.new_page(width=pr.width, height=pr.height)
        canvas.show_pdf_page(pr, src, page.number)

        wm_w = pr.width * scale
        wm_h = wm_w * wm_ratio
        x0 = (pr.width - wm_w) / 2
        y0 = (pr.height - wm_h) / 2
        rect = fitz.Rect(x0, y0, x0 + wm_w, y0 + wm_h)
        canvas.insert_image(rect, stream=wm_stream, overlay=True)

        # Brand label in footer for traceability (Aquamark-style attribution).
        footer = fitz.Rect(36, pr.height - 42, pr.width - 36, pr.height - 18)
        canvas.insert_textbox(
            footer,
            f"{brand_name} — CONFIDENTIAL",
            fontsize=9,
            fontname="helv",
            color=(0.35, 0.35, 0.35),
            align=fitz.TEXT_ALIGN_CENTER,
        )

    src.close()

    flat = fitz.open()
    matrix = fitz.Matrix(flatten_matrix, flatten_matrix)
    for page in marked:
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        np = flat.new_page(width=page.rect.width, height=page.rect.height)
        np.insert_image(np.rect, pixmap=pix)

    marked.close()
    out = flat.tobytes(deflate=True, garbage=4)
    flat.close()
    return out


def safe_output_name(original: str, brand_name: str, deal_name: str) -> str:
    stem = Path(original).stem
    brand = "".join(c if c.isalnum() else "_" for c in brand_name).strip("_")
    deal = "".join(c if c.isalnum() else "_" for c in deal_name).strip("_")
    return f"{brand}_{deal}_{stem}_Watermarked.pdf"
