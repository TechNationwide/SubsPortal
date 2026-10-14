"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PortalShell } from "@/components/PortalShell";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/api";
import { PORTAL_MODULES, canAccessUsersRoles } from "@/lib/access";
import { getSession } from "@/lib/auth";
import type { Role, User } from "@/lib/types";

type UserForm = {
  name: string;
  email: string;
  role: Role;
  password: string;
};

const emptyForm = (): UserForm => ({ name: "", email: "", role: "employee", password: "" });

function modulesFor(role: Role): readonly string[] {
  return role === "admin" ? PORTAL_MODULES.admin : PORTAL_MODULES.employee;
}

export default function UsersPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm());
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [toast, setToast] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const res = await api.getUsers();
    setUsers(res.data);
    setRefreshedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    const session = getSession();
    if (!canAccessUsersRoles(session)) {
      router.replace("/submit");
      return;
    }
    setAllowed(true);
    load().catch((e) => setToast(e.message));
  }, [load, router]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, search]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  }

  function openEdit(user: User) {
    setEditing(user);
    setForm({ name: user.name, email: user.email, role: user.role, password: "" });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name || !email) {
      setToast("Name and email are required.");
      return;
    }
    if (!editing && form.password.length < 8) {
      setToast("Password must be at least 8 characters.");
      return;
    }
    try {
      if (editing) {
        await api.updateUser(editing.id, { name, email, role: form.role });
        setToast(`Updated ${name}.`);
      } else {
        await api.createUser({ name, email, role: form.role, password: form.password });
        setToast(`Created ${name}.`);
      }
      closeModal();
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function onDelete(user: User) {
    if (!window.confirm(`Delete "${user.name}"?`)) return;
    try {
      await api.deleteUser(user.id);
      setToast(`Deleted ${user.name}.`);
      if (editing?.id === user.id) closeModal();
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function openResetPassword(user: User) {
    setResetTarget(user);
    setResetPassword("");
  }

  function closeResetPassword() {
    setResetTarget(null);
    setResetPassword("");
  }

  async function onResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    if (resetPassword.length < 8) {
      setToast("Password must be at least 8 characters.");
      return;
    }
    try {
      await api.resetUserPassword(resetTarget.id, resetPassword);
      setToast(`Password reset for ${resetTarget.name}.`);
      closeResetPassword();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Reset failed");
    }
  }

  if (!allowed) return null;

  return (
    <PortalShell
      title="Users & Roles"
      subtitle="All portal logins, roles, and module access — Keith & Tech only."
    >
      <section className="card panel config-card users-roles-panel">
        <div className="config-card-header users-roles-header">
          <div>
            <h2 className="users-roles-title">
              <span className="users-roles-title-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3 4.5 6.5v5.2c0 4.4 3.1 8.4 7.5 9.3 4.4-.9 7.5-4.9 7.5-9.3V6.5L12 3z" />
                </svg>
              </span>
              Users &amp; Roles
            </h2>
            <p>
              All portal logins, roles, and module access. Admins only (Keith &amp; Tech). Refresh after password
              changes.
            </p>
          </div>
          <div className="users-roles-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                load().catch((e) => setToast(e.message));
              }}
            >
              Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              + New User
            </button>
          </div>
        </div>

        <div className="ops-banner ops-banner-warn users-roles-note">
          Passwords are stored as secure hashes and cannot be shown in plain text. Use Reset Password if someone
          needs a new one
          {refreshedAt ? ` · Updated ${refreshedAt.toLocaleString()}` : ""}.
        </div>

        <div className="crm-toolbar">
          <div className="crm-toolbar-left">
            <input
              type="search"
              className="crm-search"
              placeholder="Search users…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="crm-record-count">
              {users.length} user{users.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="ops-scroll-panel users-roles-scroll">
          <table className="crm-table ops-table users-roles-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Password</th>
                <th>Role</th>
                <th>Modules</th>
                <th className="crm-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="crm-muted" style={{ padding: 24 }}>
                    Loading…
                  </td>
                </tr>
              ) : (
                filtered.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.name}</strong>
                    </td>
                    <td className="ops-wrap">{user.email}</td>
                    <td>
                      <span className="users-pass-mask">******** (hashed)</span>
                    </td>
                    <td>
                      <span className={`users-role-pill ${user.role === "admin" ? "admin" : "employee"}`}>
                        {user.role === "admin" ? "Admin" : "Employee"}
                      </span>
                    </td>
                    <td>
                      <div className="users-modules">
                        {modulesFor(user.role).map((mod) => (
                          <span key={mod} className="users-module-tag">
                            {user.role === "admin" ? "★ " : ""}
                            {mod}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="crm-col-actions">
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => openEdit(user)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => openResetPassword(user)}
                      >
                        Reset Password
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => onDelete(user)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {!loading && !filtered.length && (
            <div className="crm-empty">
              <strong>No users found</strong>
              <span>Try a different search or create a new user.</span>
            </div>
          )}
        </div>
      </section>

      <Modal
        open={modalOpen}
        title={editing ? "Edit User" : "New User"}
        onClose={closeModal}
        footer={
          <div className="modal-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" form="userForm" className="btn btn-primary">
              {editing ? "Save Changes" : "Create User"}
            </button>
          </div>
        }
      >
        <form id="userForm" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="userName">
              Name <span className="required">*</span>
            </label>
            <input
              id="userName"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Jane Doe"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="userEmail">
              Email / Username <span className="required">*</span>
            </label>
            <input
              id="userEmail"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="jane@nationwideadvance.com"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="userRole">
              Role <span className="required">*</span>
            </label>
            <select
              id="userRole"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              <option value="employee">Employee — Submit Deal / Partners / Zoho</option>
              <option value="admin">Admin — full access</option>
            </select>
          </div>
          {!editing && (
            <div className="field">
              <label htmlFor="userPassword">
                Password <span className="required">*</span>
              </label>
              <input
                id="userPassword"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="At least 8 characters"
                required
                minLength={8}
              />
              <span className="field-hint">Stored as a secure hash — never shown again in plain text.</span>
            </div>
          )}
        </form>
      </Modal>

      <Modal
        open={resetTarget !== null}
        title={resetTarget ? `Reset Password — ${resetTarget.name}` : "Reset Password"}
        onClose={closeResetPassword}
        footer={
          <div className="modal-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeResetPassword}>
              Cancel
            </button>
            <button type="submit" form="resetPasswordForm" className="btn btn-primary">
              Reset Password
            </button>
          </div>
        }
      >
        <form id="resetPasswordForm" onSubmit={onResetPassword}>
          <div className="field">
            <label htmlFor="resetPasswordInput">
              New password <span className="required">*</span>
            </label>
            <input
              id="resetPasswordInput"
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
            />
          </div>
        </form>
      </Modal>

      {toast && (
        <div className="toast-container">
          <div className="toast success">
            <span>•</span>
            <span>{toast}</span>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
