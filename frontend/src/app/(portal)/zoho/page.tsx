"use client";

import { FormEvent, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { api } from "@/lib/api";
import type { ZohoLeadData } from "@/lib/types";

function fmt(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function maskSsn(ssn: string): string {
  const digits = ssn.replace(/\D/g, "");
  if (digits.length < 4) return "—";
  return `•••-••-${digits.slice(-4)}`;
}

export default function ZohoLookupPage() {
  const [leadId, setLeadId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<ZohoLeadData | null>(null);
  const [showSsn, setShowSsn] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const id = leadId.trim();
    if (!id) return;
    setLoading(true);
    setError("");
    setData(null);
    setShowSsn(false);
    try {
      const res = await api.zoho.getLead(id);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pull this lead.");
    } finally {
      setLoading(false);
    }
  }

  const owner = data?.owners[0];

  return (
    <PortalShell
      title="Zoho Lookup"
      subtitle="Pull a lead straight from Zoho CRM to see what's on file before starting a submission."
    >
      <section className="card panel config-card">
        <div className="config-card-header">
          <div>
            <h2>Pull a lead</h2>
            <p>Read-only for now — this doesn&rsquo;t change anything in Zoho.</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="crm-toolbar">
          <div className="crm-toolbar-left" style={{ flex: 1 }}>
            <input
              type="text"
              className="crm-search"
              placeholder="Zoho Lead ID (e.g. 5292507000402729011)"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              style={{ minWidth: 320 }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading || !leadId.trim()}>
            {loading ? "Pulling…" : "Pull from Zoho"}
          </button>
        </form>
        {error && (
          <div className="toast-container" style={{ position: "static", marginTop: 12 }}>
            <div className="toast error">
              <span>•</span>
              <span>{error}</span>
            </div>
          </div>
        )}
      </section>

      {data && (
        <>
          <section className="card panel config-card">
            <div className="config-card-header">
              <div>
                <h2>Business</h2>
              </div>
            </div>
            <table className="crm-table">
              <tbody>
                <tr><td style={{ width: 220 }}><strong>Legal name</strong></td><td>{fmt(data.business.legal_name)}</td></tr>
                <tr><td><strong>DBA</strong></td><td>{fmt(data.business.dba)}</td></tr>
                <tr><td><strong>Phone</strong></td><td>{fmt(data.business.phone)}</td></tr>
                <tr><td><strong>Tax ID</strong></td><td>{fmt(data.business.tax_id)}</td></tr>
                <tr><td><strong>Entity type</strong></td><td>{fmt(data.business.entity_type)}</td></tr>
                <tr><td><strong>State of formation</strong></td><td>{fmt(data.business.state_of_formation)}</td></tr>
                <tr><td><strong>Start date</strong></td><td>{fmt(data.business.business_start_date)}</td></tr>
                <tr>
                  <td><strong>Billing address</strong></td>
                  <td>
                    {[data.business.billing_street, data.business.billing_city, data.business.billing_state, data.business.billing_postal_code]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          {owner && (
            <section className="card panel config-card">
              <div className="config-card-header">
                <div>
                  <h2>Owner</h2>
                </div>
              </div>
              <table className="crm-table">
                <tbody>
                  <tr><td style={{ width: 220 }}><strong>Name</strong></td><td>{fmt(`${owner.first_name} ${owner.last_name}`.trim())}</td></tr>
                  <tr><td><strong>Date of birth</strong></td><td>{fmt(owner.date_of_birth)}</td></tr>
                  <tr>
                    <td><strong>SSN</strong></td>
                    <td>
                      {owner.ssn ? (
                        <>
                          {showSsn ? owner.ssn : maskSsn(owner.ssn)}{" "}
                          <button type="button" className="btn btn-secondary btn-xs" onClick={() => setShowSsn((s) => !s)}>
                            {showSsn ? "Hide" : "Show"}
                          </button>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                  <tr><td><strong>Ownership %</strong></td><td>{fmt(owner.ownership_percentage)}</td></tr>
                  <tr><td><strong>Phone</strong></td><td>{fmt(owner.phone)}</td></tr>
                  <tr><td><strong>Email</strong></td><td>{fmt(owner.email)}</td></tr>
                  <tr>
                    <td><strong>Mailing address</strong></td>
                    <td>
                      {[owner.mailing_street, owner.mailing_city, owner.mailing_state, owner.mailing_postal_code]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          <section className="card panel config-card">
            <div className="config-card-header">
              <div>
                <h2>Loan</h2>
                <p>Only the fields Zoho actually carries — not the full submission shape.</p>
              </div>
            </div>
            <table className="crm-table">
              <tbody>
                <tr><td style={{ width: 220 }}><strong>Average monthly revenue</strong></td><td>{fmt(data.loan.average_monthly_revenue)}</td></tr>
                <tr><td><strong>Average daily balance</strong></td><td>{fmt(data.loan.average_daily_balance)}</td></tr>
              </tbody>
            </table>
          </section>
        </>
      )}
    </PortalShell>
  );
}
