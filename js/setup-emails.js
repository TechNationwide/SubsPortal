let brands = Store.getBrands();

function persistBrands() {
  Store.saveBrands(brands);
  showToast("Email accounts saved.", "success");
}

function renderEmailAccounts() {
  const root = document.getElementById("emailAccountList");
  if (!root) return;
  root.innerHTML = brands
    .map(
      (b, i) => `
    <div class="email-account-row">
      <label>${escapeHtml(b.name)}</label>
      <input type="email" value="${escapeAttr(b.email)}" data-brand-email="${i}" onchange="updateBrandEmail(${i}, this.value)" placeholder="submissions@brand.com">
      <span class="email-status ${b.email ? "ready" : "pending"}">${b.email ? "Address set" : "Needs setup"}</span>
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

function updateBrandEmail(brandIndex, email) {
  brands[brandIndex].email = email.trim();
  persistBrands();
  renderEmailAccounts();
}

initSetupPage(
  "emails",
  "Email Accounts",
  "Configure each brand's sending address. Production will connect OAuth or SMTP credentials here.",
);
brands = Store.getBrands();
renderEmailAccounts();
