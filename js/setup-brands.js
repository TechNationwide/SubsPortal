let brands = Store.getBrands();
let editingIndex = null;
let modalLogoDataUrl = null;
let listSearchQuery = "";

function persistBrands() {
  Store.saveBrands(brands);
}

function syncFundersAfterBrandRemoval(removedIndex) {
  const funders = Store.getFunders();
  funders.forEach((funder) => {
    funder.brands = funder.brands
      .filter((bi) => bi !== removedIndex)
      .map((bi) => (bi > removedIndex ? bi - 1 : bi));
  });
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

function filteredBrands() {
  const q = listSearchQuery.trim().toLowerCase();
  if (!q) return brands.map((brand, index) => ({ brand, index }));
  return brands
    .map((brand, index) => ({ brand, index }))
    .filter(
      ({ brand }) =>
        brand.name.toLowerCase().includes(q) ||
        (brand.email || "").toLowerCase().includes(q) ||
        (brand.app || "").toLowerCase().includes(q),
    );
}

function renderBrandList() {
  const tbody = document.getElementById("brandTableBody");
  const empty = document.getElementById("brandEmptyState");
  const countEl = document.getElementById("brandRecordCount");
  if (!tbody) return;

  const rows = filteredBrands();
  if (countEl) {
    countEl.textContent = `${brands.length} brand${brands.length === 1 ? "" : "s"}`;
  }

  if (!rows.length) {
    tbody.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }

  empty?.classList.add("hidden");
  tbody.innerHTML = rows
    .map(
      ({ brand, index }) => `
    <tr class="crm-row" data-index="${index}">
      <td>
        <div class="crm-logo-cell">
          ${
            brand.logo
              ? `<img src="${escapeAttr(brand.logo)}" alt="" class="crm-logo-thumb" />`
              : `<span class="crm-logo-placeholder" style="background:${escapeAttr(brand.accent || "#4f46e5")}">${escapeHtml(brand.name.slice(0, 1))}</span>`
          }
        </div>
      </td>
      <td><strong>${escapeHtml(brand.name)}</strong></td>
      <td>${brand.email ? escapeHtml(brand.email) : '<span class="crm-muted">—</span>'}</td>
      <td>${brand.app ? escapeHtml(brand.app) : '<span class="crm-muted">—</span>'}</td>
      <td>
        <span class="crm-color-chip" style="background:${escapeAttr(brand.accent || "#4f46e5")}" title="${escapeAttr(brand.accent || "")}"></span>
      </td>
      <td class="crm-col-actions">
        <button type="button" class="btn btn-secondary btn-xs" onclick="openEditBrand(${index})">Edit</button>
        <button type="button" class="btn btn-secondary btn-xs" onclick="confirmDeleteBrand(${index})" ${brands.length <= 1 ? "disabled" : ""}>Delete</button>
      </td>
    </tr>
  `,
    )
    .join("");
}

function openCreateBrand() {
  editingIndex = null;
  modalLogoDataUrl = null;
  document.getElementById("brandModalTitle").textContent = "New Brand";
  document.getElementById("brandModalSaveBtn").textContent = "Create Brand";
  document.getElementById("brandModalDeleteBtn").style.display = "none";

  document.getElementById("brandFormName").value = "";
  document.getElementById("brandFormEmail").value = "";
  document.getElementById("brandFormApp").value = "";
  document.getElementById("brandFormAccent").value = "#4f46e5";
  document.getElementById("brandFormLogo").value = "";

  renderModalLogoPreview();
  openBrandModal();
  document.getElementById("brandFormName").focus();
}

function openEditBrand(index) {
  const brand = brands[index];
  if (!brand) return;

  editingIndex = index;
  modalLogoDataUrl = brand.logo || null;
  document.getElementById("brandModalTitle").textContent = "Edit Brand";
  document.getElementById("brandModalSaveBtn").textContent = "Save Changes";
  const deleteBtn = document.getElementById("brandModalDeleteBtn");
  deleteBtn.style.display = brands.length <= 1 ? "none" : "inline-flex";
  deleteBtn.onclick = () => confirmDeleteBrand(index);

  document.getElementById("brandFormName").value = brand.name;
  document.getElementById("brandFormEmail").value = brand.email || "";
  document.getElementById("brandFormApp").value = brand.app || "";
  document.getElementById("brandFormAccent").value = brand.accent || "#4f46e5";
  document.getElementById("brandFormLogo").value = "";

  renderModalLogoPreview();
  openBrandModal();
}

function openBrandModal() {
  document.getElementById("brandModal")?.classList.remove("hidden");
}

function closeBrandModal() {
  document.getElementById("brandModal")?.classList.add("hidden");
  editingIndex = null;
  modalLogoDataUrl = null;
}

function closeBrandModalOnOverlay(event) {
  if (event.target.id === "brandModal") closeBrandModal();
}

function renderModalLogoPreview() {
  const preview = document.getElementById("brandModalLogoPreview");
  const img = document.getElementById("brandModalLogoImg");
  if (!preview || !img) return;

  if (modalLogoDataUrl) {
    preview.classList.remove("hidden");
    img.src = modalLogoDataUrl;
  } else {
    preview.classList.add("hidden");
    img.removeAttribute("src");
  }
}

function setModalLogoFromFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToast("Logo must be a PNG, JPEG, or WebP image.", "error");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast("Logo must be under 2 MB.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    modalLogoDataUrl = reader.result;
    renderModalLogoPreview();
  };
  reader.readAsDataURL(file);
}

function bindModalLogoUpload() {
  const zone = document.getElementById("brandModalLogoDrop");
  const input = document.getElementById("brandFormLogo");
  if (!zone || !input) return;

  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) setModalLogoFromFile(file);
  });
  input.addEventListener("change", () => {
    if (input.files[0]) setModalLogoFromFile(input.files[0]);
    input.value = "";
  });
  document.getElementById("brandModalLogoRemove")?.addEventListener("click", () => {
    modalLogoDataUrl = null;
    renderModalLogoPreview();
  });
}

function handleBrandFormSubmit(e) {
  e.preventDefault();

  const name = document.getElementById("brandFormName").value.trim();
  if (!name) {
    showToast("Brand name is required.", "error");
    return;
  }

  const payload = {
    name,
    email: document.getElementById("brandFormEmail").value.trim(),
    app:
      document.getElementById("brandFormApp").value.trim() || `${name} Application`,
    accent: document.getElementById("brandFormAccent").value,
    logo: modalLogoDataUrl || null,
  };

  if (editingIndex === null) {
    brands.push(payload);
    persistBrands();
    showToast(`Created ${name}.`, "success");
  } else {
    brands[editingIndex] = { ...brands[editingIndex], ...payload };
    persistBrands();
    showToast(`Updated ${name}.`, "success");
  }

  brands = Store.getBrands();
  closeBrandModal();
  renderBrandList();
}

function confirmDeleteBrand(index) {
  if (brands.length <= 1) return;
  const name = brands[index].name;
  if (!window.confirm(`Delete "${name}"? Funder assignments for this brand will be updated.`)) {
    return;
  }
  brands.splice(index, 1);
  syncFundersAfterBrandRemoval(index);
  persistBrands();
  brands = Store.getBrands();
  closeBrandModal();
  renderBrandList();
  showToast(`Deleted ${name}.`, "success");
}

function bindBrandListSearch() {
  const input = document.getElementById("brandListSearch");
  if (!input) return;
  input.addEventListener("input", () => {
    listSearchQuery = input.value;
    renderBrandList();
  });
}

initSetupPage(
  "brands",
  "Brands",
  "Manage your funding brands and upload logos used for Aquamark watermarking.",
);

document.getElementById("openCreateBrandBtn")?.addEventListener("click", openCreateBrand);
document.getElementById("brandForm")?.addEventListener("submit", handleBrandFormSubmit);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("brandModal")?.classList.contains("hidden")) {
    closeBrandModal();
  }
});

bindModalLogoUpload();
bindBrandListSearch();
brands = Store.getBrands();
renderBrandList();

// Global handlers for inline onclick attributes
window.openCreateBrand = openCreateBrand;
window.openEditBrand = openEditBrand;
window.closeBrandModal = closeBrandModal;
window.closeBrandModalOnOverlay = closeBrandModalOnOverlay;
window.confirmDeleteBrand = confirmDeleteBrand;
