import json
from pathlib import Path
from urllib.request import Request, urlopen

pdf = Path(__file__).resolve().parent.parent / "sample_bloated.pdf"
boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
data = pdf.read_bytes()
body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="preset"\r\n\r\n'
    f"balanced\r\n"
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="file"; filename="sample_bloated.pdf"\r\n'
    f"Content-Type: application/pdf\r\n\r\n"
).encode() + data + f"\r\n--{boundary}--\r\n".encode()

req = Request("http://127.0.0.1:8000/api/compress", data=body, method="POST")
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
with urlopen(req, timeout=120) as resp:
    print(json.dumps(json.load(resp), indent=2))
