      let brands = Store.getBrands();
      let funders = Store.getFunders();
      let teams = Store.getTeams();

      let brandFiles = {};
      let funderStates = {};
      let pendingSend = null;
      let prevCounts = { files: 0, selected: 0, watermarked: 0, sent: 0 };
      let selectedRepKey = "";

      function loadConfig() {
        brands = Store.getBrands();
        funders = Store.getFunders();
        teams = Store.getTeams();
      }

      brands.forEach((_, i) => {
        if (!brandFiles[i]) brandFiles[i] = [];
      });

      function fundersForBrand(brandIndex) {
        return funders
          .map((f, fi) => ({ ...f, index: fi }))
          .filter((f) => f.brands.includes(brandIndex));
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

      function ccListForCurrentRep() {
        const team = teamForRep(selectedRepKey);
        if (!team) return [];
        return team.members.map((m) => ({ name: m.name, email: m.email }));
      }

      function ccDisplayString() {
        const list = ccListForCurrentRep();
        if (!list.length) return "—";
        return list.map((m) => `${m.name} <${m.email}>`).join(", ");
      }

      function selectedRep() {
        return allReps().find((r) => r.key === selectedRepKey) || null;
      }

      function updateRepHint() {
        const hint = document.getElementById("repHint");
        if (!hint) return;
        hint.classList.toggle("visible", !selectedRepKey);
      }

      function renderRepSelect() {
        const select = document.getElementById("submittedBy");
        if (!select) return;
        const current = select.value;
        select.innerHTML =
          '<option value="">— Select rep —</option>' +
          allReps()
            .map(
              (r) =>
                `<option value="${r.key}">${r.name} (${r.teamName})</option>`,
            )
            .join("");
        if (current && allReps().some((r) => r.key === current)) {
          select.value = current;
        }
      }

      function onRepChange() {
        selectedRepKey = document.getElementById("submittedBy").value;
        updateCcPreview();
        updateRepHint();
        document.querySelectorAll(".brand-cc-line").forEach((el) => {
          el.textContent = ccDisplayString();
        });
        updateCounts();
        const rep = selectedRep();
        if (rep) {
          addAudit(
            "All Brands",
            "Rep selected",
            `${rep.name} (${rep.teamName}) — team CC: ${ccDisplayString()}`,
          );
        }
      }

      function updateCcPreview() {
        const el = document.getElementById("ccPreview");
        if (!el) return;
        const list = ccListForCurrentRep();
        const rep = selectedRep();
        if (!list.length) {
          el.className = "cc-preview empty";
          el.innerHTML =
            "<strong>CC Recipients</strong>Select a rep to auto-CC their team on all outgoing emails.";
          return;
        }
        el.className = "cc-preview";
        el.innerHTML = `<strong>CC Recipients (${list.length})</strong>
          <div class="cc-chips">${list
            .map(
              (m) => `
            <span class="cc-chip ${rep && m.email === rep.email ? "submitter" : ""}">
              <span class="cc-avatar">${getInitials(m.name)}</span>
              ${m.name}${rep && m.email === rep.email ? " (submitter)" : ""}
            </span>`,
            )
            .join("")}</div>`;
      }

      function totalBrandFiles() {
        return Object.values(brandFiles).reduce((sum, arr) => sum + arr.length, 0);
      }

      function brandHasFiles(brandIndex) {
        return (brandFiles[brandIndex] || []).length > 0;
      }

      function anyBrandHasFiles() {
        return brands.some((_, i) => brandHasFiles(i));
      }

      function initFunderStates() {
        funderStates = {};
        brands.forEach((_, bi) => {
          funders.forEach((_, fi) => {
            funderStates[`${bi}_${fi}`] = "ready";
          });
        });
      }

      function getState(brandIndex, funderIndex) {
        return funderStates[`${brandIndex}_${funderIndex}`] || "ready";
      }

      function setState(brandIndex, funderIndex, state) {
        funderStates[`${brandIndex}_${funderIndex}`] = state;
        updateBadge(brandIndex, funderIndex);
        updateFunderSendButtons();
        updateBrandProgress(brandIndex);
        renderFunderPackages(brandIndex);
        updateCounts();
        updateWorkflow();
      }

      function stateLabel(state) {
        const labels = {
          ready: "Ready",
          processing: "Watermarking…",
          watermarked: "Watermarked",
          queued: "Queued",
          sent: "Sent",
          error: "Failed",
        };
        return labels[state] || state;
      }

      function dealName() {
        return document.getElementById("dealName").value.trim() || "Deal Name";
      }

      function subjectLine() {
        return `NEW DEAL - ${dealName()}`;
      }

      /* ── Auth ── */
      function checkSession() {
        const session = Store.getSession();
        if (session) {
          showPortal(session.email);
        }
      }

      const loginForm = document.getElementById("loginForm");
      if (loginForm) {
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const email = document.getElementById("loginEmail").value.trim();
        Store.setSession(email);
        const loginPage = document.getElementById("loginPage");
        loginPage.classList.add("exiting");
        setTimeout(() => {
          showPortal(email);
          loginPage.classList.remove("exiting");
          addAudit(
            "System",
            "User signed in",
            `${email} accessed the submission portal.`,
          );
          showToast("Welcome back! Your workspace is ready.", "success");
        }, 400);
      });
      }

      function showPortal(email) {
        loadConfig();
        renderSiteNav("submit");
        document.getElementById("loginPage").classList.add("hidden");
        const portal = document.getElementById("portalPage");
        portal.classList.remove("hidden");
        portal.classList.remove("portal-enter");
        void portal.offsetWidth;
        portal.classList.add("portal-enter");
        document.getElementById("userDisplay").textContent = email;
        if (!document.getElementById("auditRows").children.length) {
          addAudit(
            "All Brands",
            "Deal opened",
            `Submission portal loaded for ${dealName()}.`,
          );
        }
        initScrollProgress();
        renderRepSelect();
        initDefaultRep();
        renderBrandNav();
        renderBrands();
        syncSubjects();
        updateCounts();
      }

      function spawnConfetti(x, y) {
        const colors = ["#4f46e5", "#10b981", "#8b5cf6", "#0ea5e9", "#ec4899", "#c9a227"];
        for (let i = 0; i < 16; i++) {
          const el = document.createElement("div");
          el.className = "confetti-burst";
          el.style.left = x + (Math.random() - 0.5) * 100 + "px";
          el.style.top = y + "px";
          el.style.background = colors[i % colors.length];
          el.style.animationDelay = Math.random() * 0.25 + "s";
          el.style.width = 6 + Math.random() * 8 + "px";
          el.style.height = el.style.width;
          el.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
          document.body.appendChild(el);
          setTimeout(() => el.remove(), 1400);
        }
      }

      function animateCounter(el, target) {
        if (!el) return;
        const start = parseInt(el.textContent, 10) || 0;
        if (start === target) return;
        const duration = 500;
        const startTime = performance.now();
        function tick(now) {
          const p = Math.min((now - startTime) / duration, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(start + (target - start) * eased);
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        if (el.id) animateMetric(el.id);
      }

      function animateMetric(id) {
        const el = document.getElementById(id)?.closest(".metric");
        if (el) {
          el.classList.remove("metric-pop");
          void el.offsetWidth;
          el.classList.add("metric-pop");
        }
      }

      function logout() { Store.clearSession(); window.location.href = "index.html"; }

      function loadDemoFiles() {
        const demoNames = [
          "Bank_Statements_Jan-Mar.pdf",
          "Owner_Drivers_License.pdf",
          "Voided_Check.pdf",
          "Business_Tax_Return.pdf",
        ];
        brands.forEach((_, bi) => {
          brandFiles[bi] = demoNames.map((name) => ({
            name,
            size: 240000 + Math.floor(Math.random() * 400000),
            demo: true,
          }));
        });
        renderBrands();
        renderBrandNav();
        updateDocChecklist();
        updateCounts();
        updateWorkflow();
        addAudit(
          "All Brands",
          "Demo files loaded",
          `${demoNames.length} sample files added to each brand for ${dealName()}.`,
        );
        showToast("Demo files loaded to all brands.", "success");
      }

      function updateDocChecklist() {
        const names = Object.values(brandFiles)
          .flat()
          .map((f) => f.name.toLowerCase())
          .join(" ");
        const total = totalBrandFiles();
        const checks = {
          statements: /bank|statement/.test(names) || total > 0,
          id: /id|license|driver/.test(names) || total > 1,
          check: /void|check/.test(names) || total > 2,
          supporting: /tax|support|return|doc/.test(names) || total > 3,
        };
        document.querySelectorAll(".doc-item").forEach((el) => {
          const key = el.dataset.doc;
          const done = checks[key];
          el.classList.toggle("done", done);
          el.querySelector(".doc-icon").textContent = done ? "✓" : "○";
        });
      }

      /* ── Per-brand file upload ── */
      function setupBrandUpload(brandIndex) {
        const box = document.getElementById(`brandUpload_${brandIndex}`);
        const input = document.getElementById(`brandFileInput_${brandIndex}`);
        if (!box || !input) return;

        box.addEventListener("dragover", (e) => {
          e.preventDefault();
          box.classList.add("dragover");
        });
        box.addEventListener("dragleave", () => box.classList.remove("dragover"));
        box.addEventListener("drop", (e) => {
          e.preventDefault();
          box.classList.remove("dragover");
          addBrandFiles(brandIndex, e.dataTransfer.files);
        });
        input.addEventListener("change", () => {
          addBrandFiles(brandIndex, input.files);
          input.value = "";
        });
      }

      function addBrandFiles(brandIndex, fileList) {
        if (!brandFiles[brandIndex]) brandFiles[brandIndex] = [];
        Array.from(fileList).forEach((file) => {
          brandFiles[brandIndex].push(file);
        });
        renderBrandFileList(brandIndex);
        updateDocChecklist();
        updateCounts();
        updateWorkflow();
        if (fileList.length) {
          addAudit(
            brands[brandIndex].name,
            "Files uploaded",
            `${fileList.length} file(s) added to ${brands[brandIndex].name} package.`,
          );
          renderBrandNav();
          showToast(
            `${fileList.length} file(s) uploaded to ${brands[brandIndex].name}.`,
            "success",
          );
        }
      }

      function removeBrandFile(brandIndex, fileIndex) {
        const name = brandFiles[brandIndex][fileIndex].name;
        brandFiles[brandIndex].splice(fileIndex, 1);
        renderBrandFileList(brandIndex);
        updateDocChecklist();
        updateCounts();
        updateWorkflow();
        addAudit(
          brands[brandIndex].name,
          "File removed",
          `${name} removed from brand package.`,
        );
        renderBrandNav();
      }

      function renderBrandFileList(brandIndex) {
        const root = document.getElementById(`brandFileList_${brandIndex}`);
        const box = document.getElementById(`brandUpload_${brandIndex}`);
        if (!root) return;
        const files = brandFiles[brandIndex] || [];
        if (box) {
          box.classList.toggle("has-files", files.length > 0);
          const countEl = box.querySelector(".brand-file-count");
          if (countEl) {
            countEl.textContent = `${files.length} file${files.length === 1 ? "" : "s"} uploaded`;
            countEl.style.display = files.length ? "inline-flex" : "none";
          }
        }
        if (!files.length) {
          root.innerHTML = "";
          return;
        }
        root.innerHTML = files
          .map(
            (f, i) => `
          <div class="brand-file-item">
            <span>${f.name} (${formatSize(f.size)})</span>
            <button type="button" onclick="removeBrandFile(${brandIndex}, ${i})">Remove</button>
          </div>
        `,
          )
          .join("");
        updateBrandStatusPill(brandIndex);
      }

      function brandStatus(brandIndex) {
        const files = brandFiles[brandIndex]?.length || 0;
        const selected = selectedFundersForBrand(brandIndex).length;
        const sent = selectedFundersForBrand(brandIndex).filter(
          (fi) => getState(brandIndex, fi) === "sent",
        ).length;
        if (sent > 0 && sent === selected) return { label: "Complete", cls: "ready" };
        if (selected > 0 && files > 0) return { label: "In progress", cls: "pending" };
        if (files > 0) return { label: "Files ready", cls: "pending" };
        return { label: "Needs files", cls: "empty" };
      }

      function updateBrandStatusPill(brandIndex) {
        const pill = document.getElementById(`brandStatus_${brandIndex}`);
        if (!pill) return;
        const s = brandStatus(brandIndex);
        pill.className = `brand-status-pill ${s.cls}`;
        pill.textContent = s.label;
      }

      function renderFunderPackages(brandIndex) {
        const root = document.getElementById(`funderPackages_${brandIndex}`);
        if (!root) return;
        const selected = selectedFundersForBrand(brandIndex);
        const sourceFiles = brandFiles[brandIndex] || [];

        if (!selected.length) {
          root.innerHTML =
            '<div class="funder-package-empty">Select funders above to organize outgoing files by funder name.</div>';
          return;
        }

        const sourceBlock =
          sourceFiles.length > 0
            ? `
          <div class="brand-source-panel">
            <div class="brand-source-header">
              <span>📂</span> ${brands[brandIndex].name} — Source Upload (watermarked once per brand)
            </div>
            <div class="brand-source-files">
              ${sourceFiles.map((f) => `<div class="brand-source-file"><span>📄</span>${f.name}</div>`).join("")}
            </div>
          </div>`
            : `<div class="funder-package-empty">Upload files for ${brands[brandIndex].name} to begin packaging.</div>`;

        const funderBlocks = selected
          .map((fi) => {
            const funder = funders[fi];
            const state = getState(brandIndex, fi);
            const outgoing = [];
            if (state === "watermarked" || state === "sent") {
              outgoing.push({
                name: `${cleanFileName(brands[brandIndex].name)}_${cleanFileName(funder.name)}_${cleanFileName(dealName())}_Watermarked.pdf`,
                type: "watermarked",
                sent: state === "sent",
              });
            }
            outgoing.push({
              name: `${cleanFileName(brands[brandIndex].name)}_${cleanFileName(dealName())}_Application.pdf`,
              type: "application",
              sent: state === "sent",
            });

            return `
            <div class="funder-package-group">
              <div class="funder-package-header">
                <span class="folder-icon">📁</span>
                ${funder.name}
                <span class="badge ${state}" style="margin-left:auto">${stateLabel(state)}</span>
              </div>
              <div class="funder-package-files">
                <div class="funder-outgoing-label">Outgoing to ${funder.email}</div>
                ${outgoing.length ? outgoing.map((f) => `<div class="funder-package-file ${f.type === "watermarked" ? "watermarked" : ""} ${f.sent ? "sent" : ""}"><span class="file-icon">${f.type === "watermarked" ? "🔒" : "📋"}</span>${f.name}</div>`).join("") : '<div class="funder-package-file"><span class="file-icon">⏳</span>Awaiting watermark…</div>'}
              </div>
            </div>
          `;
          })
          .join("");

        root.innerHTML = sourceBlock + funderBlocks;
      }

      /* ── Brands ── */
      function renderBrandNav() {
        const nav = document.getElementById("brandNav");
        nav.innerHTML = brands
          .map((b, i) => {
            const files = brandFiles[i]?.length || 0;
            const dot = files
              ? '<span style="width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block"></span>'
              : '<span style="width:6px;height:6px;border-radius:50%;background:#cbd5e1;display:inline-block"></span>';
            return `<button type="button" onclick="scrollToBrand(${i})">${dot} ${b.name}</button>`;
          })
          .join("");
      }

      function scrollToBrand(index) {
        const card = document.querySelector(
          `.brand-card[data-brand="${index}"]`,
        );
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "start" });
          card.classList.remove("highlight-flash");
          void card.offsetWidth;
          card.classList.add("highlight-flash");
        }
      }

      function brandProgress(brandIndex) {
        const selected = selectedFundersForBrand(brandIndex);
        const watermarked = selected.filter(
          (fi) =>
            getState(brandIndex, fi) === "watermarked" ||
            getState(brandIndex, fi) === "sent",
        ).length;
        const sent = selected.filter(
          (fi) => getState(brandIndex, fi) === "sent",
        ).length;
        return { selected: selected.length, watermarked, sent };
      }

      function renderBrands() {
        const saved = saveBrandUIState();
        const root = document.getElementById("brandGrid");
        root.innerHTML = "";

        brands.forEach((brand, brandIndex) => {
          const progress = brandProgress(brandIndex);
          const status = brandStatus(brandIndex);
          const assignedFunders = fundersForBrand(brandIndex);
          const fileCount = (brandFiles[brandIndex] || []).length;
          const card = document.createElement("article");
          card.className = "brand-card";
          card.dataset.brand = brandIndex;
          card.style.setProperty("--brand-accent", brand.accent);
          card.style.animationDelay = `${brandIndex * 0.08}s`;

          card.innerHTML = `
          <div class="brand-header">
            <div>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <h3 style="margin:0">${brand.name}</h3>
                <span class="brand-status-pill ${status.cls}" id="brandStatus_${brandIndex}">${status.label}</span>
              </div>
              <div class="brand-meta">
                <span><strong>From:</strong> ${brand.email}</span>
                <span><strong>Application:</strong> ${brand.app}</span>
                <span><strong>Files:</strong> ${fileCount}</span>
              </div>
              <div class="brand-step-bar" style="margin-top:10px" id="brandProgress_${brandIndex}">
                <span class="brand-step-pill ${progress.selected ? "done" : ""}">${progress.selected} funder(s)</span>
                <span class="brand-step-pill ${progress.watermarked ? "done" : ""}">${progress.watermarked} watermarked</span>
                <span class="brand-step-pill ${progress.sent ? "done" : ""}">${progress.sent} sent</span>
              </div>
            </div>
            <label class="brand-toggle">
              <input type="checkbox" class="brand-enabled" data-brand="${brandIndex}" checked onchange="toggleBrand(${brandIndex})">
              Use Brand
            </label>
          </div>

          <div class="brand-body">
            <div class="email-settings">
              <div class="email-line"><strong>Subject:</strong> <span class="subject-line">${subjectLine()}</span></div>
              <div class="email-line"><strong>Email body:</strong> Please Underwrite</div>
              <div class="email-line"><strong>CC:</strong> <span class="brand-cc-line">${ccDisplayString()}</span></div>
              <div class="email-line"><strong>Attachments per funder:</strong> Aquamark watermarked PDF + ${brand.app}</div>
            </div>

            <div class="notes-row">
              <div>
                <label>Admin Notes / Submission Notes</label>
                <textarea class="brand-notes" data-brand="${brandIndex}" placeholder="Optional notes to add under Please Underwrite..."></textarea>
              </div>
              <div>
                <label>${brand.name} — Upload Deal Package</label>
                <div class="brand-upload-box ${fileCount ? "has-files" : ""}" id="brandUpload_${brandIndex}" onclick="document.getElementById('brandFileInput_${brandIndex}').click()">
                  <input type="file" id="brandFileInput_${brandIndex}" multiple accept=".pdf,.png,.jpg,.jpeg">
                  <div class="upload-mini-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </div>
                  <strong>${fileCount ? `${fileCount} file${fileCount === 1 ? "" : "s"} ready for ${brand.name}` : `Upload files for ${brand.name}`}</strong>
                  <span>Watermark once — separate from other brands</span>
                  <div class="brand-file-count" style="display:${fileCount ? "inline-flex" : "none"}">${fileCount} file${fileCount === 1 ? "" : "s"} uploaded</div>
                </div>
                <div class="brand-file-list" id="brandFileList_${brandIndex}"></div>
              </div>
            </div>

            <div class="funder-box">
              <div class="funder-title">
                <strong>Select funders for ${brand.name}</strong>
                <button type="button" onclick="toggleFunders(${brandIndex})">Select / Clear All</button>
              </div>
              <div class="funder-list" id="funderList_${brandIndex}">
                ${assignedFunders.length ? assignedFunders
                  .map(
                    (funder) => {
                      const funderIndex = funder.index;
                      return `
                  <div class="funder-row" data-brand="${brandIndex}" data-funder="${funderIndex}">
                    <input type="checkbox" class="funder-check" data-brand="${brandIndex}" data-funder="${funderIndex}" onchange="onFunderChange(${brandIndex}, ${funderIndex})">
                    <span class="funder-name">
                      <strong>${funder.name}</strong>
                      <small>${funder.email} — files organized under this funder name.</small>
                    </span>
                    <div class="funder-actions">
                      <span class="badge ${getState(brandIndex, funderIndex)}" data-badge="${brandIndex}_${funderIndex}">${stateLabel(getState(brandIndex, funderIndex))}</span>
                      <button type="button" class="btn btn-secondary btn-xs btn-funder-send hidden" data-send="${brandIndex}_${funderIndex}" onclick="openSendModal(${brandIndex}, ${funderIndex})">Send Email</button>
                    </div>
                  </div>
                `;
                    },
                  )
                  .join("") : '<div class="funder-package-empty">No funders assigned to this brand. Assign funders in the Funder Registry above.</div>'}
              </div>
            </div>

            <div class="funder-packages">
              <div class="funder-packages-title">Outgoing Files by Funder</div>
              <div id="funderPackages_${brandIndex}"></div>
            </div>

            <div class="actions">
              <button type="button" class="btn btn-secondary" onclick="previewBrand(${brandIndex})">Preview Queue</button>
              <button type="button" class="btn btn-aquamark btn-watermark-brand" data-brand="${brandIndex}" onclick="watermarkBrand(${brandIndex})" disabled>Aquamark + Flatten</button>
              <button type="button" class="btn btn-primary btn-send-brand" data-brand="${brandIndex}" onclick="openBrandSendModal(${brandIndex})" disabled>Preview &amp; Send All Ready</button>
            </div>
          </div>
        `;
          root.appendChild(card);
          renderBrandFileList(brandIndex);
          renderFunderPackages(brandIndex);
          setupBrandUpload(brandIndex);
        });

        restoreBrandUIState(saved);
        updateFunderSendButtons();
        updateCounts();
      }

      function saveBrandUIState() {
        const state = { notes: {}, enabled: {}, checks: {} };
        brands.forEach((_, bi) => {
          const notesEl = document.querySelector(
            `.brand-notes[data-brand="${bi}"]`,
          );
          state.notes[bi] = notesEl ? notesEl.value : "";
          const enabled = document.querySelector(
            `.brand-enabled[data-brand="${bi}"]`,
          );
          state.enabled[bi] = enabled ? enabled.checked : true;
          state.checks[bi] = Array.from(
            document.querySelectorAll(
              `.funder-check[data-brand="${bi}"]:checked`,
            ),
          ).map((c) => Number(c.dataset.funder));
        });
        return state;
      }

      function restoreBrandUIState(state) {
        brands.forEach((_, bi) => {
          const notesEl = document.querySelector(
            `.brand-notes[data-brand="${bi}"]`,
          );
          if (notesEl && state.notes[bi] !== undefined) {
            notesEl.value = state.notes[bi];
          }
          const enabled = document.querySelector(
            `.brand-enabled[data-brand="${bi}"]`,
          );
          if (enabled && state.enabled[bi] !== undefined) {
            enabled.checked = state.enabled[bi];
            const card = document.querySelector(
              `.brand-card[data-brand="${bi}"]`,
            );
            if (card) card.classList.toggle("disabled", !state.enabled[bi]);
          }
          (state.checks[bi] || []).forEach((fi) => {
            const check = document.querySelector(
              `.funder-check[data-brand="${bi}"][data-funder="${fi}"]`,
            );
            if (check) check.checked = true;
          });
          renderBrandFileList(bi);
          renderFunderPackages(bi);
          updateBrandStatusPill(bi);
        });
      }

      function onFunderChange(brandIndex, funderIndex) {
        const check = document.querySelector(
          `.funder-check[data-brand="${brandIndex}"][data-funder="${funderIndex}"]`,
        );
        if (!check.checked && getState(brandIndex, funderIndex) !== "sent") {
          setState(brandIndex, funderIndex, "ready");
        }
        updateBrandProgress(brandIndex);
        renderFunderPackages(brandIndex);
        updateBrandStatusPill(brandIndex);
        updateCounts();
        updateWorkflow();
      }

      function updateBrandProgress(brandIndex) {
        const el = document.getElementById(`brandProgress_${brandIndex}`);
        if (!el) return;
        const p = brandProgress(brandIndex);
        el.innerHTML = `
          <span class="brand-step-pill ${p.selected ? "done" : ""}">${p.selected} funder(s)</span>
          <span class="brand-step-pill ${p.watermarked ? "done" : ""}">${p.watermarked} watermarked</span>
          <span class="brand-step-pill ${p.sent ? "done" : ""}">${p.sent} sent</span>
        `;
      }

      function updateFunderSendButtons() {
        brands.forEach((_, bi) => {
          funders.forEach((_, fi) => {
            const btn = document.querySelector(`[data-send="${bi}_${fi}"]`);
            if (!btn) return;
            const checked = document.querySelector(
              `.funder-check[data-brand="${bi}"][data-funder="${fi}"]`,
            )?.checked;
            const state = getState(bi, fi);
            const show = checked && state === "watermarked";
            btn.classList.toggle("hidden", !show);
          });
        });
      }

      function namingExample(brand) {
        return `${cleanFileName(brand.name)}_[FUNDER]_${cleanFileName(dealName())}_Watermarked.pdf
${cleanFileName(brand.name)}_${cleanFileName(dealName())}_Application.pdf`;
      }

      function syncSubjects() {
        const subject = subjectLine();
        document.getElementById("subjectExample").textContent = dealName();
        document.getElementById("globalSubject").textContent = subject;
        document.querySelectorAll(".subject-line").forEach((el) => {
          el.textContent = subject;
        });
        brands.forEach((_, brandIndex) => {
          renderFunderPackages(brandIndex);
        });
      }

      function toggleBrand(brandIndex) {
        const enabled = document.querySelector(
          `.brand-enabled[data-brand="${brandIndex}"]`,
        ).checked;
        const card = document.querySelector(
          `.brand-card[data-brand="${brandIndex}"]`,
        );
        card.classList.toggle("disabled", !enabled);
        updateCounts();
        updateWorkflow();
      }

      function updateWorkflow() {
        const hasRep = Boolean(selectedRepKey);
        const hasFiles = anyBrandHasFiles();
        const hasFunders =
          Number(document.getElementById("selectedCount").textContent) > 0;
        const watermarked = Number(
          document.getElementById("watermarkedCount").textContent,
        );
        const sent = Number(document.getElementById("sentCount").textContent);
        const selected = Number(
          document.getElementById("selectedCount").textContent,
        );
        const sendable = countSendable();

        const steps = {
          team: hasRep,
          upload: hasFiles,
          funders: hasFunders,
          send: sent > 0 || sendable > 0,
        };

        let activeStep = "team";
        if (!hasRep) activeStep = "team";
        else if (!hasFiles) activeStep = "upload";
        else if (!hasFunders) activeStep = "funders";
        else if (watermarked < selected || sendable > 0) activeStep = "send";
        else if (sent > 0) activeStep = "send";
        else activeStep = "send";

        const allComplete =
          hasRep && hasFiles && hasFunders && sent > 0 && sendable === 0;

        document.querySelectorAll(".workflow-step").forEach((el) => {
          const step = el.dataset.step;
          el.classList.remove("active", "done");
          if (allComplete || (steps[step] && step !== activeStep)) {
            el.classList.add("done");
          }
          if (!allComplete && step === activeStep) el.classList.add("active");
        });

        const hint = document.getElementById("nextStepHint");
        if (!hasRep) {
          hint.innerHTML =
            "<strong>Next:</strong> Select the submitting rep — their team will be CC'd automatically.";
        } else if (!hasFiles) {
          hint.innerHTML =
            "<strong>Next:</strong> Upload files per brand below, or click <em>Load Demo Files</em>.";
        } else if (!hasFunders) {
          hint.innerHTML =
            "<strong>Next:</strong> Enable brands and select funders for each brand.";
        } else if (watermarked < selected) {
          hint.innerHTML = `<strong>Next:</strong> Run <em>Aquamark + Flatten</em> on ${selected - watermarked} remaining package(s).`;
        } else if (sendable > 0) {
          hint.innerHTML = `<strong>Next:</strong> Preview and send ${sendable} ready email(s).`;
        } else if (sent > 0) {
          hint.innerHTML = `<strong>Done:</strong> ${sent} email(s) sent. See activity log below.`;
        } else {
          hint.innerHTML =
            "<strong>Next:</strong> Watermark packages, then send to funders.";
        }

        let pct = 0;
        if (!hasRep) pct = 10;
        else if (!hasFiles) pct = 30;
        else if (!hasFunders) pct = 50;
        else if (watermarked < selected) pct = 50 + Math.round((watermarked / Math.max(selected, 1)) * 25);
        else if (sendable > 0) pct = 85;
        else if (allComplete) pct = 100;
        else if (sent > 0) pct = 70 + Math.round((sent / Math.max(selected, 1)) * 30);
        else pct = 75;

        const fill = document.getElementById("workflowTrackFill");
        const pctEl = document.getElementById("workflowPct");
        if (fill) fill.style.width = pct + "%";
        if (pctEl) pctEl.textContent = pct + "%";
      }

      function updateBadge(brandIndex, funderIndex) {
        const badge = document.querySelector(
          `[data-badge="${brandIndex}_${funderIndex}"]`,
        );
        if (!badge) return;
        const state = getState(brandIndex, funderIndex);
        badge.className = `badge ${state}`;
        badge.textContent = stateLabel(state);
        if (state === "watermarked" || state === "sent") {
          badge.classList.add("badge-pop");
        }
      }

      function updateCounts() {
        let selected = 0;
        let watermarked = 0;
        let sent = 0;
        let brandsActive = 0;

        brands.forEach((_, bi) => {
          const enabled = document.querySelector(
            `.brand-enabled[data-brand="${bi}"]`,
          );
          if (enabled && enabled.checked) brandsActive++;
        });

        document.querySelectorAll(".funder-check:checked").forEach((check) => {
          const bi = check.dataset.brand;
          const fi = check.dataset.funder;
          const brandEnabled = document.querySelector(
            `.brand-enabled[data-brand="${bi}"]`,
          );
          if (!brandEnabled || !brandEnabled.checked) return;
          selected++;
          const state = getState(Number(bi), Number(fi));
          if (state === "watermarked" || state === "sent") watermarked++;
          if (state === "sent") sent++;
        });

        animateCounter(document.getElementById("brandCount"), brandsActive);
        const totalFiles = totalBrandFiles();
        if (totalFiles !== prevCounts.files)
          animateCounter(document.getElementById("fileCount"), totalFiles);
        if (selected !== prevCounts.selected)
          animateCounter(document.getElementById("selectedCount"), selected);
        if (watermarked !== prevCounts.watermarked)
          animateCounter(document.getElementById("watermarkedCount"), watermarked);
        if (sent !== prevCounts.sent)
          animateCounter(document.getElementById("sentCount"), sent);

        const ccMembers = ccListForCurrentRep().length;
        const ccEl = document.getElementById("ccCount");
        if (ccEl) animateCounter(ccEl, ccMembers);

        prevCounts = {
          files: totalFiles,
          selected,
          watermarked,
          sent,
        };

        const canWatermark = brands.some((_, bi) => {
          const enabled = document.querySelector(
            `.brand-enabled[data-brand="${bi}"]`,
          );
          return (
            enabled?.checked &&
            brandHasFiles(bi) &&
            selectedFundersForBrand(bi).length > 0
          );
        });

        document.getElementById("watermarkAllBtn").disabled = !canWatermark;

        brands.forEach((_, bi) => {
          const wmBtn = document.querySelector(
            `.btn-watermark-brand[data-brand="${bi}"]`,
          );
          const sendBtn = document.querySelector(
            `.btn-send-brand[data-brand="${bi}"]`,
          );
          const enabled = document.querySelector(
            `.brand-enabled[data-brand="${bi}"]`,
          );
          const brandSelected = selectedFundersForBrand(bi).length;
          const hasFiles = brandHasFiles(bi);
          if (wmBtn) {
            wmBtn.disabled =
              !hasFiles || !enabled?.checked || brandSelected === 0;
          }
          if (sendBtn) {
            const hasWatermarked = selectedFundersForBrand(bi).some(
              (fi) => getState(bi, fi) === "watermarked",
            );
            sendBtn.disabled = !hasWatermarked;
          }
        });

        const sendAllReady = countSendable() > 0;
        document.getElementById("sendAllBtn").disabled = !sendAllReady;

        updateWorkflow();
      }

      function countSendable() {
        let count = 0;
        brands.forEach((_, bi) => {
          const enabled = document.querySelector(
            `.brand-enabled[data-brand="${bi}"]`,
          );
          if (!enabled || !enabled.checked) return;
          selectedFundersForBrand(bi).forEach((fi) => {
            if (getState(bi, fi) === "watermarked") count++;
          });
        });
        return count;
      }

      function toggleFunders(brandIndex) {
        const checks = Array.from(
          document.querySelectorAll(
            `.funder-check[data-brand="${brandIndex}"]`,
          ),
        );
        const shouldCheck = checks.some((c) => !c.checked);
        checks.forEach((c) => {
          c.checked = shouldCheck;
          const fi = Number(c.dataset.funder);
          if (!shouldCheck && getState(brandIndex, fi) !== "sent") {
            setState(brandIndex, fi, "ready");
          }
        });
        updateBrandProgress(brandIndex);
        updateCounts();
      }

      function selectedFundersForBrand(brandIndex) {
        return Array.from(
          document.querySelectorAll(
            `.funder-check[data-brand="${brandIndex}"]:checked`,
          ),
        ).map((check) => Number(check.dataset.funder));
      }

      function brandNotes(brandIndex) {
        const el = document.querySelector(
          `.brand-notes[data-brand="${brandIndex}"]`,
        );
        return el ? el.value.trim() : "";
      }

      function emailBody(brandIndex) {
        const notes = brandNotes(brandIndex);
        return notes ? `Please Underwrite\n\n${notes}` : "Please Underwrite";
      }

      function attachmentsFor(brandIndex, funderIndex) {
        const brand = brands[brandIndex];
        const funder = funders[funderIndex];
        return [
          `${cleanFileName(brand.name)}_${cleanFileName(funder.name)}_${cleanFileName(dealName())}_Watermarked.pdf`,
          `${cleanFileName(brand.name)}_${cleanFileName(dealName())}_Application.pdf`,
        ];
      }

      /* ── Aquamark simulation ── */
      async function watermarkFunder(brandIndex, funderIndex) {
        const brand = brands[brandIndex];
        const funder = funders[funderIndex];
        const state = getState(brandIndex, funderIndex);

        if (state === "processing" || state === "sent") return false;

        setState(brandIndex, funderIndex, "processing");

        await delay(1200 + Math.random() * 800);

        setState(brandIndex, funderIndex, "watermarked");

        addAudit(
          brand.name,
          "Aquamark complete",
          `${funder.name}: PDF watermarked & flattened — ${cleanFileName(brand.name)}_${cleanFileName(funder.name)}_${cleanFileName(dealName())}_Watermarked.pdf`,
        );

        return true;
      }

      async function watermarkBrand(brandIndex) {
        const brand = brands[brandIndex];
        const enabled = document.querySelector(
          `.brand-enabled[data-brand="${brandIndex}"]`,
        ).checked;
        const selected = selectedFundersForBrand(brandIndex);
        const wmBtn = document.querySelector(
          `.btn-watermark-brand[data-brand="${brandIndex}"]`,
        );

        if (!enabled) {
          showToast(`${brand.name} is disabled.`, "error");
          return;
        }

        if (!brandHasFiles(brandIndex)) {
          showToast(`Upload files for ${brand.name} before watermarking.`, "error");
          addAudit(brand.name, "Watermark skipped", "No files uploaded for this brand.");
          return;
        }

        if (!selected.length) {
          showToast("Select at least one funder.", "error");
          addAudit(brand.name, "Watermark skipped", "No funders selected.");
          return;
        }

        if (wmBtn) {
          wmBtn.disabled = true;
          wmBtn.textContent = "Processing…";
        }

        addAudit(
          brand.name,
          "Aquamark started",
          `Processing ${selected.length} funder package(s) via Aquamark…`,
        );

        for (const fi of selected) {
          if (getState(brandIndex, fi) !== "sent") {
            await watermarkFunder(brandIndex, fi);
          }
        }

        if (wmBtn) {
          wmBtn.textContent = "Aquamark + Flatten";
        }
        updateCounts();

        showToast(
          `${brand.name}: ${selected.length} package(s) watermarked & flattened.`,
          "success",
        );
      }

      async function watermarkAll() {
        const brandsWithWork = brands.filter((_, bi) => {
          const enabled = document.querySelector(
            `.brand-enabled[data-brand="${bi}"]`,
          );
          return enabled?.checked && brandHasFiles(bi) && selectedFundersForBrand(bi).length > 0;
        });

        if (!brandsWithWork.length) {
          showToast("Upload files per brand and select funders first.", "error");
          return;
        }

        const btn = document.getElementById("watermarkAllBtn");
        btn.disabled = true;
        btn.textContent = "Processing…";

        let total = 0;
        for (let bi = 0; bi < brands.length; bi++) {
          const enabled = document.querySelector(
            `.brand-enabled[data-brand="${bi}"]`,
          );
          if (!enabled || !enabled.checked) continue;
          const selected = selectedFundersForBrand(bi);
          for (const fi of selected) {
            if (getState(bi, fi) !== "sent") {
              await watermarkFunder(bi, fi);
              total++;
            }
          }
        }

        btn.textContent = "Aquamark All Selected";
        updateCounts();

        if (!total) {
          showToast("No funders selected across active brands.", "error");
          return;
        }

        showToast(`Aquamark complete — ${total} package(s) ready.`, "success");
        addAudit(
          "All Brands",
          "Batch watermark",
          `${total} funder-specific packages watermarked & flattened.`,
        );
      }

      function previewBrand(brandIndex) {
        const brand = brands[brandIndex];
        const selected = selectedFundersForBrand(brandIndex);

        if (!brandHasFiles(brandIndex)) {
          showToast(`Upload files for ${brand.name} first.`, "error");
          return;
        }

        if (!selected.length) {
          addAudit(brand.name, "Preview skipped", "No funders selected.");
          showToast("Select funders to preview.", "error");
          return;
        }

        const names = selected.map((fi) => funders[fi].name).join(", ");
        const attachExample = attachmentsFor(brandIndex, selected[0]);
        addAudit(
          brand.name,
          "Queue preview",
          `${selected.length} submission(s) to ${names}. From: ${brand.email}. Subject: ${subjectLine()}. Attachments: ${attachExample.join(", ")}.`,
        );
        showToast(`Queue preview ready for ${brand.name}.`, "success");
      }

      /* ── Email modal ── */
      function openBrandSendModal(brandIndex) {
        const brand = brands[brandIndex];
        const ready = selectedFundersForBrand(brandIndex).filter(
          (fi) => getState(brandIndex, fi) === "watermarked",
        );

        if (!ready.length) {
          showToast("Watermark packages before sending.", "error");
          return;
        }

        if (ready.length === 1) {
          openSendModal(brandIndex, ready[0]);
        } else {
          openSendModal(brandIndex, ready[0], ready);
        }
      }

      function openSendAllModal() {
        if (!selectedRepKey) {
          showToast("Select a submitting rep first — their team will be CC'd.", "error");
          document.getElementById("submittedBy").focus();
          updateRepHint();
          return;
        }

        const queue = [];
        brands.forEach((brand, bi) => {
          const enabled = document.querySelector(
            `.brand-enabled[data-brand="${bi}"]`,
          );
          if (!enabled || !enabled.checked) return;
          selectedFundersForBrand(bi).forEach((fi) => {
            if (getState(bi, fi) === "watermarked") {
              queue.push({ bi, fi });
            }
          });
        });

        if (!queue.length) return;

        pendingSend = { type: "batch", queue };
        const brandEmails = [...new Set(queue.map((q) => brands[q.bi].email))];

        document.getElementById("modalTitle").textContent =
          `Send ${queue.length} Email(s)`;
        document.getElementById("modalFrom").textContent =
          brandEmails.length > 1 ? brandEmails.join(" · ") : brandEmails[0];
        document.getElementById("modalTo").textContent = queue
          .map(
            (q) =>
              `${brands[q.bi].name} → ${funders[q.fi].name} <${funders[q.fi].email}>`,
          )
          .join("\n");
        document.getElementById("modalSubject").textContent = subjectLine();
        document.getElementById("modalBody").textContent =
          "Please Underwrite (per-brand notes included where set)";
        document.getElementById("modalCc").textContent = ccDisplayString();
        document.getElementById("modalAttachments").innerHTML = queue
          .map((q) => {
            const b = brands[q.bi];
            const f = funders[q.fi];
            return `<div class="attachment-item">${b.name} → ${f.name}: ${attachmentsFor(q.bi, q.fi).join(", ")}</div>`;
          })
          .join("");

        openEmailModal();
      }

      function openSendModal(brandIndex, funderIndex, batchIndices) {
        if (!selectedRepKey) {
          showToast("Select a submitting rep first — their team will be CC'd.", "error");
          document.getElementById("submittedBy").focus();
          updateRepHint();
          return;
        }

        const brand = brands[brandIndex];
        const funder = funders[funderIndex];
        const isBatch = batchIndices && batchIndices.length > 1;

        pendingSend = isBatch
          ? {
              type: "brand-batch",
              brandIndex,
              queue: batchIndices.map((fi) => ({ bi: brandIndex, fi })),
            }
          : { type: "single", brandIndex, funderIndex };

        document.getElementById("modalTitle").textContent = isBatch
          ? `Send ${batchIndices.length} Emails — ${brand.name}`
          : `Email Preview — ${brand.name}`;

        document.getElementById("modalFrom").textContent = brand.email;

        if (isBatch) {
          document.getElementById("modalTo").textContent = batchIndices
            .map((fi) => `${funders[fi].name} <${funders[fi].email}>`)
            .join(", ");
        } else {
          document.getElementById("modalTo").textContent =
            `${funder.name} <${funder.email}>`;
        }

        document.getElementById("modalSubject").textContent = subjectLine();
        document.getElementById("modalBody").textContent =
          emailBody(brandIndex);
        document.getElementById("modalCc").textContent = ccDisplayString();

        const attachRoot = document.getElementById("modalAttachments");
        if (isBatch) {
          attachRoot.innerHTML = batchIndices
            .map(
              (fi) => `
            <div class="attachment-item">${funders[fi].name}: ${attachmentsFor(brandIndex, fi).join(", ")}</div>
          `,
            )
            .join("");
        } else {
          attachRoot.innerHTML = attachmentsFor(brandIndex, funderIndex)
            .map((a) => `<div class="attachment-item">${a}</div>`)
            .join("");
        }

        openEmailModal();
      }

      function closeEmailModal() {
        const overlay = document.getElementById("emailModal");
        overlay.classList.add("closing");
        setTimeout(() => {
          overlay.classList.add("hidden");
          overlay.classList.remove("closing");
          pendingSend = null;
        }, 200);
      }

      function openEmailModal() {
        const overlay = document.getElementById("emailModal");
        overlay.classList.remove("hidden", "closing");
      }

      function closeModalOnOverlay(e) {
        if (e.target.id === "emailModal") closeEmailModal();
      }

      async function confirmSend() {
        if (!pendingSend) return;

        const btn = document.getElementById("modalSendBtn");
        btn.disabled = true;
        btn.textContent = "Sending…";

        await delay(1500);

        if (pendingSend.type === "single") {
          sendSingle(pendingSend.brandIndex, pendingSend.funderIndex);
        } else {
          pendingSend.queue.forEach(({ bi, fi }) => sendSingle(bi, fi, true));
          addAudit(
            "All Brands",
            "Batch emails sent",
            `${pendingSend.queue.length} email(s) sent successfully.`,
          );
          showToast(
            `${pendingSend.queue.length} email(s) sent successfully.`,
            "success",
          );
        }

        btn.disabled = false;
        btn.textContent = "Send Email";
        closeEmailModal();
        updateCounts();
      }

      function sendSingle(brandIndex, funderIndex, silent) {
        const brand = brands[brandIndex];
        const funder = funders[funderIndex];

        setState(brandIndex, funderIndex, "sent");

        addAudit(
          brand.name,
          "Email sent",
          `To ${funder.name} (${funder.email}) from ${brand.email}. CC: ${ccDisplayString()}. Attachments: watermarked PDF + ${brand.app}.`,
        );

        if (!silent) {
          showToast(`Email sent to ${funder.name} from ${brand.name}.`, "success");
          const btn = document.querySelector(`[data-send="${brandIndex}_${funderIndex}"]`);
          if (btn) {
            const rect = btn.getBoundingClientRect();
            spawnConfetti(rect.left + rect.width / 2, rect.top);
          }
        }
      }

      /* ── Audit & toast ── */
      function addAudit(brand, action, details) {
        const root = document.getElementById("auditRows");
        const now = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        const pillClass = getAuditPillClass(action);
        const tr = document.createElement("tr");
        tr.innerHTML = `
        <td>${now}</td>
        <td>${brand}</td>
        <td><span class="audit-action-pill ${pillClass}">${action}</span></td>
        <td>${details}</td>
      `;
        root.prepend(tr);
      }

      function getAuditPillClass(action) {
        const a = action.toLowerCase();
        if (a.includes("sent") || a.includes("email")) return "sent";
        if (a.includes("aquamark") || a.includes("watermark")) return "watermark";
        if (a.includes("upload") || a.includes("file") || a.includes("demo")) return "upload";
        if (a.includes("sign") || a.includes("login") || a.includes("opened")) return "login";
        return "";
      }

      function initDefaultRep() {
        loadConfig();
        const maxRep = allReps().find((r) => r.name === "Max Morris");
        if (maxRep && !selectedRepKey) {
          selectedRepKey = maxRep.key;
          const select = document.getElementById("submittedBy");
          if (select) select.value = maxRep.key;
          updateCcPreview();
          updateRepHint();
        }
      }

      document.querySelectorAll(".quick-nav-link").forEach((link) => {
        link.addEventListener("click", (e) => {
          const id = link.getAttribute("href")?.slice(1);
          const target = id && document.getElementById(id);
          if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      });

      /* ── Init ── */
      if (document.getElementById("portalPage")) {
      initRipple();
      loadConfig();
      initFunderStates();
      renderBrandNav();
      renderBrands();
      syncSubjects();
      checkSession();
      if (!document.getElementById("portalPage").classList.contains("hidden")) {
        renderSiteNav("submit");
        renderRepSelect();
        initDefaultRep();
        updateCcPreview();
        updateRepHint();
        updateWorkflow();
        initScrollProgress();
      }

      window.addEventListener("focus", () => {
        if (document.getElementById("portalPage")?.classList.contains("hidden")) return;
        loadConfig();
        renderRepSelect();
        renderBrandNav();
        renderBrands();
        updateCcPreview();
        updateCounts();
      });
      }