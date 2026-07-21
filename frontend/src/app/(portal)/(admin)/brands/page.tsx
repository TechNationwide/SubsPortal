"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/api";
import type { Brand } from "@/lib/types";

const EMPTY_BRAND: Brand = {
  name: "",
  email: "",
  app: "",
  accent: "#4f46e5",
  aquamark_email: "",
};

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState<Brand>(EMPTY_BRAND);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    const res = await api.getBrands();
    setBrands(res.data);
  }, []);

  useEffect(() => {
    load().catch((e) => setToast(e.message));
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return brands
      .map((brand, index) => ({ brand, index }))
      .filter(({ brand }) => {
        if (!q) return true;
        return (
          brand.name.toLowerCase().includes(q) ||
          (brand.email || "").toLowerCase().includes(q) ||
          (brand.aquamark_email || "").toLowerCase().includes(q) ||
          (brand.app || "").toLowerCase().includes(q)
        );
      });
  }, [brands, search]);

  function openCreate() {
    setEditingIndex(null);
    setForm(EMPTY_BRAND);
    setModalOpen(true);
  }

  function openEdit(index: number) {
    setEditingIndex(index);
    setForm({ ...brands[index], aquamark_email: brands[index].aquamark_email || "" });
    setModalOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setToast("Brand name is required.");
      return;
    }
    const payload: Brand = {
      ...form,
      name: form.name.trim(),
      email: form.email.trim(),
      aquamark_email: form.aquamark_email.trim(),
      app: form.app.trim() || `${form.name.trim()} Application`,
    };
    try {
      if (editingIndex === null) {
        await api.createBrand(payload);
        setToast(`Created ${payload.name}.`);
      } else {
        await api.updateBrand(editingIndex, payload);
        setToast(`Updated ${payload.name}.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function onDelete(index: number) {
    const name = brands[index].name;
    if (!window.confirm(`Delete "${name}"? Funder assignments will be updated.`)) return;
    try {
      await api.deleteBrand(index);
      setToast(`Deleted ${name}.`);
      setModalOpen(false);
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <PortalShell title="Portal Setup" subtitle="Manage brands, Aquamark accounts, and submission emails.">
      <div className="setup-page-header">
        <h1>Brands</h1>
        <p>Manage funding brands and the Aquamark account email used when watermarking each brand.</p>
      </div>

      <section className="card panel config-card">
        <div className="config-card-header">
          <div>
            <h2>Brand Registry</h2>
            <p>CRM list view — create or edit in the modal.</p>
          </div>
          <span className="config-badge">Admin</span>
        </div>

        <div className="crm-toolbar">
          <div className="crm-toolbar-left">
            <input
              type="search"
              className="crm-search"
              placeholder="Search brands…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="crm-record-count">{brands.length} brands</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            + New Brand
          </button>
        </div>

        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Brand</th>
                <th>Submission email</th>
                <th>Aquamark email</th>
                <th>Application</th>
                <th>Accent</th>
                <th className="crm-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ brand, index }) => (
                <tr key={index}>
                  <td>
                    <div className="crm-brand-name-cell">
                      <span
                        className="crm-logo-placeholder"
                        style={{ background: brand.accent }}
                      >
                        {brand.name[0]}
                      </span>
                      <strong>{brand.name}</strong>
                    </div>
                  </td>
                  <td>{brand.email || "—"}</td>
                  <td>{brand.aquamark_email || "—"}</td>
                  <td>{brand.app || "—"}</td>
                  <td>
                    <span className="crm-color-chip" style={{ background: brand.accent }} />
                  </td>
                  <td className="crm-col-actions">
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => openEdit(index)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      disabled={brands.length <= 1}
                      onClick={() => onDelete(index)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={modalOpen}
        title={editingIndex === null ? "New Brand" : "Edit Brand"}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            {editingIndex !== null && brands.length > 1 && (
              <button type="button" className="btn btn-secondary" onClick={() => onDelete(editingIndex)}>
                Delete
              </button>
            )}
            <div className="modal-footer-right">
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" form="brandForm" className="btn btn-primary">
                {editingIndex === null ? "Create Brand" : "Save Changes"}
              </button>
            </div>
          </>
        }
      >
        <form id="brandForm" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="brandName">Brand name *</label>
            <input
              id="brandName"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="brandEmail">Submission email</label>
            <input
              id="brandEmail"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="brand@company.com"
            />
          </div>
          <div className="field">
            <label htmlFor="brandAquamarkEmail">Aquamark user email</label>
            <input
              id="brandAquamarkEmail"
              type="email"
              value={form.aquamark_email}
              onChange={(e) => setForm({ ...form, aquamark_email: e.target.value })}
              placeholder="christina@aquamark.io"
            />
            <p className="field-hint">
              Aquamark account email for this brand. Sent as <code>user_email</code> when processing deals.
            </p>
          </div>
          <div className="field">
            <label htmlFor="brandApp">Application name</label>
            <input
              id="brandApp"
              value={form.app}
              onChange={(e) => setForm({ ...form, app: e.target.value })}
            />
          </div>
          <div className="field brand-accent-field">
            <label htmlFor="brandAccent">Accent color</label>
            <div className="brand-accent-row">
              <input
                id="brandAccent"
                type="color"
                value={form.accent || "#4f46e5"}
                onChange={(e) => setForm({ ...form, accent: e.target.value })}
              />
              <span
                className="crm-color-chip brand-accent-preview"
                style={{ background: form.accent || "#4f46e5" }}
                aria-hidden
              />
              <span className="brand-accent-hex">{form.accent || "#4f46e5"}</span>
            </div>
          </div>
        </form>
      </Modal>

      {toast && (
        <div className="toast-container">
          <div className="toast">
            <span>•</span>
            <span>{toast}</span>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
