"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
];

const ADMIN_ONLY_NAV_IDS = new Set(["teams", "brands", "funders", "users", "access"]);

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
              <div className="header-logo" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3l7 3.2v5.4c0 4.6-3 8.5-7 9.9-4-1.4-7-5.3-7-9.9V6.2L12 3z" />
                  <path d="M9.2 12.1l1.9 1.9 3.7-3.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="brand-kicker">VAT Submission Portal</p>
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
          </div>
        </div>
      </header>

      <main className="setup-page-main portal-main">{children}</main>
    </div>
  );
}
