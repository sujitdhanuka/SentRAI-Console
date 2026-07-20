// SentRAI Compliance Console — vanilla JS dashboard. No build step required.
const API = "/api/v1";
let MODELS_CACHE = [];
let PROJECTS_CACHE = [];
let ACTIVE_PROJECT_ID = localStorage.getItem("sentrai_active_project_id") || "";
let CURRENT_TAB = "projects";       // the tab currently shown (for context-sensitive help)
let DOCS_MARKDOWN_CACHE = null;     // the help doc, fetched once and reused

// ── Auth state ───────────────────────────────────────────────────────────
let AUTH_TOKEN = localStorage.getItem("sentrai_access_token") || "";
let AUTH_USER = JSON.parse(localStorage.getItem("sentrai_user") || "null");

function _getAuthHeaders() {
  return AUTH_TOKEN
    ? { "Content-Type": "application/json", "Authorization": `Bearer ${AUTH_TOKEN}` }
    : { "Content-Type": "application/json" };
}

function _saveAuth(accessToken, user) {
  AUTH_TOKEN = accessToken;
  AUTH_USER = user;
  localStorage.setItem("sentrai_access_token", accessToken);
  localStorage.setItem("sentrai_user", JSON.stringify(user));
  _syncUserChip();
}

function _clearAuth() {
  AUTH_TOKEN = "";
  AUTH_USER = null;
  localStorage.removeItem("sentrai_access_token");
  localStorage.removeItem("sentrai_user");
  localStorage.removeItem("sentrai_active_project_id");
  ACTIVE_PROJECT_ID = "";
  _syncUserChip();
}

function _syncUserChip() {
  const chip = document.getElementById("user-chip");
  if (!chip) return;
  if (AUTH_USER) {
    chip.style.display = "flex";
    const initials = (AUTH_USER.full_name || AUTH_USER.email || "U")
      .split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const avatar = document.getElementById("user-avatar");
    const nameEl = document.getElementById("user-display-name");
    const roleEl = document.getElementById("user-display-role");
    if (avatar) avatar.textContent = initials;
    if (nameEl) nameEl.textContent = AUTH_USER.full_name || AUTH_USER.email;
    if (roleEl) roleEl.textContent = AUTH_USER.role || "VIEWER";
  } else {
    chip.style.display = "none";
  }
}

function logout() {
  _clearAuth();
  showAuthOverlay();
  toast("Signed out successfully", "info");
}

function showAuthOverlay() {
  const overlay = document.getElementById("auth-overlay");
  if (overlay) overlay.style.display = "flex";
}

function hideAuthOverlay() {
  const overlay = document.getElementById("auth-overlay");
  if (overlay) {
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 0.4s ease";
    setTimeout(() => { overlay.style.display = "none"; overlay.style.opacity = "1"; }, 400);
  }
}

function showAuthTab(tab) {
  const loginForm = document.getElementById("form-login");
  const regForm = document.getElementById("form-register");
  const loginTab = document.getElementById("tab-login");
  const regTab = document.getElementById("tab-register");
  if (tab === "login") {
    loginForm.style.display = "block";
    regForm.style.display = "none";
    loginTab.style.background = "rgba(99,102,241,0.85)";
    loginTab.style.color = "#fff";
    regTab.style.background = "transparent";
    regTab.style.color = "#94a3b8";
  } else {
    loginForm.style.display = "none";
    regForm.style.display = "block";
    regTab.style.background = "rgba(99,102,241,0.85)";
    regTab.style.color = "#fff";
    loginTab.style.background = "transparent";
    loginTab.style.color = "#94a3b8";
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById("btn-login-submit");
  const errEl = document.getElementById("login-error");
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  btn.textContent = "Signing in…";
  btn.disabled = true;
  errEl.style.display = "none";
  try {
    const body = new URLSearchParams({ username: email, password });
    const res = await fetch(`${API}/auth/token`, { method: "POST", body });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 120)); }
    if (!res.ok) throw new Error(data.detail || "Login failed");
    // Fetch user profile
    const meRes = await fetch(`${API}/auth/me`, {
      headers: { "Authorization": `Bearer ${data.access_token}` }
    });
    const user = await meRes.json();
    _saveAuth(data.access_token, user);
    hideAuthOverlay();
    toast(`Welcome back, ${user.full_name || user.email}! 👋`, "info");
    initDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = "block";
  } finally {
    btn.textContent = "Sign In →";
    btn.disabled = false;
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById("btn-reg-submit");
  const errEl = document.getElementById("reg-error");
  // Role is never chosen at signup — the server always creates a Viewer.
  const payload = {
    full_name: document.getElementById("reg-name").value,
    email: document.getElementById("reg-email").value,
    password: document.getElementById("reg-password").value,
  };
  btn.textContent = "Creating account…";
  btn.disabled = true;
  errEl.style.display = "none";
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Server error: ${text.slice(0, 120)}`); }
    if (!res.ok) throw new Error(data.detail || "Registration failed");
    toast("Account created! Please sign in.", "info");
    showAuthTab("login");
    document.getElementById("login-email").value = payload.email;
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = "block";
  } finally {
    btn.textContent = "Create Account →";
    btn.disabled = false;
  }
}

function setActiveProject(id) {
  ACTIVE_PROJECT_ID = id || "";
  if (ACTIVE_PROJECT_ID) {
    localStorage.setItem("sentrai_active_project_id", ACTIVE_PROJECT_ID);
  } else {
    localStorage.removeItem("sentrai_active_project_id");
  }
  _syncProjectBar();
}

function _syncProjectBar() {
  const bar = document.getElementById("active-project-bar");
  const nameEl = document.getElementById("active-project-name");
  if (!bar) return;
  if (ACTIVE_PROJECT_ID) {
    const proj = PROJECTS_CACHE.find((p) => p.project_id === ACTIVE_PROJECT_ID);
    if (nameEl) nameEl.textContent = proj ? proj.name : ACTIVE_PROJECT_ID.slice(0, 8);
    bar.style.display = "flex";
  } else {
    bar.style.display = "none";
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function projectLabel(projectId) {
  if (!projectId) return "";
  const p = PROJECTS_CACHE.find((pr) => pr.project_id === projectId);
  return p ? `<br/><span class="muted" style="font-size:0.62rem">🗂 ${p.name}</span>` : "";
}

// ── Utilities ────────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { ...(_getAuthHeaders()), ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 401) {
    _clearAuth();
    showAuthOverlay();
    throw new Error("Session expired — please sign in again");
  }
  if (!res.ok) {
    // NestJS errors carry `message` (string, or an array for validation
    // failures); older FastAPI-style errors used `detail`. Surface whichever
    // is present so the real reason is shown instead of a blank message.
    let detail = "";
    if (data && typeof data === "object") {
      if (Array.isArray(data.message)) detail = data.message.join("; ");
      else if (data.message) detail = String(data.message);
      else if (data.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } else if (typeof data === "string" && data) {
      detail = data;
    }
    throw new Error(detail || res.statusText || `Request failed (HTTP ${res.status})`);
  }
  return data;
}

function toast(message, kind = "ok") {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function badge(value, cls) {
  return `<span class="badge ${cls || value}">${value.replace(/_/g, " ")}</span>`;
}

function shortId(id) {
  return id ? id.slice(0, 8) : "";
}

function formToObject(form) {
  const fd = new FormData(form);
  const obj = {};
  for (const [k, v] of fd.entries()) obj[k] = v;
  // checkboxes that aren't checked don't appear in FormData — fill false
  form.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    if (!(cb.name in obj)) obj[cb.name] = false;
    else obj[cb.name] = true;
  });
  return obj;
}

// ── Tab navigation ───────────────────────────────────────────────────────────

function updateTabVisibility(hasActiveProject) {
  document.querySelectorAll(".tab").forEach((tab) => {
    const name = tab.dataset.tab;
    if (name === "users") {
      // Global ADMIN or an org OWNER (who administers their own org's users).
      tab.style.display = (AUTH_USER && (AUTH_USER.role === "ADMIN" || AUTH_USER.role === "OWNER")) ? "" : "none";
    } else if (name === "compliance") {
      // Portfolio-wide executive rollup — always available; it aggregates across
      // every project you can see, and narrows to the active project when one is set.
      tab.style.display = "";
    } else if (name === "ci-ledger") {
      // Org-wide auditor ledger — visible to sign-off / audit roles only.
      tab.style.display = canViewLedger() ? "" : "none";
    } else if (name === "orgs") {
      // Organizations is a global-admin surface (an ADMIN with no tenant).
      // Show it by default — not only after the Users tab has been opened.
      tab.style.display = (AUTH_USER && AUTH_USER.role === "ADMIN" && !AUTH_USER.tenant_id) ? "" : "none";
    } else if (name !== "projects" && name !== "docs") {
      tab.style.display = hasActiveProject ? "" : "none";
    }
  });
  _syncProjectBar();
}

function switchToTab(tabName) {
  CURRENT_TAB = tabName; // remember where we are so "? Help" is context-sensitive
  document.querySelectorAll(".tab").forEach((t) => {
    if (t.dataset.tab === tabName) t.classList.add("active");
    else t.classList.remove("active");
  });
  document.querySelectorAll(".panel").forEach((p) => {
    if (p.id === `panel-${tabName}`) p.classList.add("active");
    else p.classList.remove("active");
  });
  
  if (tabName === "projects") {
    const btnNewProject = document.getElementById("btn-new-project");
    if (btnNewProject) {
      // Any logged-in user can create projects (org membership is optional).
      btnNewProject.style.display = "inline-block";
    }
    loadProjects();
  }
  if (tabName === "overview") loadOverview();
  if (tabName === "compliance") loadCompliance();
  if (tabName === "ci-ledger") loadCiLedger();
  if (tabName === "orgs") loadOrgs();
  if (tabName === "inventory") {
    const btnNewModel = document.getElementById("btn-new-model");
    if (btnNewModel) {
      // Any logged-in user can register models (org membership is optional).
      btnNewModel.style.display = "inline-block";
    }
    loadModels();
  }
  if (tabName === "monitoring") loadModelSelect("drift-model-select");
  if (tabName === "audit") loadModelSelect("audit-model-select");
  if (tabName === "incidents") { loadModelSelect("incident-model-select"); loadIncidents(); loadSectoralStats(); }
  if (tabName === "discover") {
    loadProjectsIntoSelect("discover-project-select").then(() => {
      const select = document.getElementById("discover-project-select");
      if (select) {
        select.value = ACTIVE_PROJECT_ID;
        select.dispatchEvent(new Event("change"));
      }
    });
  }
  if (tabName === "lineage") loadLineageGraph();
  if (tabName === "docs") loadDocs();
  // Users tab: global ADMIN or an org OWNER. Org tab visibility is handled in
  // updateTabVisibility (global admins only), so it isn't gated on this click.
  if (tabName === "users" && AUTH_USER && (AUTH_USER.role === "ADMIN" || AUTH_USER.role === "OWNER")) {
    const tabUsers = document.getElementById("tab-users");
    if (tabUsers) tabUsers.style.display = "inline-block";
    loadUsers();
  }
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  switchToTab(btn.dataset.tab);
});

async function loadDocs() {
  const el = document.getElementById("docs-content");
  try {
    const data = await api("/docs");
    if (data.error) {
      el.innerHTML = `<div class="result-banner bad">Failed to load documentation: ${data.error}</div>`;
    } else {
      el.innerHTML = marked.parse(data.content || "");
    }
  } catch (e) {
    el.innerHTML = `<div class="result-banner bad">Failed to load documentation: ${e.message}</div>`;
  }
}

async function loadLineageGraph() {
  const container = document.getElementById("cy-lineage");
  container.innerHTML = "<div style='color:var(--muted); padding:20px;'>Loading lineage graph…</div>";
  try {
    const models = await api("/inventory/models");
    const projects = await api("/projects");
    
    // Fix loophole #3: never silently mutate ACTIVE_PROJECT_ID
    // If no project is active, show an empty state and exit
    let projectId = ACTIVE_PROJECT_ID;
    if (!projectId) {
      container.innerHTML = "<div style='color:var(--muted); padding:20px;'>No project active. Select &amp; activate a project to view its lineage graph.</div>";
      return;
    }
    
    const elements = [];
    
    const selectedProj = projects.find((p) => p.project_id === projectId);
    if (selectedProj) {
      elements.push({
        data: { id: `proj-${selectedProj.project_id}`, label: selectedProj.name, type: 'project' }
      });
    } else {
      container.innerHTML = "<div style='color:var(--muted); padding:20px;'>No project selected. Please choose a project.</div>";
      return;
    }
    
    models.forEach((m) => {
      if (m.project_id === projectId) {
        elements.push({
          data: { id: `model-${m.model_id}`, label: m.name, type: 'model' }
        });
        elements.push({
          data: { id: `edge-${m.project_id}-${m.model_id}`, source: `proj-${m.project_id}`, target: `model-${m.model_id}` }
        });
        
        if (m.autonomous_scope) {
          const promptId = `prompt-${m.model_id}`;
          elements.push({
            data: { id: promptId, label: `Scope: ${m.autonomous_scope}`, type: 'prompt' }
          });
          elements.push({
            data: { id: `edge-${m.model_id}-${promptId}`, source: `model-${m.model_id}`, target: promptId }
          });
        }
      }
    });
    
    if (elements.length <= 1) {
      // Only project node exists
      container.innerHTML = `<div style='color:var(--muted); padding:20px;'>No models registered for project "${selectedProj.name}".</div>`;
      return;
    }
    
    container.innerHTML = "";
    cytoscape({
      container: container,
      elements: elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#4f46e5',
            'label': 'data(label)',
            'color': '#f8fafc',
            'font-size': '11px',
            'text-valign': 'center',
            'text-halign': 'center',
            'width': '120px',
            'height': '40px',
            'shape': 'round-rectangle',
            'border-width': 1,
            'border-color': '#312e81'
          }
        },
        {
          selector: 'node[type="model"]',
          style: {
            'background-color': '#0d9488',
            'border-color': '#115e59',
            'shape': 'ellipse',
            'width': '90px',
            'height': '90px'
          }
        },
        {
          selector: 'node[type="prompt"]',
          style: {
            'background-color': '#d97706',
            'border-color': '#78350f',
            'shape': 'hexagon',
            'width': '110px',
            'height': '50px'
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#94a3b8',
            'target-arrow-color': '#94a3b8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier'
          }
        }
      ],
      layout: {
        name: 'breadthfirst',
        directed: true,
        padding: 20
      }
    });
  } catch (e) {
    container.innerHTML = `<div class="result-banner bad">Failed to load lineage: ${e.message}</div>`;
  }
}

// ── Health check ─────────────────────────────────────────────────────────────

async function checkHealth() {
  const el = document.getElementById("health-status");
  try {
    const res = await fetch("/health");
    if (res.ok) { el.textContent = "● service healthy"; el.className = "topbar-status ok"; }
    else throw new Error();
  } catch {
    el.textContent = "● service unreachable"; el.className = "topbar-status error";
  }
}

// ── Overview ─────────────────────────────────────────────────────────────────

async function loadOverview() {
  try {
    const data = await api("/sutras");
    const grid = document.getElementById("sutras-grid");
    grid.innerHTML = data.sutras.map((s) => `
      <div class="principle-card">
        <div class="num">PRINCIPLE ${s.id}</div>
        <div class="title">${s.name}</div>
        <div class="desc">${s.principle}</div>
      </div>
    `).join("");
  } catch (e) {
    toast("Failed to load sutras: " + e.message, "error");
  }
  refreshOverviewStats();
}

async function refreshOverviewStats() {
  try {
    const [models, risk] = await Promise.all([
      api("/inventory/models"),
      api("/compliance/incident/sectoral-risk"),
    ]);
    const high = models.filter((m) => ["HIGH", "CRITICAL", "PROHIBITED"].includes(m.risk_level)).length;
    const stats = [
      { label: "Registered Models", value: models.length },
      { label: "High-Risk Models", value: high, cls: high ? "danger" : "success" },
      { label: "Total Incidents", value: risk.total_incidents },
      { label: "Overdue Reports", value: risk.overdue_count, cls: risk.overdue_count ? "danger" : "success" },
      { label: "Active Circuit Breakers", value: risk.circuit_breakers_active, cls: risk.circuit_breakers_active ? "danger" : "success" },
    ];
    document.getElementById("overview-stats").innerHTML = stats.map((s) => `
      <div class="stat-box ${s.cls || ""}"><div class="value">${s.value}</div><div class="label">${s.label}</div></div>
    `).join("");
  } catch (e) {
    document.getElementById("overview-stats").innerHTML = `<div class="empty-state">Stats unavailable — ${e.message}</div>`;
  }
}

// ── Executive Compliance Rollup ───────────────────────────────────────────────

async function loadCompliance() {
  const scope = ACTIVE_PROJECT_ID ? `?project_id=${encodeURIComponent(ACTIVE_PROJECT_ID)}` : "";
  const headlineEl = document.getElementById("compliance-headline");
  const statsEl = document.getElementById("compliance-stats");
  const fwEl = document.getElementById("compliance-frameworks");
  const gapsEl = document.getElementById("compliance-gaps");
  statsEl.innerHTML = `<div class="empty-state">Computing portfolio compliance…</div>`;
  fwEl.innerHTML = ""; gapsEl.innerHTML = "";
  try {
    const p = await api("/compliance/portfolio" + scope);
    const clean = p.summary.open_blocking_gaps === 0 && p.summary.total_models > 0;
    headlineEl.style.display = "block";
    headlineEl.className = "result-banner " + (clean ? "ok" : "bad");
    headlineEl.textContent = p.summary.headline;

    const rate = Math.round(p.summary.compliance_rate * 100);
    const stats = [
      { label: "Models", value: p.summary.total_models },
      { label: "Fully Compliant", value: `${p.summary.fully_compliant} (${rate}%)`, cls: clean ? "success" : "" },
      { label: "High-Risk", value: p.summary.high_risk_models, cls: p.summary.high_risk_models ? "danger" : "success" },
      { label: "Open Blocking Gaps", value: p.summary.open_blocking_gaps, cls: p.summary.open_blocking_gaps ? "danger" : "success" },
    ];
    statsEl.innerHTML = stats.map((s) =>
      `<div class="stat-box ${s.cls || ""}"><div class="value">${s.value}</div><div class="label">${s.label}</div></div>`).join("");

    // Shift-left CI gate signal (folded in from the gate ledger).
    const ci = p.ci_gate || {};
    const readiness = ci.gate_readiness_score == null ? "—" : Math.round(ci.gate_readiness_score * 100) + "%";
    const ciStats = [
      { label: "Gate Readiness", value: readiness, cls: ci.gate_readiness_score == null ? "" : (ci.active_blocked_gates ? "danger" : "success") },
      { label: "Active Blocked Gates", value: ci.active_blocked_gates ?? 0, cls: ci.active_blocked_gates ? "danger" : "success" },
      { label: "Shadow AI Assets", value: ci.shadow_ai_assets ?? 0, cls: ci.shadow_ai_assets ? "danger" : "success" },
      { label: "Gate Events", value: ci.events_recorded ?? 0 },
    ];
    const ciStatsEl = document.getElementById("compliance-ci-stats");
    if (ciStatsEl) ciStatsEl.innerHTML = ciStats.map((s) =>
      `<div class="stat-box ${s.cls || ""}"><div class="value">${s.value}</div><div class="label">${s.label}</div></div>`).join("");

    fwEl.innerHTML = p.frameworks.map((f) => {
      const pct = Math.round(f.pass_rate * 100);
      const ok = f.open_gaps === 0 && f.models_assessed > 0;
      return `<div class="principle-card">
        <div class="num">${pct}% PASS</div>
        <div class="title">${escapeHtml(f.name)}</div>
        <div class="desc">${escapeHtml(f.readiness)}</div>
        <div style="margin-top:10px;"><span class="badge ${ok ? "ok" : "risk-HIGH"}">${f.models_passing}/${f.models_assessed} passing · ${f.open_gaps} gap(s)</span></div>
      </div>`;
    }).join("");

    gapsEl.innerHTML = p.top_gaps.length === 0
      ? `<div class="result-banner ok">No blocking gaps across the portfolio.</div>`
      : p.top_gaps.map((g) => `
          <div style="display:flex; gap:12px; align-items:baseline; padding:9px 0; border-bottom:1px solid var(--border);">
            <span class="badge neutral" style="white-space:nowrap;">${escapeHtml(g.framework)} · ${escapeHtml(g.control)}</span>
            <span>${escapeHtml(g.statement)}</span>
          </div>`).join("");
  } catch (e) {
    statsEl.innerHTML = `<div class="empty-state">Failed to load rollup — ${e.message}</div>`;
  }
  const btn = document.getElementById("btn-export-portfolio-pdf");
  if (btn) btn.onclick = downloadPortfolioPdf;
}

async function downloadPortfolioPdf() {
  const scope = ACTIVE_PROJECT_ID ? `?project_id=${encodeURIComponent(ACTIVE_PROJECT_ID)}` : "";
  try {
    const res = await fetch(API + "/compliance/portfolio/export-pdf" + scope, { headers: _getAuthHeaders() });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "sentrai-portfolio-readiness.pdf";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast("Readiness PDF downloaded", "ok");
  } catch (e) {
    toast("PDF export failed: " + e.message, "error");
  }
}

// ── CI/CD Pre-Deployment Gate Ledger ──────────────────────────────────────────

let CI_EVENTS_CACHE = [];
const LEDGER_ROLES = ["ADMIN", "CISO", "REVIEWER", "APPROVER"];
const OVERRIDE_ROLES = ["ADMIN", "CISO", "APPROVER"];
function canViewLedger() { return !!(AUTH_USER && LEDGER_ROLES.includes(AUTH_USER.role)); }
function canOverride() { return !!(AUTH_USER && OVERRIDE_ROLES.includes(AUTH_USER.role)); }

function timeAgo(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return secs <= 1 ? "just now" : `${secs} secs ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

// Effective verdict badge (original FAIL that was signed off shows OVERRIDDEN).
function verdictBadge(ev) {
  if (ev.overridden) return `<span class="badge OVERRIDDEN" title="Original verdict: FAIL — signed off by ${escapeHtml(ev.overridden_by || "")}">OVERRIDDEN</span>`;
  return `<span class="badge ${ev.verdict === "pass" ? "PASS" : "FAIL"}">${ev.verdict.toUpperCase()}</span>`;
}

function canMintCiToken() { return !!(AUTH_USER && ["ADMIN", "CISO"].includes(AUTH_USER.role)); }

async function loadCiLedger() {
  const tbody = document.getElementById("ci-ledger-rows");
  const empty = document.getElementById("ci-ledger-empty");
  const filter = document.getElementById("ci-ledger-filter");
  const setupBtn = document.getElementById("btn-setup-ci");
  if (setupBtn) setupBtn.style.display = canMintCiToken() ? "" : "none";
  const verdict = filter ? filter.value : "";
  tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Loading gate ledger…</td></tr>`;
  empty.classList.add("hidden");
  try {
    const qs = verdict ? `?verdict=${verdict}` : "";
    const events = await api("/ci/events" + qs);
    CI_EVENTS_CACHE = Array.isArray(events) ? events : [];
    if (CI_EVENTS_CACHE.length === 0) {
      tbody.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    renderCiRows(CI_EVENTS_CACHE);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load ledger — ${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderCiRows(events) {
  const tbody = document.getElementById("ci-ledger-rows");
  tbody.innerHTML = events.map((ev) => {
    const sha = (ev.commit_sha || "").slice(0, 8);
    const gaps = ev.blocking_violations || [];
    const triage = gaps.length === 0
      ? `<span class="muted">—</span>`
      : gaps.slice(0, 2).map((g) =>
          `<div>${g.shadow ? `<span class="badge risk-HIGH" style="margin-right:4px;">SHADOW</span>` : ""}<span title="${escapeHtml(g.reason)}">${escapeHtml(g.model_name)} — missing ${escapeHtml((g.missing || []).join(", "))}</span></div>`
        ).join("") + (gaps.length > 2 ? `<div class="muted">+${gaps.length - 2} more…</div>` : "");
    return `<tr data-event-id="${ev.gate_event_id}">
      <td><code title="${escapeHtml(ev.commit_sha || "")}">${escapeHtml(sha) || "—"}</code>${ev.pr_number ? `<div class="muted" style="font-size:0.65rem;">PR #${escapeHtml(ev.pr_number)}</div>` : ""}</td>
      <td>${escapeHtml(ev.project_name || ev.project_id.slice(0, 8))}</td>
      <td><span class="time-ago" title="${escapeHtml(ev.occurred_at)}">${timeAgo(ev.occurred_at)}</span></td>
      <td>${verdictBadge(ev)}</td>
      <td>${ev.models_detected}</td>
      <td style="font-size:0.72rem;">${triage}</td>
      <td><button class="btn ghost small btn-audit-event">Audit →</button></td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll(".btn-audit-event").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.closest("tr").dataset.eventId;
      openCiDetail(id);
    });
  });
}

// Renders one file's flagged lines as a mini code viewer, highlighting the
// exact AST-flagged lines (imports / aliases that tripped the policy).
function renderCodeViewer(evidence) {
  if (!evidence || evidence.length === 0) {
    return `<div class="override-note">No line-level evidence captured for this asset.</div>`;
  }
  return `<div class="code-viewer">` + evidence.map((sig) =>
    `<div class="code-line flagged"><span class="ln">${sig.line}</span><span class="lc">${escapeHtml(sig.snippet || "")}</span></div>`
  ).join("") + `</div>`;
}

function openCiDetail(eventId) {
  const ev = CI_EVENTS_CACHE.find((e) => e.gate_event_id === eventId);
  if (!ev) return;
  const overlay = document.getElementById("ci-detail-overlay");
  const title = document.getElementById("ci-detail-title");
  const body = document.getElementById("ci-detail-body");
  title.innerHTML = `Gate ${verdictBadge(ev)} · <code>${escapeHtml((ev.commit_sha || "").slice(0, 8))}</code>`;

  const gaps = ev.blocking_violations || [];
  const gapsHtml = gaps.length === 0
    ? `<div class="result-banner ok">No blocking violations — this commit passed the gate.</div>`
    : gaps.map((g) => `
        <div class="gap-card">
          <div class="gap-head">
            <span class="badge ${g.severity ? "risk-" + g.severity : "neutral"}">${escapeHtml(g.severity || "")}</span>
            ${g.shadow ? `<span class="badge risk-HIGH">SHADOW AI</span>` : ""}
            <span class="gap-file">${escapeHtml(g.file_location)}</span>
          </div>
          <div class="gap-reason">${escapeHtml(g.reason)}</div>
          <div class="override-note" style="margin-bottom:6px;">Missing controls: <strong>${escapeHtml((g.missing || []).join(", "))}</strong></div>
          ${renderCodeViewer(g.evidence)}
        </div>`).join("");

  let overrideHtml = "";
  if (ev.overridden) {
    overrideHtml = `<div class="override-box">
      <strong>✔ Auditor sign-off recorded</strong>
      <div class="override-note">By <strong>${escapeHtml(ev.overridden_by || "")}</strong> · ${escapeHtml(ev.overridden_at ? new Date(ev.overridden_at).toLocaleString() : "")}</div>
      <div class="override-note" style="margin-top:6px;">Justification: “${escapeHtml(ev.override_reason || "")}”</div>
      <div class="override-note" style="margin-top:6px;">The original verdict <strong>FAIL</strong> remains on the immutable record.</div>
    </div>`;
  } else if (ev.verdict === "fail" && canOverride()) {
    overrideHtml = `<div class="override-box">
      <strong>Grant Auditing Sign-Off Override</strong>
      <div class="override-note">This does not erase the failure — it records your identity and justification alongside the original verdict.</div>
      <textarea id="ci-override-reason" placeholder="Justification (required, min 10 chars) — e.g. compensating control X approved under ticket GRC-123."></textarea>
      <button class="btn danger" id="btn-submit-override" data-event-id="${ev.gate_event_id}">Grant Override & Sign Off</button>
    </div>`;
  } else if (ev.verdict === "fail") {
    overrideHtml = `<div class="override-note">A failed gate can only be signed off by an ADMIN, CISO, or APPROVER.</div>`;
  }

  body.innerHTML = `
    <div class="metric-row" style="margin-bottom:14px;">
      <div class="metric"><span class="v">${escapeHtml(ev.project_name || "—")}</span><span class="k">Project</span></div>
      <div class="metric"><span class="v">${escapeHtml(ev.triggered_by || "—")}</span><span class="k">Triggered by</span></div>
      <div class="metric"><span class="v">${timeAgo(ev.occurred_at)}</span><span class="k">When</span></div>
      <div class="metric"><span class="v">${ev.models_detected}</span><span class="k">Models detected</span></div>
    </div>
    <h3 style="font-size:0.85rem; margin:0 0 10px;">Blocking Violations & Flagged Code</h3>
    ${gapsHtml}
    ${overrideHtml}
  `;
  overlay.classList.remove("hidden");

  const submitBtn = document.getElementById("btn-submit-override");
  if (submitBtn) submitBtn.addEventListener("click", () => submitOverride(ev.gate_event_id));
}

function closeCiDetail() {
  document.getElementById("ci-detail-overlay").classList.add("hidden");
}

async function submitOverride(eventId) {
  const ta = document.getElementById("ci-override-reason");
  const btn = document.getElementById("btn-submit-override");
  const reason = (ta ? ta.value : "").trim();
  if (reason.length < 10) {
    toast("Justification must be at least 10 characters.", "error");
    if (ta) ta.focus();
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "Signing off…"; }
  try {
    const updated = await api(`/ci/events/${eventId}/override`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    // Update state in place — no hard refresh.
    const idx = CI_EVENTS_CACHE.findIndex((e) => e.gate_event_id === eventId);
    if (idx >= 0) CI_EVENTS_CACHE[idx] = updated;
    renderCiRows(CI_EVENTS_CACHE);
    openCiDetail(eventId); // re-render modal in its overridden state
    toast("Override recorded — original failure preserved.", "ok");
  } catch (e) {
    toast("Override failed: " + e.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "Grant Override & Sign Off"; }
  }
}

// Ledger controls
document.getElementById("btn-refresh-ci-ledger")?.addEventListener("click", loadCiLedger);
document.getElementById("ci-ledger-filter")?.addEventListener("change", loadCiLedger);
document.getElementById("btn-close-ci-detail")?.addEventListener("click", closeCiDetail);
document.getElementById("ci-detail-overlay")?.addEventListener("click", (e) => {
  if (e.target.id === "ci-detail-overlay") closeCiDetail();
});
document.getElementById("link-open-ci-ledger")?.addEventListener("click", (e) => {
  e.preventDefault();
  if (canViewLedger()) switchToTab("ci-ledger");
  else toast("The gate ledger is available to audit roles (ADMIN, CISO, REVIEWER, APPROVER).", "error");
});

// ── Context-sensitive help ────────────────────────────────────────────────────
// The "? Help" button (and the "?" key) opens the help doc's section for whatever
// tab you're currently on. The doc (public/docs/HELP.md) is the single source of
// truth — this just slices out the relevant section and renders it inline.

const CONTEXT_HELP_SECTIONS = {
  projects: "Projects",
  overview: "Overview",
  compliance: "Compliance Rollup",
  "ci-ledger": "CI Gate Ledger",
  inventory: "Model Inventory",
  monitoring: "Drift Monitoring",
  audit: "Audit Trail",
  incidents: "Incidents",
  lineage: "Lineage Graph",
  docs: "Docs",
  users: "Users",
  orgs: "Organizations",
};

async function getDocsMarkdown() {
  if (DOCS_MARKDOWN_CACHE != null) return DOCS_MARKDOWN_CACHE;
  const data = await api("/docs");
  DOCS_MARKDOWN_CACHE = data && data.content ? data.content : "";
  return DOCS_MARKDOWN_CACHE;
}

// Slice one "### N. Title" section (heading + body, up to the next ## or ###) out
// of the help markdown.
function extractHelpSection(md, title) {
  const lines = md.split("\n");
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^###\\s+\\d+\\.\\s*" + esc + "\\s*$", "i");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i].trim())) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^###?\s+\S/.test(lines[i])) { end = i; break; } // next ## or ### heading
  }
  return lines.slice(start, end).join("\n").trim();
}

async function openContextHelp() {
  const title = CONTEXT_HELP_SECTIONS[CURRENT_TAB] || null;
  const overlay = document.getElementById("help-modal-overlay");
  const body = document.getElementById("help-modal-body");
  const titleEl = document.getElementById("help-modal-title");
  titleEl.textContent = title ? `Help · ${title}` : "Help";
  body.innerHTML = `<div class="empty-state">Loading help…</div>`;
  overlay.classList.remove("hidden");
  try {
    const md = await getDocsMarkdown();
    const section = title ? extractHelpSection(md, title) : null;
    body.innerHTML = section
      ? marked.parse(section)
      : `<p>No screen-specific help here yet — open the full guide for details.</p>`;
  } catch (e) {
    body.innerHTML = `<div class="empty-state">Couldn't load help — ${escapeHtml(e.message)}. Try the full guide.</div>`;
  }
}

function closeContextHelp() {
  document.getElementById("help-modal-overlay").classList.add("hidden");
}

document.getElementById("btn-context-help")?.addEventListener("click", openContextHelp);
document.getElementById("btn-close-help-modal")?.addEventListener("click", closeContextHelp);
document.getElementById("help-modal-overlay")?.addEventListener("click", (e) => {
  if (e.target.id === "help-modal-overlay") closeContextHelp();
});
document.getElementById("btn-help-full-guide")?.addEventListener("click", () => {
  closeContextHelp();
  switchToTab("docs");
});
// "?" opens context help; Esc closes it. Ignore while typing in a field.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeContextHelp(); return; }
  if (e.key !== "?" || !AUTH_USER) return;
  const tag = e.target.tagName || "";
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.target.isContentEditable) return;
  e.preventDefault();
  openContextHelp();
});

// ── Set up CI scanning (mint a token + a copy-run snippet) ─────────────────────

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove(); return true;
  }
}

// A ready-to-run scan example with the token + this host baked in.
function ciScanSnippet(token) {
  const base = window.location.origin;
  return [
    `curl -s -X POST ${base}/api/v1/ci/scan \\`,
    `  -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \\`,
    `  -d '{`,
    `    "commit_sha": "manual-test-001",`,
    `    "files": [`,
    `      { "path": ".sentrai/policy.yaml", "content": "gates:\\n  block_on:\\n    - severity: HIGH\\n      missing: [registered, owner_team, board_policy_ref]\\n  frameworks: [eu_ai_act]\\n" },`,
    `      { "path": "app/model.py", "content": "import openai\\n\\ndef score(x):\\n    return openai.chat.completions.create(model=\\"gpt-4\\", messages=[])\\n" }`,
    `    ]`,
    `  }'`,
  ].join("\n");
}

async function openCiSetup() {
  const overlay = document.getElementById("ci-setup-overlay");
  const body = document.getElementById("ci-setup-body");
  body.innerHTML = `<div class="empty-state">Loading projects…</div>`;
  overlay.classList.remove("hidden");
  let projects = [];
  try { projects = await api("/projects"); }
  catch (e) { body.innerHTML = `<div class="empty-state">Couldn't load projects — ${escapeHtml(e.message)}</div>`; return; }
  if (!projects.length) {
    body.innerHTML = `<p>Create a project first (Projects tab), then come back to generate a CI token for it.</p>`;
    return;
  }
  const opts = projects.map((p) =>
    `<option value="${p.project_id}" ${p.project_id === ACTIVE_PROJECT_ID ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
  body.innerHTML = `
    <p>Generate a long-lived <strong>CI service token</strong> for a project, then use it in your pipeline (or the ready-to-run snippet) to send scans to this gate.</p>
    <label style="display:block; margin-bottom:12px;">Project
      <select id="ci-setup-project" style="width:100%;">${opts}</select>
    </label>
    <button class="btn primary" id="btn-generate-ci-token">Generate CI token</button>
    <div id="ci-setup-result" style="margin-top:16px;"></div>`;
  document.getElementById("btn-generate-ci-token").addEventListener("click", generateCiToken);
}

async function generateCiToken() {
  const sel = document.getElementById("ci-setup-project");
  const projectId = sel.value;
  const projectName = sel.options[sel.selectedIndex].text;
  const btn = document.getElementById("btn-generate-ci-token");
  const result = document.getElementById("ci-setup-result");
  btn.disabled = true; btn.textContent = "Generating…";
  try {
    const res = await api("/ci/tokens", {
      method: "POST",
      body: JSON.stringify({ project_id: projectId, label: `${projectName} CI`.slice(0, 120) }),
    });
    const token = res.token;
    const snippet = ciScanSnippet(token);
    result.innerHTML = `
      <div class="result-banner ok">✔ Token generated for <strong>${escapeHtml(projectName)}</strong>. Valid 365 days — store it now, it isn't shown again.</div>
      <label style="display:block; margin:10px 0 6px;">CI service token — store as the <code>SENTRAI_CI_TOKEN</code> pipeline secret</label>
      <div style="display:flex; gap:8px; align-items:center;">
        <input id="ci-token-value" readonly value="${escapeHtml(token)}" style="flex:1; font-family:var(--mono); font-size:0.72rem;" />
        <button class="btn ghost small" id="btn-copy-ci-token">Copy</button>
      </div>
      <h4 style="margin:16px 0 6px; font-size:0.85rem;">Test it now — paste into a terminal</h4>
      <pre id="ci-snippet-text" style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:10px; overflow-x:auto; font-family:var(--mono); font-size:0.7rem; white-space:pre; margin:0;"></pre>
      <div style="margin-top:8px;"><button class="btn ghost small" id="btn-copy-ci-snippet">Copy snippet</button></div>
      <p class="muted" style="margin-top:12px; font-size:0.72rem;">For real pipelines, wire the gate in with <code>ci-integration/</code> (GitHub Action + policy example), then refresh this ledger to see gate events.</p>`;
    document.getElementById("ci-snippet-text").textContent = snippet;
    document.getElementById("btn-copy-ci-token").addEventListener("click", async () => { await copyText(token); toast("Token copied", "ok"); });
    document.getElementById("btn-copy-ci-snippet").addEventListener("click", async () => { await copyText(snippet); toast("Snippet copied", "ok"); });
  } catch (e) {
    result.innerHTML = `<div class="result-banner bad">Couldn't generate token — ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = "Generate CI token";
  }
}

function closeCiSetup() { document.getElementById("ci-setup-overlay").classList.add("hidden"); }

document.getElementById("btn-setup-ci")?.addEventListener("click", openCiSetup);
document.getElementById("btn-close-ci-setup")?.addEventListener("click", closeCiSetup);
document.getElementById("ci-setup-overlay")?.addEventListener("click", (e) => {
  if (e.target.id === "ci-setup-overlay") closeCiSetup();
});

// ── Inventory ────────────────────────────────────────────────────────────────

const SUTRAS_LIST = [
  "TRUST_IS_THE_FOUNDATION", "PEOPLE_FIRST", "INNOVATION_OVER_RESTRAINT",
  "FAIRNESS_AND_EQUITY", "ACCOUNTABILITY", "UNDERSTANDABLE_BY_DESIGN",
  "SAFETY_RESILIENCE_SUSTAINABILITY",
];

function initSutrasCheckboxes() {
  const el = document.getElementById("sutras-checkboxes");
  el.innerHTML = SUTRAS_LIST.map((s) => `
    <label class="checkbox"><input type="checkbox" name="sutra_${s}" data-sutra="${s}" /> ${s.replace(/_/g, " ")}</label>
  `).join("");
}

document.getElementById("btn-new-model").addEventListener("click", () => {
  document.getElementById("form-register-model").classList.toggle("hidden");
});
document.getElementById("btn-cancel-model").addEventListener("click", () => {
  document.getElementById("form-register-model").classList.add("hidden");
});

document.getElementById("btn-rescan-models").addEventListener("click", async () => {
  const scope = ACTIVE_PROJECT_ID ? "this project's models" : "all models you can see";
  if (!confirm(`Re-scan ${scope}?\n\nThis re-evaluates every model against the current SentRAI logic, and re-reads the codebase for models linked to a source file — updating risk levels where they changed. Your governance edits (owner, policy, sutras, lifecycle) are preserved.`)) return;
  const btn = document.getElementById("btn-rescan-models");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ Re-scanning…";
  try {
    const res = await api("/inventory/models/rescan", {
      method: "POST",
      body: JSON.stringify({ project_id: ACTIVE_PROJECT_ID || null }),
    });
    let msg = `Re-scanned ${res.rescanned} model(s) — ${res.risk_changed} risk level(s) updated`;
    if (res.source_missing > 0) msg += ` · ${res.source_missing} source file(s) no longer detected as AI`;
    toast(msg);
    loadModels();
  } catch (err) {
    toast("Re-scan failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

document.getElementById("model-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const obj = formToObject(form);
  const sutras = SUTRAS_LIST.filter((s) => form.querySelector(`[data-sutra="${s.id}"]`)?.checked).map((s) => s.id);
  const payload = {
    name: obj.name,
    model_type: obj.model_type,
    functional_area: obj.functional_area,
    use_case_description: obj.use_case_description,
    target_customer_segments: obj.target_customer_segments ? obj.target_customer_segments.split(",").map((s) => s.trim()).filter(Boolean) : [],
    owner_team: obj.owner_team,
    developed_by: obj.developed_by,
    board_policy_ref: obj.board_policy_ref,
    human_oversight_required: !!obj.human_oversight_required,
    autonomous_scope: obj.autonomous_scope || null,
    sutras_alignment: sutras,
    project_id: ACTIVE_PROJECT_ID || null,  // Fix loophole #1: always include active project
  };
  try {
    await api("/inventory/models", { method: "POST", body: JSON.stringify(payload) });
    toast("Model registered successfully");
    form.reset();
    document.getElementById("form-register-model").classList.add("hidden");
    loadModels();
  } catch (err) {
    toast("Registration failed: " + err.message, "error");
  }
});

async function loadModels() {
  try {
    const projectFilter = ACTIVE_PROJECT_ID;
    const qs = projectFilter ? `?project_id=${encodeURIComponent(projectFilter)}` : "";
    MODELS_CACHE = await api(`/inventory/models${qs}`);
    renderModelTable();
  } catch (e) {
    toast("Failed to load models: " + e.message, "error");
  }
}

// Red chip listing hardcoded secrets found in the model's source at scan time.
// The masked values + line numbers show on hover; nothing renders when clean.
function securityChip(findings) {
  if (!Array.isArray(findings) || !findings.length) return "";
  const detail = findings.map((s) => `${s.type} — line ${s.line}: ${s.masked_value}`).join("\n");
  const n = findings.length;
  return `<br/><span class="badge risk-HIGH" style="font-size:0.6rem;margin-top:4px;display:inline-block;" title="${escapeHtml(detail)}">🔓 ${n} hardcoded secret${n > 1 ? "s" : ""} in source</span>`;
}

// ── Inventory table: sort + filter (client-side over MODELS_CACHE) ─────────────
const RISK_RANK = { LOW: 0, MINIMAL: 0, MEDIUM: 1, LIMITED: 1, HIGH: 2, CRITICAL: 3, PROHIBITED: 4 };
const LIFECYCLE_RANK = { DESIGN: 0, DEVELOPMENT: 1, VALIDATION: 2, DEPLOYED: 3, MONITORING: 4, DECOMMISSIONED: 5 };
let MODEL_SORT = { col: "name", dir: 1 };
const MODEL_FILTER = { text: "", risk: "", lifecycle: "", compliance: "" };

function modelMatchesFilter(m) {
  const f = MODEL_FILTER;
  if (f.risk && m.risk_level !== f.risk) return false;
  if (f.lifecycle && m.lifecycle_stage !== f.lifecycle) return false;
  if (f.compliance === "compliant" && !m.compliance_pass) return false;
  if (f.compliance === "gaps" && m.compliance_pass) return false;
  if (f.text) {
    const hay = `${m.name} ${m.source_ref || ""} ${m.use_case_description || ""}`.toLowerCase();
    if (!hay.includes(f.text.toLowerCase())) return false;
  }
  return true;
}

function compareModels(a, b) {
  let av, bv;
  switch (MODEL_SORT.col) {
    case "risk": av = RISK_RANK[a.risk_level] ?? 0; bv = RISK_RANK[b.risk_level] ?? 0; break;
    case "compliance": av = a.compliance_pass ? -1 : (a.open_gap_count || 0); bv = b.compliance_pass ? -1 : (b.open_gap_count || 0); break;
    case "lifecycle": av = LIFECYCLE_RANK[a.lifecycle_stage] ?? 0; bv = LIFECYCLE_RANK[b.lifecycle_stage] ?? 0; break;
    case "oversight": av = a.human_oversight_required ? 1 : 0; bv = b.human_oversight_required ? 1 : 0; break;
    case "registered": av = new Date(a.registered_at).getTime() || 0; bv = new Date(b.registered_at).getTime() || 0; break;
    default: av = (a.name || "").toLowerCase(); bv = (b.name || "").toLowerCase();
  }
  if (av < bv) return -MODEL_SORT.dir;
  if (av > bv) return MODEL_SORT.dir;
  return 0;
}

function updateModelSortIndicators() {
  document.querySelectorAll("#models-table thead th[data-sort]").forEach((th) => {
    if (!th.dataset.label) th.dataset.label = th.textContent.trim();
    const active = MODEL_SORT.col === th.dataset.sort;
    th.textContent = th.dataset.label + (active ? (MODEL_SORT.dir === 1 ? " ▲" : " ▼") : "");
  });
}

function renderModelTable() {
  const projectFilter = ACTIVE_PROJECT_ID;
  const tbody = document.querySelector("#models-table tbody");
  const empty = document.getElementById("models-empty");
  const countEl = document.getElementById("models-count");
  updateModelSortIndicators();

  if (!MODELS_CACHE.length) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
    if (countEl) countEl.textContent = "";
    return;
  }
  empty.classList.add("hidden");
  const rows = MODELS_CACHE.filter(modelMatchesFilter).sort(compareModels);
  if (countEl) countEl.textContent = `${rows.length} of ${MODELS_CACHE.length} model(s)`;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No models match the current filter.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((m) => `
      <tr data-model-id="${m.model_id}">
        <td>
          <strong>${m.name}</strong>
          ${m.use_case_description ? `<div style="font-size:0.7rem; color:var(--muted); max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px;" title="${escapeHtml(m.use_case_description)}">${escapeHtml(m.use_case_description)}</div>` : ""}
          <br/><span class="muted">${shortId(m.model_id)}</span>${projectFilter ? "" : projectLabel(m.project_id)}${m.source_ref ? `<br/><span class="muted" style="font-size:0.62rem">📄 ${m.source_ref}</span>` : ""}
          ${securityChip(m.security_findings)}
        </td>
        <td>${badge(m.risk_level, "risk-" + m.risk_level)}</td>
        <td>
          ${m.compliance_pass
            ? `<span class="badge COMPLIANT">✓ Compliant</span>`
            : `<button class="btn small danger close-gaps-btn" data-id="${m.model_id}" data-name="${m.name}">${m.open_gap_count} gap(s) — Close</button>`}
        </td>
        <td>
          <select class="lifecycle-select" data-id="${m.model_id}" style="font-size:0.68rem;padding:4px 6px;">
            ${["DESIGN","DEVELOPMENT","VALIDATION","DEPLOYED","MONITORING","DECOMMISSIONED"].map((s) =>
              `<option value="${s}" ${s === m.lifecycle_stage ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </td>
        <td>${m.human_oversight_required ? "✅" : "—"}</td>
        <td><button class="btn small ghost grievance-btn" data-id="${m.model_id}">+ Grievance</button></td>
        <td>${fmtDate(m.registered_at)}</td>
        <td>
          <button class="btn small ghost ledger-btn" data-id="${m.model_id}" data-name="${m.name}">View Ledger</button>
          <button class="btn small ghost remove-model-btn" data-id="${m.model_id}" data-name="${m.name}" title="Remove from inventory (e.g. a discovery false-positive)">🗑</button>
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll(".remove-model-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(`Remove "${btn.dataset.name}" from the inventory?\n\nUse this for false positives from codebase discovery (e.g. a settings/UI file that isn't actually an AI model). This soft-removes the model — its ledger history is kept for audit purposes.`)) return;
        try {
          await api(`/inventory/models/${btn.dataset.id}`, { method: "DELETE" });
          toast("Model removed from inventory");
          MODELS_CACHE = [];
          loadModels();
          loadProjects();
        } catch (err) {
          toast("Remove failed: " + err.message, "error");
        }
      });
    });

    tbody.querySelectorAll(".close-gaps-btn").forEach((btn) => {
      btn.addEventListener("click", () => openGovernancePanel(btn.dataset.id, btn.dataset.name));
    });

    tbody.querySelectorAll(".lifecycle-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        try {
          await api(`/inventory/models/${sel.dataset.id}/lifecycle`, {
            method: "PATCH",
            body: JSON.stringify({ stage: sel.value, actor: "dashboard_user", notes: "Updated via UI" }),
          });
          toast("Lifecycle updated");
        } catch (err) { toast("Update failed: " + err.message, "error"); }
      });
    });

    tbody.querySelectorAll(".grievance-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const notes = prompt("Grievance resolution notes:");
        if (notes === null) return;
        try {
          await api(`/inventory/models/${btn.dataset.id}/grievances`, {
            method: "PATCH",
            body: JSON.stringify({ count_delta: 1, resolution_notes: notes }),
          });
          toast("Grievance recorded");
          loadModels();
        } catch (err) { toast("Failed: " + err.message, "error"); }
      });
    });

    tbody.querySelectorAll(".ledger-btn").forEach((btn) => {
      btn.addEventListener("click", () => showLedger(btn.dataset.id, btn.dataset.name));
    });
}

// Sort on header click; filter on control input (wired once).
document.querySelectorAll("#models-table thead th[data-sort]").forEach((th) => {
  th.style.cursor = "pointer";
  th.addEventListener("click", () => {
    const col = th.dataset.sort;
    if (MODEL_SORT.col === col) MODEL_SORT.dir *= -1;
    else { MODEL_SORT.col = col; MODEL_SORT.dir = 1; }
    renderModelTable();
  });
});
["model-filter-text", "model-filter-risk", "model-filter-lifecycle", "model-filter-compliance"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  const apply = () => {
    MODEL_FILTER.text = (document.getElementById("model-filter-text") || {}).value || "";
    MODEL_FILTER.risk = (document.getElementById("model-filter-risk") || {}).value || "";
    MODEL_FILTER.lifecycle = (document.getElementById("model-filter-lifecycle") || {}).value || "";
    MODEL_FILTER.compliance = (document.getElementById("model-filter-compliance") || {}).value || "";
    renderModelTable();
  };
  el.addEventListener("input", apply);
  el.addEventListener("change", apply);
});

// ── Inline expandable detail row (gaps / ledger) ──────────────────────────────
// Renders directly under the clicked model's row in the table, instead of a
// separate panel at the bottom of the page — no scrolling needed to use it.

let OPEN_DETAIL_KEY = null; // `${modelId}:${type}` of the currently expanded row, if any

function closeDetailRow() {
  const existing = document.querySelector("#models-table tr.detail-row");
  if (existing) existing.remove();
  OPEN_DETAIL_KEY = null;
}

function openDetailRow(modelId, type, innerHtml) {
  closeDetailRow();
  const targetRow = document.querySelector(`#models-table tr[data-model-id="${modelId}"]`);
  if (!targetRow) return null;
  const tr = document.createElement("tr");
  tr.className = "detail-row";
  tr.innerHTML = `<td colspan="8"><div class="inline-panel">${innerHtml}</div></td>`;
  targetRow.after(tr);
  OPEN_DETAIL_KEY = `${modelId}:${type}`;
  return tr;
}

function sutrasCheckboxesHtml(dataAttr, activeSutras = []) {
  const activeSet = new Set(activeSutras || []);
  return SUTRAS_LIST.map((s) => `
    <label class="checkbox"><input type="checkbox" ${dataAttr}="${s}" ${activeSet.has(s) ? 'checked' : ''} /> ${s.replace(/_/g, " ")}</label>
  `).join("");
}

function gapsListHtml(report) {
  const sutras = report;
  const nist = report.nist_rmf || { overall_pass: true, blocking_gaps: [] };
  const eu = report.eu_ai_act || { overall_pass: true, blocking_gaps: [], risk_tier: "Minimal" };
  const iso = report.iso_42001 || { overall_pass: true, blocking_gaps: [] };

  let html = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-bottom: 16px;">`;

  // 1. RBI FREE-AI Sutras
  html += `
    <div style="background: var(--bg-card); border: 1px solid var(--border); padding: 12px; border-radius: 8px;">
      <div style="font-weight: bold; font-size: 0.76rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-bottom: 6px;">
        <span>🇮🇳 RBI FREE-AI 7 Sutras</span>
        <span class="badge ${sutras.overall_pass ? 'COMPLIANT' : 'risk-HIGH'}">${sutras.overall_pass ? 'Compliant' : 'Non-compliant'}</span>
      </div>
      ${sutras.overall_pass 
        ? `<div style="font-size: 0.72rem; color: #15803d;">✓ All 7 Sutras validated.</div>`
        : `<ul style="margin: 0; padding-left: 14px; font-size: 0.68rem; color: var(--muted); display:flex; flex-direction:column; gap:4px;">
             ${sutras.blocking_gaps.map((g) => `<li>${g}</li>`).join("")}
           </ul>`
      }
    </div>
  `;

  // 2. NIST AI RMF
  html += `
    <div style="background: var(--bg-card); border: 1px solid var(--border); padding: 12px; border-radius: 8px;">
      <div style="font-weight: bold; font-size: 0.76rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-bottom: 6px;">
        <span>🇺🇸 NIST AI RMF 1.0</span>
        <span class="badge ${nist.overall_pass ? 'COMPLIANT' : 'risk-HIGH'}">${nist.overall_pass ? 'Compliant' : 'Non-compliant'}</span>
      </div>
      ${nist.overall_pass 
        ? `<div style="font-size: 0.72rem; color: #15803d;">✓ Meets Govern, Map, Measure, Manage controls.</div>`
        : `<ul style="margin: 0; padding-left: 14px; font-size: 0.68rem; color: var(--muted); display:flex; flex-direction:column; gap:4px;">
             ${nist.blocking_gaps.map((g) => `<li>${g}</li>`).join("")}
           </ul>`
      }
    </div>
  `;

  // 3. EU AI Act
  html += `
    <div style="background: var(--bg-card); border: 1px solid var(--border); padding: 12px; border-radius: 8px;">
      <div style="font-weight: bold; font-size: 0.76rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-bottom: 6px;">
        <span>🇪🇺 EU AI Act</span>
        <span class="badge ${eu.overall_pass ? 'COMPLIANT' : 'risk-HIGH'}">${eu.overall_pass ? 'Compliant' : 'Non-compliant'}</span>
      </div>
      <div style="font-size: 0.68rem; margin-bottom: 6px;">Risk Tier: <span class="badge neutral" style="font-size:0.6rem; padding:1px 4px;">${eu.risk_tier}</span></div>
      ${eu.overall_pass 
        ? `<div style="font-size: 0.72rem; color: #15803d;">✓ Satisfies requirements for risk tier.</div>`
        : `<ul style="margin: 0; padding-left: 14px; font-size: 0.68rem; color: var(--muted); display:flex; flex-direction:column; gap:4px;">
             ${eu.blocking_gaps.map((g) => `<li>${g}</li>`).join("")}
           </ul>`
      }
    </div>
  `;

  // 4. ISO 42001
  html += `
    <div style="background: var(--bg-card); border: 1px solid var(--border); padding: 12px; border-radius: 8px;">
      <div style="font-weight: bold; font-size: 0.76rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-bottom: 6px;">
        <span>🌐 ISO 42001</span>
        <span class="badge ${iso.overall_pass ? 'COMPLIANT' : 'risk-HIGH'}">${iso.overall_pass ? 'Compliant' : 'Non-compliant'}</span>
      </div>
      ${iso.overall_pass 
        ? `<div style="font-size: 0.72rem; color: #15803d;">✓ Meets Clause 6, 8 System requirements.</div>`
        : `<ul style="margin: 0; padding-left: 14px; font-size: 0.68rem; color: var(--muted); display:flex; flex-direction:column; gap:4px;">
             ${iso.blocking_gaps.map((g) => `<li>${g}</li>`).join("")}
           </ul>`
      }
    </div>
  `;

  html += `</div>`;
  return html;
}

async function openGovernancePanel(modelId, name) {
  const key = `${modelId}:governance`;
  if (OPEN_DETAIL_KEY === key) { closeDetailRow(); return; }

  const model = MODELS_CACHE.find((m) => m.model_id === modelId);
  const formattedDate = model?.last_red_team_date ? model.last_red_team_date.split('T')[0] : '';
  const tr = openDetailRow(modelId, "governance", `
    <div class="panel-head">
      <h3>Close Governance Gaps — ${name}</h3>
      <button type="button" class="btn ghost small" id="btn-close-governance">✕</button>
    </div>
    <div id="governance-gaps-list" style="margin-bottom:16px">Loading…</div>
    <form id="governance-form">
      <div class="form-row">
        <label>Owner Team <input name="owner_team" value="${escapeHtml(model?.owner_team || '')}" placeholder="e.g. Platform Risk Team" /></label>
        <label>Board Policy Reference <input name="board_policy_ref" value="${escapeHtml(model?.board_policy_ref || '')}" placeholder="e.g. AI-POLICY-2026-014" /></label>
      </div>
      <div class="form-row">
        <label class="checkbox"><input type="checkbox" name="human_oversight_required" ${model?.human_oversight_required ? "checked" : ""} /> Human Oversight Required</label>
        <label>Last Red-Team Date <input type="date" name="last_red_team_date" value="${formattedDate}" /></label>
      </div>
      <label>Autonomous Scope (if any) <input name="autonomous_scope" value="${escapeHtml(model?.autonomous_scope || '')}" placeholder="e.g. routine FAQ responses" /></label>
      <label>Use Case Description <textarea name="use_case_description" rows="2">${escapeHtml(model?.use_case_description || '')}</textarea></label>
      <fieldset>
        <legend>Sutras Declared</legend>
        <div class="checkbox-grid">${sutrasCheckboxesHtml('data-gov-sutra', model?.sutras_alignment)}</div>
      </fieldset>
      <div class="form-actions" style="display:flex; justify-content:space-between; align-items:center;">
        <button type="submit" class="btn primary">Save &amp; Re-check Compliance</button>
        <a href="/api/v1/inventory/models/${modelId}/export-pdf" class="btn secondary" target="_blank" style="text-decoration:none;">Export Audit Report (PDF)</a>
      </div>
    </form>
  `);
  if (!tr) return;

  tr.querySelector("#btn-close-governance").addEventListener("click", closeDetailRow);
  tr.querySelector("#governance-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const obj = formToObject(form);
    const sutras = SUTRAS_LIST.filter((s) => form.querySelector(`[data-gov-sutra="${s.id}"]`)?.checked).map((s) => s.id);

    const payload = { actor: "dashboard_user" };
    if (obj.owner_team) payload.owner_team = obj.owner_team;
    if (obj.board_policy_ref) payload.board_policy_ref = obj.board_policy_ref;
    payload.human_oversight_required = !!obj.human_oversight_required;
    if (obj.autonomous_scope) payload.autonomous_scope = obj.autonomous_scope;
    if (obj.use_case_description) payload.use_case_description = obj.use_case_description;
    if (obj.last_red_team_date) payload.last_red_team_date = new Date(obj.last_red_team_date).toISOString();
    if (sutras.length) payload.sutras_alignment = sutras;

    try {
      const result = await api(`/inventory/models/${modelId}/governance`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const gapsEl = tr.querySelector("#governance-gaps-list");
      if (gapsEl) gapsEl.innerHTML = gapsListHtml(result.compliance);
      toast(result.compliance.overall_pass ? "All gaps closed — model is now compliant" : "Saved — some gaps remain");
      MODELS_CACHE = [];
      await loadModels();
      // Re-open the panel post-refresh since loadModels() rebuilds the table.
      openGovernancePanel(modelId, name);
    } catch (err) {
      toast("Save failed: " + err.message, "error");
    }
  });

  try {
    const report = await api(`/inventory/models/${modelId}/compliance-check`);
    const gapsEl = tr.querySelector("#governance-gaps-list");
    if (gapsEl) gapsEl.innerHTML = gapsListHtml(report);
  } catch (err) {
    toast("Could not load compliance status: " + err.message, "error");
  }
}

async function showLedger(modelId, name) {
  const key = `${modelId}:ledger`;
  if (OPEN_DETAIL_KEY === key) { closeDetailRow(); return; }

  const tr = openDetailRow(modelId, "ledger", `
    <div class="panel-head">
      <h3>Ledger — ${name}</h3>
      <button type="button" class="btn ghost small" id="btn-close-ledger">✕</button>
    </div>
    <div id="ledger-timeline">Loading…</div>
  `);
  if (!tr) return;
  tr.querySelector("#btn-close-ledger").addEventListener("click", closeDetailRow);

  try {
    const events = await api(`/inventory/models/${modelId}/ledger`);
    const timeline = tr.querySelector("#ledger-timeline");
    timeline.innerHTML = events.length
      ? events.map((ev) => `
          <div class="ledger-item">
            <div class="dot"></div>
            <div>
              <div><strong>${ev.event_type}</strong> — <span class="muted">${ev.actor}</span></div>
              <div class="time">${fmtDate(ev.occurred_at)}</div>
              <div class="muted">${JSON.stringify(ev.event_data)}</div>
            </div>
          </div>
        `).join("")
      : `<div class="empty-state">No ledger events.</div>`;
  } catch (e) {
    toast("Failed to load ledger: " + e.message, "error");
  }
}

async function loadModelSelect(selectId) {
  const sel = document.getElementById(selectId);
  const prev = sel.value;
  // Fix loophole #4: if no project active, show a helpful hint instead of all models globally
  if (!ACTIVE_PROJECT_ID) {
    sel.innerHTML = `<option value="">— Select a project first —</option>`;
    return;
  }
  try {
    const qs = `?project_id=${encodeURIComponent(ACTIVE_PROJECT_ID)}`;
    const models = await api(`/inventory/models${qs}`);
    sel.innerHTML = models.length
      ? models.map((m) => `<option value="${m.model_id}">${m.name} (${m.risk_level})</option>`).join("")
      : `<option value="">No models in this project</option>`;
    if (prev) sel.value = prev;
  } catch (e) {
    sel.innerHTML = `<option value="">Failed to load models</option>`;
  }
}

// ── Monitoring ───────────────────────────────────────────────────────────────

document.getElementById("btn-demo-data").addEventListener("click", () => {
  const form = document.getElementById("drift-form");
  const training = Array.from({ length: 200 }, () => (Math.random() * 0.3 + 0.4).toFixed(3));
  const live = Array.from({ length: 200 }, () => (Math.random() * 0.3 + 0.65).toFixed(3));
  form.training_scores.value = training.join(",");
  form.live_scores.value = live.join(",");
  form.baseline_accuracy.value = "0.91";
  form.current_accuracy.value = "0.79";
  toast("Demo data generated (simulating a significant drift)");
});

document.getElementById("drift-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const obj = formToObject(form);
  if (!obj.model_id) { toast("Select a model first", "error"); return; }
  const payload = {
    model_id: obj.model_id,
    training_scores: obj.training_scores.split(",").map(Number).filter((n) => !isNaN(n)),
    live_scores: obj.live_scores.split(",").map(Number).filter((n) => !isNaN(n)),
    baseline_accuracy: parseFloat(obj.baseline_accuracy),
    current_accuracy: parseFloat(obj.current_accuracy),
  };
  if (payload.training_scores.length < 2 || payload.live_scores.length < 2) {
    toast("Need at least 2 values in each score list (try Generate Demo Data)", "error");
    return;
  }
  try {
    const report = await api("/monitoring/drift/evaluate", { method: "POST", body: JSON.stringify(payload) });
    renderDriftResult(report);
    loadDriftHistory(obj.model_id);
    loadBcpStatus(obj.model_id);
    toast("Drift evaluation complete");
  } catch (err) {
    toast("Evaluation failed: " + err.message, "error");
  }
});

function renderDriftResult(report) {
  const card = document.getElementById("drift-result-card");
  const kind = report.circuit_breaker_active ? "bad" : report.status === "WARNING" ? "warn" : "ok";
  card.classList.remove("hidden");
  card.innerHTML = `
    <h3>Drift Evaluation Result ${badge(report.status)}</h3>
    <div class="result-banner ${kind}">
      ${report.circuit_breaker_active
        ? `🚨 Circuit breaker tripped. ${report.remediation_action || ""} Review ticket: <strong>${report.human_review_ticket}</strong>`
        : report.status === "WARNING"
          ? "⚠️ Moderate distributional shift detected — monitor closely."
          : "✅ Model operating within nominal parameters."}
    </div>
    <div class="metric-row">
      <div class="metric"><div class="v">${report.psi_score.toFixed(4)}</div><div class="k">PSI Score</div></div>
      <div class="metric"><div class="v">${report.wasserstein_distance.toFixed(4)}</div><div class="k">Wasserstein Distance</div></div>
      <div class="metric"><div class="v">${(report.accuracy_delta * 100).toFixed(2)}%</div><div class="k">Accuracy Delta</div></div>
    </div>
  `;
}

async function loadDriftHistory(modelId) {
  if (!modelId) return;
  try {
    const history = await api(`/monitoring/drift/${modelId}/history`);
    const tbody = document.querySelector("#drift-history-table tbody");
    const empty = document.getElementById("drift-history-empty");
    if (!history.length) { tbody.innerHTML = ""; empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");
    tbody.innerHTML = history.map((r) => `
      <tr>
        <td>${fmtDate(r.computed_at)}</td>
        <td>${badge(r.status)}</td>
        <td>${r.psi_score.toFixed(4)}</td>
        <td>${r.wasserstein_distance.toFixed(4)}</td>
        <td>${(r.accuracy_delta * 100).toFixed(2)}%</td>
        <td>${r.circuit_breaker_active ? "🚨 ON" : "—"}</td>
      </tr>
    `).join("");
  } catch (e) { /* silent */ }
}

async function loadBcpStatus(modelId) {
  const panel = document.getElementById("bcp-panel");
  if (!modelId) { panel.innerHTML = `<span class="muted">Select a model to view fallback status.</span>`; return; }
  try {
    const status = await api(`/monitoring/bcp/${modelId}/status`);
    panel.innerHTML = `
      <div>
        <strong>${status.bcp_active ? "🚨 FALLBACK ACTIVE" : "✅ Normal Operation"}</strong>
        ${status.reason ? `<div class="muted">${status.reason}</div>` : ""}
      </div>
      <div>
        <button class="btn small ${status.bcp_active ? "ghost" : "danger"}" id="bcp-toggle">${status.bcp_active ? "Deactivate Fallback" : "Activate Fallback"}</button>
      </div>
    `;
    document.getElementById("bcp-toggle").addEventListener("click", async () => {
      try {
        if (status.bcp_active) {
          await api(`/monitoring/bcp/${modelId}/deactivate`, { method: "POST" });
        } else {
          const reason = prompt("Reason for activating BCP fallback:", "Manual override via dashboard");
          if (reason === null) return;
          await api(`/monitoring/bcp/${modelId}/activate`, {
            method: "POST",
            body: JSON.stringify({ reason, rules_engine_ref: "RULES_ENGINE_v1", actor: "dashboard_user" }),
          });
        }
        loadBcpStatus(modelId);
        toast("BCP status updated");
      } catch (err) { toast("Failed: " + err.message, "error"); }
    });
  } catch (e) {
    panel.innerHTML = `<span class="muted">Unable to load BCP status.</span>`;
  }
}

document.getElementById("drift-model-select").addEventListener("change", (e) => {
  loadDriftHistory(e.target.value);
  loadBcpStatus(e.target.value);
});

// ── Audit ────────────────────────────────────────────────────────────────────

document.getElementById("audit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const obj = formToObject(form);
  if (!obj.model_id) { toast("Select a model first", "error"); return; }
  const payload = {
    auditor_ref: obj.auditor_ref,
    audit_type: obj.audit_type,
    training_data_bias_checked: !!obj.training_data_bias_checked,
    data_consent_verified: !!obj.data_consent_verified,
    data_sources_documented: !!obj.data_sources_documented,
    sensitive_attributes_excluded: !!obj.sensitive_attributes_excluded,
    model_architecture_reviewed: !!obj.model_architecture_reviewed,
    decision_logic_documented: !!obj.decision_logic_documented,
    adversarial_robustness_tested: !!obj.adversarial_robustness_tested,
    performance_benchmarks_met: !!obj.performance_benchmarks_met,
    bcp_verified: !!obj.bcp_verified,
    human_override_tested: !!obj.human_override_tested,
    explainability_score: parseFloat(obj.explainability_score || "0"),
    trust_verified: !!obj.trust_verified,
    human_oversight_verified: !!obj.human_oversight_verified,
    innovation_not_stifled: !!obj.innovation_not_stifled,
    fairness_metrics_passed: !!obj.fairness_metrics_passed,
    accountability_chain_documented: !!obj.accountability_chain_documented,
    explainability_verified: !!obj.explainability_verified,
  };
  try {
    const result = await api(`/audit/models/${obj.model_id}/initiate`, { method: "POST", body: JSON.stringify(payload) });
    renderAuditResult(result);
    loadAuditHistory(obj.model_id);
    toast("Audit completed");
  } catch (err) {
    toast("Audit failed: " + err.message, "error");
  }
});

function renderAuditResult(result) {
  const card = document.getElementById("audit-result-card");
  card.classList.remove("hidden");
  const kind = result.overall_verdict === "COMPLIANT" ? "ok" : result.overall_verdict === "CONDITIONAL" ? "warn" : "bad";
  card.innerHTML = `
    <h3>Audit Result ${badge(result.overall_verdict)}</h3>
    <div class="result-banner ${kind}">Explainability score: <strong>${result.explainability_score}</strong> · Next audit due: <strong>${fmtDate(result.next_audit_due)}</strong></div>
    <div class="sutra-grid-mini">
      ${Object.entries(result.sutras_compliance).map(([k, v]) => `
        <div class="sutra-chip ${v ? "pass" : "fail"}">${k.replace(/_/g, " ")} <span>${v ? "✓" : "✗"}</span></div>
      `).join("")}
    </div>
  `;
}

async function loadAuditHistory(modelId) {
  if (!modelId) return;
  try {
    const audits = await api(`/audit/models/${modelId}/audits`);
    const tbody = document.querySelector("#audit-history-table tbody");
    const empty = document.getElementById("audit-history-empty");
    if (!audits.length) { tbody.innerHTML = ""; empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");
    tbody.innerHTML = audits.map((a) => `
      <tr>
        <td>${fmtDate(a.created_at)}</td>
        <td>${a.audit_type}</td>
        <td>${a.auditor_ref}</td>
        <td>${badge(a.overall_verdict)}</td>
        <td>${a.explainability_score}</td>
        <td>${(a.findings || []).length}</td>
      </tr>
    `).join("");
  } catch (e) { /* silent */ }
}

document.getElementById("audit-model-select").addEventListener("change", (e) => loadAuditHistory(e.target.value));

document.getElementById("explain-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const obj = formToObject(form);
  const top_features = {};
  (obj.top_features || "").split(",").forEach((pair) => {
    const [k, v] = pair.split(":").map((s) => s.trim());
    if (k && v !== undefined && !isNaN(parseFloat(v))) top_features[k] = parseFloat(v);
  });
  const payload = {
    decision_ref: obj.decision_ref,
    top_features,
    decision_outcome: obj.decision_outcome,
    confidence_score: parseFloat(obj.confidence_score),
    explanation_method: obj.explanation_method || "SHAP",
    human_readable_summary: obj.human_readable_summary,
    is_contestable: true,
  };
  try {
    const result = await api("/audit/explainability/record", { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("explain-result").innerHTML = `
      <div class="result-banner ok" style="margin-top:14px">
        Recorded decision <strong>${result.decision_ref}</strong> → ${result.outcome} (confidence ${result.confidence}). Contestable: ${result.is_contestable ? "Yes" : "No"}.
      </div>`;
    toast("Explainability record saved");
    form.reset();
  } catch (err) {
    toast("Failed: " + err.message, "error");
  }
});

// ── Incidents ────────────────────────────────────────────────────────────────

document.getElementById("btn-new-incident").addEventListener("click", () => {
  document.getElementById("form-report-incident").classList.toggle("hidden");
});
document.getElementById("btn-cancel-incident").addEventListener("click", () => {
  document.getElementById("form-report-incident").classList.add("hidden");
});

document.getElementById("incident-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const obj = formToObject(form);
  if (!obj.model_id) { toast("Select a model first", "error"); return; }
  const model = MODELS_CACHE.find((m) => m.model_id === obj.model_id);
  const payload = {
    model_id: obj.model_id,
    model_name: model ? model.name : "Unknown",
    re_name: obj.re_name,
    functional_area: obj.functional_area,
    incident_category: obj.incident_category,
    severity: obj.severity,
    description: obj.description,
    observed_at: new Date(obj.observed_at).toISOString(),
    detected_at: new Date(obj.detected_at).toISOString(),
    model_risk_level: obj.model_risk_level,
    autonomous_system_involved: !!obj.autonomous_system_involved,
    immediate_action_taken: obj.immediate_action_taken,
    system_suspended: !!obj.system_suspended,
    fallback_activated: !!obj.fallback_activated,
    repeat_incident: !!obj.repeat_incident,
    affected_consumers: obj.ac_count ? {
      count: parseInt(obj.ac_count, 10),
      demographic_segment: obj.ac_segment || null,
      harm_type: obj.ac_harm_type || "unspecified",
      compensation_provided: false,
    } : null,
  };
  try {
    const result = await api("/compliance/incident/report", { method: "POST", body: JSON.stringify(payload) });
    toast(`Incident reported — deadline in ${result.hours_until_deadline.toFixed(1)}h`);
    form.reset();
    document.getElementById("form-report-incident").classList.add("hidden");
    loadIncidents();
    loadSectoralStats();
  } catch (err) {
    toast("Submission failed: " + err.message, "error");
  }
});

async function loadIncidents() {
  try {
    const incidents = await api("/compliance/incident");
    const tbody = document.querySelector("#incidents-table tbody");
    const empty = document.getElementById("incidents-empty");
    if (!incidents.length) { tbody.innerHTML = ""; empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");
    tbody.innerHTML = incidents.map((i) => `
      <tr>
        <td><strong>${i.model_name}</strong><br/><span class="muted">${i.re_name}</span></td>
        <td>${i.category.replace(/_/g, " ")}</td>
        <td>${badge(i.severity)}</td>
        <td>${badge(i.status, i.status === "RESOLVED" || i.status === "CLOSED" ? "COMPLIANT" : "neutral")}</td>
        <td>${i.is_overdue ? `<span style="color:var(--danger)">OVERDUE</span>` : fmtDate(i.reporting_deadline)}</td>
        <td>${i.regulator_notified ? "✅" : "—"}</td>
        <td>
          <select class="status-select" data-id="${i.incident_id}" style="font-size:0.68rem;padding:4px 6px;">
            ${["REPORTED","UNDER_INVESTIGATION","REMEDIATION_IN_PROGRESS","RESOLVED","CLOSED"].map((s) =>
              `<option value="${s}" ${s === i.status ? "selected" : ""}>${s.replace(/_/g, " ")}</option>`).join("")}
          </select>
        </td>
      </tr>
    `).join("");
    tbody.querySelectorAll(".status-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        try {
          await api(`/compliance/incident/${sel.dataset.id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: sel.value, regulator_notified: true }),
          });
          toast("Incident status updated");
          loadSectoralStats();
        } catch (err) { toast("Failed: " + err.message, "error"); }
      });
    });
  } catch (e) {
    toast("Failed to load incidents: " + e.message, "error");
  }
}

async function loadSectoralStats() {
  try {
    const risk = await api("/compliance/incident/sectoral-risk");
    const stats = [
      { label: "Total Incidents", value: risk.total_incidents },
      { label: "Overdue Reports", value: risk.overdue_count, cls: risk.overdue_count ? "danger" : "success" },
      { label: "Active Circuit Breakers", value: risk.circuit_breakers_active, cls: risk.circuit_breakers_active ? "danger" : "success" },
      { label: "Repeat Incident Rate", value: (risk.repeat_incident_rate * 100).toFixed(1) + "%" },
    ];
    document.getElementById("sectoral-stats").innerHTML = stats.map((s) => `
      <div class="stat-box ${s.cls || ""}"><div class="value">${s.value}</div><div class="label">${s.label}</div></div>
    `).join("");
  } catch (e) {
    document.getElementById("sectoral-stats").innerHTML = "";
  }
}

// ── Discover ─────────────────────────────────────────────────────────────────

let LAST_SCAN_DIRECTORY = "";
let LAST_SCAN_PROJECT_ID = "";
let LAST_SCAN_CANDIDATES = [];
let BROWSE_CURRENT_PATH = null;
let BROWSE_TARGET_SELECTOR = '#scan-form input[name="directory"]';

// ── Directory browser modal ──────────────────────────────────────────────────

const browseModal = document.getElementById("browse-modal-overlay");

async function openBrowseModal(startPath, targetSelector) {
  if (targetSelector) BROWSE_TARGET_SELECTOR = targetSelector;
  browseModal.classList.remove("hidden");
  await loadBrowsePath(startPath || null);
}

function closeBrowseModal() {
  browseModal.classList.add("hidden");
}

async function loadBrowsePath(path) {
  const pathLabel = document.getElementById("browse-current-path");
  const listEl = document.getElementById("browse-dir-list");
  const upBtn = document.getElementById("btn-browse-up");
  pathLabel.textContent = "Loading…";
  listEl.innerHTML = "";

  try {
    const qs = path ? `?path=${encodeURIComponent(path)}` : "";
    const result = await api(`/discovery/browse${qs}`);
    BROWSE_CURRENT_PATH = result.current_path;
    pathLabel.textContent = result.current_path;
    upBtn.disabled = !result.parent_path;
    upBtn.dataset.parent = result.parent_path || "";

    if (!result.directories.length) {
      listEl.innerHTML = `<div class="modal-empty">No subdirectories here.</div>`;
      return;
    }
    listEl.innerHTML = result.directories.map((d) => `
      <div class="modal-dir-item" data-path="${d.path}">📁 ${d.name}</div>
    `).join("");
    listEl.querySelectorAll(".modal-dir-item").forEach((el) => {
      el.addEventListener("click", () => loadBrowsePath(el.dataset.path));
    });
  } catch (err) {
    pathLabel.textContent = BROWSE_CURRENT_PATH || "/";
    toast("Could not browse directory: " + err.message, "error");
  }
}

document.getElementById("btn-browse-directory").addEventListener("click", () => {
  const sel = '#scan-form input[name="directory"]';
  const existing = document.querySelector(sel).value.trim();
  openBrowseModal(existing || null, sel);
});
document.getElementById("btn-close-browse-modal").addEventListener("click", closeBrowseModal);
document.getElementById("btn-cancel-browse").addEventListener("click", closeBrowseModal);
document.getElementById("btn-browse-up").addEventListener("click", (e) => {
  const parent = e.currentTarget.dataset.parent;
  if (parent) loadBrowsePath(parent);
});
document.getElementById("btn-select-directory").addEventListener("click", () => {
  if (BROWSE_CURRENT_PATH) {
    document.querySelector(BROWSE_TARGET_SELECTOR).value = BROWSE_CURRENT_PATH;
  }
  closeBrowseModal();
});
browseModal.addEventListener("click", (e) => {
  if (e.target === browseModal) closeBrowseModal();
});

document.getElementById("discover-project-select").addEventListener("change", (e) => {
  const projectId = e.target.value;
  const dirInput = document.querySelector('#scan-form input[name="directory"]');
  if (!projectId) return;
  const project = PROJECTS_CACHE.find((p) => p.project_id === projectId);
  if (project) dirInput.value = project.root_directory;
});

document.getElementById("scan-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const directory = e.target.directory.value.trim();
  const projectId = document.getElementById("discover-project-select").value;
  const card = document.getElementById("scan-result-card");
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Scanning…";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const result = await api("/discovery/scan", {
      method: "POST",
      body: JSON.stringify({ directory, project_id: projectId || null }),
      signal: controller.signal,
    });
    LAST_SCAN_DIRECTORY = directory;
    LAST_SCAN_PROJECT_ID = projectId;
    LAST_SCAN_CANDIDATES = result.candidates;
    document.getElementById("scan-summary").textContent =
      `${result.files_flagged} file(s) flagged in ${directory}`;
    renderCandidates(result.candidates);
    card.classList.remove("hidden");
    toast(`Scan complete — ${result.files_flagged} candidate(s) found`);
  } catch (err) {
    if (err.name === "AbortError") {
      toast("Scan timed out after 20s — the service may be unresponsive. Check that the backend is running.", "error");
    } else {
      toast("Scan failed: " + err.message, "error");
    }
  } finally {
    clearTimeout(timeoutId);
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

function renderCandidates(candidates) {
  const container = document.getElementById("candidates-list");
  if (!candidates.length) {
    container.innerHTML = `<div class="empty-state">No AI/ML/LLM signals detected in this directory.</div>`;
    return;
  }
  container.innerHTML = candidates.map((c, i) => `
    <div class="candidate-card">
      <div class="candidate-head">
        <label><input type="checkbox" class="candidate-checkbox" data-path="${c.file_path}" checked /> <strong>${c.suggested_name}</strong></label>
        ${badge(c.risk_hint, "risk-" + c.risk_hint)}
      </div>
      <div class="candidate-path">${c.file_path}</div>
      ${c.description ? `<div class="candidate-desc" style="margin: 6px 0; font-style: italic; color: var(--muted); font-size: 0.72rem; line-height: 1.3;">"${escapeHtml(c.description)}"</div>` : ""}
      <div class="candidate-meta">
        ${badge(c.model_type_guess, "neutral")}
        ${badge(c.functional_area_guess.replace(/_/g, " "), "neutral")}
        ${badge(c.confidence + " confidence", "neutral")}
      </div>
      ${(c.domain_tags || []).length ? `<div class="candidate-meta">${c.domain_tags.map((t) => `<span class="badge domain-tag">${t}</span>`).join("")}</div>` : ""}
      <div class="candidate-signals">Signals: ${[...new Set(c.signals.map((s) => s.category))].join(", ") || "none"}</div>
      <details class="candidate-gaps">
        <summary>⚠ ${c.gaps.length} governance gap(s) — click to view</summary>
        <ul>${c.gaps.map((g) => `<li>${g}</li>`).join("")}</ul>
      </details>
      
      ${(c.prompts || []).length ? `
        <div class="candidate-prompts" style="margin: 8px 0; background: rgba(0,0,0,0.02); padding: 8px; border-radius: 6px; border: 1px dashed rgba(0,0,0,0.08);">
          <div style="font-weight:bold; font-size:0.7rem; margin-bottom:4px; display:flex; align-items:center; gap:6px;">💬 Discovered Prompts (${c.prompts.length})</div>
          ${c.prompts.map((p) => `
            <div style="font-size:0.68rem; margin-bottom:6px; line-height:1.35;">
              <span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.6rem; padding:1px 4px;">${p.prompt_type}</span>
              ${p.injection_risk === "HIGH" ? `<span class="badge" style="background:#fee2e2; color:#b91c1c; font-size:0.6rem; padding:1px 4px; font-weight:bold;">⚠ Injection Risk</span>` : ''}
              ${(p.pii_detected || []).map((pii) => `<span class="badge" style="background:#fef3c7; color:#d97706; font-size:0.6rem; padding:1px 4px;">🛡️ PII: ${pii}</span>`).join("")}
              <div style="font-style:italic; color:var(--muted); margin-top:2px;">"${escapeHtml(p.raw_text)}"</div>
            </div>
          `).join("")}
        </div>
      ` : ""}

      ${(c.secrets || []).length ? `
        <div class="candidate-secrets" style="margin: 8px 0; background: #fff5f5; border: 1px solid #fee2e2; padding: 8px; border-radius: 6px;">
          <div style="font-weight:bold; font-size:0.7rem; color:#b91c1c; margin-bottom:4px; display:flex; align-items:center; gap:6px;">🚨 Security Vulnerabilities (${c.secrets.length})</div>
          ${c.secrets.map((s) => `
            <div style="font-size:0.68rem; margin-bottom:4px;">
              <strong>${s.type}</strong> on line ${s.line}: <code style="background:rgba(0,0,0,0.05); padding:1px 4px; border-radius:3px;">${s.masked_value}</code>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `).join("");
}

document.getElementById("btn-select-all").addEventListener("click", () => {
  const boxes = document.querySelectorAll(".candidate-checkbox");
  const allChecked = Array.from(boxes).every((b) => b.checked);
  boxes.forEach((b) => (b.checked = !allChecked));
});

document.getElementById("btn-import-selected").addEventListener("click", async () => {
  const selected = Array.from(document.querySelectorAll(".candidate-checkbox:checked")).map((b) => b.dataset.path);
  if (!selected.length) { toast("Select at least one candidate first", "error"); return; }
  const ownerTeam = document.getElementById("import-owner-team").value || "UNASSIGNED — pending review";
  const policyRef = document.getElementById("import-policy-ref").value || "";
  
  let overwrite = false;
  try {
    const qs = LAST_SCAN_PROJECT_ID ? `?project_id=${encodeURIComponent(LAST_SCAN_PROJECT_ID)}` : "";
    const projectModels = await api(`/inventory/models${qs}`);
    const existingPaths = new Set(projectModels.map(m => m.source_ref).filter(Boolean));
    const hasDuplicates = selected.some(path => existingPaths.has(path));
    
    if (hasDuplicates) {
      overwrite = confirm("Some of the selected models are already imported in this project. Do you want to overwrite them?\n\n- Click OK to overwrite (deletes existing model records and adds fresh ones)\n- Click Cancel to skip duplicates and only import new ones.");
    }
  } catch (e) {
    console.error("Duplicate check failed, proceeding with overwrite=false", e);
  }

  try {
    const imported = await api("/discovery/import", {
      method: "POST",
      body: JSON.stringify({
        directory: LAST_SCAN_DIRECTORY,
        project_id: LAST_SCAN_PROJECT_ID || null,
        file_paths: selected,
        owner_team: ownerTeam,
        board_policy_ref: policyRef,
        overwrite: overwrite,
      }),
    });
    if (imported.length > 0) {
      toast(`Imported ${imported.length} model(s) into inventory — open the Model Inventory tab to complete governance`);
    } else {
      toast("No new models were imported (duplicates were skipped)", "info");
    }
    MODELS_CACHE = [];
    loadModels();
    loadProjects();
  } catch (err) {
    toast("Import failed: " + err.message, "error");
  }
});

// ── Projects ─────────────────────────────────────────────────────────────────

/** Show only the codebase-source pane matching the selected radio. */
function syncCodebaseSource() {
  const sel = document.querySelector('#project-form input[name="codebase_source"]:checked');
  const source = sel ? sel.value : "zip";
  ["zip", "folder", "github"].forEach((s) => {
    document.getElementById(`src-pane-${s}`).classList.toggle("hidden", s !== source);
  });
}
document.querySelectorAll('#project-form input[name="codebase_source"]').forEach((r) =>
  r.addEventListener("change", syncCodebaseSource),
);

function openProjectForm(project) {
  const panel = document.getElementById("form-new-project");
  const form = document.getElementById("project-form");
  form.reset();
  ["project-codebase-zip", "project-codebase-folder", "gh-owner", "gh-repo", "gh-branch", "gh-token"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  syncCodebaseSource();
  if (project) {
    document.getElementById("project-form-title").textContent = `Edit Project — ${project.name}`;
    document.getElementById("project-form-submit").textContent = "Save Changes";
    form.project_id.value = project.project_id;
    form.name.value = project.name;
    form.description.value = project.description || "";
  } else {
    document.getElementById("project-form-title").textContent = "New Project";
    document.getElementById("project-form-submit").textContent = "Create Project";
    form.project_id.value = "";
  }
  panel.classList.remove("hidden");
}

document.getElementById("btn-new-project").addEventListener("click", () => {
  const panel = document.getElementById("form-new-project");
  if (!panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
  } else {
    openProjectForm(null);
  }
});
document.getElementById("btn-cancel-project").addEventListener("click", () => {
  document.getElementById("form-new-project").classList.add("hidden");
});

/** Multipart upload — auth header only; the browser sets the multipart boundary. */
async function apiUpload(path, formData) {
  const headers = AUTH_TOKEN ? { "Authorization": `Bearer ${AUTH_TOKEN}` } : {};
  const res = await fetch(API + path, { method: "POST", headers, body: formData });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 401) {
    _clearAuth();
    showAuthOverlay();
    throw new Error("Session expired — please sign in again");
  }
  if (res.status === 413) {
    throw new Error(
      "Upload too large for the server's request limit. Exclude node_modules/build folders, " +
      "use the Upload folder option (it sends only source files), or connect the GitHub repo instead."
    );
  }
  if (!res.ok) {
    const detail = (data && typeof data === 'object' && (data.message || data.detail)) || res.statusText;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data;
}

// Skip these directories and only keep scannable source files — this keeps a
// folder upload tiny and clear of hosting request-size limits.
const CODEBASE_SKIP_DIR_RE = /(^|\/)(node_modules|\.git|\.next|dist|build|out|__pycache__|\.venv|venv|env|vendor|coverage|\.turbo|\.cache|target|\.idea|\.vscode|\.pytest_cache|\.mypy_cache)(\/|$)/;
const CODEBASE_SCAN_EXT = new Set([".py",".ipynb",".ts",".tsx",".js",".jsx",".mjs",".cjs",".go",".java",".rb",".yaml",".yml",".json",".toml",".md",".txt",".env",".cfg",".ini"]);
function shouldUploadCodebaseFile(relPath) {
  if (CODEBASE_SKIP_DIR_RE.test(relPath)) return false;
  const base = relPath.split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "";
  return CODEBASE_SCAN_EXT.has(ext);
}

/** Upload the codebase for a project from whichever source is selected. */
async function uploadProjectCodebase(projectId, source) {
  if (source === "zip") {
    const input = document.getElementById("project-codebase-zip");
    const file = input && input.files.length ? input.files[0] : null;
    if (!file) return null;
    if (file.size > 40 * 1024 * 1024) {
      toast("Large .zip — if the upload is rejected, exclude node_modules or use the folder/GitHub option.", "info");
    }
    toast("Uploading codebase…");
    const fd = new FormData();
    fd.append("file", file);
    return apiUpload(`/projects/${projectId}/codebase`, fd);
  }
  if (source === "folder") {
    const input = document.getElementById("project-codebase-folder");
    const all = input && input.files.length ? [...input.files] : null;
    if (!all) return null;
    // Filter to source files only, client-side, so we never upload dependency
    // trees or binaries (avoids the server request-size limit entirely).
    const files = all.filter((f) => shouldUploadCodebaseFile(f.webkitRelativePath || f.name));
    if (files.length === 0) {
      throw new Error("No source files found in that folder (only node_modules/binaries were present).");
    }
    toast(`Uploading ${files.length} source files (of ${all.length})…`);
    const fd = new FormData();
    // Send the true relative path alongside each file — multer would otherwise
    // reduce the filename to a basename, losing structure and junk filtering.
    for (const f of files) {
      fd.append("files", f);
      fd.append("paths", f.webkitRelativePath || f.name);
    }
    return apiUpload(`/projects/${projectId}/codebase/folder`, fd);
  }
  if (source === "github") {
    const owner = document.getElementById("gh-owner").value.trim();
    const repo = document.getElementById("gh-repo").value.trim();
    if (!owner || !repo) return null;
    toast("Fetching GitHub repository…");
    return api(`/projects/${projectId}/codebase/github`, {
      method: "POST",
      body: JSON.stringify({
        owner,
        repo,
        branch: document.getElementById("gh-branch").value.trim() || undefined,
        token: document.getElementById("gh-token").value.trim() || undefined,
      }),
    });
  }
  return null;
}

/** True when the selected source has enough input to attempt an upload. */
function hasCodebaseInput(source) {
  if (source === "zip") return document.getElementById("project-codebase-zip").files.length > 0;
  if (source === "folder") return document.getElementById("project-codebase-folder").files.length > 0;
  if (source === "github") {
    return !!document.getElementById("gh-owner").value.trim() && !!document.getElementById("gh-repo").value.trim();
  }
  return false;
}

document.getElementById("project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const obj = formToObject(form);
  const isEdit = !!obj.project_id;
  const source = (document.querySelector('#project-form input[name="codebase_source"]:checked') || {}).value || "zip";
  const hasCode = hasCodebaseInput(source);

  if (!isEdit && !hasCode) {
    toast("Add a codebase: upload a .zip or folder, or enter a GitHub owner/repo", "error");
    return;
  }

  const submitBtn = document.getElementById("project-form-submit");
  submitBtn.disabled = true;

  // Step 1: create/update the project. A failure here is a real create failure.
  let projectId = obj.project_id;
  let justCreated = false;
  try {
    if (isEdit) {
      await api(`/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: obj.name, description: obj.description || "" }),
      });
    } else {
      const created = await api("/projects", {
        method: "POST",
        body: JSON.stringify({ name: obj.name, description: obj.description || "", root_directory: "" }),
      });
      projectId = created.project_id;
      justCreated = true;
    }
  } catch (err) {
    toast(`Failed to ${isEdit ? "update" : "create"} project: ` + (err.message || "unknown error"), "error");
    submitBtn.disabled = false;
    return;
  }

  // Step 2: upload the codebase. The project already exists, so a failure here
  // is an UPLOAD failure — report it as such (not "failed to create") and keep
  // the created project so the user can retry without a duplicate-name error.
  try {
    if (hasCode) {
      const up = await uploadProjectCodebase(projectId, source);
      toast(`Codebase ready — ${up.files_extracted} files added${up.entries_skipped ? `, ${up.entries_skipped} skipped` : ""}`);
    } else {
      toast(isEdit ? "Project updated" : "Project created");
    }
    form.reset();
    document.getElementById("form-new-project").classList.add("hidden");
    loadProjects();
  } catch (err) {
    const where = justCreated ? "Project created, but the codebase upload failed" : "Codebase upload failed";
    toast(`${where}: ` + (err.message || "unknown error"), "error");
    // Refresh so the created project appears (retry the upload via its Edit button).
    loadProjects();
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadProjects() {
  try {
    const projects = await api("/projects");
    PROJECTS_CACHE = projects;
    const grid = document.getElementById("projects-grid");
    const empty = document.getElementById("projects-empty");

    if (!projects.length) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    grid.innerHTML = projects.map((p) => `
      <div class="project-card">
        <div class="title">🗂 ${p.name}</div>
        ${p.description ? `<div class="desc">${p.description}</div>` : ""}
        <div class="path">${/[\\/]workspaces[\\/]/.test(p.root_directory || "") ? "📦 uploaded codebase" : p.root_directory}</div>
        <div class="meta-row">
          <span class="badge neutral">${p.model_count} model(s)</span>
          ${p.model_count > 0
            ? `<span class="badge ${p.open_gap_count === 0 ? "COMPLIANT" : "risk-HIGH"}">${p.compliant_count}/${p.model_count} compliant</span>`
            : ""}
          ${p.has_scan_result
            ? `<span class="badge ok">🔎 ${p.models_discovered} AI file(s) discovered</span>`
            : (p.model_count > 0 || p.last_scanned_at)
              ? `<span class="badge ok">🔎 scanned</span>`
              : `<span class="badge risk-HIGH">⚠ not scanned — upload a codebase</span>`}
        </div>
        <div class="actions">
          <button class="btn small primary select-project-btn" data-id="${p.project_id}">⚡ Select &amp; Activate Project</button>
          <button class="btn small ghost edit-project-btn" data-id="${p.project_id}">✏️ Edit</button>
          <button class="btn small ghost delete-project-btn" data-id="${p.project_id}" data-name="${p.name}">🗑 Delete</button>
        </div>
      </div>
    `).join("");

    grid.querySelectorAll(".edit-project-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const project = PROJECTS_CACHE.find((p) => p.project_id === btn.dataset.id);
        if (project) openProjectForm(project);
      });
    });

    grid.querySelectorAll(".select-project-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const project = PROJECTS_CACHE.find((p) => p.project_id === btn.dataset.id);
        if (project) {
          setActiveProject(project.project_id);
          const gSel = document.getElementById("global-project-select");
          if (gSel) gSel.value = ACTIVE_PROJECT_ID;
          updateTabVisibility(true);
          
          if (project.model_count > 0) {
            switchToTab("inventory");
            toast(`Activated Project: ${project.name}`);
          } else {
            switchToTab("discover");
            const pathInput = document.querySelector("#scan-form input[name='directory']");
            if (pathInput) pathInput.value = project.root_directory;
            toast(`Activated Project: ${project.name}. Please scan codebase to discover models first.`, "info");
          }
        }
      });
    });

    grid.querySelectorAll(".delete-project-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const project = PROJECTS_CACHE.find((p) => p.project_id === btn.dataset.id);
        if (!project) return;
        
        let cascade = false;
        if (project.model_count > 0) {
          if (!confirm(`Delete project "${project.name}"?`)) return;
          if (!confirm(`WARNING: This project contains ${project.model_count} registered models. Deleting the project will permanently delete all associated models. Are you sure you want to proceed?`)) return;
          cascade = true;
        } else {
          if (!confirm(`Delete project "${project.name}"?`)) return;
        }
        
        try {
          const qs = cascade ? "?cascade=true" : "";
          await api(`/projects/${project.project_id}${qs}`, { method: "DELETE" });
          toast("Project deleted");
          if (ACTIVE_PROJECT_ID === project.project_id) {
            setActiveProject("");
            updateTabVisibility(false);
            const gSel = document.getElementById("global-project-select");
            if (gSel) gSel.value = "";
          }
          loadProjects();
        } catch (err) {
          toast("Delete failed: " + err.message, "error");
        }
      });
    });
  } catch (e) {
    toast("Failed to load projects: " + e.message, "error");
  }
}

async function loadGlobalProjectSelect() {
  const sel = document.getElementById("global-project-select");
  if (!sel) return;
  try {
    const projects = await api("/projects");
    PROJECTS_CACHE = projects;
    
    if (projects.length === 0) {
      sel.innerHTML = `<option value="">— Create a Project first —</option>`;
      setActiveProject("");
      updateTabVisibility(false);
      return;
    }
    
    sel.innerHTML = `<option value="">— Select a Project —</option>` +
      projects.map((p) => `<option value="${p.project_id}">${p.name}</option>`).join("");
    
    if (ACTIVE_PROJECT_ID && projects.find(p => p.project_id === ACTIVE_PROJECT_ID)) {
      sel.value = ACTIVE_PROJECT_ID;
      updateTabVisibility(true);
    } else {
      ACTIVE_PROJECT_ID = "";
      sel.value = "";
      updateTabVisibility(false);
    }
  } catch (e) {
    sel.innerHTML = `<option value="">Error loading projects</option>`;
  }
}

function refreshActiveTab() {
  const activeTab = document.querySelector(".tab.active");
  if (activeTab) {
    // Re-trigger click handler
    const btn = activeTab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
    
    if (btn.dataset.tab === "projects") loadProjects();
    if (btn.dataset.tab === "overview") loadOverview();
    if (btn.dataset.tab === "inventory") { loadModels(); }
    if (btn.dataset.tab === "monitoring") loadModelSelect("drift-model-select");
    if (btn.dataset.tab === "audit") loadModelSelect("audit-model-select");
    if (btn.dataset.tab === "incidents") { loadModelSelect("incident-model-select"); loadIncidents(); loadSectoralStats(); }
    if (btn.dataset.tab === "discover") {
      const select = document.getElementById("discover-project-select");
      if (select) {
        select.value = ACTIVE_PROJECT_ID;
        select.dispatchEvent(new Event("change"));
      }
    }
    if (btn.dataset.tab === "lineage") loadLineageGraph();
    if (btn.dataset.tab === "docs") loadDocs();
  }
}

async function loadProjectsIntoSelect(selectId) {
  const sel = document.getElementById(selectId);
  const prev = sel.value;
  try {
    const projects = PROJECTS_CACHE.length ? PROJECTS_CACHE : await api("/projects");
    PROJECTS_CACHE = projects;
    const placeholder = sel.querySelector("option[value='']");
    sel.innerHTML = (placeholder ? placeholder.outerHTML : `<option value="">All Projects</option>`) +
      projects.map((p) => `<option value="${p.project_id}">${p.name}</option>`).join("");
    if (prev) sel.value = prev;
  } catch (e) {
    // leave existing options in place
  }
}

document.getElementById("inventory-project-filter").addEventListener("change", () => loadModels());
document.getElementById("lineage-project-filter").addEventListener("change", () => loadLineageGraph());
const globalSelect = document.getElementById("global-project-select");
if (globalSelect) {
  globalSelect.addEventListener("change", (e) => {
    setActiveProject(e.target.value);
    updateTabVisibility(!!ACTIVE_PROJECT_ID);
    if (!ACTIVE_PROJECT_ID) {
      switchToTab("projects");
    } else {
      refreshActiveTab();
    }
  });
}

// ── Close Project button ──────────────────────────────────────────────────────
const closeProjectBtn = document.getElementById("btn-close-project");
if (closeProjectBtn) {
  closeProjectBtn.addEventListener("click", () => {
    setActiveProject("");
    updateTabVisibility(false);
    const gSel = document.getElementById("global-project-select");
    if (gSel) gSel.value = "";
    switchToTab("projects");
    toast("Project closed. Select a project to continue.", "info");
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

// Theme Toggle logic
const themeBtn = document.getElementById("btn-toggle-theme");
if (themeBtn) {
  const currentTheme = localStorage.getItem("theme") || "dark";
  if (currentTheme === "light") {
    document.body.classList.add("light-theme");
    themeBtn.textContent = "🌙 Dark Mode";
  }
  
  themeBtn.addEventListener("click", () => {
    if (document.body.classList.contains("light-theme")) {
      document.body.classList.remove("light-theme");
      themeBtn.textContent = "☀️ Light Mode";
      localStorage.setItem("theme", "dark");
    } else {
      document.body.classList.add("light-theme");
      themeBtn.textContent = "🌙 Dark Mode";
      localStorage.setItem("theme", "light");
    }
  });
}

loadGlobalProjectSelect().then(() => {
  initSutrasCheckboxes();
  checkHealth();
  loadProjects();
  // Restore persisted project session
  if (ACTIVE_PROJECT_ID && PROJECTS_CACHE.find(p => p.project_id === ACTIVE_PROJECT_ID)) {
    _syncProjectBar();
    updateTabVisibility(true);
    const gSel = document.getElementById("global-project-select");
    if (gSel) gSel.value = ACTIVE_PROJECT_ID;
    loadModels();
    loadOverview();
    const proj = PROJECTS_CACHE.find(p => p.project_id === ACTIVE_PROJECT_ID);
    if (proj) toast(`Resumed project: ${proj.name}`);
  } else {
    setActiveProject("");
    updateTabVisibility(false);
    switchToTab("projects");
  }
});

// initDashboard — called after login or on page-load when token already present
function initDashboard() {
  _syncUserChip();
  checkHealth();
  loadGlobalProjectSelect().then(() => {
    initSutrasCheckboxes();
    loadProjects();
    if (ACTIVE_PROJECT_ID && PROJECTS_CACHE.find(p => p.project_id === ACTIVE_PROJECT_ID)) {
      _syncProjectBar();
      updateTabVisibility(true);
      const gSel = document.getElementById("global-project-select");
      if (gSel) gSel.value = ACTIVE_PROJECT_ID;
      loadModels();
      loadOverview();
      const proj = PROJECTS_CACHE.find(p => p.project_id === ACTIVE_PROJECT_ID);
      if (proj) toast(`Resumed project: ${proj.name}`);
    } else {
      setActiveProject("");
      updateTabVisibility(false);
      switchToTab("projects");
    }
  });
}
setInterval(checkHealth, 30000);

// ── Boot sequence ─────────────────────────────────────────────────────────────
// If a JWT token is already in localStorage, skip the overlay and boot straight in.
// Otherwise show the login screen.
if (AUTH_TOKEN) {
  hideAuthOverlay();
  initDashboard();
} else {
  showAuthOverlay();
}

// ── Users Management ─────────────────────────────────────────────────────────

const USER_ROLES = ["VIEWER", "OWNER", "REVIEWER", "APPROVER", "ADMIN", "CISO"];

// Roles the current user may assign. Only a global ADMIN can grant ADMIN; an
// OWNER administers their org and can grant any role up to CISO. Mirrors the
// server-side ceiling — the API rejects an over-reach regardless.
function assignableRoles() {
  if (AUTH_USER && AUTH_USER.role === "ADMIN") return USER_ROLES;
  return USER_ROLES.filter((r) => r !== "ADMIN");
}

async function loadUsers() {
  const tbody = document.querySelector("#users-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "<tr><td colspan='6' class='muted'>Loading users…</td></tr>";
  try {
    const users = await api("/users/");
    tbody.innerHTML = "";
    if (users.length === 0) {
      tbody.innerHTML = "<tr><td colspan='6' class='muted'>No users found.</td></tr>";
      return;
    }
    const roles = assignableRoles();
    users.forEach(u => {
      // Always include the user's current role in the list (even if above the
      // actor's ceiling) so the dropdown renders the real value.
      const options = roles.includes(u.role) ? roles : [u.role, ...roles];
      const roleOptions = options
        .map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`)
        .join("");
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${escapeHtml(u.full_name)}</strong></td>
        <td>${escapeHtml(u.email)}</td>
        <td>
          <select class="user-role-select" style="padding:5px 8px;background:var(--surface-2,#1a2237);color:var(--fg,#e6e9f2);border:1px solid var(--border,#263049);border-radius:6px;font-size:0.8rem;cursor:pointer;"
            onchange="changeUserRole('${u.user_id}','${escapeHtml(u.email)}', this.value)">
            ${roleOptions}
          </select>
        </td>
        <td>${u.organization_name ? escapeHtml(u.organization_name) : '<span class="muted">Global</span>'}</td>
        <td>${u.is_active ? badge("ACTIVE", "ok") : badge("INACTIVE", "critical")}</td>
        <td style="white-space:nowrap;">
          <button class="btn ghost small" onclick="resetUserPassword('${u.user_id}', '${escapeHtml(u.email)}')">Reset Password</button>
          <button class="btn ghost small" onclick="toggleUserActive('${u.user_id}', '${escapeHtml(u.email)}', ${u.is_active})">${u.is_active ? "Deactivate" : "Activate"}</button>
          <button class="btn ghost small" style="color:#f87171;border-color:rgba(239,68,68,0.35);" onclick="deleteUser('${u.user_id}', '${escapeHtml(u.email)}')">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan='6' style="color:var(--critical)">Error loading users: ${err.message}</td></tr>`;
  }
}

async function resetUserPassword(userId, email) {
  const newPwd = prompt(`Enter new password for ${email} (min 8 characters):`);
  if (!newPwd) return;
  try {
    await api(`/users/${userId}/reset-password`, {
      method: "PATCH",
      body: JSON.stringify({ new_password: newPwd })
    });
    toast(`Password reset for ${email}`, "ok");
  } catch (err) {
    toast(err.message, "critical");
  }
}

async function changeUserRole(userId, email, role) {
  try {
    await api(`/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });
    toast(`Role updated to ${role} for ${email}`, "ok");
    loadUsers();
  } catch (err) {
    toast(err.message, "critical");
    loadUsers(); // revert the dropdown to the server's actual value
  }
}

async function toggleUserActive(userId, email, isActive) {
  const action = isActive ? "Deactivate" : "Activate";
  if (!confirm(`${action} ${email}?`)) return;
  try {
    await api(`/users/${userId}`, { method: "PATCH", body: JSON.stringify({ is_active: !isActive }) });
    toast(`${email} ${isActive ? "deactivated" : "activated"}`, "ok");
    loadUsers();
  } catch (err) {
    toast(err.message, "critical");
  }
}

async function deleteUser(userId, email) {
  if (!confirm(`Permanently delete ${email}?\n\nThis cannot be undone. Their audit history is retained.`)) return;
  try {
    await api(`/users/${userId}`, { method: "DELETE" });
    toast(`${email} deleted`, "ok");
    loadUsers();
  } catch (err) {
    toast(err.message, "critical");
  }
}

const btnNewUser = document.getElementById("btn-new-user");
const formNewUser = document.getElementById("form-new-user");
const btnCancelUser = document.getElementById("btn-cancel-user");
const userForm = document.getElementById("user-form");

if (btnNewUser && formNewUser) {
  btnNewUser.addEventListener("click", () => {
    formNewUser.classList.remove("hidden");
    document.getElementById("new-user-name").focus();
    
    // Hide Organization dropdown for org OWNERs — they only create in their org.
    const orgLabel = document.getElementById("new-user-org").parentElement;
    if (AUTH_USER && AUTH_USER.tenant_id) {
      orgLabel.style.display = "none";
    } else {
      orgLabel.style.display = "block";
    }
    // Rebuild the role options from the caller's ceiling (`hidden` on <option>
    // is unreliable across browsers, so we omit ADMIN from the DOM entirely).
    const roleSel = document.getElementById("new-user-role");
    if (roleSel) {
      const labels = { VIEWER: "Viewer", OWNER: "Model Owner", REVIEWER: "Reviewer", APPROVER: "Approver", ADMIN: "Admin", CISO: "CISO" };
      roleSel.innerHTML = assignableRoles().map((r) => `<option value="${r}">${labels[r] || r}</option>`).join("");
    }
  });
}
if (btnCancelUser && formNewUser) {
  btnCancelUser.addEventListener("click", () => {
    formNewUser.classList.add("hidden");
    if(userForm) userForm.reset();
  });
}
if (userForm) {
  userForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("user-form-submit");
    btn.disabled = true;
    btn.textContent = "Creating...";
    
    const payload = {
      full_name: document.getElementById("new-user-name").value,
      email: document.getElementById("new-user-email").value,
      password: document.getElementById("new-user-password").value,
      role: document.getElementById("new-user-role").value,
      organization_id: document.getElementById("new-user-org").value || null
    };
    
    try {
      await api("/users/", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      toast("User created successfully");
      userForm.reset();
      formNewUser.classList.add("hidden");
      loadUsers();
    } catch (err) {
      toast(err.message, "critical");
    } finally {
      btn.disabled = false;
      btn.textContent = "Create User";
    }
  });
}

// ── Organizations Management ───────────────────────────────────────────────────

async function loadOrgs() {
  const tbody = document.querySelector("#orgs-table tbody");
  const orgSelect = document.getElementById("new-user-org");
  if (!tbody) return;
  tbody.innerHTML = "<tr><td colspan='3' class='muted'>Loading organizations…</td></tr>";
  try {
    const orgs = await api("/organizations/");
    tbody.innerHTML = "";
    
    if (orgSelect) {
      orgSelect.innerHTML = '<option value="">Global / None</option>';
    }

    if (orgs.length === 0) {
      tbody.innerHTML = "<tr><td colspan='3' class='muted'>No organizations found.</td></tr>";
      return;
    }
    orgs.forEach(o => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${escapeHtml(o.name)}</strong></td>
        <td>${escapeHtml(o.description)}</td>
        <td>${fmtDate(o.created_at)}</td>
      `;
      tbody.appendChild(tr);

      if (orgSelect) {
        const opt = document.createElement("option");
        opt.value = o.organization_id;
        opt.textContent = o.name;
        orgSelect.appendChild(opt);
      }
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan='3' style="color:var(--critical)">Error loading organizations: ${err.message}</td></tr>`;
  }
}

const btnNewOrg = document.getElementById("btn-new-org");
const formNewOrg = document.getElementById("form-new-org");
const btnCancelOrg = document.getElementById("btn-cancel-org");
const orgForm = document.getElementById("org-form");

if (btnNewOrg && formNewOrg) {
  btnNewOrg.addEventListener("click", () => {
    formNewOrg.classList.remove("hidden");
    document.getElementById("new-org-name").focus();
  });
}
if (btnCancelOrg && formNewOrg) {
  btnCancelOrg.addEventListener("click", () => {
    formNewOrg.classList.add("hidden");
    if(orgForm) orgForm.reset();
  });
}
if (orgForm) {
  orgForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("org-form-submit");
    btn.disabled = true;
    btn.textContent = "Creating...";
    
    const payload = {
      name: document.getElementById("new-org-name").value,
      description: document.getElementById("new-org-desc").value
    };
    
    try {
      await api("/organizations/", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      toast("Organization created successfully");
      orgForm.reset();
      formNewOrg.classList.add("hidden");
      loadOrgs();
    } catch (err) {
      toast(err.message, "critical");
    } finally {
      btn.disabled = false;
      btn.textContent = "Create Organization";
    }
  });
}

