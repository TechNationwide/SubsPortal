const API = "";
const MAX_FILES = 15;

// file registry: { id, file, status, jobId, result }
let fileRegistry = [];
let selectedPreset = "balanced";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0))} ${sizes[i]}`;
}

function showToast(msg, type = "default") {
  const toast = $("#toast");
  toast.textContent = msg;
  toast.classList.remove("error", "success");
  if (type === "error")   toast.classList.add("error");
  if (type === "success") toast.classList.add("success");
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

// ── Health check ─────────────────────────────────────────
async function checkHealth() {
  const pill = $("#healthStatus");
  try {
    const res = await fetch(`${API}/api/health`);
    const data = await res.json();
    pill.classList.add("ok");
    const gs = data.ghostscript_available ? " · GS ready" : "";
    pill.innerHTML = `<span class="status-dot"></span><span>Online${gs}</span>`;
  } catch {
    pill.innerHTML = `<span class="status-dot"></span><span>Offline</span>`;
  }
}

// ── File management ───────────────────────────────────────
function addFiles(newFiles) {
  const pdfs = Array.from(newFiles).filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  const nonPdfs = newFiles.length - pdfs.length;

  if (nonPdfs > 0) showToast(`${nonPdfs} non-PDF file(s) skipped`, "error");

  const remaining = MAX_FILES - fileRegistry.length;
  if (pdfs.length > remaining) {
    showToast(`Max ${MAX_FILES} files. Only added first ${remaining}.`, "error");
  }

  const toAdd = pdfs.slice(0, remaining);
  toAdd.forEach(f => {
    fileRegistry.push({ id: uid(), file: f, status: "pending", jobId: null, result: null });
  });

  renderQueue();
  syncCompressBtn();
}

function removeFile(id) {
  fileRegistry = fileRegistry.filter(f => f.id !== id);
  renderQueue();
  syncCompressBtn();
  if (fileRegistry.length === 0) {
    $("#fileQueue").classList.add("hidden");
    $("#uploadZoneWrap") && $("#uploadZoneWrap").classList.remove("hidden");
  }
}

function clearAll() {
  fileRegistry = [];
  renderQueue();
  syncCompressBtn();
  $("#fileQueue").classList.add("hidden");
}

// ── Render queue list ─────────────────────────────────────
function renderQueue() {
  const list = $("#queueList");
  const queue = $("#fileQueue");

  if (fileRegistry.length === 0) {
    queue.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  queue.classList.remove("hidden");

  // header counts
  const totalBytes = fileRegistry.reduce((s, f) => s + f.file.size, 0);
  $("#queueCount").textContent = `${fileRegistry.length} file${fileRegistry.length !== 1 ? "s" : ""}`;
  $("#queueSize").textContent = `· ${formatBytes(totalBytes)} total`;

  // rebuild only items that changed
  const existing = new Set(Array.from(list.querySelectorAll(".queue-item")).map(el => el.dataset.id));
  const current  = new Set(fileRegistry.map(f => f.id));

  // remove deleted
  list.querySelectorAll(".queue-item").forEach(el => {
    if (!current.has(el.dataset.id)) el.remove();
  });

  // add / update
  fileRegistry.forEach((entry, idx) => {
    let el = list.querySelector(`.queue-item[data-id="${entry.id}"]`);
    if (!el) {
      el = buildQueueItem(entry);
      list.appendChild(el);
    } else {
      updateQueueItem(el, entry);
    }
  });
}

function buildQueueItem(entry) {
  const el = document.createElement("div");
  el.className = `queue-item ${entry.status}`;
  el.dataset.id = entry.id;
  el.innerHTML = queueItemHTML(entry);
  el.querySelector(".qi-delete")?.addEventListener("click", () => removeFile(entry.id));
  el.querySelector(".qi-download")?.addEventListener("click", () => downloadJob(entry.jobId, entry.file.name));
  return el;
}

function updateQueueItem(el, entry) {
  el.className = `queue-item ${entry.status}`;
  el.innerHTML = queueItemHTML(entry);
  el.querySelector(".qi-delete")?.addEventListener("click", () => removeFile(entry.id));
  el.querySelector(".qi-download")?.addEventListener("click", () => downloadJob(entry.jobId, entry.file.name));
}

function queueItemHTML(entry) {
  const { file, status, result } = entry;

  const iconLabel = status === "done" ? "✓" : status === "error" ? "✕" : "PDF";

  let statusHTML = "";
  if (status === "pending") {
    statusHTML = `<span class="qi-status pending">Queued</span>`;
  } else if (status === "compressing") {
    statusHTML = `<span class="qi-status compressing"><span class="qi-spinner"></span> Compressing…</span>`;
  } else if (status === "done" && result) {
    statusHTML = `
      <span class="qi-status done">−${result.reduction_percent}%</span>
      <button class="qi-download" title="Download compressed file">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M3 19h18"/>
        </svg>
      </button>`;
  } else if (status === "error") {
    statusHTML = `<span class="qi-status error">Failed</span>`;
  }

  const metaRight = result
    ? `<span>${formatBytes(result.original_bytes)}</span><span style="color:var(--yellow)">→</span><span style="color:var(--success)">${formatBytes(result.compressed_bytes)}</span>`
    : `<span>${formatBytes(file.size)}</span>`;

  const deleteBtn = status === "pending"
    ? `<button class="qi-delete" title="Remove">✕</button>`
    : "";

  return `
    <div class="qi-icon">${iconLabel}</div>
    <div class="qi-info">
      <div class="qi-name">${file.name}</div>
      <div class="qi-meta">${metaRight}</div>
    </div>
    ${statusHTML}
    ${deleteBtn}
  `;
}

// ── Compress button state ─────────────────────────────────
function syncCompressBtn() {
  const btn = $("#compressBtn");
  const pending = fileRegistry.filter(f => f.status === "pending").length;
  btn.disabled = pending === 0;
  const label = btn.querySelector(".btn-label");
  label.textContent = pending === 0
    ? "Compress Files"
    : `Compress ${pending} File${pending !== 1 ? "s" : ""}`;
}

// ── Compress all pending files ────────────────────────────
async function compressAll() {
  const pending = fileRegistry.filter(f => f.status === "pending");
  if (pending.length === 0) return;

  setGlobalLoading(true);
  $("#resultsCard").classList.add("hidden");

  // mark all as compressing
  pending.forEach(entry => { entry.status = "compressing"; });
  renderQueue();

  // compress in parallel
  await Promise.all(pending.map(entry => compressOne(entry)));

  setGlobalLoading(false);
  showResults();
}

async function compressOne(entry) {
  const form = new FormData();
  form.append("file", entry.file);
  form.append("preset", selectedPreset);

  try {
    const res  = await fetch(`${API}/api/compress`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Compression failed");

    entry.status = "done";
    entry.jobId  = data.job_id;
    entry.result = data;
  } catch (err) {
    entry.status = "error";
    entry.error  = err.message;
  }

  renderQueue();
}

// ── Download helpers ──────────────────────────────────────
async function downloadJob(jobId, originalName) {
  const a = document.createElement("a");
  a.href = `${API}/api/download/${jobId}`;
  a.download = `${originalName.replace(/\.pdf$/i, "")}_compressed.pdf`;
  a.click();
}

async function downloadAll() {
  const jobIds = fileRegistry.filter(f => f.status === "done" && f.jobId).map(f => f.jobId);
  if (jobIds.length === 0) return;

  const res = await fetch(`${API}/api/batch-download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jobIds),
  });

  if (!res.ok) { showToast("Batch download failed", "error"); return; }

  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "keith_compressed.zip"; a.click();
  URL.revokeObjectURL(url);
}

// ── Show results section ──────────────────────────────────
function showResults() {
  const done    = fileRegistry.filter(f => f.status === "done");
  const failed  = fileRegistry.filter(f => f.status === "error");
  const card    = $("#resultsCard");
  const list    = $("#resultsList");

  if (done.length === 0 && failed.length === 0) return;

  // summary line
  const totalOrig = done.reduce((s, f) => s + f.result.original_bytes, 0);
  const totalComp = done.reduce((s, f) => s + f.result.compressed_bytes, 0);
  const pct = totalOrig > 0 ? Math.round((1 - totalComp / totalOrig) * 100) : 0;

  const summaryEl = $("#resultsSummary");
  if (done.length > 0) {
    summaryEl.innerHTML = `${formatBytes(totalOrig)} → <span>${formatBytes(totalComp)}</span> · <span>${pct}% smaller</span>`;
  } else {
    summaryEl.textContent = `${failed.length} file(s) failed`;
  }

  // show / hide download all
  const dlAll = $("#downloadAllBtn");
  if (done.length > 1) dlAll.classList.remove("hidden");
  else dlAll.classList.add("hidden");

  // build result rows
  list.innerHTML = "";
  fileRegistry.forEach(entry => {
    if (entry.status !== "done" && entry.status !== "error") return;
    const row = buildResultRow(entry);
    list.appendChild(row);
  });

  card.classList.remove("hidden");
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });

  if (done.length > 0) showToast(`${done.length} file${done.length !== 1 ? "s" : ""} compressed successfully!`, "success");
  if (failed.length > 0) showToast(`${failed.length} file(s) failed`, "error");
}

function buildResultRow(entry) {
  const row = document.createElement("div");
  row.className = `result-row${entry.status === "error" ? " error" : ""}`;

  if (entry.status === "done" && entry.result) {
    const r = entry.result;
    row.innerHTML = `
      <div class="rr-icon">PDF</div>
      <div class="rr-info">
        <div class="rr-name">${entry.file.name}</div>
        <div class="rr-sizes">
          <span>${formatBytes(r.original_bytes)}</span>
          <span class="rr-arrow">→</span>
          <span class="rr-after">${formatBytes(r.compressed_bytes)}</span>
          <span style="color:var(--text-dim)">· ${r.page_count} page${r.page_count !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <span class="rr-badge">−${r.reduction_percent}%</span>
      <button class="rr-dl" title="Download">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M3 19h18"/>
        </svg>
      </button>`;
    row.querySelector(".rr-dl").addEventListener("click", () => downloadJob(entry.jobId, entry.file.name));
  } else {
    row.innerHTML = `
      <div class="rr-icon">!</div>
      <div class="rr-info">
        <div class="rr-name">${entry.file.name}</div>
        <div class="rr-sizes" style="color:var(--danger)">${entry.error || "Compression failed"}</div>
      </div>
      <span class="rr-badge">Error</span>`;
  }

  return row;
}

// ── Global loading state ──────────────────────────────────
function setGlobalLoading(loading) {
  const btn = $("#compressBtn");
  btn.disabled = loading;
  btn.querySelector(".btn-label").textContent = loading ? "Compressing…" : "Compress Files";
  btn.querySelector(".btn-spinner").classList.toggle("hidden", !loading);
  btn.querySelector("svg")?.classList.toggle("hidden", loading);
}

// ── Event listeners ───────────────────────────────────────
$("#browseBtn").addEventListener("click", e => { e.stopPropagation(); $("#fileInput").click(); });
$("#addMoreBtn").addEventListener("click", () => $("#fileInput").click());

$("#fileInput").addEventListener("change", e => {
  if (e.target.files.length) addFiles(e.target.files);
  e.target.value = "";
});

const dropZone = $("#dropZone");
dropZone.addEventListener("click", () => $("#fileInput").click());
dropZone.addEventListener("dragover",  e => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

$("#clearAllBtn").addEventListener("click", clearAll);
$("#compressBtn").addEventListener("click", compressAll);
$("#downloadAllBtn").addEventListener("click", downloadAll);

$("#newJobBtn").addEventListener("click", () => {
  fileRegistry = [];
  renderQueue();
  syncCompressBtn();
  $("#resultsCard").classList.add("hidden");
  $("#fileQueue").classList.add("hidden");
  dropZone.scrollIntoView({ behavior: "smooth" });
});

$$(".preset-card").forEach(card => {
  card.addEventListener("click", () => {
    $$(".preset-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    selectedPreset = card.dataset.preset;
  });
});

checkHealth();
