/**
 * Shared data store — persists config across main portal and setup pages.
 */
const Store = {
  KEYS: {
    SESSION: "submission_portal_session",
    BRANDS: "portal_brands",
    FUNDERS: "portal_funders",
    TEAMS: "portal_teams",
    BRAND_WATERMARKS_LEGACY: "portal_brand_watermarks",
  },

  defaultBrands() {
    return [
      {
        name: "Nationwide",
        email: "deals@nationwideadvance.com",
        app: "Nationwide Application",
        accent: "#4f46e5",
      },
      {
        name: "Ontrack",
        email: "submissions@ontrackfunding.com",
        app: "Ontrack Application",
        accent: "#059669",
      },
      {
        name: "Funding Tech",
        email: "submissions@fundingtech.com",
        app: "Funding Tech Application",
        accent: "#7c3aed",
      },
      {
        name: "Zsales",
        email: "submissions@zsalesfunding.com",
        app: "Zsales Application",
        accent: "#ea580c",
      },
      {
        name: "AJ Nationwide",
        email: "deals@ajnationwideconsulting.com",
        app: "AJ Nationwide Application",
        accent: "#0284c7",
      },
    ];
  },

  defaultFunders() {
    return [
      {
        name: "Forward Funding Capital",
        email: "submissions@forwardfunding.com",
        brands: [0, 1, 2],
      },
      {
        name: "Rapid Merchant Group",
        email: "deals@rapidmerchant.com",
        brands: [0, 1, 3],
      },
      {
        name: "BlueLine Capital",
        email: "underwriting@bluelinecapital.com",
        brands: [0, 2, 4],
      },
      {
        name: "Evergreen MCA",
        email: "deals@evergreenmca.com",
        brands: [1, 2, 3],
      },
      {
        name: "Summit Advance",
        email: "submissions@summitadvance.com",
        brands: [0, 1, 2, 3, 4],
      },
      {
        name: "NorthBridge Funding",
        email: "deals@northbridgefunding.com",
        brands: [2, 3, 4],
      },
    ];
  },

  defaultTeams() {
    return [
      {
        id: "max-team",
        name: "Max's Team",
        lead: "Max Morris",
        members: [
          { name: "Max Morris", email: "max@company.com" },
          { name: "Morris", email: "morris@company.com" },
          { name: "Abe", email: "abe@company.com" },
          { name: "Kevin", email: "kevin@company.com" },
        ],
      },
      {
        id: "sarah-team",
        name: "Sarah's Team",
        lead: "Sarah Chen",
        members: [
          { name: "Sarah Chen", email: "sarah@company.com" },
          { name: "James", email: "james@company.com" },
          { name: "Lisa", email: "lisa@company.com" },
        ],
      },
      {
        id: "david-team",
        name: "David's Team",
        lead: "David Park",
        members: [
          { name: "David Park", email: "david@company.com" },
          { name: "Rachel", email: "rachel@company.com" },
          { name: "Tom", email: "tom@company.com" },
          { name: "Nina", email: "nina@company.com" },
        ],
      },
    ];
  },

  getBrands() {
    const brands = this._read(this.KEYS.BRANDS, this.defaultBrands());
    return this._mergeLegacyBrandLogos(brands);
  },

  saveBrands(brands) {
    this._write(this.KEYS.BRANDS, brands);
  },

  _mergeLegacyBrandLogos(brands) {
    try {
      const raw = localStorage.getItem(this.KEYS.BRAND_WATERMARKS_LEGACY);
      if (!raw) return brands;
      const legacy = JSON.parse(raw);
      brands.forEach((brand, index) => {
        if (!brand.logo && legacy[index]) {
          brand.logo = legacy[index];
        }
      });
    } catch {
      /* ignore corrupt legacy data */
    }
    return brands;
  },

  removeBrandLogo(brandIndex) {
    const brands = this.getBrands();
    if (brands[brandIndex]) {
      brands[brandIndex].logo = null;
      this.saveBrands(brands);
    }
  },

  setBrandLogo(brandIndex, dataUrl) {
    const brands = this.getBrands();
    if (brands[brandIndex]) {
      brands[brandIndex].logo = dataUrl;
      this.saveBrands(brands);
    }
  },

  getFunders() {
    return this._read(this.KEYS.FUNDERS, this.defaultFunders());
  },

  saveFunders(funders) {
    this._write(this.KEYS.FUNDERS, funders);
  },

  getTeams() {
    return this._read(this.KEYS.TEAMS, this.defaultTeams());
  },

  saveTeams(teams) {
    this._write(this.KEYS.TEAMS, teams);
  },

  getSession() {
    const raw = localStorage.getItem(this.KEYS.SESSION);
    return raw ? JSON.parse(raw) : null;
  },

  setSession(email) {
    localStorage.setItem(this.KEYS.SESSION, JSON.stringify({ email }));
  },

  clearSession() {
    localStorage.removeItem(this.KEYS.SESSION);
  },

  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : structuredClone(fallback);
    } catch {
      return structuredClone(fallback);
    }
  },

  _write(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  },
};
