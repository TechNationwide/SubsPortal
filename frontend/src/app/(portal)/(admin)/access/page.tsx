"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { api } from "@/lib/api";
import type { PartnerIntegrationStatus } from "@/lib/types";

const INTEGRATION_LABELS: Record<string, string> = {
  ondeck: "OnDeck",
  can: "CAN Capital",
  peac: "PEAC",
  channel: "Channel",
  idea: "iDea Financial",
  zoho: "Zoho CRM",
};

export default function AccessPage() {
  const [statuses, setStatuses] = useState<Record<string, PartnerIntegrationStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.partners
      .getStatus()
      .then((res) => setStatuses(res.partners))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load integration status"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalShell
      title="Access & Credentials"
      subtitle="Where accounts, integrations, and server access actually live — for whoever's maintaining this next."
    >
      <section className="card panel config-card">
        <div className="config-card-header">
          <div>
            <h2>Portal accounts</h2>
            <p>
              Passwords are bcrypt-hashed — one-way, not recoverable by anyone. To get someone
              into an account, reset their password from the Users page instead of trying to
              retrieve the old one.
            </p>
          </div>
          <span className="config-badge">Admin</span>
        </div>
        <Link href="/users" className="btn btn-primary">
          Manage users &amp; reset passwords →
        </Link>
      </section>

      <section className="card panel config-card">
        <div className="config-card-header">
          <div>
            <h2>Third-party integrations</h2>
            <p>Live configured/not-configured status, pulled straight from the server — never a stale snapshot.</p>
          </div>
          <span className="config-badge">Live</span>
        </div>
        {loading ? (
          <p className="crm-muted">Loading…</p>
        ) : error ? (
          <p className="crm-muted">{error}</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Integration</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(statuses).map(([key, status]) => (
                  <tr key={key}>
                    <td>
                      <strong>{INTEGRATION_LABELS[key] ?? key}</strong>
                    </td>
                    <td>
                      {status.configured ? (
                        <span className="partner-ready-badge">Configured</span>
                      ) : (
                        <span className="config-badge">Not configured</span>
                      )}
                    </td>
                    <td className="crm-muted">
                      {Object.entries(status)
                        .filter(([k]) => k !== "configured")
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="field-hint">
          Real credential values are never returned here — only whether each one is set. See
          &ldquo;Server access&rdquo; below for how to check an actual value.
        </p>
      </section>

      <section className="card panel config-card">
        <div className="config-card-header">
          <div>
            <h2>Server access</h2>
            <p>Everything actually runs on one AWS EC2 box — no managed services to separately manage access to.</p>
          </div>
        </div>
        <table className="crm-table">
          <tbody>
            <tr>
              <td style={{ width: 180 }}><strong>Host</strong></td>
              <td>18.224.233.72 (AWS EC2)</td>
            </tr>
            <tr>
              <td><strong>SSH</strong></td>
              <td>
                <code>ssh -i vat-portal.pem ubuntu@18.224.233.72</code> — ask whoever holds{" "}
                <code>vat-portal.pem</code> for the key file itself; it isn&rsquo;t stored here.
              </td>
            </tr>
            <tr>
              <td><strong>App path</strong></td>
              <td><code>/home/ubuntu/vaTeam-WebPage</code></td>
            </tr>
            <tr>
              <td><strong>Process manager</strong></td>
              <td><code>pm2</code> — <code>vateam-api</code> (backend), <code>vateam-web</code> (frontend)</td>
            </tr>
            <tr>
              <td><strong>Real secrets</strong></td>
              <td>
                <code>backend/.env</code> on the server only — never committed, never shown in
                this app. Once SSH&rsquo;d in: <code>cat backend/.env</code>.
              </td>
            </tr>
            <tr>
              <td><strong>Source code</strong></td>
              <td>
                <code>github.com/Mushibhai47/SubsPortall</code> and{" "}
                <code>github.com/TechNationwide/SubsPortal</code> — see the engineering handoff
                docs for why production&rsquo;s own git history has diverged from both.
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </PortalShell>
  );
}
