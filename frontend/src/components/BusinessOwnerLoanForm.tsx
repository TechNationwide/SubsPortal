"use client";

import type { BusinessDetails, LoanDetails, OwnerDetails } from "@/lib/types";

export const emptyBusinessDetails = (): BusinessDetails => ({
  legal_name: "",
  dba: "",
  phone: "",
  tax_id: "",
  entity_type: "",
  state_of_formation: "",
  business_start_date: "",
  industry_naics_code: "",
  billing_street: "",
  billing_city: "",
  billing_state: "",
  billing_postal_code: "",
  billing_country: "US",
});

export const emptyOwnerDetails = (): OwnerDetails => ({
  first_name: "",
  last_name: "",
  title: "",
  date_of_birth: "",
  ssn: "",
  ownership_percentage: 0,
  phone: "",
  email: "",
  mailing_street: "",
  mailing_city: "",
  mailing_state: "",
  mailing_postal_code: "",
  mailing_country: "US",
});

export const emptyLoanDetails = (): LoanDetails => ({
  requested_amount: 250000,
  loan_purpose: "Working Capital",
  desired_term_months: 18,
  average_monthly_revenue: null,
  average_daily_balance: null,
});

const ENTITY_TYPES = ["LLC", "Corporation", "Sole Proprietorship", "Partnership", "LLP", "Trust"];

type Props = {
  business: BusinessDetails;
  onBusinessChange: (business: BusinessDetails) => void;
  owners: OwnerDetails[];
  onOwnersChange: (owners: OwnerDetails[]) => void;
  loan: LoanDetails;
  onLoanChange: (loan: LoanDetails) => void;
};

export function BusinessOwnerLoanForm({
  business,
  onBusinessChange,
  owners,
  onOwnersChange,
  loan,
  onLoanChange,
}: Props) {
  function updateOwner(i: number, patch: Partial<OwnerDetails>) {
    const next = [...owners];
    next[i] = { ...next[i], ...patch };
    onOwnersChange(next);
  }

  function addOwner() {
    if (owners.length >= 2) return;
    onOwnersChange([...owners, emptyOwnerDetails()]);
  }

  function removeOwner(i: number) {
    if (owners.length <= 1) return;
    onOwnersChange(owners.filter((_, idx) => idx !== i));
  }

  const totalOwnership = owners.reduce((sum, o) => sum + (Number(o.ownership_percentage) || 0), 0);

  return (
    <div className="partner-form">
      <h3 className="partner-form-section-title">Business details</h3>
      <div className="field-grid-2">
        <div className="field">
          <label htmlFor="bizLegalName">Legal business name <span className="required">*</span></label>
          <input
            id="bizLegalName"
            value={business.legal_name}
            onChange={(e) => onBusinessChange({ ...business, legal_name: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="bizDba">DBA</label>
          <input
            id="bizDba"
            value={business.dba}
            onChange={(e) => onBusinessChange({ ...business, dba: e.target.value })}
            placeholder="Same as legal name if blank"
          />
        </div>
        <div className="field">
          <label htmlFor="bizPhone">Business phone</label>
          <input
            id="bizPhone"
            value={business.phone}
            onChange={(e) => onBusinessChange({ ...business, phone: e.target.value })}
            placeholder="10 digits"
          />
        </div>
        <div className="field">
          <label htmlFor="bizTaxId">Federal Tax ID (EIN)</label>
          <input
            id="bizTaxId"
            value={business.tax_id}
            onChange={(e) => onBusinessChange({ ...business, tax_id: e.target.value })}
            placeholder="9 digits"
          />
        </div>
        <div className="field">
          <label htmlFor="bizEntityType">Entity type</label>
          <select
            id="bizEntityType"
            value={business.entity_type}
            onChange={(e) => onBusinessChange({ ...business, entity_type: e.target.value })}
          >
            <option value="">Select…</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="bizStateFormation">State of formation</label>
          <input
            id="bizStateFormation"
            value={business.state_of_formation}
            maxLength={2}
            onChange={(e) => onBusinessChange({ ...business, state_of_formation: e.target.value.toUpperCase() })}
            placeholder="e.g. NY"
          />
        </div>
        <div className="field">
          <label htmlFor="bizStartDate">Business start date</label>
          <input
            id="bizStartDate"
            type="date"
            value={business.business_start_date}
            onChange={(e) => onBusinessChange({ ...business, business_start_date: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="bizNaics">Industry / NAICS code</label>
          <input
            id="bizNaics"
            value={business.industry_naics_code}
            onChange={(e) => onBusinessChange({ ...business, industry_naics_code: e.target.value })}
          />
        </div>
      </div>

      <h4 className="partner-form-subsection-title">Billing address</h4>
      <div className="field-grid-2">
        <div className="field">
          <label htmlFor="bizBillingStreet">Street</label>
          <input
            id="bizBillingStreet"
            value={business.billing_street}
            onChange={(e) => onBusinessChange({ ...business, billing_street: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="bizBillingCity">City</label>
          <input
            id="bizBillingCity"
            value={business.billing_city}
            onChange={(e) => onBusinessChange({ ...business, billing_city: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="bizBillingState">State</label>
          <input
            id="bizBillingState"
            value={business.billing_state}
            maxLength={2}
            onChange={(e) => onBusinessChange({ ...business, billing_state: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="field">
          <label htmlFor="bizBillingZip">ZIP</label>
          <input
            id="bizBillingZip"
            value={business.billing_postal_code}
            onChange={(e) => onBusinessChange({ ...business, billing_postal_code: e.target.value })}
          />
        </div>
      </div>

      <div className="partner-form-header-row">
        <h3 className="partner-form-section-title">Owner details</h3>
        <span
          className={`partner-ownership-badge${totalOwnership < 50 ? " warn" : ""}`}
          title="Combined ownership across listed owners"
        >
          {totalOwnership.toFixed(0)}% combined ownership
        </span>
      </div>
      {totalOwnership < 50 && (
        <p className="aquamark-hint">
          Combined ownership is below 50% — OnDeck auto-declines applications under this threshold.
        </p>
      )}

      {owners.map((owner, i) => (
        <div key={i} className="partner-owner-block">
          <div className="partner-form-header-row">
            <h4 className="partner-form-subsection-title">Owner {i + 1}</h4>
            {owners.length > 1 && (
              <button type="button" className="btn btn-secondary btn-xs" onClick={() => removeOwner(i)}>
                Remove
              </button>
            )}
          </div>
          <div className="field-grid-2">
            <div className="field">
              <label>First name <span className="required">*</span></label>
              <input
                value={owner.first_name}
                onChange={(e) => updateOwner(i, { first_name: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Last name <span className="required">*</span></label>
              <input
                value={owner.last_name}
                onChange={(e) => updateOwner(i, { last_name: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Title</label>
              <input
                value={owner.title}
                onChange={(e) => updateOwner(i, { title: e.target.value })}
                placeholder="CEO, Owner, Partner…"
              />
            </div>
            <div className="field">
              <label>Ownership %</label>
              <input
                type="number"
                min={0}
                max={100}
                value={owner.ownership_percentage}
                onChange={(e) => updateOwner(i, { ownership_percentage: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Date of birth</label>
              <input
                type="date"
                value={owner.date_of_birth}
                onChange={(e) => updateOwner(i, { date_of_birth: e.target.value })}
              />
            </div>
            <div className="field">
              <label>SSN</label>
              <input
                value={owner.ssn}
                onChange={(e) => updateOwner(i, { ssn: e.target.value })}
                placeholder="9 digits"
              />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={owner.phone} onChange={(e) => updateOwner(i, { phone: e.target.value })} />
            </div>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                value={owner.email}
                onChange={(e) => updateOwner(i, { email: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Mailing street</label>
              <input
                value={owner.mailing_street}
                onChange={(e) => updateOwner(i, { mailing_street: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Mailing city</label>
              <input
                value={owner.mailing_city}
                onChange={(e) => updateOwner(i, { mailing_city: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Mailing state</label>
              <input
                value={owner.mailing_state}
                maxLength={2}
                onChange={(e) => updateOwner(i, { mailing_state: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="field">
              <label>Mailing ZIP</label>
              <input
                value={owner.mailing_postal_code}
                onChange={(e) => updateOwner(i, { mailing_postal_code: e.target.value })}
              />
            </div>
          </div>
        </div>
      ))}
      {owners.length < 2 && (
        <button type="button" className="btn btn-secondary btn-xs" onClick={addOwner}>
          + Add second owner
        </button>
      )}

      <h3 className="partner-form-section-title">Loan details</h3>
      <div className="field-grid-2">
        <div className="field">
          <label>Requested amount <span className="required">*</span></label>
          <input
            type="number"
            min={0}
            value={loan.requested_amount}
            onChange={(e) => onLoanChange({ ...loan, requested_amount: Number(e.target.value) })}
            required
          />
        </div>
        <div className="field">
          <label>Loan purpose</label>
          <input
            value={loan.loan_purpose}
            onChange={(e) => onLoanChange({ ...loan, loan_purpose: e.target.value })}
            placeholder="Expansion, Equipment, Working Capital…"
          />
        </div>
        <div className="field">
          <label>Desired term (months)</label>
          <input
            type="number"
            min={0}
            value={loan.desired_term_months ?? ""}
            onChange={(e) =>
              onLoanChange({ ...loan, desired_term_months: e.target.value ? Number(e.target.value) : null })
            }
          />
        </div>
        <div className="field">
          <label>Average monthly revenue</label>
          <input
            type="number"
            min={0}
            value={loan.average_monthly_revenue ?? ""}
            onChange={(e) =>
              onLoanChange({
                ...loan,
                average_monthly_revenue: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </div>
        <div className="field">
          <label>Average daily bank balance</label>
          <input
            type="number"
            min={0}
            value={loan.average_daily_balance ?? ""}
            onChange={(e) =>
              onLoanChange({
                ...loan,
                average_daily_balance: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
