"use client";

import { useMemo, useState } from "react";
import { ArchitectureFlow } from "@/components/ArchitectureFlow";
import { PortalShell } from "@/components/PortalShell";
import {
  ARCH_GROUPS,
  ARCH_SECTIONS,
  APP_PATH,
  DEPLOY_STEPS,
  ENV_NAMES,
  FUTURE_ITEMS,
  GLOSSARY,
  KEY_FILES,
  LIVE_URL,
  PARTNER_DOCS,
  REPO_URL,
  SERVER_HOST,
  TECH_STACK,
  buildPlainTextDoc,
  getPartnerDoc,
  type ArchSectionId,
} from "@/lib/architecture-docs";

type FlowMode = "static" | "animated";

export default function ArchitecturePage() {
  const [sectionId, setSectionId] = useState<ArchSectionId>("overview");
  const [flowMode, setFlowMode] = useState<FlowMode>("static");

  const section = useMemo(
    () => ARCH_SECTIONS.find((s) => s.id === sectionId) ?? ARCH_SECTIONS[0],
    [sectionId],
  );

  function downloadPdf() {
    window.print();
  }

  function downloadText() {
    const blob = new Blob([buildPlainTextDoc()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nationwide-submission-portal-solution-document.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PortalShell
      title="Solution Document"
      subtitle="Plain-language map of the Submission Portal — for Keith and for any developer who takes over next."
    >
      <div className="arch-toolbar no-print">
        <p className="arch-toolbar-note">
          Admin only. Same handoff map as the engineering docs, updated for today&apos;s portal
          (including Expansion Capital). Download a copy anytime.
        </p>
        <div className="arch-toolbar-actions">
          <button type="button" className="btn btn-primary" onClick={downloadPdf}>
            Download PDF
          </button>
          <button type="button" className="btn btn-secondary" onClick={downloadText}>
            Download text copy
          </button>
        </div>
      </div>

      <div className="arch-layout">
        <aside className="arch-sidebar card panel no-print" aria-label="Documentation sections">
          <p className="arch-sidebar-title">Sections</p>
          <nav className="arch-sidebar-nav">
            {ARCH_GROUPS.map((group) => (
              <div key={group.id} className="arch-sidebar-group">
                <p className="arch-sidebar-group-label">{group.label}</p>
                {ARCH_SECTIONS.filter((item) => item.group === group.id).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`arch-sidebar-link${sectionId === item.id ? " is-active" : ""}`}
                    onClick={() => setSectionId(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <div className="arch-content" id="architecture-print-root">
          <header className="arch-print-cover print-only">
            <h1>Nationwide Advance — Submission Portal</h1>
            <p>Solution Document (handoff notes)</p>
            <p>
              Live: {LIVE_URL}
              <br />
              Code: {REPO_URL}
            </p>
          </header>

          <div className="arch-screen-only">
            <section className="card panel config-card arch-section">
              <div className="config-card-header">
                <div>
                  <h2>{section.title}</h2>
                  <p>{section.summary}</p>
                </div>
                <span className="config-badge">Admin</span>
              </div>
              <SectionBody
                id={section.id}
                flowMode={flowMode}
                onFlowMode={setFlowMode}
              />
            </section>
          </div>

          <div className="arch-print-all print-only">
            {ARCH_SECTIONS.map((item) => (
              <section key={item.id} className="arch-print-section">
                <h2>{item.title}</h2>
                <p className="arch-print-summary">{item.summary}</p>
                <SectionBody id={item.id} flowMode="static" onFlowMode={() => undefined} print />
              </section>
            ))}
          </div>
        </div>
      </div>
    </PortalShell>
  );
}

function SectionBody({
  id,
  flowMode,
  onFlowMode,
  print = false,
}: {
  id: ArchSectionId;
  flowMode: FlowMode;
  onFlowMode: (mode: FlowMode) => void;
  print?: boolean;
}) {
  if (id === "overview") {
    return (
      <div className="arch-prose">
        <p>
          SubsPortal is an internal portal for Nationwide Advance. It does three jobs: run deal PDFs
          through a watermark / flatten / compress pipeline (Aquamark, branded per funder), submit
          deals into partner APIs, and sync merchant fields with Zoho CRM.
        </p>
        <p>
          There are <strong>six</strong> direct API partners today: OnDeck, CAN Capital,{" "}
          <strong>Expansion Capital</strong>, PEAC, Channel, and iDea Financial — plus the classic
          Submit Deal email path for funders who still take deals by email.
        </p>
        <ul>
          <li>
            Live site:{" "}
            <a href={LIVE_URL} target="_blank" rel="noreferrer">
              {LIVE_URL}
            </a>
          </li>
          <li>
            Code:{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {REPO_URL}
            </a>
          </li>
          <li>Who can open this Solution Document: admins only (for example Keith)</li>
        </ul>
        <p className="field-hint">
          Where partner logic came from: several APIs (especially PEAC and iDea) had incomplete public
          specs. Behavior was cross-checked against the client&apos;s working Zoho Deluge scripts and
          live responses — not invented from scratch.
        </p>
      </div>
    );
  }

  if (id === "flow") {
    return (
      <div className="arch-prose">
        {!print && (
          <div className="arch-flow-controls no-print">
            <button
              type="button"
              className={`btn btn-xs${flowMode === "static" ? " btn-primary" : " btn-secondary"}`}
              onClick={() => onFlowMode("static")}
            >
              Static diagram
            </button>
            <button
              type="button"
              className={`btn btn-xs${flowMode === "animated" ? " btn-primary" : " btn-secondary"}`}
              onClick={() => onFlowMode("animated")}
            >
              Animated walkthrough
            </button>
          </div>
        )}
        <ArchitectureFlow mode={print ? "static" : flowMode} />
        <p style={{ marginTop: 16 }}>
          After submit, approvals and declines happen in each funder&apos;s own system. This portal&apos;s
          job ends when a complete, correctly formatted application is in their hands.
        </p>
      </div>
    );
  }

  if (id === "where") {
    return (
      <div className="arch-prose">
        <p>
          Unlike a Vercel-only app, SubsPortal is a traditional always-on server. There is no
          serverless host for the main portal.
        </p>
        <ul>
          <li>
            <strong>Live:</strong> {LIVE_URL}
          </li>
          <li>
            <strong>Server:</strong> {SERVER_HOST}
          </li>
          <li>
            <strong>App folder:</strong> <code>{APP_PATH}</code>
          </li>
          <li>
            <strong>GitHub:</strong>{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {REPO_URL}
            </a>{" "}
            (TechNationwide, branch <code>main</code>)
          </li>
        </ul>
        <p>
          Real credentials live only in <code>backend/.env</code> on the server — never committed, never
          printed in this document. Use the Access tab to see configured / not-configured status without
          exposing secret values.
        </p>
      </div>
    );
  }

  if (id === "architecture") {
    return (
      <div className="arch-prose">
        <p>Three moving pieces, one server:</p>
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Layer</th>
                <th>What it is</th>
              </tr>
            </thead>
            <tbody>
              {TECH_STACK.map((row) => (
                <tr key={row.layer}>
                  <td>
                    <strong>{row.layer}</strong>
                  </td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 style={{ marginTop: 20 }}>Partner client pattern</h3>
        <ul>
          <li>One file per funder (and Zoho / Aquamark) under <code>backend/</code>.</li>
          <li>Config from env vars at call time — never cached at import.</li>
          <li>
            <code>*_configured()</code> stays False until credentials exist (safety gate).
          </li>
          <li>
            <code>describe_integration()</code> powers Access / status badges without leaking secrets.
          </li>
          <li>HTTP via Python <code>urllib</code> with masked request/response logging.</li>
        </ul>
      </div>
    );
  }

  if (id === "deploy") {
    return (
      <div className="arch-prose">
        <p>
          Production is a single AWS EC2 box. Deploys are manual: copy → build (frontend) → PM2 restart.
        </p>
        <ol>
          {DEPLOY_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p>
          Processes: <code>vateam-api</code> (FastAPI) and <code>vateam-web</code> (Next.js). A 307 from
          the site root to <code>/login</code> is normal when you are signed out.
        </p>
      </div>
    );
  }

  if (id === "database") {
    return (
      <div className="arch-prose">
        <p>
          Postgres, accessed through a small threaded connection pool in <code>db.py</code>. Queries go
          through one shared cursor helper — there is no second ad-hoc connection path.
        </p>
        <ul>
          <li>Users, sessions, roles (admin vs standard)</li>
          <li>Brands, funders, teams, watermark jobs</li>
          <li>Partner submission records and status</li>
        </ul>
        <p className="field-hint">
          Idle connections can be closed by Postgres; the pool must not return a dead connection. If you
          see intermittent DB errors after idle time, check the pool recycle / health handling in{" "}
          <code>db.py</code>.
        </p>
      </div>
    );
  }

  const partner = getPartnerDoc(id);
  if (partner) {
    return (
      <div className="arch-prose">
        <p>
          <code>{partner.module}</code>
        </p>
        <p>
          <strong>Flow:</strong> {partner.steps}
        </p>
        <h3>Worth knowing</h3>
        <ul>
          {partner.quirks.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (id === "zoho") {
    return (
      <div className="arch-prose">
        <p>
          Zoho is not a lender submission. It is a two-way sync with Nationwide Advance&apos;s CRM Lead
          records (business, owner, loan fields).
        </p>
        <ul>
          <li>
            Auth: Zoho Self Client OAuth2 — long-lived refresh token after a one-time grant code.
          </li>
          <li>
            <code>backend/zoho_client.py</code> — get / update Lead, same configured() pattern as partners.
          </li>
          <li>
            <strong>Zoho Lookup</strong> page — paste Lead ID, pull, edit, push back (confirm dialog).
          </li>
          <li>
            API Partners form can pull a Lead ID and merge fields into the shared business / owner / loan
            step.
          </li>
        </ul>
        <p>
          Lead ID is still entered manually (no name search yet). Revenue is passed through as-is; push
          does not set a CRM “status” field — only mapped data fields.
        </p>
      </div>
    );
  }

  if (id === "frontend") {
    return (
      <div className="arch-prose arch-two-col">
        <div className="arch-path-card">
          <h3>API Partners</h3>
          <p>
            Wizard under <code>/partners</code>: deal name → pick partners → upload → optional application
            PDF → shared business/owner/loan form → per-partner actions.
          </p>
          <p>
            Partners: {PARTNER_DOCS.map((p) => p.name).join(", ")}. Validation runs client-side before a
            submit button fires so obvious rejects never hit the funder.
          </p>
        </div>
        <div className="arch-path-card">
          <h3>Submit Deal</h3>
          <p>
            Classic path under <code>/submit</code>: pick brand, email funders, watermark once, send via
            SendGrid with the prepared files.
          </p>
          <p>Best when the funder still receives deals by email instead of API.</p>
        </div>
      </div>
    );
  }

  if (id === "debugging") {
    return (
      <div className="arch-prose">
        <p>
          Practical loop: submit something real → read the exact error → find the earliest wrong field or
          URL → fix → retry. Partner docs alone rarely predict every quirk.
        </p>
        <h3>Reading an error</h3>
        <ul>
          <li>
            <strong>Validation / 400:</strong> something we sent failed their rules — usually fixable in
            our mapping.
          </li>
          <li>
            <strong>403:</strong> auth or allow-list issue (sometimes looks like auth when it is a wrong
            URL).
          </li>
          <li>
            <strong>Generic “partner failed”:</strong> always open the detailed message from the toast or
            API logs — the label alone is not enough.
          </li>
        </ul>
        <h3>Where to cross-check</h3>
        <ul>
          <li>Compare request/response to the Zoho reference script for that funder, line by line.</li>
          <li>Check Access + server logs (<code>vateam-api</code>) for the masked HTTP dump.</li>
          <li>If neither explains it, escalate to the funder&apos;s integration contact.</li>
        </ul>
      </div>
    );
  }

  if (id === "future") {
    return (
      <div className="arch-prose">
        <ul>
          {FUTURE_ITEMS.map((item) => (
            <li key={item.title}>
              <strong>{item.title}.</strong> {item.text}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // glossary
  return (
    <div className="arch-prose">
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Term</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {GLOSSARY.map((row) => (
              <tr key={row.term}>
                <td>
                  <strong>{row.term}</strong>
                </td>
                <td>{row.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 20 }}>Key files</h3>
      <ul>
        {KEY_FILES.map((f) => (
          <li key={f.path}>
            <code>{f.path}</code> — {f.note}
          </li>
        ))}
      </ul>
      <h3>Environment names (values on server only)</h3>
      <ul>
        {ENV_NAMES.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <ol style={{ marginTop: 20 }}>
        <li>Read every section of this Solution Document once.</li>
        <li>Open Access to see what is configured on live.</li>
        <li>
          Clone{" "}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            {REPO_URL}
          </a>
          .
        </li>
        <li>Test locally. Deploy only after an admin says go.</li>
        <li>Funder APIs: Development first. Production only with explicit approval.</li>
      </ol>
    </div>
  );
}
