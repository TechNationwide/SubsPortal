# VAT Submission Portal

Next.js frontend + Python (FastAPI) backend.

## Structure

```
backend/          FastAPI API + PDF processing (Aquamark)
frontend/         Next.js 15 app (App Router)
data/             JSON store + processed PDFs (created at runtime)
css/, *.html      Legacy static site (kept for reference)
```

## Run locally

### 1. Backend (port 8000)

```bash
cd backend
pip install -r requirements.txt
python run.py
```

API docs: http://127.0.0.1:8000/docs

### 2. Frontend (port 3000)

```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:3000

Production: https://portal.nationwideadvance.com

## Documentation

| What | Where |
|------|--------|
| **Interactive API docs** (Swagger / OpenAPI) | FastAPI: local `http://127.0.0.1:8000/docs` — production box `http://127.0.0.1:8006/docs` (nginx only exposes `/api/*` publicly) |
| **Engineering handoff** | https://subsportal-handoff-docs.vercel.app/ |
| **This repo** | https://github.com/TechNationwide/SubsPortal |

## Pages

| Route | Description |
|-------|-------------|
| `/login` | Portal sign-in |
| `/submit` | Submit deal — Aquamark watermark, downloads, email |
| `/partners` | API Partners — OnDeck, CAN, PEAC, Channel, iDea |
| `/zoho` | Zoho Lead pull / edit / push |
| `/teams` | CRM list + modal (members editor) |
| `/brands` | CRM list + modal (logo upload, submission email) |
| `/funders` | CRM list + modal (searchable multi-brand picker) |
| `/users` | User admin |
| `/access` | Partner/API access flags |

## Zoho write-back (API Partners)

If a **Zoho Lead ID** is filled in on `/partners` before submit, a successful create writes funder IDs onto that Lead (same fields as the old Zoho Deluge buttons). Push to Zoho (business/owner/loan) is unchanged.

| Submit | Zoho fields |
|--------|-------------|
| OnDeck | `business_id`, `lead_url`, `app_no` (+ OnDeck status stage when available) |
| CAN Capital | `canCapital_App_No` / `canCapital_App_No_1` |
| iDea Financial | `IdeaFinancial_App_ID` |

Funder submit still succeeds if the Zoho write fails. PEAC / Channel are not mapped to that Dev: onDeck section.

## Aquamark integration

Processing uses the [Aquamark Broker API](https://www.aquamark.io/broker) only — there is no local fallback. If the API fails, the portal shows an **Aquamark error** popup with details.

1. **Broker logo** — from your Aquamark Watermark Console
2. **Recipients** — funder names assigned to the selected brand (attribution on each PDF)
3. **Files** — one or more deal PDFs

Output count = **PDFs × funders**. Example: 2 PDFs and 2 funders → 4 watermarked files.

Copy `backend/.env.example` → `backend/.env`:

```env
AQUAMARK_API_URL=https://aquamark-broker-funder.onrender.com
AQUAMARK_API_KEY=aqua-api-watermark-77204041104282
AQUAMARK_USER_EMAIL=christina@aquamark.io
```

Restart the backend (`python run.py`). Check: `GET http://127.0.0.1:8000/api/aquamark/status`

**Test API** — Public test credential (Aquamark branding). **Production** — use your Aquamark account email after signup and subscription.

## Environment

`frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

Next.js rewrites `/api/*` to the Python backend in development.
