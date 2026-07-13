"""HTTP integration test against running backend."""

import json
import urllib.request
from pathlib import Path

pdf = Path(__file__).resolve().parent.parent / "test-files" / "aquamark-test-3pages.pdf"
base = "http://127.0.0.1:8000"

status = json.loads(urllib.request.urlopen(f"{base}/api/aquamark/status").read())
print("status:", status)

boundary = "----aquatest"
recipients = json.dumps(
    [{"name": "Funder Alpha", "email": "alpha@test.com"}, {"name": "Funder Beta", "email": "beta@test.com"}]
)
parts = [
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"brand_name\"\r\n\r\nNationwide".encode(),
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"deal_name\"\r\n\r\nQA Run".encode(),
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"recipients\"\r\n\r\n{recipients}".encode(),
    (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"test.pdf\"\r\n"
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode()
    + pdf.read_bytes(),
    f"--{boundary}--\r\n".encode(),
]
body = b"\r\n".join(parts)
req = urllib.request.Request(f"{base}/api/aquamark/process", data=body, method="POST")
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

try:
    res = json.loads(urllib.request.urlopen(req, timeout=180).read())
    print("process OK:", res.get("source"), len(res.get("files", [])), "files")
    for f in res.get("files", []):
        print(" -", f["name"], "|", f.get("recipient"))
except urllib.error.HTTPError as e:
    print("process FAIL:", e.code, e.read().decode())
