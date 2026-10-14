import type { Session } from "@/lib/auth";

/** Users & Roles nav + page — Keith and Tech only (not every admin). */
const USERS_ROLES_EMAILS = new Set([
  "keith@nationwideadvance.com",
  "tech@nationwideadvance.com",
  // Current Tech/admin console login on production
  "admin@nationwideadvance.com",
]);

export function canAccessUsersRoles(session: Session | null | undefined): boolean {
  if (!session || session.role !== "admin") return false;
  return USERS_ROLES_EMAILS.has(String(session.email || "").trim().toLowerCase());
}

export const PORTAL_MODULES = {
  admin: [
    "submit",
    "partners",
    "zoho",
    "teams",
    "brands",
    "funders",
    "usersRoles",
    "access",
    "integrationStatus",
    "solutionDoc",
  ],
  employee: ["submit", "partners", "zoho"],
} as const;
