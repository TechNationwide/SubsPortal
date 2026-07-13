"""Watermark PDFs with a brand image and flatten to a single raster layer."""

from __future__ import annotations

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


def flatten_pdf(pdf_bytes: bytes, *, flatten_matrix: float = 2.0) -> bytes:
    """Rasterize each page so watermarks and content are baked into a single layer."""
    src = fitz.open(stream=pdf_bytes, filetype="pdf")
    flat = fitz.open()
    matrix = fitz.Matrix(flatten_matrix, flatten_matrix)
    for page in src:
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        np = flat.new_page(width=page.rect.width, height=page.rect.height)
        np.insert_image(np.rect, pixmap=pix)
    src.close()
    out = flat.tobytes(deflate=True, garbage=4)
    flat.close()
    return out


def watermark_and_flatten(
    pdf_bytes: bytes,
    *,
    brand_name: str,
    recipient_name: str | None = None,
    watermark_bytes: bytes | None = None,
    scale: float = 0.38,
    flatten_matrix: float = 2.0,
) -> bytes:
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

        if recipient_name and recipient_name.strip():
            funder_label = recipient_name.strip()
            attr_rect = fitz.Rect(36, pr.height - 78, pr.width - 36, pr.height - 48)
            canvas.insert_textbox(
                attr_rect,
                funder_label,
                fontsize=11,
                fontname="helv",
                color=(0.25, 0.25, 0.25),
                align=fitz.TEXT_ALIGN_CENTER,
            )

        footer = fitz.Rect(36, pr.height - 42, pr.width - 36, pr.height - 18)
        footer_lines = [f"{brand_name} — CONFIDENTIAL"]
        if recipient_name and recipient_name.strip():
            footer_lines.append(f"Funder attribution: {recipient_name.strip()}")
        canvas.insert_textbox(
            footer,
            "\n".join(footer_lines),
            fontsize=9,
            fontname="helv",
            color=(0.35, 0.35, 0.35),
            align=fitz.TEXT_ALIGN_CENTER,
        )

    src.close()
    marked_bytes = marked.tobytes(deflate=True, garbage=4)
    marked.close()
    return flatten_pdf(marked_bytes, flatten_matrix=flatten_matrix)


def safe_output_name(
    original: str,
    brand_name: str,
    deal_name: str,
    recipient_name: str | None = None,
) -> str:
    stem = Path(original).stem
    brand = "".join(c if c.isalnum() else "_" for c in brand_name).strip("_")
    deal = "".join(c if c.isalnum() else "_" for c in deal_name).strip("_")
    recipient = "".join(c if c.isalnum() else "_" for c in (recipient_name or "")).strip("_")
    if recipient:
        return f"{brand}_{recipient}_{deal}_{stem}_Watermarked.pdf"
    return f"{brand}_{deal}_{stem}_Watermarked.pdf"
