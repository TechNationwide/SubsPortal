"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/api";
import type { Team, TeamMember } from "@/lib/types";

const emptyMember = (): TeamMember => ({ name: "", email: "" });

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [formName, setFormName] = useState("");
  const [formLead, setFormLead] = useState("");
  const [formMembers, setFormMembers] = useState<TeamMember[]>([emptyMember()]);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await api.getTeams();
    setTeams(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((e) => setToast(e.message));
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.lead.toLowerCase().includes(q) ||
        t.members.some(
          (m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
        ),
    );
  }, [teams, search]);

  function openCreate() {
    setEditing(null);
    setFormName("");
    setFormLead("");
    setFormMembers([{ name: "", email: "" }]);
    setModalOpen(true);
  }

  function openEdit(team: Team) {
    setEditing(team);
    setFormName(team.name);
    setFormLead(team.lead);
    setFormMembers(team.members.map((m) => ({ ...m })));
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
  }

  function updateMember(i: number, field: keyof TeamMember, value: string) {
    const prevName = formMembers[i]?.name.trim() || "";
    setFormMembers((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
    if (field === "name" && formLead === prevName) {
      setFormLead(value.trim());
    }
  }

  function addMemberRow() {
    setFormMembers((prev) => [...prev, emptyMember()]);
  }

  function removeMemberRow(i: number) {
    if (formMembers.length <= 1) return;
    const removedName = formMembers[i].name.trim();
    setFormMembers((prev) => prev.filter((_, idx) => idx !== i));
    if (formLead === removedName) {
      setFormLead("");
    }
  }

  const namedMembers = useMemo(
    () =>
      formMembers
        .map((m, index) => ({ ...m, index }))
        .filter((m) => m.name.trim().length > 0),
    [formMembers],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const members = formMembers
      .map((m) => ({ name: m.name.trim(), email: m.email.trim() }))
      .filter((m) => m.name || m.email);
    if (!formName.trim()) {
      setToast("Team name is required.");
      return;
    }
    if (!members.length) {
      setToast("Add at least one team member.");
      return;
    }
    if (!formLead.trim()) {
      setToast("Select a team lead from the members you added.");
      return;
    }
    const lead = formLead.trim();
    const payload = { name: formName.trim(), lead, members };
    try {
      if (editing) {
        await api.updateTeam(editing.id, payload);
        setToast(`Updated ${payload.name}.`);
      } else {
        await api.createTeam(payload);
        setToast(`Created ${payload.name}.`);
      }
      closeModal();
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function onDelete(team: Team) {
    if (!window.confirm(`Delete "${team.name}"?`)) return;
    try {
      await api.deleteTeam(team.id);
      setToast(`Deleted ${team.name}.`);
      if (editing?.id === team.id) closeModal();
      await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <PortalShell
      title="Portal Setup"
      subtitle="Configure teams, funders, and brands."
    >
      <div className="setup-page-header">
        <h1>Teams</h1>
        <p>Group reps so the submitter and their whole team are CC&apos;d on every deal email.</p>
      </div>

      <section className="card panel config-card">
        <div className="config-card-header">
          <div>
            <h2>Sales Rep Teams</h2>
            <p>One name and email per member. The whole team is CC&apos;d when any member submits.</p>
          </div>
          <span className="config-badge">Admin</span>
        </div>

        <div className="crm-toolbar">
          <div className="crm-toolbar-left">
            <input
              type="search"
              className="crm-search"
              placeholder="Search teams…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="crm-record-count">
              {teams.length} team{teams.length === 1 ? "" : "s"}
            </span>
          </div>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            + New Team
          </button>
        </div>

        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Lead</th>
                <th>Members</th>
                <th>CC emails</th>
                <th className="crm-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="crm-muted" style={{ padding: 24 }}>
                    Loading…
                  </td>
                </tr>
              ) : (
                filtered.map((team) => (
                  <tr key={team.id}>
                    <td>
                      <strong>{team.name}</strong>
                    </td>
                    <td>{team.lead}</td>
                    <td>{team.members.length}</td>
                    <td>
                      <div className="crm-tag-list">
                        {team.members.slice(0, 3).map((m) => (
                          <span key={m.email} className="crm-tag" style={{ ["--tag-color" as string]: "#4f46e5" }}>
                            {m.name}
                          </span>
                        ))}
                        {team.members.length > 3 && (
                          <span className="crm-tag crm-tag-more">+{team.members.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="crm-col-actions">
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => openEdit(team)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        disabled={teams.length <= 1}
                        onClick={() => onDelete(team)}
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
              <strong>No teams found</strong>
              <span>Try a different search or create a new team.</span>
            </div>
          )}
        </div>
      </section>

      <Modal
        open={modalOpen}
        title={editing ? "Edit Team" : "New Team"}
        onClose={closeModal}
        wide
        footer={
          <>
            {editing && teams.length > 1 && (
              <button type="button" className="btn btn-secondary" onClick={() => onDelete(editing)}>
                Delete
              </button>
            )}
            <div className="modal-footer-right">
              <button type="button" className="btn btn-secondary" onClick={closeModal}>
                Cancel
              </button>
              <button type="submit" form="teamForm" className="btn btn-primary">
                {editing ? "Save Changes" : "Create Team"}
              </button>
            </div>
          </>
        }
      >
        <form id="teamForm" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="teamName">Team name <span className="required">*</span></label>
            <input
              id="teamName"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Max's Team"
              required
            />
          </div>
          <div className="field">
            <label>
              Members <span className="required">*</span>
            </label>
            <span className="field-hint">Add members first, then choose the team lead below.</span>
            <div className="team-members-editor">
              <div className="team-members-label">
                <span>Name</span>
                <span>Email</span>
                <span aria-hidden />
              </div>
              {formMembers.map((m, i) => (
                <div key={i} className="team-edit-row">
                  <input
                    type="text"
                    value={m.name}
                    placeholder="Rep name"
                    onChange={(e) => updateMember(i, "name", e.target.value)}
                  />
                  <input
                    type="email"
                    value={m.email}
                    placeholder="email@company.com"
                    onChange={(e) => updateMember(i, "email", e.target.value)}
                  />
                  <button
                    type="button"
                    title="Remove member"
                    disabled={formMembers.length <= 1}
                    onClick={() => removeMemberRow(i)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-xs team-add-member-btn" onClick={addMemberRow}>
                + Add Member
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="teamLead">Team lead <span className="required">*</span></label>
            <select
              id="teamLead"
              className="team-lead-select"
              value={formLead}
              onChange={(e) => setFormLead(e.target.value)}
              disabled={namedMembers.length === 0}
              required
            >
              <option value="">
                {namedMembers.length === 0 ? "Add at least one member name above…" : "Select team lead…"}
              </option>
              {namedMembers.map((m) => (
                <option key={m.index} value={m.name.trim()}>
                  {m.name.trim()}
                  {m.email.trim() ? ` — ${m.email.trim()}` : ""}
                </option>
              ))}
            </select>
            {namedMembers.length > 0 && (
              <span className="field-hint">{namedMembers.length} member{namedMembers.length === 1 ? "" : "s"} available as lead</span>
            )}
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
