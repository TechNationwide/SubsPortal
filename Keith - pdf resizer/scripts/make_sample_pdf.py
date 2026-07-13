"""Generate a sample bloated PDF (simulates post-flatten raster bloat)."""

import io
from pathlib import Path

import fitz

out = Path(__file__).resolve().parent.parent / "sample_bloated.pdf"

doc = fitz.open()

for i in range(2):
    page = doc.new_page(width=612, height=792)
    w, h = 1800, 2340  # ~300 DPI letter page
    samples = bytearray(w * h * 3)
    for y in range(h):
        row = y * w * 3
        for x in range(w):
            idx = row + x * 3
            samples[idx] = (x * 5 + y * 3 + i * 40) % 256
            samples[idx + 1] = (x * 2 + y * 7) % 256
            samples[idx + 2] = (x + y + i * 25) % 256
    pix = fitz.Pixmap(fitz.csRGB, w, h, bytes(samples), False)
    page.insert_image(page.rect, pixmap=pix)
    page.insert_text((50, 50), f"Flattened page {i + 1}", fontsize=18, color=(1, 1, 1))

buf = io.BytesIO()
doc.save(buf, deflate=False)
doc.close()
out.write_bytes(buf.getvalue())
mb = out.stat().st_size / 1024 / 1024
print(f"Created {out} ({mb:.2f} MB)")
