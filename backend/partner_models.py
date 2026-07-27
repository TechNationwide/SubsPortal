"""Shared Business/Owner/Loan data model for the API Partners tab.

Nothing in the rest of the app has a structured business/loan entity today —
the existing "Submit Deal" flow only carries a free-text deal name, with all
real deal detail living inside the uploaded PDF. This is the first structured
model, designed to cover both OnDeck's (up to 2 owners) and CAN Capital's
(1 primary contact) data needs; each funder client module maps these fields
onto that funder's exact wire shape.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class BusinessDetailsBody(BaseModel):
    legal_name: str
    dba: str = ""
    phone: str = ""
    tax_id: str = ""
    entity_type: str = ""
    state_of_formation: str = ""
    business_start_date: str = ""
    industry_naics_code: str = ""
    billing_street: str = ""
    billing_city: str = ""
    billing_state: str = ""
    billing_postal_code: str = ""
    billing_country: str = "US"


class OwnerDetailsBody(BaseModel):
    first_name: str
    last_name: str
    title: str = ""
    date_of_birth: str = ""
    ssn: str = ""
    ownership_percentage: float = 0
    phone: str = ""
    email: str = ""
    mailing_street: str = ""
    mailing_city: str = ""
    mailing_state: str = ""
    mailing_postal_code: str = ""
    mailing_country: str = "US"


class LoanDetailsBody(BaseModel):
    requested_amount: float
    loan_purpose: str = ""
    desired_term_months: int | None = None
    average_monthly_revenue: float | None = None
    average_daily_balance: float | None = None


class PartnerSubmissionCreateBody(BaseModel):
    brand_name: str
    deal_name: str = "Deal"
    aquamark_job_id: str = ""
    business: BusinessDetailsBody
    owners: list[OwnerDetailsBody] = Field(min_length=1, max_length=2)
    loan: LoanDetailsBody


class SendDocumentsBody(BaseModel):
    job_id: str
    filenames: list[str] = Field(min_length=1)


class ProcessApplicationBody(BaseModel):
    consent_accepted: bool = False


class BrandAssignmentBody(BaseModel):
    brand_index: int | None = None
