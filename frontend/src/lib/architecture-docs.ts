/** Plain-language Solution Document content (admin tab + PDF/text download).
 *  Structure follows the public engineering handoff docs, updated for today's portal
 *  (6 API partners including Expansion Capital, TechNationwide repo, current deploy).
 */

export type ArchSectionId =
  | "overview"
  | "flow"
  | "where"
  | "architecture"
  | "deploy"
  | "database"
  | "ondeck"
  | "can"
  | "ecg"
  | "peac"
  | "channel"
  | "idea"
  | "zoho"
  | "frontend"
  | "debugging"
  | "future"
  | "glossary";

export type ArchGroupId = "start" | "partners" | "also";

export type ArchSection = {
  id: ArchSectionId;
  group: ArchGroupId;
  label: string;
  title: string;
  summary: string;
};

export const ARCH_GROUPS: { id: ArchGroupId; label: string }[] = [
  { id: "start", label: "Start here" },
  { id: "partners", label: "API partners" },
  { id: "also", label: "Also" },
];

export const ARCH_SECTIONS: ArchSection[] = [
  {
    id: "overview",
    group: "start",
    label: "Overview",
    title: "Overview",
    summary:
      "SubsPortal is Nationwide Advance's internal submission portal: watermark deals, sync Zoho leads, and send into funder APIs or email.",
  },
  {
    id: "flow",
    group: "start",
    label: "Business flow",
    title: "Business flow — what a broker actually does",
    summary: "From deal name → watermark → business details → submit (email or API).",
  },
  {
    id: "where",
    group: "start",
    label: "Where everything is",
    title: "Where everything actually is",
    summary: "One always-on AWS server — not Vercel. Code on GitHub; secrets only on the server.",
  },
  {
    id: "architecture",
    group: "start",
    label: "Architecture",
    title: "Architecture",
    summary: "Next.js + FastAPI + Postgres on one EC2 box, with nginx and PM2.",
  },
  {
    id: "deploy",
    group: "start",
    label: "Server & deployment",
    title: "Server & deployment",
    summary: "Manual deploy: copy files → build frontend if needed → restart PM2.",
  },
  {
    id: "database",
    group: "start",
    label: "Database",
    title: "Database",
    summary: "PostgreSQL with a small connection pool. Users, sessions, brands, partner submissions.",
  },
  {
    id: "ondeck",
    group: "partners",
    label: "OnDeck",
    title: "OnDeck",
    summary: "Submit application → upload documents. Status available in the portal.",
  },
  {
    id: "can",
    group: "partners",
    label: "CAN Capital",
    title: "CAN Capital",
    summary: "Create application → upload docs → process (consent-gated).",
  },
  {
    id: "ecg",
    group: "partners",
    label: "Expansion Capital",
    title: "Expansion Capital (ECG)",
    summary: "Submit deal + owners → send bank statements → check status. Live on Production.",
  },
  {
    id: "peac",
    group: "partners",
    label: "PEAC",
    title: "PEAC",
    summary: "Single POST with business, owners, loan, and documents (base64).",
  },
  {
    id: "channel",
    group: "partners",
    label: "Channel",
    title: "Channel (CPC)",
    summary: "Multi-step onboarding sequence ending in finalize — not a single call.",
  },
  {
    id: "idea",
    group: "partners",
    label: "iDea Financial",
    title: "iDea Financial",
    summary: "Create application → upload documents → process (consent-gated).",
  },
  {
    id: "zoho",
    group: "also",
    label: "Zoho CRM",
    title: "Zoho CRM sync",
    summary: "Pull / push Lead fields into the portal forms. Not a funder submission.",
  },
  {
    id: "frontend",
    group: "also",
    label: "Partners / Submit Deal",
    title: "Two ways to submit (UI)",
    summary: "API Partners wizard vs classic Submit Deal email path.",
  },
  {
    id: "debugging",
    group: "also",
    label: "Debugging",
    title: "Debugging patterns",
    summary: "How to read partner errors and where to cross-check.",
  },
  {
    id: "future",
    group: "also",
    label: "Future work",
    title: "Future work",
    summary: "Known gaps and improvements worth doing next.",
  },
  {
    id: "glossary",
    group: "also",
    label: "Glossary",
    title: "Glossary & quick reference",
    summary: "Terms, key paths, and env var names (values stay on the server).",
  },
];

export const FLOW_STEPS = [
  {
    id: "deal",
    title: "1. Name the deal",
    text: "A label used for watermarking and filenames. Optionally pull merchant details from Zoho.",
  },
  {
    id: "pick",
    title: "2. Pick destinations",
    text: "API Partners: choose any combination of the six partners (each has a brand for Aquamark). Submit Deal: pick brand + email funders.",
  },
  {
    id: "upload",
    title: "3. Upload PDFs",
    text: "Bank statements and, when needed, an application document.",
  },
  {
    id: "watermark",
    title: "4. Watermark, flatten, compress",
    text: "Aquamark stamps the brand watermark; the portal can flatten and compress afterward.",
  },
  {
    id: "form",
    title: "5. Business, owner & loan details",
    text: "Filled once and shared across selected partners. The form blocks submit until required fields for those partners are complete.",
  },
  {
    id: "send",
    title: "6. Submit",
    text: "Email path sends via SendGrid. API path uses each partner's buttons (submit, send statements, process/status as needed).",
  },
] as const;

export const TECH_STACK = [
  { layer: "Website (frontend)", detail: "Next.js + React — portal screens people click" },
  { layer: "Server (backend)", detail: "Python FastAPI — Zoho, Aquamark, email, and funder APIs" },
  { layer: "Database", detail: "PostgreSQL — users, sessions, partner submissions, brands" },
  { layer: "Reverse proxy", detail: "nginx — portal.nationwideadvance.com → Next.js + /api → FastAPI" },
  { layer: "Process manager", detail: "PM2 — vateam-web and vateam-api stay running" },
  { layer: "Hosting", detail: "One AWS EC2 machine — not serverless" },
] as const;

export type PartnerDoc = {
  id: ArchSectionId;
  name: string;
  module: string;
  steps: string;
  quirks: string[];
};

export const PARTNER_DOCS: PartnerDoc[] = [
  {
    id: "ondeck",
    name: "OnDeck",
    module: "backend/ondeck_client.py",
    steps: "Submit application → upload documents. Status can be checked in the portal.",
    quirks: [
      "Base URL must include the /api path segment.",
      "documentNeed must use OnDeck's accepted values (not free text).",
      "Combined owner ownership under 50% is rejected locally before calling OnDeck.",
      "Average monthly revenue and average daily balance are required for a full submit.",
    ],
  },
  {
    id: "can",
    name: "CAN Capital",
    module: "backend/can_client.py",
    steps: "Create application → upload documents (presigned S3-style) → process (consent-gated).",
    quirks: [
      "Document upload uses the current Wasabi / SigV4-style field shape.",
      "Hard-rejects individual files over about 12MB — keep statements compressed.",
      "rep_email on create controls where CAN sends decline/status emails.",
      "Process step requires explicit consent before the application is finalized.",
    ],
  },
  {
    id: "ecg",
    name: "Expansion Capital",
    module: "backend/ecg_client.py",
    steps: "Submit deal + owners → send bank statements → check status.",
    quirks: [
      "Auth is the x-authtoken header (not a login OAuth dance).",
      "Hosts: api.dev.ecg.com (Dev) vs api.prod.ecg.com (Production). Live portal uses Production.",
      "Industry must be chosen from Expansion's list (not a free-text NAICS).",
      "At most 2 owners; ownership percentages must total 100% or less.",
      "Configured only when ECG_AUTH_TOKEN and ECG_PARTNER_EMAIL are set on the server.",
      "With a Zoho Lead ID: writes Expansion_App_ID on submit and Expansion_App_Status on submit/status check (same pattern as OnDeck / CAN / iDea).",
    ],
  },
  {
    id: "peac",
    name: "PEAC",
    module: "backend/peac_client.py",
    steps: "Single POST — business, owner, loan, and documents (base64) together.",
    quirks: [
      "Production hostname includes “devportal” — that is intentional, matching the client's Zoho script.",
      "Bank statement labels must use month abbreviations (Jan, Feb, …), not free labels.",
      "Loan purpose is hardcoded to Expansion for PEAC's picklist.",
      "Amount / revenue fields must be whole numbers (no decimal point).",
    ],
  },
  {
    id: "channel",
    name: "Channel",
    module: "backend/channel_client.py",
    steps: "Multi-step CPC onboarding (application → contacts/files → finalize). Not a single call.",
    quirks: [
      "Without the finalize step, deals stay drafts in Channel's portal.",
      "File Category must match Channel's enum (bank statements vs application).",
      "Application type “New” uses the confirmed type id from Channel's API.",
      "Response success is a real JSON boolean — do not compare to the string \"true\".",
      "Long-lived Bearer token from Channel; refresh manually if it expires.",
    ],
  },
  {
    id: "idea",
    name: "iDea Financial",
    module: "backend/idea_client.py",
    steps: "Create application → upload documents → process (consent-gated).",
    quirks: [
      "Cloudflare can block Python's default User-Agent — the client sends a browser-like UA.",
      "ownershipPercentage must be an integer (not 100.0).",
      "Upload filenames should stay short/simple to avoid their database rejecting the file.",
      "entityType confirmed for LLC; other types follow kebab-case as best effort.",
    ],
  },
];

export const DEPLOY_STEPS = [
  "Review and test locally first.",
  "Copy changed files to the server app folder (scp) — there is no auto-deploy from git push alone.",
  "Frontend changes: on the server run npm run build inside frontend/.",
  "Restart: pm2 restart vateam-web and/or pm2 restart vateam-api.",
  "Confirm https://portal.nationwideadvance.com loads and /api/health is healthy.",
] as const;

export const FUTURE_ITEMS = [
  {
    title: "Zsales Aquamark account",
    text: "Only the Zsales brand's Aquamark email fails (500 from Aquamark). Other brands process cleanly.",
  },
  {
    title: "Official specs for PEAC / iDea",
    text: "Those two still rely heavily on Zoho reference scripts. Official docs would reduce guesswork.",
  },
  {
    title: "Usable partner sandboxes",
    text: "Most fixes were verified against production because sandboxes do not mirror real validation.",
  },
  {
    title: "Pre-flight file size checks",
    text: "Warn before upload when a file will fail CAN (~12MB) or other partner limits.",
  },
  {
    title: "Zoho Lead discovery",
    text: "Lead ID is still pasted manually. Search-by-name was not in the original client spec.",
  },
] as const;

export const GLOSSARY = [
  {
    term: "Aquamark",
    meaning: "External watermarking API. Brands map to Aquamark identities used on bank-statement PDFs.",
  },
  {
    term: "API Partners",
    meaning: "Portal tab that submits directly into funder APIs (six partners today).",
  },
  {
    term: "Submit Deal",
    meaning: "Classic email path — watermark once, email funders via SendGrid.",
  },
  {
    term: "configured()",
    meaning: "Backend gate: partner client returns False until required env credentials exist — no accidental live calls.",
  },
  {
    term: "Access tab",
    meaning: "Admin screen showing which integrations are configured (never shows secret values).",
  },
  {
    term: "Solution Document",
    meaning: "This admin guide — under Sign Out in the header for admins only.",
  },
] as const;

export const KEY_FILES = [
  { path: "backend/main.py", note: "HTTP API routes, auth, partner endpoints" },
  { path: "backend/db.py", note: "Postgres pool and queries" },
  { path: "backend/*_client.py", note: "One module per funder / Zoho / Aquamark" },
  { path: "frontend/src/app/(portal)/partners/page.tsx", note: "API Partners wizard" },
  { path: "frontend/src/app/(portal)/submit/page.tsx", note: "Submit Deal email path" },
  { path: "frontend/src/components/PortalShell.tsx", note: "Header nav + Solution Document link" },
] as const;

export const ENV_NAMES = [
  "Database URL / Postgres settings",
  "Session / auth secrets",
  "ZOHO_* (Self Client OAuth)",
  "Aquamark credentials per brand setup",
  "SendGrid API key",
  "ONDECK_*, CAN_*, ECG_*, PEAC_*, CHANNEL_*, IDEA_* partner tokens and base URLs",
] as const;

export const REPO_URL = "https://github.com/TechNationwide/SubsPortal";
export const LIVE_URL = "https://portal.nationwideadvance.com";
export const SERVER_HOST = "AWS EC2 (portal.nationwideadvance.com)";
export const APP_PATH = "/home/ubuntu/vaTeam-WebPage";

export function getPartnerDoc(id: ArchSectionId): PartnerDoc | undefined {
  return PARTNER_DOCS.find((p) => p.id === id);
}

export function buildPlainTextDoc(): string {
  const lines: string[] = [
    "NATIONWIDE ADVANCE — SUBMISSION PORTAL",
    "Solution Document (plain-language handoff)",
    "",
    `Live site: ${LIVE_URL}`,
    `Code: ${REPO_URL}`,
    `Runs on: ${SERVER_HOST}`,
    `Server app path: ${APP_PATH}`,
    "",
  ];

  for (const section of ARCH_SECTIONS) {
    lines.push("=".repeat(60));
    lines.push(section.title.toUpperCase());
    lines.push(section.summary);
    lines.push("");
  }

  lines.push("=".repeat(60));
  lines.push("BUSINESS FLOW");
  for (const step of FLOW_STEPS) {
    lines.push(`${step.title}: ${step.text}`);
  }
  lines.push("");

  lines.push("=".repeat(60));
  lines.push("TECHNOLOGY");
  for (const row of TECH_STACK) {
    lines.push(`- ${row.layer}: ${row.detail}`);
  }
  lines.push("");

  lines.push("=".repeat(60));
  lines.push("API PARTNERS");
  for (const p of PARTNER_DOCS) {
    lines.push(`- ${p.name} (${p.module}): ${p.steps}`);
    for (const q of p.quirks) {
      lines.push(`    • ${q}`);
    }
  }
  lines.push("");

  lines.push("=".repeat(60));
  lines.push("DEPLOY");
  DEPLOY_STEPS.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("");

  lines.push("=".repeat(60));
  lines.push("FOR A NEW DEVELOPER");
  lines.push(`1. Clone ${REPO_URL} (TechNationwide account).`);
  lines.push("2. Read this Solution Document and the Access tab.");
  lines.push("3. Never point funder APIs at Production until Keith says so.");
  lines.push("4. Deploy to the live EC2 box only after local review.");
  lines.push("5. Secrets live in backend/.env on the server — never commit them.");
  lines.push("");

  return lines.join("\n");
}
