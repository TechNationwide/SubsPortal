import type { PartnerFunderKey } from "./types";

export const ECG_INDUSTRIES = [
  "Accounting & Tax Preparation",
  "Agriculture",
  "Automotive",
  "Construction",
  "Consulting",
  "Cosmetology",
  "Custodial & Janitorial",
  "Education & Training",
  "Financial Services",
  "General Services",
  "Health & Fitness",
  "Hospitality",
  "Insurance",
  "IT",
  "Law",
  "Leisure & Entertainment",
  "Manufacturing",
  "Marketing",
  "Medical",
  "Nursery & Landscaping",
  "Other",
  "Pest Control",
  "Real Estate",
  "Restaurant & Bar Establishments",
  "Retail",
  "Security",
  "Staffing",
  "Telcom",
  "Transportation & Delivery",
  "Wholesale",
] as const;

export type PartnerRosterEntry = {
  key: PartnerFunderKey;
  label: string;
  apiReady: boolean;
  /** Short one-line caption shown on the partner selection card. */
  description: string;
  /** Button labels in flow order, matching the client's exact requested wording. */
  steps: string[];
  /** When true, the third step checks status instead of the CAN/iDea credit-consent process. */
  checkStatus?: boolean;
};

export const PARTNER_ROSTER: PartnerRosterEntry[] = [
  {
    key: "channel",
    label: "Channel",
    apiReady: true,
    description: "Single-call submission (application + business + owner)",
    steps: ["Submit to Channel"],
  },
  {
    key: "peac",
    label: "PEAC",
    apiReady: true,
    description: "Single-call submission (application + business + owner)",
    steps: ["Submit to PEAC"],
  },
  {
    key: "ondeck",
    label: "OnDeck",
    apiReady: true,
    description: "Submit application + send bank statements",
    steps: ["Submit to OnDeck", "Send bs OnDeck"],
  },
  {
    key: "can",
    label: "CAN Capital",
    apiReady: true,
    description: "Submit, send docs & process application",
    steps: ["Submit to CAN", "Send bs CAN", "Process app CAN"],
  },
  {
    key: "idea",
    label: "iDea Financial",
    apiReady: true,
    description: "Submit, send docs & process application",
    steps: ["Submit to iDea", "Send bs iDea", "Process app iDea"],
  },
  {
    key: "ecg",
    label: "Expansion Capital",
    apiReady: true,
    description: "Submit application, send bank statements, check status",
    steps: ["Submit to Expansion", "Send bs Expansion", "Check status Expansion"],
    checkStatus: true,
  },
];
