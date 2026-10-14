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

/** Full message — pretty-print JSON when possible so every word stays readable. */
function formatMessage(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "—";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

type BlameTone = "funder" | "zoho" | "ops" | "portal";

type BlameInfo = {
  tone: BlameTone;
  /** Short chip label Keith can scan in one glance */
  chip: string;
  /** One-line explanation under the chip */
  detail: string;
};

/**
 * Tell Keith whose side an issue is on before he has to ask.
 * Funder HTTP/API replies are labeled as not a portal bug.
 */
function explainBlame(
  funderKey?: string | null,
  action?: string | null,
  message?: string | null,
  ok?: boolean | null,
): BlameInfo | null {
  if (ok) return null;
  const key = String(funderKey || "");
  const label = INTEGRATION_LABELS[key] || key || "Partner";
  const msg = String(message || "");
  const act = String(action || "");

  if (
    /Lead ID was (likely )?blank/i.test(msg) ||
    /Skipped — Zoho Lead ID/i.test(msg) ||
    (/zoho_partner_ids/i.test(act) && /blank/i.test(msg))
  ) {
    return {
      tone: "ops",
      chip: "Portal process — Lead ID was blank",
      detail:
        "Not a funder outage. Add the Zoho Lead ID on Partners and Push (or re-submit) so OnDeck / CAN / iDea / Expansion IDs write to CRM.",
    };
  }

  if (/Zoho (CRM )?is not configured/i.test(msg)) {
    return {
      tone: "portal",
      chip: "Portal config",
      detail: "Zoho credentials are missing on the server — this is our setup, not a funder API failure.",
    };
  }

  if (/Zoho API|Zoho Leads|Zoho token|Zoho CRM/i.test(msg)) {
    return {
      tone: "zoho",
      chip: "Not a portal bug — Zoho CRM response",
      detail: "This text came from Zoho. The portal only forwarded their reply.",
    };
  }

  if (
    /\b(OnDeck|CAN Capital|iDea|Idea|Expansion|Channel|PEAC|Aquamark)\b[\s\S]{0,40}\bAPI\b/i.test(msg) ||
    /\bAPI\s+\d{3}\b/i.test(msg) ||
    (/\b(unreachable|timed out|timeout)\b/i.test(msg) && !/Zoho/i.test(msg))
  ) {
    return {
      tone: "funder",
      chip: `Not a portal bug — ${label} API response`,
      detail: `This message came from ${label}'s servers (their validation / downtime / data rules). The portal logged their reply as-is.`,
    };
  }

  if (key && key !== "zoho" && act && !/^zoho_/i.test(act)) {
    return {
      tone: "funder",
      chip: `Not a portal bug — ${label} side`,
      detail: `Treat this as a ${label} API / data issue unless the note clearly says otherwise.`,
    };
  }

  if (/^zoho_/i.test(act) || key === "zoho") {
    return {
      tone: "zoho",
      chip: "Zoho / write-back",
      detail: "Related to Zoho write-back — usually Lead ID or Zoho reply, not a funder outage.",
    };
  }

  return {
    tone: "portal",
    chip: "Needs a quick check",
    detail: "Highlight this row and we can confirm whose side it is.",
  };
}

function BlameCallout({ info }: { info: BlameInfo }) {
  return (
    <div className={`ops-blame ops-blame-${info.tone}`} role="note">
      <strong>{info.chip}</strong>
      <span>{info.detail}</span>
    </div>
  );
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
          Review the issues below. Orange &quot;Not a portal bug&quot; labels mean the funder/Zoho API replied with
          that error — we only logged it. Blank Zoho Lead IDs on submit are still the most common reason OnDeck /
          CAN / iDea / Expansion IDs stay empty in CRM.
        </div>
      ) : null}

      <div className="ops-legend" aria-label="How to read issue labels">
        <span className="ops-legend-item ops-blame-funder">
          <strong>Funder API</strong> — their servers / rules (not a portal bug)
        </span>
        <span className="ops-legend-item ops-blame-zoho">
          <strong>Zoho</strong> — CRM reply or write-back
        </span>
        <span className="ops-legend-item ops-blame-ops">
          <strong>Process</strong> — usually blank Lead ID on submit
        </span>
      </div>

      <section className="card panel">
        <div className="panel-header">
          <h2>API lines</h2>
          <p className="panel-sub">Configured status plus the newest logged response for each funder.</p>
        </div>
        <div className="ops-scroll-panel ops-scroll-panel-lines">
          <div className="ops-line-grid">
            {INTEGRATION_ORDER.map((key) => {
              const status = (partners[key] || { configured: false }) as PartnerIntegrationStatus;
              const last = lastByFunder[key];
              const state = cardState(Boolean(status.configured), last);
              const blame = last
                ? explainBlame(key, last.action, last.message, last.ok)
                : null;
              const note = formatMessage(
                last?.message || (status.configured ? "No recent events." : "Credentials not set on server."),
              );
              return (
                <article key={key} className="ops-line-card">
                  <div className="ops-line-card-top">
                    <h3>{INTEGRATION_LABELS[key] || key}</h3>
                    <span className={`brand-status-pill ${state.tone}`}>{state.label}</span>
                  </div>
                  <dl className="ops-line-meta">
                    <div>
                      <dt>Configured</dt>
                      <dd>{status.configured ? "Yes" : "No"}</dd>
                    </div>
                    <div>
                      <dt>Last action</dt>
                      <dd className="ops-mono">{last?.action || "—"}</dd>
                    </div>
                    <div>
                      <dt>When</dt>
                      <dd>{formatWhen(last?.created_at)}</dd>
                    </div>
                  </dl>
                  {blame && <BlameCallout info={blame} />}
                  <pre className="ops-msg ops-msg-card">{note}</pre>
                </article>
              );
            })}
          </div>
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
          <div className="ops-scroll-panel">
            <table className="crm-table ops-table">
              <thead>
                <tr>
                  <th className="ops-col-when">When</th>
                  <th className="ops-col-api">API</th>
                  <th className="ops-col-deal">Deal</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue: IntegrationStatusIssue, idx) => {
                  const blame = explainBlame(issue.funder_key, issue.action, issue.note, false);
                  return (
                    <tr key={`${issue.submission_id}-${issue.kind}-${idx}`}>
                      <td className="ops-col-when">{formatWhen(issue.when)}</td>
                      <td className="ops-col-api">
                        <strong>{INTEGRATION_LABELS[issue.funder_key] || issue.funder_key || "—"}</strong>
                        <div className="ops-mono ops-sub">{issue.action}</div>
                      </td>
                      <td className="ops-col-deal">
                        <div className="ops-wrap">{issue.deal_name || "—"}</div>
                        <div className="ops-mono ops-sub ops-wrap">
                          #{issue.submission_id}
                          {issue.external_id ? ` · ${issue.external_id}` : ""}
                        </div>
                      </td>
                      <td>
                        {blame && <BlameCallout info={blame} />}
                        <pre className="ops-msg">{formatMessage(issue.note)}</pre>
                      </td>
                    </tr>
                  );
                })}
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
          <div className="ops-scroll-panel">
            <table className="crm-table ops-table">
              <thead>
                <tr>
                  <th className="ops-col-when">When</th>
                  <th className="ops-col-api">API</th>
                  <th className="ops-col-result">Result</th>
                  <th>Response</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 80).map((ev) => {
                  const blame = explainBlame(ev.funder_key, ev.action, ev.message, ev.ok);
                  return (
                    <tr key={ev.id}>
                      <td className="ops-col-when">{formatWhen(ev.created_at)}</td>
                      <td className="ops-col-api">
                        <strong>{INTEGRATION_LABELS[ev.funder_key] || ev.funder_key}</strong>
                        <div className="ops-mono ops-sub ops-wrap">
                          {ev.action} · {ev.deal_name || "—"}
                        </div>
                      </td>
                      <td className="ops-col-result">
                        <span className={`brand-status-pill ${ev.ok ? "ready" : "pending"}`}>
                          {ev.ok ? "OK" : "Issue"}
                        </span>
                        {ev.http_status != null && <div className="ops-sub">HTTP {ev.http_status}</div>}
                      </td>
                      <td>
                        {blame && <BlameCallout info={blame} />}
                        <pre className="ops-msg">{formatMessage(ev.message)}</pre>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PortalShell>
  );
}
