"use client";

import { PortalShell } from "@/components/PortalShell";

/** Local-only preview — no login required. Remove before production deploy if desired. */
export default function LogoPreviewPage() {
  return (
    <PortalShell
      title="Submit Deal"
      subtitle="Logo preview — header shows your Nationwide logo (top-left)."
    >
      <div className="card" style={{ maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>Where the logo appears</h2>
        <ul style={{ lineHeight: 1.7 }}>
          <li>
            <strong>Dashboard header (top-left)</strong> — every page after login uses{" "}
            <code>PortalShell</code> with your logo next to &quot;Submission Portal&quot;.
          </li>
          <li>
            <strong>Login page</strong> — left panel and sign-in card.
          </li>
          <li>
            <strong>Browser tab</strong> — favicon.
          </li>
        </ul>
        <p style={{ marginBottom: 0, color: "var(--muted)" }}>
          This page skips login so you can preview the post-login layout locally.
        </p>
      </div>
    </PortalShell>
  );
}
