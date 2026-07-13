# Zoho CRM Integration — Feasibility & Setup

**Short answer: yes, this is possible**, and it doesn't need any new API — Keith
already has one. What's needed is (1) Keith reachable on a public domain, and
(2) a Custom Button + Deluge function on the Zoho side. Both pieces below are
ready to wire up once the domain is live.

## How it works

```
Zoho CRM record (Lead/Deal)
  → agent clicks "Compress PDF" button
  → Deluge function fires
      1. reads the target attachment off the record
      2. invokeurl POST → Keith's /api/compress-and-download (multipart file)
      3. gets the compressed PDF back in the same response
      4. zoho.crm.attachFile() saves it back onto the record
  → done, agent sees the compressed file on the record
```

One HTTP round trip. No polling, no webhook callback — Keith compresses and
streams the result back in the same request.

## What's already built (this repo)

- `POST /api/compress-and-download` — new endpoint added for this integration.
  Takes a PDF (multipart `file` + optional `preset`), returns the compressed
  PDF directly as the response body (not JSON — the old `/api/compress` +
  `/api/download/{job_id}` two-step flow still exists for the web UI, this is
  a one-call version for server-to-server callers like Zoho).
  Stats come back as headers: `X-Original-Bytes`, `X-Compressed-Bytes`,
  `X-Reduction-Percent`, `X-Page-Count`.
- API key protection on every `/api/*` route except `/api/health`. Set the
  `KEITH_API_KEY` environment variable before exposing this publicly —
  without it, the API is wide open to anyone who finds the domain. Requests
  must send `X-API-Key: <the key>`. Verified: unauthenticated and wrong-key
  requests get `401`, correct key passes through.
  (Locally with `KEITH_API_KEY` unset, nothing changes — the existing web UI
  keeps working with no auth, same as today.)

Tested against `sample_bloated.pdf` in this repo: 25.3 MB → 3.78 MB (85%
smaller) in one call, well under Zoho's response size limit (see below).

## Constraints to design around (confirmed from Zoho's docs)

- **40-second timeout** per `invokeurl` call — if Keith takes longer than that
  to respond, Zoho gives up. Compression of a normal contract/proposal PDF
  (the "aqua/flatten bloat" case this tool targets) finishes in a few seconds;
  very large or many-hundred-page files could risk this.
- **5 MB response cap** on `invokeurl` calls to external (non-Zoho) domains —
  the compressed PDF coming back from Keith must be under 5 MB. Given the
  whole point is shrinking bloated files, this should hold for typical
  documents, but a huge original could still compress to something over 5 MB.
- **5-minute total execution cap** per Deluge function — not a real concern
  for a single invokeurl call, just noting it exists.
- If a specific client's files are likely to blow past the 5 MB compressed
  limit, the fix is to change Keith to upload the result to Zoho WorkDrive (or
  S3) and return a link instead of raw bytes — different flow, not built yet,
  flag it if it comes up.

## Setup checklist

1. Deploy Keith to the AWS server behind the domain (HTTPS recommended).
2. Set `KEITH_API_KEY` in the server environment to a random secret.
3. In Zoho CRM: **Setup → Customization → \[Module] → Buttons** → create a
   custom button, action = "Writing Function", paste the script below, fill
   in `KEITH_URL` and `KEITH_API_KEY`, adjust the module name.
4. Place the button on the Lead (or Deal) layout.

## Sample Deluge function

Attach a PDF to the Lead record first (the button assumes there's already an
attachment to compress — that's the normal case: someone uploaded a bloated
signed contract).

```javascript
// Custom Button function — module: Leads
recordId = input.record_id;

// 1. Find the attachment to compress (grabs the most recent one)
attachments = zoho.crm.getRelatedRecords("Attachments", "Leads", recordId);
if (attachments.size() == 0) {
	return "No attachment found on this record.";
}
targetAttachment = attachments.get(0);
attachmentId = targetAttachment.get("id");
fileName = targetAttachment.get("File_Name");

// 2. Download the original attachment bytes from Zoho
originalFile = invokeurl
[
	url: "https://www.zohoapis.com/crm/v2/Leads/" + recordId + "/Attachments/" + attachmentId
	type: GET
	connection: "crm_oauth_connection" // pre-authenticated Zoho connection
];

// 3. Send it to Keith for compression, get the compressed PDF straight back
originalFile.setParamName("file");
compressedFile = invokeurl
[
	url: "https://KEITH_URL/api/compress-and-download"
	type: POST
	files: originalFile
	parameters: {"preset": "balanced"}
	headers: {"X-API-Key": "KEITH_API_KEY"}
];

// 4. Attach the compressed PDF back onto the record
result = zoho.crm.attachFile("Leads", recordId, compressedFile);

return "Compressed and attached: " + fileName;
```

Notes on the script:
- `connection: "crm_oauth_connection"` needs a Zoho CRM connection created once
  under **Setup → Developer Space → Connections** (standard Zoho-to-Zoho auth,
  not related to Keith's API key).
- Swap `KEITH_URL` / `KEITH_API_KEY` for the real domain and secret once
  deployed. Don't hardcode the key in a shared script long-term — Zoho
  supports storing secrets in Connections, worth moving to that once this is
  confirmed working.
- `preset` can be `light` / `balanced` / `aggressive` / `maximum` — matches
  the presets in the web UI.

## What's NOT done yet (by design — this was a feasibility pass)

- The button isn't actually created in Zoho (needs a real Zoho CRM admin
  session, module/field names from the client's actual setup).
- No handling yet for "compressed file still over 5 MB" — will surface as a
  Deluge error; fine for now, revisit if it happens in practice.
- Nothing here touches the SMS Sales Agent app — this is a separate,
  standalone integration between Zoho and Keith directly.
