"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { api } from "@/lib/api";
import { canAccessUsersRoles } from "@/lib/access";
import { clearSession, getSession, type Session } from "@/lib/auth";

type NavItem = {
  id: string;
  label: string;
  href: string;
  adminOnly?: boolean;
  usersRolesOnly?: boolean;
  icon: React.ReactNode;
};

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <span className="portal-nav-icon" aria-hidden="true">
      {children}
    </span>
  );
}

const NAV: NavItem[] = [
  {
    id: "submit",
    label: "Submit Deal",
    href: "/submit",
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 19h14" />
        </svg>
      </Icon>
    ),
  },
  {
    id: "partners",
    label: "API Partners",
    href: "/partners",
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="4" width="7" height="7" rx="1.5" />
          <rect x="14" y="4" width="7" height="7" rx="1.5" />
          <rect x="3" y="13" width="7" height="7" rx="1.5" />
          <rect x="14" y="13" width="7" height="7" rx="1.5" />
        </svg>
      </Icon>
    ),
  },
  {
    id: "zoho",
    label: "Zoho Lookup",
    href: "/zoho",
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
      </Icon>
    ),
  },
  {
    id: "teams",
    label: "Teams",
    href: "/teams",
    adminOnly: true,
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M3.5 19c1.2-3.2 3.4-4.8 5.5-4.8S13.3 15.8 14.5 19" />
          <path d="M14 14.5c1.3-.7 2.7-.7 4 0 1.5.8 2.4 2.4 2.7 4.5" />
        </svg>
      </Icon>
    ),
  },
  {
    id: "brands",
    label: "Brands",
    href: "/brands",
    adminOnly: true,
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 7h16v12H4z" />
          <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
        </svg>
      </Icon>
    ),
  },
  {
    id: "funders",
    label: "Funders",
    href: "/funders",
    adminOnly: true,
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 19V8l8-4 8 4v11" />
          <path d="M9 19v-6h6v6" />
        </svg>
      </Icon>
    ),
  },
  {
    id: "users",
    label: "Users & Roles",
    href: "/users",
    adminOnly: true,
    usersRolesOnly: true,
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3 4.5 6.5v5.2c0 4.4 3.1 8.4 7.5 9.3 4.4-.9 7.5-4.9 7.5-9.3V6.5L12 3z" />
          <path d="M9.5 12.2 11 13.7l3.5-3.5" />
        </svg>
      </Icon>
    ),
  },
  {
    id: "access",
    label: "Access",
    href: "/access",
    adminOnly: true,
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </Icon>
    ),
  },
  {
    id: "integration-status",
    label: "Integration Status",
    href: "/integration-status",
    adminOnly: true,
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 19V9" />
          <path d="M10 19V5" />
          <path d="M16 19v-7" />
          <path d="M22 19V8" />
        </svg>
      </Icon>
    ),
  },
  {
    id: "architecture",
    label: "Solution Document",
    href: "/architecture",
    adminOnly: true,
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M5 4h9l5 5v11H5z" />
          <path d="M14 4v5h5" />
          <path d="M8 13h8M8 17h6" />
        </svg>
      </Icon>
    ),
  },
];

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function PortalShell({ title, subtitle, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setSession(getSession());
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* session may already be gone server-side; clear it locally regardless */
    }
    clearSession();
    router.replace("/login");
  }

  const visibleNav = NAV.filter((p) => {
    if (p.usersRolesOnly) return canAccessUsersRoles(session);
    if (p.adminOnly) return session?.role === "admin";
    return true;
  });

  return (
    <div className={`portal-shell portal-shell--sidebar${navOpen ? " nav-open" : ""}`}>
      <div
        className="portal-sidebar-backdrop"
        aria-hidden={!navOpen}
        onClick={() => setNavOpen(false)}
      />

      <aside className="portal-sidebar" aria-label="Portal navigation">
        <div className="portal-sidebar-brand">
          <BrandLogo variant="full" tone="brand" className="portal-sidebar-logo" priority />
          <div className="portal-sidebar-brand-text">
            <p className="portal-sidebar-kicker">Submission Portal</p>
            <p className="portal-sidebar-tagline">Nationwide Advance</p>
          </div>
        </div>

        <nav className="portal-sidebar-nav" aria-label="Portal pages">
          {visibleNav.map((p) => {
            const active = pathname === p.href;
            return (
              <Link
                key={p.id}
                href={p.href}
                className={`portal-nav-link${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {p.icon}
                <span>{p.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="portal-sidebar-foot">
          <div className="portal-sidebar-user" title={session?.email || ""}>
            <span className="portal-sidebar-user-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="8" r="3.2" />
                <path d="M5 19c1.4-3.5 3.8-5.2 7-5.2s5.6 1.7 7 5.2" />
              </svg>
            </span>
            <span className="portal-sidebar-user-meta">
              <strong>{session?.name || "User"}</strong>
              <em>{session?.email || ""}</em>
            </span>
          </div>
          <button type="button" className="portal-logout-btn" onClick={logout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
              <path d="M14 12H7" />
              <path d="m16 8 4 4-4 4" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      <div className="portal-frame">
        <header className="portal-topbar">
          <button
            type="button"
            className="portal-menu-btn"
            aria-label={navOpen ? "Close menu" : "Open menu"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="portal-topbar-text">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </header>
        <main className="setup-page-main portal-main">{children}</main>
      </div>
    </div>
  );
}
