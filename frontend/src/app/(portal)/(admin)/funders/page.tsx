"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { Modal } from "@/components/Modal";
import { BrandMultiSelect } from "@/components/BrandMultiSelect";
import { api } from "@/lib/api";
import type { Brand, Funder, TeamMember } from "@/lib/types";

const emptyCcMember = (): TeamMember => ({ name: "", email: "" });

const EMPTY_FUNDER: Funder = {
  name: "",
  email: "",
  cc_members: [],
  brands: [],
};

export default function FundersPage() {
  const [funders, setFunders] = useState<Funder[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState<Funder>(EMPTY_FUNDER);
  const [formCcMembers, setFormCcMembers] = useState<TeamMember[]>([emptyCcMember()]);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    const [fundersRes, brandsRes] = await Promise.all([api.getFunders(), api.getBrands()]);
    setFunders(fundersRes.data);
    setBrands(brandsRes.data);
  }, []);

  useEffect(() => {
    load().catch((e) => setToast(e.message));
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return funders
      .map((funder, index) => ({ funder, index }))
      .filter(({ funder }) => {
        if (!q) return true;
        const brandNames = (funder.brands ?? []).map((bi) => brands[bi]?.name || "").join(" ");
        const ccText = (funder.cc_members ?? [])
          .map((m) => `${m.name} ${m.email}`)
          .join(" ");
        return (
          funder.name.toLowerCase().includes(q) ||
          (funder.email || "").toLowerCase().includes(q) ||
          ccText.toLowerCase().includes(q) ||
          brandNames.toLowerCase().includes(q)
        );
      });
  }, [funders, brands, search]);

  function openCreate() {
    setEditingIndex(null);
    setForm(EMPTY_FUNDER);
    setFormCcMembers([emptyCcMember()]);
    setModalOpen(true);
  }

  function openEdit(index: number) {
    const funder = funders[index];
    setEditingIndex(index);
    setForm({
      ...funder,
      brands: [...(funder.brands ?? [])],
      cc_members: [...(funder.cc_members ?? [])],
    });
    setFormCcMembers(
      funder.cc_members?.length
        ? funder.cc_members.map((m) => ({ ...m }))
        : [emptyCcMember()],
    );
    setModalOpen(true);
  }

  function updateCcMember(i: number, field: keyof TeamMember, value: string) {
    setFormCcMembers((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  }

  function addCcMemberRow() {
    setFormCcMembers((prev) => [...prev, emptyCcMember()]);
  }

  function removeCcMemberRow(i: number) {
    if (formCcMembers.length <= 1) return;
    setFormCcMembers((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setToast("Funder name is required.");
      return;
    }
    const cc_members = formCcMembers
      .map((m) => ({ name: m.name.trim(), email: m.email.trim() }))
      .filter((m) => m.name || m.email);
    const payload: Funder = {
      name: form.name.trim(),
      email: form.email.trim(),
      cc_members,
      brands: [...form.brands].sort((a, b) => a - b),
    };
    try {
      if (editingIndex === null) {
        await api.createFunder(payload);
        setToast(`Created ${payload.name}.`);
      } else {
        await api.updateFunder(editingIndex, payload);
        setToast(`Updated ${payload.name}.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function onDelete(index: number) {
    const name = funders[index].name;
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await api.deleteFunder(index);
      setToast(`Deleted ${name}.`);
      setModalOpen(false);
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <PortalShell title="Portal Setup" subtitle="Manage funders and which brands they apply to.">
      <div className="setup-page-header">
        <h1>Funder Registry</h1>
        <p>
          Lock funders to brands for auto-selection on Submit Deal, or leave unlocked for manual
          selection only.
        </p>
      </div>

      <section className="card panel config-card">
        <div className="config-card-header">
          <div>
            <h2>Funders</h2>
            <p>CRM list — assign brands and CC contacts for each funder.</p>
          </div>
          <span className="config-badge">Admin</span>
        </div>

        <div className="crm-toolbar">
          <div className="crm-toolbar-left">
            <input
              type="search"
              className="crm-search"
              placeholder="Search funders…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="crm-record-count">{funders.length} funders</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            + New Funder
          </button>
        </div>

        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Funder</th>
                <th>Email</th>
                <th>Funder CC</th>
                <th>Applies to brands</th>
                <th className="crm-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ funder, index }) => (
                <tr key={index}>
                  <td>
                    <strong>{funder.name}</strong>
                  </td>
                  <td>{funder.email || "—"}</td>
                  <td>
                    {(funder.cc_members ?? []).length === 0 ? (
                      <span className="aquamark-hint">—</span>
                    ) : (
                      <div className="crm-tag-list">
                        {(funder.cc_members ?? []).slice(0, 3).map((m) => (
                          <span
                            key={m.email || m.name}
                            className="crm-tag"
                            style={{ ["--tag-color" as string]: "#4f46e5" }}
                          >
                            {m.name || m.email}
                          </span>
                        ))}
                        {(funder.cc_members ?? []).length > 3 && (
                          <span className="crm-tag crm-tag-more">
                            +{(funder.cc_members ?? []).length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {(funder.brands ?? []).length === 0 ? (
                      <span className="aquamark-hint">Manual only</span>
                    ) : (
                      <div className="crm-tag-list">
                        {(funder.brands ?? []).slice(0, 4).map((bi) =>
                          brands[bi] ? (
                            <span
                              key={bi}
                              className="crm-tag"
                              style={{ ["--tag-color" as string]: brands[bi].accent }}
                            >
                              {brands[bi].name}
                            </span>
                          ) : null,
                        )}
                        {(funder.brands ?? []).length > 4 && (
                          <span className="crm-tag crm-tag-more">+{(funder.brands ?? []).length - 4}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="crm-col-actions">
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => openEdit(index)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      disabled={funders.length <= 1}
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
        title={editingIndex === null ? "New Funder" : "Edit Funder"}
        onClose={() => setModalOpen(false)}
        wide
        footer={
          <>
            {editingIndex !== null && funders.length > 1 && (
              <button type="button" className="btn btn-secondary" onClick={() => onDelete(editingIndex)}>
                Delete
              </button>
            )}
            <div className="modal-footer-right">
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" form="funderForm" className="btn btn-primary">
                {editingIndex === null ? "Create Funder" : "Save Changes"}
              </button>
            </div>
          </>
        }
      >
        <form id="funderForm" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="funderName">Funder name *</label>
            <input
              id="funderName"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="funderEmail">Submission email</label>
            <input
              id="funderEmail"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Funder CC</label>
            <span className="field-hint">
              Add CC contacts for this funder. Their emails are included when this funder is selected
              on Submit Deal (in addition to the team CC).
            </span>
            <div className="team-members-editor">
              <div className="team-members-label">
                <span>Name</span>
                <span>Email</span>
                <span aria-hidden />
              </div>
              {formCcMembers.map((m, i) => (
                <div key={i} className="team-edit-row">
                  <input
                    type="text"
                    value={m.name}
                    placeholder="Contact name"
                    onChange={(e) => updateCcMember(i, "name", e.target.value)}
                  />
                  <input
                    type="email"
                    value={m.email}
                    placeholder="email@company.com"
                    onChange={(e) => updateCcMember(i, "email", e.target.value)}
                  />
                  <button
                    type="button"
                    title="Remove contact"
                    disabled={formCcMembers.length <= 1}
                    onClick={() => removeCcMemberRow(i)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-secondary btn-xs team-add-member-btn"
                onClick={addCcMemberRow}
              >
                + Add CC contact
              </button>
            </div>
          </div>
          <div className="field">
            <label>Applies to brands</label>
            <p className="field-hint">
              Locked funders auto-select on Submit Deal when one of these brands is chosen. Leave
              empty for manual selection only.
            </p>
            <BrandMultiSelect
              brands={brands}
              selected={form.brands}
              onChange={(brandIndices) => setForm({ ...form, brands: brandIndices })}
            />
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
