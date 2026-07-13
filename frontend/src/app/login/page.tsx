"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setSession } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.target as HTMLFormElement);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    try {
      const res = await api.login(email, password);
      setSession({ email: res.email, token: res.token });
      router.push("/teams");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="login-page">
      <div className="login-split">
        <div className="login-brand-panel">
          <div className="login-brand-content">
            <h2>Multi-Brand<br />Submission Portal</h2>
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
              <input id="loginPassword" name="password" type="password" placeholder="••••••••" required />
            </div>
            {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
            <button type="submit" className="btn btn-primary btn-login" style={{ width: "100%" }}>
              Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
