"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setSession } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.target as HTMLFormElement);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    try {
      const res = await api.login(email, password);
      setSession({
        id: res.user.id,
        name: res.user.name,
        email: res.user.email,
        role: res.user.role,
        token: res.token,
      });
      router.push(res.user.role === "admin" ? "/teams" : "/submit");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <style>{`
        .password-field { position: relative; }
        .password-field input { padding-right: 46px; }
        .password-toggle {
          position: absolute; top: 50%; right: 10px; transform: translateY(-50%);
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px;
          background: transparent; color: var(--muted); cursor: pointer;
        }
        .password-toggle:hover { color: var(--text); background: rgba(12, 21, 32, 0.04); }
        .password-toggle:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(196, 163, 106, 0.28); color: var(--primary); }
      `}</style>
      <div className="login-split">
        <div className="login-brand-panel">
          <div className="login-brand-content">
            <p className="login-brand-mark">VAT</p>
            <div className="login-gold-rule" aria-hidden="true" />
            <h2>
              Submission
              <br />
              Portal
            </h2>
            <p className="tagline">A calm, private workspace for multi-brand deal submission.</p>
          </div>
          <div className="login-features">
            <div className="login-feature">
              <div className="login-feature-icon">◆</div>
              <div>
                <strong>Refined workflow</strong>
                <span>Submit, watermark, and route deals with less friction.</span>
              </div>
            </div>
            <div className="login-feature">
              <div className="login-feature-icon">◇</div>
              <div>
                <strong>Partner ready</strong>
                <span>API Partners and Zoho stay one click away.</span>
              </div>
            </div>
          </div>
        </div>
        <div className="login-card">
          <div className="login-header">
            <h1>Welcome back</h1>
            <p className="login-welcome">Sign in to continue.</p>
          </div>
          <form className="login-body" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="loginEmail">Email address</label>
              <input id="loginEmail" name="email" type="email" placeholder="you@company.com" required />
            </div>
            <div className="field">
              <label htmlFor="loginPassword">Password</label>
              <div className="password-field">
                <input
                  id="loginPassword"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {error && <p className="login-error">{error}</p>}
            <button
              type="submit"
              className={`btn btn-primary btn-login${loading ? " is-loading" : ""}`}
              style={{ width: "100%" }}
              disabled={loading}
            >
              <span className="btn-login-label">{loading ? "Signing in…" : "Sign In"}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
