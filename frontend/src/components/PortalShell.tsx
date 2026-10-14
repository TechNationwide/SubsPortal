"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { api } from "@/lib/api";
import { clearSession, getSession, type Session } from "@/lib/auth";

const NAV = [
  { id: "submit", label: "Submit Deal", href: "/submit" },
  { id: "partners", label: "API Partners", href: "/partners" },
  { id: "zoho", label: "Zoho Lookup", href: "/zoho" },
  { id: "teams", label: "Teams", href: "/teams" },
  { id: "brands", label: "Brands", href: "/brands" },
  { id: "funders", label: "Funders", href: "/funders" },
  { id: "users", label: "Users", href: "/users" },
  { id: "access", label: "Access", href: "/access" },
  { id: "integration-status", label: "Integration Status", href: "/integration-status" },
];

const ADMIN_ONLY_NAV_IDS = new Set([
  "teams",
  "brands",
  "funders",
  "users",
  "access",
  "integration-status",
]);

const SOLUTION_DOC = { id: "architecture", label: "Solution Document", href: "/architecture" };

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function PortalShell({ title, subtitle, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setSession(getSession());
  }, []);

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* session may already be gone server-side; clear it locally regardless */
    }
    clearSession();
    router.replace("/login");
  }

  const visibleNav = NAV.filter(
    (p) => session?.role === "admin" || !ADMIN_ONLY_NAV_IDS.has(p.id),
  );

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-inner">
          <div className="portal-header-text">
            <div className="header-logo-row">
              <BrandLogo variant="full" tone="brand" className="header-brand-wordmark" priority />
              <div>
                <p className="brand-kicker">Submission Portal</p>
                <h1>{title}</h1>
                {subtitle && <p>{subtitle}</p>}
              </div>
            </div>
            <nav className="site-nav" aria-label="Portal pages">
              {visibleNav.map((p) => (
                <Link
                  key={p.id}
                  href={p.href}
                  className={`site-nav-link${pathname === p.href ? " active" : ""}`}
                >
                  {p.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="user-bar">
            <span className="user-pill">{session?.email || "user"}</span>
            <button type="button" className="btn btn-ghost" onClick={logout}>
              Sign Out
            </button>
            {session?.role === "admin" && (
              <Link
                href={SOLUTION_DOC.href}
                className={`site-nav-link solution-doc-link${pathname === SOLUTION_DOC.href ? " active" : ""}`}
              >
                {SOLUTION_DOC.label}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="setup-page-main portal-main">{children}</main>
    </div>
  );
}
