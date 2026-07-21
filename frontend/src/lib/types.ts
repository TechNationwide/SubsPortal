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
