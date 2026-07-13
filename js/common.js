/**
 * Shared UI — auth, navigation, toasts, utilities.
 */
function showToast(message, type) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast${type ? " " + type : ""}`;
  const icon = type === "success" ? "✓" : type === "error" ? "!" : "•";
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function getInitials(name) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function cleanFileName(value) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logout() {
  Store.clearSession();
  window.location.href = "index.html";
}

function requireAuth() {
  const session = Store.getSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }
  const el = document.getElementById("userDisplay");
  if (el) el.textContent = session.email;
  return session;
}

function renderSiteNav(activePage) {
  const nav = document.getElementById("siteNav");
  if (!nav) return;
  const pages = [
    { id: "submit", label: "Submit Deal", href: "index.html" },
    { id: "aquamark", label: "Aquamark", href: "index-aquamark.html" },
    { id: "teams", label: "Teams", href: "teams.html" },
    { id: "brands", label: "Brands", href: "brands.html" },
    { id: "funders", label: "Funders", href: "funders.html" },
  ];
  nav.innerHTML = pages
    .map(
      (p) =>
        `<a href="${p.href}" class="site-nav-link${p.id === activePage ? " active" : ""}">${p.label}</a>`,
    )
    .join("");
}

function initScrollProgress() {
  const bar = document.getElementById("scrollProgress");
  const quickNav = document.getElementById("portalQuickNav");
  if (!bar) return;
  function onScroll() {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const pct = h > 0 ? (window.scrollY / h) * 100 : 0;
    bar.style.width = pct + "%";
    if (quickNav) {
      quickNav.classList.toggle("is-stuck", window.scrollY > 120);
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function initRipple() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn");
    if (!btn || btn.disabled) return;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + "px";
    ripple.style.left = e.clientX - rect.left - size / 2 + "px";
    ripple.style.top = e.clientY - rect.top - size / 2 + "px";
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
}

function initSetupPage(pageId, title, subtitle) {
  requireAuth();
  renderSiteNav(pageId);
  initRipple();
  initScrollProgress();
  const titleEl = document.getElementById("pageTitle");
  const subEl = document.getElementById("pageSubtitle");
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && typeof closeEmailModal === "function") {
    closeEmailModal();
  }
});
