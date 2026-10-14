"use client";

import { useCallback, useEffect, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { api } from "@/lib/api";
import type {
  IntegrationStatusEvent,
  IntegrationStatusIssue,
  IntegrationStatusResponse,
  PartnerIntegrationStatus,
} from "@/lib/types";

const INTEGRATION_ORDER = [
  "ondeck",
  "can",
  "idea",
  "ecg",
  "channel",
  "peac",
  "zoho",
  "aquamark",
] as const;

const INTEGRATION_LABELS: Record<string, string> = {
  ondeck: "OnDeck",
  can: "CAN Capital",
  idea: "iDea Financial",
  ecg: "Expansion Capital",
  channel: "Channel",
  peac: "PEAC",
  zoho: "Zoho CRM",
  aquamark: "Aquamark",
};

function formatWhen(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function shortNote(value?: string | null, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function cardState(configured: boolean, last?: IntegrationStatusEvent) {
  if (!configured) return { label: "Not configured", tone: "empty" as const };
  if (!last) return { label: "Configured", tone: "ready" as const };
  if (last.ok) return { label: "Last call OK", tone: "ready" as const };
  return { label: "Needs attention", tone: "pending" as const };
}

export default function IntegrationStatusPage() {
  const [hours, setHours] = useState(48);
  const [data, setData] = useState<IntegrationStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (windowHours: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getIntegrationStatus(windowHours);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integration status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(hours);
  }, [hours, load]);

  const summary = data?.summary;
  const partners = data?.partners || {};
  const lastByFunder = data?.last_by_funder || {};
  const issues = data?.issues || [];
  const events = data?.events || [];

  const healthy =
    !loading &&
    !error &&
    summary &&
    summary.api_failed === 0 &&
    summary.zoho_failed === 0 &&
    summary.zoho_skipped === 0;

  return (
    <PortalShell
      title="Integration Status"
      subtitle="Live view of funder APIs, Zoho write-backs, and recent responses — admin only."
    >
      <section className="card panel ops-toolbar">
        <div className="ops-toolbar-left">
          <span className="config-badge">Admin</span>
          <p className="panel-sub" style={{ margin: 0 }}>
            Window: last {hours} hours. Refresh after a submit to see whether Zoho IDs were written.
          </p>
        </div>
        <div className="ops-toolbar-right">
          <select
            className="crm-search"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            aria-label="Time window"
            style={{ minWidth: 140 }}
          >
            <option value={24}>Last 24 hours</option>
            <option value={48}>Last 48 hours</option>
            <option value={72}>Last 72 hours</option>
            <option value={168}>Last 7 days</option>
          </select>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load(hours)}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      {error && (
        <section className="card panel">
          <p className="crm-muted">{error}</p>
        </section>
      )}

      {summary && (
        <section className="ops-summary-grid">
          <div className="ops-summary-card">
            <span className="ops-summary-label">Submits</span>
            <strong>{summary.submits}</strong>
          </div>
          <div className="ops-summary-card">
            <span className="ops-summary-label">API failures</span>
            <strong>{summary.api_failed}</strong>
          </div>
          <div className="ops-summary-card">
            <span className="ops-summary-label">Zoho writes OK</span>
            <strong>{summary.zoho_ok}</strong>
          </div>
          <div className="ops-summary-card">
            <span className="ops-summary-label">Zoho skipped / failed</span>
            <strong>{summary.zoho_skipped + summary.zoho_failed}</strong>
          </div>
        </section>
      )}

      {healthy ? (
        <div className="ops-banner ops-banner-ok">Integrations look healthy in this window.</div>
      ) : summary ? (
        <div className="ops-banner ops-banner-warn">
          Review the issues below — blank Zoho Lead IDs on submit are the most common reason OnDeck / CAN / iDea
          IDs stay empty in CRM.
        </div>
      ) : null}

      <section className="card panel">
        <div className="panel-header">
          <h2>API lines</h2>
          <p className="panel-sub">Configured status plus the newest logged response for each funder.</p>
        </div>
        <div className="ops-line-grid">
          {INTEGRATION_ORDER.map((key) => {
            const status = (partners[key] || { configured: false }) as PartnerIntegrationStatus;
            const last = lastByFunder[key];
            const state = cardState(Boolean(status.configured), last);
            return (
              <article key={key} className="ops-line-card">
                <div className="ops-line-card-top">
                  <h3>{INTEGRATION_LABELS[key] || key}</h3>
                  <span className={`brand-status-pill ${state.tone}`}>{state.label}</span>
                </div>
                <div className="ops-line-meta">
                  <span>
                    <em>Configured</em>
                    {status.configured ? "Yes" : "No"}
                  </span>
                  <span>
                    <em>Last action</em>
                    {last?.action || "—"}
                  </span>
                  <span>
                    <em>When</em>
                    {formatWhen(last?.created_at)}
                  </span>
                </div>
                <p className="ops-line-note">{shortNote(last?.message || (status.configured ? "No recent events." : "Credentials not set on server."))}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="card panel">
        <div className="panel-header">
          <h2>Recent delivery issues</h2>
          <p className="panel-sub">Failed API calls and submissions that never wrote funder IDs back to Zoho.</p>
        </div>
        {loading && !data ? (
          <p className="crm-muted">Loading…</p>
        ) : issues.length === 0 ? (
          <p className="crm-muted">No issues in this window.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>API</th>
                  <th>Deal</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue: IntegrationStatusIssue, idx) => (
                  <tr key={`${issue.submission_id}-${issue.kind}-${idx}`}>
                    <td>{formatWhen(issue.when)}</td>
                    <td>
                      <strong>{INTEGRATION_LABELS[issue.funder_key] || issue.funder_key || "—"}</strong>
                      <div className="crm-muted">{issue.action}</div>
                    </td>
                    <td>
                      {issue.deal_name || "—"}
                      <div className="crm-muted">
                        #{issue.submission_id}
                        {issue.external_id ? ` · ${issue.external_id}` : ""}
                      </div>
                    </td>
                    <td>{shortNote(issue.note, 260)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card panel">
        <div className="panel-header">
          <h2>Recent API responses</h2>
          <p className="panel-sub">Newest audit trail rows from partner submits and Zoho write-backs.</p>
        </div>
        {events.length === 0 ? (
          <p className="crm-muted">No events in this window.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>API</th>
                  <th>Result</th>
                  <th>Response</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 40).map((ev) => (
                  <tr key={ev.id}>
                    <td>{formatWhen(ev.created_at)}</td>
                    <td>
                      <strong>{INTEGRATION_LABELS[ev.funder_key] || ev.funder_key}</strong>
                      <div className="crm-muted">
                        {ev.action} · {ev.deal_name || "—"}
                      </div>
                    </td>
                    <td>
                      <span className={`brand-status-pill ${ev.ok ? "ready" : "pending"}`}>
                        {ev.ok ? "OK" : "Issue"}
                      </span>
                      {ev.http_status != null && <div className="crm-muted">HTTP {ev.http_status}</div>}
                    </td>
                    <td>{shortNote(ev.message, 240)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PortalShell>
  );
}
