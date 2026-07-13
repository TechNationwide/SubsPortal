let teams = Store.getTeams();

function persistTeams() {
  Store.saveTeams(teams);
  showToast("Teams saved.", "success");
}

function renderTeams() {
  const root = document.getElementById("teamList");
  if (!root) return;

  if (!teams.length) {
    root.innerHTML =
      '<div class="funder-package-empty">No teams yet. Click <strong>+ Add Team</strong> below.</div>';
    return;
  }

  root.innerHTML = teams
    .map(
      (team, ti) => `
    <div class="team-card" data-team="${team.id}" id="teamCard_${ti}">
      <div class="team-card-header">
        <div style="flex:1;min-width:0">
          <input type="text" class="team-name-input" value="${escapeAttr(team.name)}" aria-label="Team name" onchange="updateTeamName(${ti}, this.value)">
          <div class="team-meta-row">
            <span class="team-count-pill">${team.members.length} CC member${team.members.length === 1 ? "" : "s"}</span>
            <small>Lead: ${escapeHtml(team.lead)}</small>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-xs" onclick="removeTeam(${ti})" ${teams.length <= 1 ? "disabled" : ""}>Remove Team</button>
      </div>
      <div class="team-members">
        <div class="team-members-label">
          <span>Name</span>
          <span>Email</span>
          <span></span>
        </div>
        ${team.members
          .map(
            (m, mi) => `
          <div class="team-edit-row">
            <input type="text" value="${escapeAttr(m.name)}" placeholder="Rep name" aria-label="Member name" onchange="updateTeamMember(${ti}, ${mi}, 'name', this.value)">
            <input type="email" value="${escapeAttr(m.email)}" placeholder="email@company.com" aria-label="Member email" onchange="updateTeamMember(${ti}, ${mi}, 'email', this.value)">
            <button type="button" title="Remove member" aria-label="Remove member" onclick="removeTeamMember(${ti}, ${mi})" ${team.members.length <= 1 ? "disabled" : ""}>×</button>
          </div>
        `,
          )
          .join("")}
        <button type="button" class="btn btn-secondary btn-xs team-add-member-btn" onclick="addTeamMember(${ti})">+ Add Member</button>
      </div>
    </div>
  `,
    )
    .join("");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function updateTeamName(teamIndex, value) {
  teams[teamIndex].name = value.trim() || teams[teamIndex].name;
  persistTeams();
  renderTeams();
}

function updateTeamMember(teamIndex, memberIndex, field, value) {
  teams[teamIndex].members[memberIndex][field] = value.trim();
  const member = teams[teamIndex].members[memberIndex];
  if (member.name === teams[teamIndex].lead || memberIndex === 0) {
    if (field === "name") teams[teamIndex].lead = value.trim();
  }
  persistTeams();
  renderTeams();
}

function addTeamMember(teamIndex) {
  teams[teamIndex].members.push({
    name: "New Member",
    email: "member@company.com",
  });
  persistTeams();
  renderTeams();
  const card = document.getElementById(`teamCard_${teamIndex}`);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const inputs = card.querySelectorAll(".team-edit-row input");
    const lastName = inputs[inputs.length - 2];
    if (lastName) lastName.focus();
  }
}

function removeTeamMember(teamIndex, memberIndex) {
  if (teams[teamIndex].members.length <= 1) return;
  teams[teamIndex].members.splice(memberIndex, 1);
  teams[teamIndex].lead = teams[teamIndex].members[0].name;
  persistTeams();
  renderTeams();
}

function addTeam() {
  teams.push({
    id: "team-" + Date.now(),
    name: "New Team",
    lead: "Team Lead",
    members: [{ name: "Team Lead", email: "lead@company.com" }],
  });
  persistTeams();
  renderTeams();
  const lastCard = document.querySelector(".team-list .team-card:last-child");
  if (lastCard) {
    lastCard.scrollIntoView({ behavior: "smooth", block: "start" });
    const nameInput = lastCard.querySelector(".team-name-input");
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }
}

function removeTeam(teamIndex) {
  if (teams.length <= 1) return;
  teams.splice(teamIndex, 1);
  persistTeams();
  renderTeams();
}

initSetupPage(
  "teams",
  "Teams",
  "Group reps so the submitter and their whole team are CC'd on every deal email.",
);
teams = Store.getTeams();
renderTeams();
