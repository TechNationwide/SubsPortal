"use client";

import { FormEvent, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { api } from "@/lib/api";
import type { ZohoBusinessFields, ZohoLeadData, ZohoLoanFields, ZohoOwnerFields } from "@/lib/types";

function maskSsn(ssn: string): string {
  const digits = ssn.replace(/\D/g, "");
  if (digits.length < 4) return "—";
  return `•••-••-${digits.slice(-4)}`;
}

const emptyBusiness = (): ZohoBusinessFields => ({
  legal_name: "",
  dba: "",
  phone: "",
  tax_id: "",
  entity_type: "",
  state_of_formation: "",
  business_start_date: "",
  billing_street: "",
  billing_city: "",
  billing_state: "",
  billing_postal_code: "",
});

const emptyOwner = (): ZohoOwnerFields => ({
  first_name: "",
  last_name: "",
  date_of_birth: "",
  ssn: "",
  ownership_percentage: 0,
  phone: "",
  email: "",
  mailing_street: "",
  mailing_city: "",
  mailing_state: "",
  mailing_postal_code: "",
});

const emptyLoan = (): ZohoLoanFields => ({
  average_monthly_revenue: null,
  average_daily_balance: null,
});

export default function ZohoLookupPage() {
  const [leadId, setLeadId] = useState("");
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState("");
  const [pulled, setPulled] = useState<ZohoLeadData | null>(null);
  const [showSsn, setShowSsn] = useState(false);

  const [business, setBusiness] = useState<ZohoBusinessFields>(emptyBusiness());
  const [owner, setOwner] = useState<ZohoOwnerFields>(emptyOwner());
  const [loan, setLoan] = useState<ZohoLoanFields>(emptyLoan());

  async function onPull(e: FormEvent) {
    e.preventDefault();
    const id = leadId.trim();
    if (!id) return;
    setLoading(true);
    setError("");
    setPulled(null);
    setShowSsn(false);
    try {
      const res = await api.zoho.getLead(id);
      setPulled(res.data);
      setBusiness(res.data.business);
      setOwner(res.data.owners[0] ?? emptyOwner());
      setLoan(res.data.loan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pull this lead.");
    } finally {
      setLoading(false);
    }
  }

  async function onPush() {
    const id = leadId.trim();
    if (!id) return;
    if (
      !window.confirm(
        `This will overwrite the mapped fields on Zoho Lead ${id} with what's shown below. Continue?`,
      )
    ) {
      return;
    }
    setPushing(true);
    setError("");
    try {
      await api.zoho.updateLead(id, { business, owners: [owner], loan });
      setError("");
      window.alert("Pushed to Zoho successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to push to Zoho.");
    } finally {
      setPushing(false);
    }
  }

  function field(
    label: string,
    value: string,
    onChange: (v: string) => void,
    type: "text" | "date" = "text",
  ) {
    return (
      <tr>
        <td style={{ width: 220 }}>
          <strong>{label}</strong>
        </td>
        <td>
          <input
            type={type}
            className="crm-search"
            style={{ width: "100%" }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </td>
      </tr>
    );
  }

  return (
    <PortalShell
      title="Zoho Lookup"
      subtitle="Pull a lead from Zoho CRM, edit if needed, and push changes back — one lead at a time."
    >
      <section className="card panel config-card">
        <div className="config-card-header">
          <div>
            <h2>Pull a lead</h2>
            <p>Enter a Lead ID to load its fields below.</p>
          </div>
        </div>
        <form onSubmit={onPull} className="crm-toolbar">
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

      {pulled && (
        <>
          <section className="card panel config-card">
            <div className="config-card-header">
              <div>
                <h2>Business</h2>
              </div>
            </div>
            <table className="crm-table">
              <tbody>
                {field("Legal name", business.legal_name, (v) => setBusiness({ ...business, legal_name: v }))}
                {field("DBA", business.dba, (v) => setBusiness({ ...business, dba: v }))}
                {field("Phone", business.phone, (v) => setBusiness({ ...business, phone: v }))}
                {field("Tax ID", business.tax_id, (v) => setBusiness({ ...business, tax_id: v }))}
                {field("Entity type", business.entity_type, (v) => setBusiness({ ...business, entity_type: v }))}
                {field("State of formation", business.state_of_formation, (v) => setBusiness({ ...business, state_of_formation: v }))}
                {field("Start date", business.business_start_date, (v) => setBusiness({ ...business, business_start_date: v }), "date")}
                {field("Billing street", business.billing_street, (v) => setBusiness({ ...business, billing_street: v }))}
                {field("Billing city", business.billing_city, (v) => setBusiness({ ...business, billing_city: v }))}
                {field("Billing state", business.billing_state, (v) => setBusiness({ ...business, billing_state: v }))}
                {field("Billing ZIP", business.billing_postal_code, (v) => setBusiness({ ...business, billing_postal_code: v }))}
              </tbody>
            </table>
          </section>

          <section className="card panel config-card">
            <div className="config-card-header">
              <div>
                <h2>Owner</h2>
              </div>
            </div>
            <table className="crm-table">
              <tbody>
                {field("First name", owner.first_name, (v) => setOwner({ ...owner, first_name: v }))}
                {field("Last name", owner.last_name, (v) => setOwner({ ...owner, last_name: v }))}
                {field("Date of birth", owner.date_of_birth, (v) => setOwner({ ...owner, date_of_birth: v }), "date")}
                <tr>
                  <td style={{ width: 220 }}>
                    <strong>SSN</strong>
                  </td>
                  <td>
                    {showSsn ? (
                      <input
                        type="text"
                        className="crm-search"
                        style={{ width: "100%" }}
                        value={owner.ssn}
                        onChange={(e) => setOwner({ ...owner, ssn: e.target.value })}
                      />
                    ) : (
                      <>
                        {owner.ssn ? maskSsn(owner.ssn) : "—"}{" "}
                        <button type="button" className="btn btn-secondary btn-xs" onClick={() => setShowSsn(true)}>
                          Show / edit
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {field("Ownership %", String(owner.ownership_percentage), (v) => setOwner({ ...owner, ownership_percentage: Number(v) || 0 }))}
                {field("Phone", owner.phone, (v) => setOwner({ ...owner, phone: v }))}
                {field("Email", owner.email, (v) => setOwner({ ...owner, email: v }))}
                {field("Mailing street", owner.mailing_street, (v) => setOwner({ ...owner, mailing_street: v }))}
                {field("Mailing city", owner.mailing_city, (v) => setOwner({ ...owner, mailing_city: v }))}
                {field("Mailing state", owner.mailing_state, (v) => setOwner({ ...owner, mailing_state: v }))}
                {field("Mailing ZIP", owner.mailing_postal_code, (v) => setOwner({ ...owner, mailing_postal_code: v }))}
              </tbody>
            </table>
          </section>

          <section className="card panel config-card">
            <div className="config-card-header">
              <div>
                <h2>Loan</h2>
                <p>Only the fields Zoho actually carries — not the full submission shape.</p>
              </div>
            </div>
            <table className="crm-table">
              <tbody>
                {field(
                  "Average monthly revenue",
                  loan.average_monthly_revenue == null ? "" : String(loan.average_monthly_revenue),
                  (v) => setLoan({ ...loan, average_monthly_revenue: v === "" ? null : Number(v) || 0 }),
                )}
                {field(
                  "Average daily balance",
                  loan.average_daily_balance == null ? "" : String(loan.average_daily_balance),
                  (v) => setLoan({ ...loan, average_daily_balance: v === "" ? null : Number(v) || 0 }),
                )}
              </tbody>
            </table>
          </section>

          <section className="card panel config-card">
            <div className="config-card-header">
              <div>
                <h2>Push back to Zoho</h2>
                <p>Overwrites the fields above on this Lead. Nothing else on the record is touched.</p>
              </div>
            </div>
            <button type="button" className="btn btn-primary" disabled={pushing} onClick={onPush}>
              {pushing ? "Pushing…" : "Push to Zoho"}
            </button>
          </section>
        </>
      )}
    </PortalShell>
  );
}
