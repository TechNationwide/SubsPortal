export type TeamMember = { name: string; email: string };

export type Team = {
  id: string;
  name: string;
  lead: string;
  members: TeamMember[];
};

export type Brand = {
  name: string;
  email: string;
  app: string;
  accent: string;
  aquamark_email: string;
};

export type Funder = {
  name: string;
  email: string;
  cc_members: TeamMember[];
  brands: number[];
};

export type ProcessedFile = {
  name: string;
  original: string;
  download: string;
  size: number;
  recipient?: string;
  recipient_email?: string;
  compressed?: boolean;
};

export type Role = "admin" | "employee";

export type User = {
  id: number;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
};

// ─────────────────────── API Partners (funder-partner API tab) ───────────────────────

export type BusinessDetails = {
  legal_name: string;
  dba: string;
  phone: string;
  tax_id: string;
  entity_type: string;
  state_of_formation: string;
  business_start_date: string;
  industry_naics_code: string;
  billing_street: string;
  billing_city: string;
  billing_state: string;
  billing_postal_code: string;
  billing_country: string;
};

export type OwnerDetails = {
  first_name: string;
  last_name: string;
  title: string;
  date_of_birth: string;
  ssn: string;
  ownership_percentage: number;
  phone: string;
  email: string;
  mailing_street: string;
  mailing_city: string;
  mailing_state: string;
  mailing_postal_code: string;
  mailing_country: string;
};

export type LoanDetails = {
  requested_amount: number;
  loan_purpose: string;
  desired_term_months: number | null;
  average_monthly_revenue: number | null;
  average_daily_balance: number | null;
};

// ─────────────────────── Zoho CRM lookup ───────────────────────

export type ZohoBusinessFields = Omit<BusinessDetails, "industry_naics_code" | "billing_country">;

export type ZohoOwnerFields = Omit<OwnerDetails, "title" | "mailing_country">;

export type ZohoLoanFields = Pick<LoanDetails, "average_monthly_revenue" | "average_daily_balance">;

export type ZohoLeadData = {
  business: ZohoBusinessFields;
  owners: ZohoOwnerFields[];
  loan: ZohoLoanFields;
  raw: Record<string, unknown>;
};

export type PartnerFunderKey = "channel" | "peac" | "ondeck" | "can" | "idea";

export type PartnerSubmissionStatus = "draft" | "submitted" | "docs_sent" | "processed" | "error";

export type PartnerSubmission = {
  id: number;
  funder_key: PartnerFunderKey;
  brand_name: string;
  deal_name: string;
  created_by_user_id: number;
  aquamark_job_id: string;
  external_id: string;
  status: PartnerSubmissionStatus;
  business_details: BusinessDetails;
  owner_details: OwnerDetails[];
  loan_details: LoanDetails;
  last_error: string;
  created_at: string;
  updated_at: string;
};

export type PartnerIntegrationStatus = {
  configured: boolean;
  reason?: string;
  [key: string]: unknown;
};

export type PartnerBrandAssignment = { brand_index: number; brand_name: string } | null;

export type PartnerBrandAssignments = Partial<Record<PartnerFunderKey, PartnerBrandAssignment>>;
