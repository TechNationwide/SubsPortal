/**
 * Simplified Submit Deal — single brand selector, watermark upload, server-side Aquamark.
 */
(function () {
  const API_PROCESS = "/api/aquamark/process";

  let brands = [];
  let teams = [];
  let selectedBrandIndex = null;
  let selectedRepKey = "";
  let dealFiles = [];
  let watermarkFile = null;
  let watermarkDataUrl = null;
  let lastResults = [];

  function loadConfig() {
    brands = Store.getBrands();
    teams = Store.getTeams();
  }

  function dealName() {
    return document.getElementById("dealName")?.value.trim() || "Deal";
  }

  function saveWatermarkForBrand(index, dataUrl) {
    Store.setBrandLogo(index, dataUrl);
    brands = Store.getBrands();
  }

  function allReps() {
    const reps = [];
    teams.forEach((team) => {
      team.members.forEach((m) => {
        reps.push({
          key: `${team.id}::${m.email}`,
          name: m.name,
          email: m.email,
          teamId: team.id,
          teamName: team.name,
        });
      });
    });
    return reps;
  }

  function teamForRep(repKey) {
    if (!repKey) return null;
    const teamId = repKey.split("::")[0];
    return teams.find((t) => t.id === teamId) || null;
  }

  function selectedRep() {
    return allReps().find((r) => r.key === selectedRepKey) || null;
  }

  function renderRepSelect() {
    const select = document.getElementById("submittedBy");
    if (!select) return;
    const current = select.value;
    select.innerHTML =
      '<option value="">— Select rep —</option>' +
      allReps()
        .map((r) => `<option value="${r.key}">${r.name} (${r.teamName})</option>`)
        .join("");
    if (current && allReps().some((r) => r.key === current)) select.value = current;
    select.onchange = onRepChange;
  }

  function onRepChange() {
    selectedRepKey = document.getElementById("submittedBy").value;
    updateCcPreview();
  }

  function updateCcPreview() {
    const el = document.getElementById("ccPreview");
    if (!el) return;
    const team = teamForRep(selectedRepKey);
    const rep = selectedRep();
    if (!team) {
      el.className = "cc-preview empty";
      el.innerHTML =
        "<strong>CC Recipients</strong>Select a rep to see their team.";
      return;
    }
    el.className = "cc-preview";
    el.innerHTML = `<strong>CC Recipients (${team.members.length})</strong>
      <div class="cc-chips">${team.members
        .map(
          (m) =>
            `<span class="cc-chip ${rep && m.email === rep.email ? "submitter" : ""}">
              <span class="cc-avatar">${getInitials(m.name)}</span>
              ${m.name}
            </span>`,
        )
        .join("")}</div>`;
  }

  /* ── Brand search combobox ── */
  function filterBrands(query) {
    const q = query.trim().toLowerCase();
    if (!q) return brands.map((b, i) => ({ ...b, index: i }));
    return brands
      .map((b, i) => ({ ...b, index: i }))
      .filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          (b.email && b.email.toLowerCase().includes(q)),
      );
  }

  function renderBrandDropdown(query) {
    const list = document.getElementById("brandSearchList");
    const input = document.getElementById("brandSearch");
    if (!list || !input) return;

    const matches = filterBrands(query);
    if (!matches.length) {
      list.innerHTML = '<div class="brand-search-empty">No brands match your search.</div>';
    } else {
      list.innerHTML = matches
        .map(
          (b) => `
        <button type="button" class="brand-search-option" role="option" data-index="${b.index}">
          <span class="brand-swatch" style="background:${b.accent || "#4f46e5"}"></span>
          <span>
            <strong>${escapeHtml(b.name)}</strong>
            <small>${escapeHtml(b.email || "")}</small>
          </span>
        </button>`,
        )
        .join("");
    }

    list.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  }

  function closeBrandDropdown() {
    const list = document.getElementById("brandSearchList");
    const input = document.getElementById("brandSearch");
    if (list) list.classList.add("hidden");
    if (input) input.setAttribute("aria-expanded", "false");
  }

  function selectBrand(index) {
    selectedBrandIndex = index;
    const brand = brands[index];
    if (!brand) return;

    const pill = document.getElementById("brandSelectedPill");
    const label = document.getElementById("brandSelectedLabel");
    const swatch = document.getElementById("brandSwatch");
    const search = document.getElementById("brandSearch");

    if (pill) pill.classList.remove("hidden");
    if (label) label.textContent = brand.name;
    if (swatch) swatch.style.background = brand.accent || "#4f46e5";
    if (search) {
      search.value = brand.name;
      search.blur();
    }
    closeBrandDropdown();

    loadWatermarkForBrand(index);
    updateProcessState();
    updateWorkflow();
  }

  function clearBrand() {
    selectedBrandIndex = null;
    document.getElementById("brandSelectedPill")?.classList.add("hidden");
    const search = document.getElementById("brandSearch");
    if (search) search.value = "";
    watermarkFile = null;
    watermarkDataUrl = null;
    renderWatermarkPreview();
    updateProcessState();
    updateWorkflow();
  }

  function initBrandSearch() {
    const input = document.getElementById("brandSearch");
    const wrap = document.getElementById("brandSearchWrap");
    if (!input) return;

    input.addEventListener("focus", () => renderBrandDropdown(input.value));
    input.addEventListener("input", () => {
      selectedBrandIndex = null;
      document.getElementById("brandSelectedPill")?.classList.add("hidden");
      renderBrandDropdown(input.value);
      updateProcessState();
    });

    document.getElementById("brandSearchList")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".brand-search-option");
      if (!btn) return;
      selectBrand(Number(btn.dataset.index));
    });

    document.getElementById("brandClearBtn")?.addEventListener("click", clearBrand);

    document.addEventListener("click", (e) => {
      if (!wrap?.contains(e.target)) closeBrandDropdown();
    });
  }

  /* ── Watermark upload ── */
  function renderWatermarkPreview() {
    const preview = document.getElementById("watermarkPreview");
    const img = document.getElementById("watermarkPreviewImg");
    if (!preview || !img) return;

    if (watermarkDataUrl) {
      preview.classList.remove("hidden");
      img.src = watermarkDataUrl;
    } else {
      preview.classList.add("hidden");
      img.removeAttribute("src");
    }
  }

  function setWatermarkFromFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      showToast("Watermark must be a PNG or JPEG image.", "error");
      return;
    }
    watermarkFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      watermarkDataUrl = reader.result;
      renderWatermarkPreview();
      if (selectedBrandIndex !== null) {
        saveWatermarkForBrand(selectedBrandIndex, watermarkDataUrl);
      }
      updateProcessState();
    };
    reader.readAsDataURL(file);
  }

  function loadWatermarkForBrand(index) {
    loadConfig();
    const logo = brands[index]?.logo;
    if (logo) {
      watermarkDataUrl = logo;
      watermarkFile = null;
      renderWatermarkPreview();
      return;
    }
    watermarkDataUrl = null;
    watermarkFile = null;
    renderWatermarkPreview();
  }

  function initWatermarkUpload() {
    const zone = document.getElementById("watermarkDropZone");
    const input = document.getElementById("watermarkInput");
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
      if (file) setWatermarkFromFile(file);
    });
    input.addEventListener("change", () => {
      if (input.files[0]) setWatermarkFromFile(input.files[0]);
    });
    document.getElementById("watermarkRemoveBtn")?.addEventListener("click", () => {
      watermarkFile = null;
      watermarkDataUrl = null;
      if (selectedBrandIndex !== null) saveWatermarkForBrand(selectedBrandIndex, null);
      document.getElementById("watermarkInput").value = "";
      renderWatermarkPreview();
      updateProcessState();
    });
  }

  /* ── Deal PDF upload ── */
  function renderDealFileList() {
    const root = document.getElementById("dealFileList");
    if (!root) return;
    if (!dealFiles.length) {
      root.innerHTML = "";
      return;
    }
    root.innerHTML = dealFiles
      .map(
        (f, i) => `
      <li class="aquamark-file-item">
        <span class="file-icon">PDF</span>
        <span class="file-meta">
          <strong>${escapeHtml(f.name)}</strong>
          <small>${formatSize(f.size)}</small>
        </span>
        <button type="button" class="btn btn-secondary btn-xs" data-remove="${i}">Remove</button>
      </li>`,
      )
      .join("");

    root.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dealFiles.splice(Number(btn.dataset.remove), 1);
        renderDealFileList();
        updateProcessState();
      });
    });
  }

  function addDealFiles(fileList) {
    Array.from(fileList).forEach((f) => {
      if (f.name.toLowerCase().endsWith(".pdf")) dealFiles.push(f);
    });
    if (!dealFiles.length) {
      showToast("Please upload PDF files only.", "error");
      return;
    }
    renderDealFileList();
    updateProcessState();
  }

  function initFilesUpload() {
    const zone = document.getElementById("filesDropZone");
    const input = document.getElementById("filesInput");
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
      addDealFiles(e.dataTransfer.files);
    });
    input.addEventListener("change", () => {
      addDealFiles(input.files);
      input.value = "";
    });
  }

  function updateProcessState() {
    const btn = document.getElementById("processBtn");
    const hint = document.getElementById("processHint");
    const ready = selectedBrandIndex !== null && dealFiles.length > 0;
    if (btn) btn.disabled = !ready;
    if (hint) {
      if (selectedBrandIndex === null) {
        hint.textContent = "Select a brand to continue.";
      } else if (!dealFiles.length) {
        hint.textContent = "Upload at least one PDF.";
      } else {
        hint.textContent = `${dealFiles.length} file(s) ready — click Aquamark & Flatten.`;
      }
    }
  }

  function updateWorkflow() {
    const steps = document.querySelectorAll(".workflow-step");
    const brandOk = selectedBrandIndex !== null;
    const wmOk = !!watermarkDataUrl;
    const filesOk = dealFiles.length > 0;

    steps.forEach((step) => step.classList.remove("active", "done"));
    if (!brandOk) {
      steps[0]?.classList.add("active");
    } else if (!wmOk) {
      steps[0]?.classList.add("done");
      steps[1]?.classList.add("active");
    } else if (!filesOk) {
      steps[0]?.classList.add("done");
      steps[1]?.classList.add("done");
      steps[2]?.classList.add("active");
    } else {
      steps.forEach((s) => s.classList.add("done"));
      steps[2]?.classList.add("active");
    }
  }

  /* ── Process via API ── */
  async function processDocuments() {
    if (selectedBrandIndex === null || !dealFiles.length) return;

    const brand = brands[selectedBrandIndex];
    const btn = document.getElementById("processBtn");
    btn.disabled = true;
    btn.textContent = "Processing…";

    const form = new FormData();
    form.append("brand_name", brand.name);
    form.append("deal_name", dealName());
    dealFiles.forEach((f) => form.append("files", f, f.name));

    if (watermarkFile) {
      form.append("watermark", watermarkFile, watermarkFile.name);
    } else if (watermarkDataUrl) {
      const blob = await (await fetch(watermarkDataUrl)).blob();
      form.append("watermark", blob, "brand-watermark.png");
    }

    try {
      const res = await fetch(API_PROCESS, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Processing failed.");
      }
      if (data.errors?.length) {
        showToast(data.errors.join(" "), "error");
      }
      lastResults = data.files || [];
      renderResults(lastResults);
      showToast(
        `${lastResults.length} file(s) watermarked and flattened.`,
        "success",
      );
    } catch (err) {
      showToast(
        err.message || "Server error — run python server.py and try again.",
        "error",
      );
    } finally {
      btn.disabled = false;
      btn.textContent = "Aquamark & Flatten";
      updateProcessState();
    }
  }

  function renderResults(files) {
    const section = document.getElementById("resultsSection");
    const list = document.getElementById("resultsList");
    const bulk = document.getElementById("bulkDownloadWrap");
    if (!section || !list) return;

    section.classList.remove("hidden");
    list.innerHTML = files
      .map(
        (f) => `
      <li class="aquamark-result-item">
        <span class="file-icon success">✓</span>
        <span class="file-meta">
          <strong>${escapeHtml(f.name)}</strong>
          <small>From ${escapeHtml(f.original)} · ${formatSize(f.size)}</small>
        </span>
        <a class="btn btn-primary btn-xs" href="${f.download}" download>Download</a>
      </li>`,
      )
      .join("");

    if (bulk) bulk.style.display = files.length > 1 ? "flex" : "none";
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function downloadAll() {
    lastResults.forEach((f, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = f.download;
        a.download = f.name;
        a.click();
      }, i * 400);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* ── Auth ── */
  function checkSession() {
    const session = Store.getSession();
    if (session) showPortal(session.email);
  }

  function showPortal(email) {
    loadConfig();
    renderSiteNav("aquamark");
    document.getElementById("loginPage")?.classList.add("hidden");
    document.getElementById("portalPage")?.classList.remove("hidden");
    const userEl = document.getElementById("userDisplay");
    if (userEl) userEl.textContent = email;
    renderRepSelect();
    initBrandSearch();
    initWatermarkUpload();
    initFilesUpload();
    updateProcessState();
    initScrollProgress();
  }

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("loginEmail").value.trim();
      Store.setSession(email);
      showPortal(email);
      showToast("Signed in.", "success");
    });
  }

  document.getElementById("processBtn")?.addEventListener("click", processDocuments);
  document.getElementById("downloadAllBtn")?.addEventListener("click", downloadAll);

  if (document.getElementById("portalPage")) {
    initRipple();
    loadConfig();
    checkSession();
  }
})();
