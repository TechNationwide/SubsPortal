let funders = Store.getFunders();
let brands = Store.getBrands();
let editingIndex = null;
let listSearchQuery = "";
let modalBrandIndices = [];
let brandPickerQuery = "";

function loadConfig() {
  funders = Store.getFunders();
  brands = Store.getBrands();
}

function persistFunders() {
  Store.saveFunders(funders);
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

function brandNamesForFunder(funder) {
  return funder.brands
    .map((bi) => brands[bi]?.name)
    .filter(Boolean);
}

function renderBrandChipsHtml(brandIndices, compact) {
  if (!brandIndices.length) {
    return '<span class="crm-muted">No brands assigned</span>';
  }
  const visible = compact ? brandIndices.slice(0, 4) : brandIndices;
  const chips = visible
    .map((bi) => {
      const brand = brands[bi];
      if (!brand) return "";
      return `<span class="crm-tag" style="--tag-color:${escapeAttr(brand.accent || "#4f46e5")}">${escapeHtml(brand.name)}</span>`;
    })
    .join("");
  const extra =
    compact && brandIndices.length > 4
      ? `<span class="crm-tag crm-tag-more">+${brandIndices.length - 4}</span>`
      : "";
  return chips + extra;
}

function filteredFunders() {
  const q = listSearchQuery.trim().toLowerCase();
  if (!q) return funders.map((funder, index) => ({ funder, index }));

  return funders
    .map((funder, index) => ({ funder, index }))
    .filter(({ funder }) => {
      const names = brandNamesForFunder(funder).join(" ").toLowerCase();
      return (
        funder.name.toLowerCase().includes(q) ||
        (funder.email || "").toLowerCase().includes(q) ||
        names.includes(q)
      );
    });
}

function renderFunderList() {
  loadConfig();
  const tbody = document.getElementById("funderTableBody");
  const empty = document.getElementById("funderEmptyState");
  const countEl = document.getElementById("funderRecordCount");
  if (!tbody) return;

  const rows = filteredFunders();
  if (countEl) {
    countEl.textContent = `${funders.length} funder${funders.length === 1 ? "" : "s"}`;
  }

  if (!rows.length) {
    tbody.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }

  empty?.classList.add("hidden");
  tbody.innerHTML = rows
    .map(
      ({ funder, index }) => `
    <tr class="crm-row" data-index="${index}">
      <td><strong>${escapeHtml(funder.name)}</strong></td>
      <td>${funder.email ? escapeHtml(funder.email) : '<span class="crm-muted">—</span>'}</td>
      <td><div class="crm-tag-list">${renderBrandChipsHtml(funder.brands, true)}</div></td>
      <td class="crm-col-actions">
        <button type="button" class="btn btn-secondary btn-xs" onclick="openEditFunder(${index})">Edit</button>
        <button type="button" class="btn btn-secondary btn-xs" onclick="confirmDeleteFunder(${index})" ${funders.length <= 1 ? "disabled" : ""}>Delete</button>
      </td>
    </tr>
  `,
    )
    .join("");
}

function openCreateFunder() {
  loadConfig();
  editingIndex = null;
  modalBrandIndices = brands.length ? [0] : [];
  brandPickerQuery = "";

  document.getElementById("funderModalTitle").textContent = "New Funder";
  document.getElementById("funderModalSaveBtn").textContent = "Create Funder";
  document.getElementById("funderModalDeleteBtn").style.display = "none";
  document.getElementById("funderFormName").value = "";
  document.getElementById("funderFormEmail").value = "";
  document.getElementById("funderBrandSearch").value = "";

  renderModalBrandPicker();
  openFunderModal();
  document.getElementById("funderFormName").focus();
}

function openEditFunder(index) {
  loadConfig();
  const funder = funders[index];
  if (!funder) return;

  editingIndex = index;
  modalBrandIndices = [...funder.brands];
  brandPickerQuery = "";

  document.getElementById("funderModalTitle").textContent = "Edit Funder";
  document.getElementById("funderModalSaveBtn").textContent = "Save Changes";
  const deleteBtn = document.getElementById("funderModalDeleteBtn");
  deleteBtn.style.display = funders.length <= 1 ? "none" : "inline-flex";
  deleteBtn.onclick = () => confirmDeleteFunder(index);

  document.getElementById("funderFormName").value = funder.name;
  document.getElementById("funderFormEmail").value = funder.email || "";
  document.getElementById("funderBrandSearch").value = "";

  renderModalBrandPicker();
  openFunderModal();
}

function openFunderModal() {
  document.getElementById("funderModal")?.classList.remove("hidden");
}

function closeFunderModal() {
  document.getElementById("funderModal")?.classList.add("hidden");
  closeBrandPickerDropdown();
  editingIndex = null;
  modalBrandIndices = [];
  brandPickerQuery = "";
}

function closeFunderModalOnOverlay(event) {
  if (event.target.id === "funderModal") closeFunderModal();
}

function closeBrandPickerDropdown() {
  document.getElementById("funderBrandDropdown")?.classList.add("hidden");
  document.getElementById("funderBrandSearch")?.setAttribute("aria-expanded", "false");
}

function filteredBrandOptions() {
  const q = brandPickerQuery.trim().toLowerCase();
  return brands
    .map((brand, index) => ({ brand, index }))
    .filter(({ brand }) => {
      if (!q) return true;
      return (
        brand.name.toLowerCase().includes(q) ||
        (brand.email || "").toLowerCase().includes(q)
      );
    });
}

function renderModalBrandPicker() {
  const chipsRoot = document.getElementById("funderBrandChips");
  const dropdown = document.getElementById("funderBrandDropdown");
  if (!chipsRoot || !dropdown) return;

  if (!modalBrandIndices.length) {
    chipsRoot.innerHTML = '<span class="crm-multiselect-empty">No brands selected — search below to add.</span>';
  } else {
    chipsRoot.innerHTML = modalBrandIndices
      .map((bi) => {
        const brand = brands[bi];
        if (!brand) return "";
        return `
        <span class="crm-tag crm-tag-removable" style="--tag-color:${escapeAttr(brand.accent || "#4f46e5")}">
          ${escapeHtml(brand.name)}
          <button type="button" aria-label="Remove ${escapeAttr(brand.name)}" onclick="removeModalBrand(${bi})">×</button>
        </span>`;
      })
      .join("");
  }

  const options = filteredBrandOptions();
  if (!options.length) {
    dropdown.innerHTML = '<div class="brand-search-empty">No brands match your search.</div>';
  } else {
    dropdown.innerHTML = options
      .map(({ brand, index }) => {
        const selected = modalBrandIndices.includes(index);
        return `
        <button type="button" class="crm-multiselect-option${selected ? " selected" : ""}" role="option" aria-selected="${selected}" onclick="toggleModalBrand(${index})">
          <span class="brand-swatch" style="background:${escapeAttr(brand.accent || "#4f46e5")}"></span>
          <span class="crm-multiselect-option-text">
            <strong>${escapeHtml(brand.name)}</strong>
            <small>${escapeHtml(brand.email || "")}</small>
          </span>
          <span class="crm-multiselect-check">${selected ? "✓" : ""}</span>
        </button>`;
      })
      .join("");
  }
}

function toggleModalBrand(brandIndex) {
  const idx = modalBrandIndices.indexOf(brandIndex);
  if (idx >= 0) {
    modalBrandIndices.splice(idx, 1);
  } else {
    modalBrandIndices.push(brandIndex);
    modalBrandIndices.sort((a, b) => a - b);
  }
  renderModalBrandPicker();
}

function removeModalBrand(brandIndex) {
  modalBrandIndices = modalBrandIndices.filter((bi) => bi !== brandIndex);
  renderModalBrandPicker();
}

function bindBrandMultiselect() {
  const wrap = document.getElementById("funderBrandMultiselect");
  const input = document.getElementById("funderBrandSearch");
  if (!input || !wrap) return;

  input.addEventListener("focus", () => {
    renderModalBrandPicker();
    document.getElementById("funderBrandDropdown")?.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  });

  input.addEventListener("input", () => {
    brandPickerQuery = input.value;
    renderModalBrandPicker();
    document.getElementById("funderBrandDropdown")?.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) closeBrandPickerDropdown();
  });
}

function handleFunderFormSubmit(e) {
  e.preventDefault();
  loadConfig();

  const name = document.getElementById("funderFormName").value.trim();
  if (!name) {
    showToast("Funder name is required.", "error");
    return;
  }

  const selectedBrands = [...new Set(modalBrandIndices)].sort((a, b) => a - b);
  if (!selectedBrands.length) {
    showToast("Select at least one brand.", "error");
    return;
  }

  const payload = {
    name,
    email: document.getElementById("funderFormEmail").value.trim(),
    brands: selectedBrands,
  };

  if (editingIndex === null) {
    funders.push(payload);
    persistFunders();
    showToast(`Created ${name}.`, "success");
  } else {
    funders[editingIndex] = { ...funders[editingIndex], ...payload };
    persistFunders();
    showToast(`Updated ${name}.`, "success");
  }

  loadConfig();
  closeFunderModal();
  renderFunderList();
}

function confirmDeleteFunder(index) {
  if (funders.length <= 1) return;
  const name = funders[index].name;
  if (!window.confirm(`Delete "${name}"? This funder will be removed from all brand assignments.`)) {
    return;
  }
  funders.splice(index, 1);
  persistFunders();
  loadConfig();
  closeFunderModal();
  renderFunderList();
  showToast(`Deleted ${name}.`, "success");
}

function bindFunderListSearch() {
  const input = document.getElementById("funderListSearch");
  if (!input) return;
  input.addEventListener("input", () => {
    listSearchQuery = input.value;
    renderFunderList();
  });
}

initSetupPage(
  "funders",
  "Funder Registry",
  "Manage funders and assign which brands each funder applies to. Only assigned funders appear on the submit deal page.",
);

document.getElementById("openCreateFunderBtn")?.addEventListener("click", openCreateFunder);
document.getElementById("funderForm")?.addEventListener("submit", handleFunderFormSubmit);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("funderModal")?.classList.contains("hidden")) {
    closeFunderModal();
  }
});

bindBrandMultiselect();
bindFunderListSearch();
loadConfig();
renderFunderList();

window.openCreateFunder = openCreateFunder;
window.openEditFunder = openEditFunder;
window.closeFunderModal = closeFunderModal;
window.closeFunderModalOnOverlay = closeFunderModalOnOverlay;
window.confirmDeleteFunder = confirmDeleteFunder;
window.toggleModalBrand = toggleModalBrand;
window.removeModalBrand = removeModalBrand;
