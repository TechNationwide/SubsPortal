import json
import urllib.request
from pathlib import Path

pdf = Path(__file__).resolve().parent.parent / "test-files" / "aquamark-test-3pages.pdf"
boundary = "----test"
recipients = json.dumps(
    [
        {"name": "Funder Alpha", "email": "alpha@example.com"},
        {"name": "Funder Beta", "email": "beta@example.com"},
    ]
)
parts = [
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"brand_name\"\r\n\r\nNationwide".encode(),
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"deal_name\"\r\n\r\nBrowser QA Test".encode(),
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"recipients\"\r\n\r\n{recipients}".encode(),
    (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"test.pdf\"\r\n"
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode()
    + pdf.read_bytes(),
    f"--{boundary}--\r\n".encode(),
]
body = b"\r\n".join(parts)
req = urllib.request.Request(
    "http://127.0.0.1:8000/api/aquamark/process",
    data=body,
    method="POST",
)
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
res = json.loads(urllib.request.urlopen(req).read())
ok = res.get("ok") and len(res.get("files", [])) == 2
names = [f.get("name", "") for f in res.get("files", [])]
has_recipients = all("Funder_Alpha" in n or "Funder_Beta" in n for n in names)
print("aquamark", "PASS" if ok and has_recipients else "FAIL", res)
