# SentRAI Compliance Console — User Guide

**SentRAI** is a self-hosted AI-governance console for financial services. It turns four regulatory frameworks into software you actually run: it discovers the AI models in your codebase, scores them against **RBI FREE-AI** (*Framework for Responsible and Ethical Enablement of AI*), the **NIST AI RMF**, the **EU AI Act**, and **ISO/IEC 42001**, monitors deployed models for drift, keeps a defensible audit trail, and blocks ungoverned AI from shipping through a CI/CD gate.

This guide explains **every menu item** in detail. Skip to any tab below, or read the short orientation first.

---

## How SentRAI is organized

```
Organization (tenant)
  └── Project           one application's codebase (own scan history + model inventory)
        └── AI Models   the ML / LLM / rules models found in that codebase
              └── Governance   compliance, drift, audits, incidents, CI gate
```

- An **Organization** fully isolates its projects, models, users, and gate history from every other organization.
- A **Project** is one application you want to govern. You create one project per app.
- Most tabs work on the **Active Project** — the project you've selected. Pick one on the **Projects** tab first; the project-scoped tabs then unlock.

---

## The top bar (always visible)

| Element | What it does |
|---|---|
| **SentRAI — Console** | Home / product title. |
| **☀️ Light Mode / 🌙 Dark Mode** | Toggle the colour theme. |
| **● service healthy** | Live backend health indicator. |
| **User chip** | Your name and role (VIEWER, OWNER, REVIEWER, APPROVER, CISO, or ADMIN). |
| **Sign out** | End your session. |
| **Active Project · «name» · × Close Project** | Appears once you activate a project. Shows which project the scoped tabs are working on; **Close Project** returns you to the project list. |

---

## Menu reference

The navigation tabs, in order. Some are visible only for certain roles or once a project is active — that's noted per item.

### 1. Projects
*Visible to: everyone.*

A project tracks **one application's codebase** — its own scan history and its own scoped model inventory. Create one project per app you govern.

**Create a project** with **+ New Project**:
- **Name** and optional **Description**.
- **Codebase source** (pick one):
  - **Upload .zip** — a zip of your source. *Exclude `node_modules` and build folders* before zipping; a very large archive can be rejected by the host's request-size limit.
  - **Upload folder** — select your application's folder; source files upload directly (`node_modules`/`.git` skipped). Best for large or dependency-heavy projects.
  - **GitHub repo** — `owner`, `repository`, `branch` (default `main`), and an optional access token for private repos (used once to download, never stored).

On creation the codebase is uploaded and **scanned automatically**; the card then shows how many AI files were discovered.

**Project card actions:** **⚡ Select & Activate Project** (makes it the Active Project and unlocks the scoped tabs), **✏️ Edit**, **🗑 Delete**.

> **Tip:** You must activate a project to use Overview, Model Inventory, Drift Monitoring, Audit Trail, Incidents, and Lineage Graph.

### 2. Overview
*Visible to: everyone, once a project is active.*

An at-a-glance governance snapshot for the active project: the **Seven Sutras of Responsible AI** (the foundational principles) and a **Compliance Snapshot** — registered models, high-risk count, open gaps, incidents, and active circuit breakers.

### 3. Compliance Rollup
*Visible to: everyone, always.*

The **executive, portfolio-wide** readiness view — the board-level answer. It aggregates across every project you can see, and narrows to the active project if one is selected.

- **Headline banner** — e.g. *"2 of 5 models (40%) fully compliant across all four frameworks; 1 high-risk, 12 blocking control gaps open."*
- **Stat boxes** — Models, Fully Compliant, High-Risk, Open Blocking Gaps.
- **Shift-Left Pre-Deployment Gate** — live signal from the CI ledger: Gate Readiness %, Active Blocked Gates, Shadow AI Assets, Gate Events.
- **Framework Readiness** cards — RBI FREE-AI (7 Sutras), NIST AI RMF, EU AI Act, ISO/IEC 42001 — each with a pass rate and a plain-English readiness line.
- **Most Common Blocking Gaps** — the top control gaps across the portfolio, in plain language (e.g. *"2 models lack a named accountability owner"*).
- **⬇ Readiness PDF** — export a board-ready readiness report.

### 4. CI Gate Ledger
*Visible to: ADMIN, CISO, REVIEWER, APPROVER.*

The immutable, append-only record of **every CI/CD pre-deployment gate decision** — the defensible trail of what your pipeline let through or blocked before it reached production.

**Table columns:** Commit (short hash + PR number), Project, When (relative time), **Verdict** (`PASS` / `FAIL` / `OVERRIDDEN`), Models detected, and **Triage — core reasons** (the governance gaps, with a `SHADOW` badge for ungoverned assets).

**Controls:** verdict filter (All / Failed / Passed) and **↻ Refresh**.

**Audit →** opens the detail modal:
- **Blocking Violations & Flagged Code** — each violation shows the flagged file, the missing controls, and an inline **code viewer** highlighting the exact AST-flagged lines (for example a disguised `from transformers import Pipeline as rogue_ai`).
- **Grant Auditing Sign-Off Override** *(ADMIN / CISO / APPROVER only)* — record a justification to sign off a failed gate. This is **additive**: the original `FAIL` is preserved on the immutable record; the gate then shows as `OVERRIDDEN` with your identity, timestamp, and reason.

This ledger is fed by the CI integration — see **CI/CD integration** below.

### 5. Model Inventory
*Visible to: everyone, once a project is active.*

The register of AI/ML/LLM models in the active project — the "AI inventory" regulators expect you to maintain.

**+ Register Model** captures: Model Name; **Model Type** (Machine Learning, Deep Learning, NLP, Generative AI, Rules-Based, Hybrid); Functional Area (e.g. `credit_underwriting`, `fraud_detection`); Owner Team; Use Case Description; Developed By; Board Policy Reference; Target Customer Segments; Human Oversight Required; Autonomous Scope; and **Sutras Declared** (the seven principle checkboxes).

Each model shows its type, **risk level**, **lifecycle stage**, and a **compliance check** across the frameworks. Close gaps by editing the model's governance fields; lifecycle promotion is **gated on governance completeness** (a model can't advance until its required controls are satisfied).

**🔄 Re-scan Models** re-evaluates every model against the current SentRAI logic and re-reads the codebase for models linked to a source file — updating risk levels where they changed. **Your governance edits (owner, policy, sutras, lifecycle) are preserved.**

### 6. Drift Monitoring
*Visible to: everyone, once a project is active.*

Watch deployed models for drift and keep a safety fallback.

- **Evaluate Model Drift** — pick a model and run drift detection; computes **PSI (Population Stability Index)** and **1-D Wasserstein distance** against the baseline.
- **Circuit breaker** — trips automatically when **PSI > 0.20** or accuracy drops **> 5 percentage points**, signalling the model should fall back.
- **BCP Fallback Status** — the business-continuity posture; a rule-based fallback takes over when the breaker trips, until a human reviews.
- **Drift History** — past evaluations per model.

### 7. Audit Trail
*Visible to: everyone, once a project is active.*

Formal, three-dimensional audits plus the platform's activity log.

- **Initiate Audit** — a risk-based audit across **Input Data**, **Model & Algorithm**, and **Output & Behaviour** → a verdict (*Compliant* / *Conditional* / *Non-Compliant*) and a scheduled next-audit date by risk tier (HIGH = 6 months, MEDIUM = 12 months, LOW = 24 months).
- **Audit History** — past audits per model.
- **Test Decision Explainability** — record and review per-decision explainability evidence (SHAP/LIME-style), for the "understandable by design" requirement.

Separately, **every mutating action** in the platform is written to an immutable, PII-masked audit-event log.

### 8. Incidents
*Visible to: everyone, once a project is active.*

Report and track AI incidents, with sectoral risk intelligence.

- **Report AI Incident** — choose a model, an incident type (Bias / Discrimination, Model Drift, Data Privacy Breach, Explainability Failure, Adversarial Attack, Unintended Autonomous Action), and a severity. Severity sets a reporting deadline: **P1 Critical 6h**, **P2 High 24h**, **P3 Medium 72h**, **P4 Low 7d**.
- The **sectoral risk** dashboard aggregates by category and severity, and flags overdue reports and active circuit breakers.

### 9. Lineage Graph
*Visible to: everyone, once a project is active.*

An interactive dependency graph (built with Cytoscape) of your models and their relationships — trace how models connect and where a change ripples through the system.

### 10. Docs
*Visible to: everyone.*

This guide.

### 11. Users
*Visible to: ADMIN and OWNER.*

Manage the people in your organization.

- **+ Add User** — Full Name, Email, Password, Role. (A global **ADMIN** also picks an Organization; an **OWNER's** new users go into the OWNER's own organization automatically.)
- Per user: change **Role** (inline dropdown), **Reset Password**, **Deactivate / Activate**, **Delete**.
- **Scope & guardrails:** an OWNER sees and manages only their own organization's users and can grant any role **up to CISO** (never ADMIN); a global ADMIN manages everyone. You cannot change your own role, deactivate yourself, or remove the last active admin/owner of an organization.

### 12. Organizations
*Visible to: a global ADMIN (an ADMIN with no organization of their own).*

Manage organizations (tenants). Each organization fully isolates its projects, models, gate ledger, and users from every other. **New Organization** captures a Name and Description.

### 13. AI Settings
*Visible to: ADMIN, CISO, OWNER — because choosing where model code snippets are sent is a governance decision.*

Configure the AI model your organization uses for drafting (✨ Summarize, ✨ Draft rationale, ✨ Draft remediation plan) — bring your own LLM:

- **AI Providers** — pick a preset (OpenAI, Google Gemini, Anthropic Claude, **Ollama for fully local**, OpenRouter, Together.ai, Hugging Face, Groq, Mistral, or any OpenAI-compatible endpoint), enter the base URL, model name, and API key. Keys are encrypted at rest and **never displayed again** — only a mask like `sk-…x4Q2`. Every card shows a **data-egress badge**: 🔒 *Local* means nothing leaves your network; 🌐 *External* means secret-masked snippets are sent to that provider. **⚡ Test** fires a one-token live call so a bad key fails at setup, not first use. Each configured provider is **self-registered in your Model Inventory** (project "AI Governance Tooling") — the LLM you use for governance is itself a governed AI system, with gaps to close like any other.
- **Usage strip** — total AI calls, ok/failed, token in/out counts, and average latency for your organization: cost and reliability at a glance. Every call is also recorded in the audit trail with who invoked it and for what.
- **Prompt Vault** — the exact instructions sent to the AI for each task. Editable per organization; every save is a **new version** (nothing is overwritten), with history, restore, and reset-to-default. Templates use `{{variables}}` filled from the model being processed; removing a required variable is blocked at save.
- **Without any provider configured**, all AI buttons still work using a built-in rule-based engine — fully local, deterministic, and labeled "⚙ Auto-draft" so reviewers know its origin.

All AI output is a **draft with provenance** (✨ AI-drafted / ⚙ Auto-draft / ✓ human-confirmed): a human reviews and saves before it becomes part of the governance record.

### 14. LLM Usage
*Visible to: ADMIN, CISO, OWNER — the people accountable for AI spend and reliability.*

What your organization is actually spending on LLM calls, and how reliably they succeed. Pick a window (7 / 30 / 90 days).

- **Headline figures** — total calls, success rate, tokens in/out, average and p95 latency. A success rate below 90% turns red.
- **Daily volume** — one bar per day, with failures stacked in red above successes, so a bad day is obvious at a glance.
- **Breakdowns** — by use case (summary, risk rationale, gap remediation, executive narrative), by model, by provider, and by actor, each with call counts, token totals and average latency. This is what answers "who is driving the spend".
- **Recent failures and recent calls** — the individual events behind the numbers, including who invoked them.

Only calls that actually reach a configured provider are counted. Generations that fall back to the built-in rule-based engine cost no tokens and are deliberately **not** recorded as LLM usage — so an empty dashboard with a busy inventory means no provider is configured, not that nothing happened.

Scans generate summaries, risk rationales and remediation plans automatically, so this is also where the cost of that automation shows up.

### 15. Alignment
*Board sign-off and periodic re-certification — the workflows that keep every AI system doing what the institution sanctioned.*

Two governance workflows, switchable with the **Approvals / Attestations** toggle at the top.

- **Review-board approvals** — a **MEDIUM/HIGH-risk model cannot be promoted to a live stage (DEPLOYED / MONITORING) until it has a recorded board sign-off**. An owner clicks **Request** (choosing the target stage and how many approvals are needed), then one or more independent approvers (APPROVER / CISO / ADMIN) **Approve** or **Reject**. The **requester can never decide their own request** (separation of duties), and no approver votes twice. Once the approval quorum is met, a **Promote** button takes the model live. Every request, vote, and promotion is written to the model ledger. LOW-risk models keep the lighter self-service path.
- **Attestation campaigns** — periodic re-certification of the active inventory. Open a campaign (title, cadence in days, optional risk-tier scope) and it **snapshots every in-scope active model into a checklist**. Owners **Attest** (still within sanctioned scope) or **Flag** (needs review) each one; a flag escalates immediately. Items left pending past the due date are escalated automatically by the daily job. Progress and flagged counts show on each campaign.
- **Behavioral eval evidence** — on a model's *Close Governance Gaps* screen, the **Behavioral eval evidence** box ingests eval-harness output (promptfoo / garak / PyRIT: suite name + passed/total) as a typed `behavioral_eval` evidence artifact with its parsed pass-rate, so a reviewer sees test *results*, not just a link.

*Visible to: everyone can view; deciding approvals is limited to APPROVER / CISO / ADMIN, and opening campaigns to OWNER / APPROVER / CISO / ADMIN.*

---

## Roles & permissions

| Role | Typical use | Scope of authority |
|---|---|---|
| **VIEWER** | Read-only stakeholder | View the dashboards and data they're scoped to. |
| **OWNER** | Organization / model owner | Administer their own org's **users** (up to CISO), projects, and models. |
| **REVIEWER** | Auditor | Review the CI Gate Ledger and audits. |
| **APPROVER** | Sign-off authority | As reviewer, **plus** grant gate sign-off overrides. |
| **CISO** | Compliance leadership | Broad governance authority within the organization. |
| **ADMIN** | Global superuser | Everything, across **all** organizations. |

Organization isolation is enforced everywhere: a non-admin user only ever sees and acts on their own organization's data.

---

## CI/CD integration (the shift-left gate)

Stop ungoverned AI *before* it ships:

1. An **ADMIN/CISO mints a CI service token** (`POST /api/v1/ci/tokens`) and stores it as a pipeline secret named `SENTRAI_CI_TOKEN`.
2. Add the SentRAI gate to your pipeline — a ready-made **GitHub Action** and **GitLab** template live under `ci-integration/`. On each push or PR it sends the changed source to `POST /api/v1/ci/scan`.
3. SentRAI scans for AI usage, evaluates it against your **`.sentrai/policy.yaml`** (policy-as-code; it falls back to safe defaults if the file is absent), and returns a **pass/fail verdict plus SARIF** (rendered natively in GitHub/GitLab security tabs). A failing gate exits non-zero and blocks the deploy.
4. Every decision is recorded in the **CI Gate Ledger**, where an auditor can review the flagged code and, if justified, sign off an override.

---

## Tips & troubleshooting

- **Large or dependency-heavy repos:** use **Upload folder** or **GitHub repo** rather than a `.zip` — a big archive can exceed the host's upload limit.
- **"Not scanned" on a project card:** upload a codebase (zip/folder/GitHub); scanning runs automatically on upload and the result is stored.
- **Can't see a tab:** Overview, Model Inventory, Drift Monitoring, Audit Trail, Incidents, and Lineage Graph need an **active project**; the CI Gate Ledger, Users, and Organizations tabs are **role-gated** (see above).
- **Data & deployments:** hosted deployments run on a persistent MariaDB, so your data survives application updates. (The interactive Swagger API explorer is intentionally disabled in production.)

---

## Appendix — the frameworks behind SentRAI

SentRAI operationalizes India's **RBI FREE-AI** framework alongside three global standards, mapping a single assessment to all four.

The RBI FREE-AI report is anchored in **7 Sutras** (guiding principles), operationalized through **6 Pillars** and **26 Recommendations**.

![7 Sutras Guiding Principles](images/seven-sutras.png)

This app implements the **Governance**, **Protection**, and **Assurance** pillars end-to-end (Recommendations 14–26) as working software — not just policy text.

![Pillar Roadmap — 7 Sutras, 6 Pillars, 26 Recommendations](images/pillar-roadmap.png)

| Pillar | What it covers | Where it lives in this app |
|---|---|---|
| **Governance** | Board-approved AI policy, data lifecycle, model governance, product approval | Model Inventory (governance fields, lifecycle stages) |
| **Protection** | Consumer protection, cybersecurity, red-teaming, BCP, incident reporting | Drift Monitoring (circuit breakers, BCP), Incidents |
| **Assurance** | AI inventory & repository, audit framework, disclosures | Model Inventory, Projects (codebase scan), Audit Trail |

> The **Infrastructure**, **Policy**, and **Capacity** pillars (Recommendations 1–13) are sector-level recommendations aimed at regulators and the broader ecosystem — referenced for context, but not something a single tool implements for you.

### The 26 RBI FREE-AI Recommendations

**Innovation Enablement — Infrastructure Pillar**
1. **Financial Sector Data Infrastructure** — a high-quality financial-sector data infrastructure as digital public infrastructure, integrated with the AI Kosh.
2. **AI Innovation Sandbox** — a secure, controlled environment for AI development by REs, FinTechs, and innovators.
3. **Incentives and Funding Support** — incentive structures and infrastructure for inclusive AI usage among smaller entities.
4. **Indigenous Financial-Sector AI Models** — indigenous models (LLMs/SLMs or non-LLM) tailored to the financial sector as a public good.
5. **Integrating AI with DPI** — a framework to integrate AI with Digital Public Infrastructure for affordable services at scale.

**Innovation Enablement — Policy Pillar**
6. **Adaptive and Enabling Policies** — a comprehensive AI policy framework anchored in the 7 Sutras.
7. **Enabling AI-Based Affirmative Action** — AI innovation that accelerates financial inclusion for underserved sections.
8. **AI Liability Framework** — a graded liability framework that keeps REs liable but accommodates one-off aberrations.
9. **AI Institutional Framework** — a permanent multi-stakeholder AI Standing Committee under the RBI.

**Innovation Enablement — Capacity Pillar**
10. **Capacity Building within REs** — AI governance competencies for the Board/C-suite and workforce upskilling.
11. **Capacity Building for Regulators and Supervisors** — training and institutional capacity for supervisors.
12. **Framework for Sharing Best Practices** — an industry-driven exchange of use cases and governance practices.
13. **Recognise and Reward Responsible AI Innovation** — programs that reward responsible, high-impact AI.

**Risk Mitigation — Governance Pillar**
14. **Board-Approved AI Policy** — governance structure, accountability, risk appetite, safeguards, and model-lifecycle framework.
15. **Data Lifecycle Governance** — controls for data collection, usage, retention, and deletion (DPDP Act compliant).
16. **AI System Governance Framework** — lifecycle governance with mandatory human oversight before autonomous deployment.
17. **Product Approval Process** — AI-enabled products within the product-approval framework, with AI-specific risk evaluations.

**Risk Mitigation — Protection Pillar**
18. **Consumer Protection** — transparency, fairness, accessible recourse, and customer education.
19. **Cybersecurity Measures** — identify AI-introduced risks and use AI for dynamic threat detection.
20. **Red Teaming** — structured red-teaming across the lifecycle, proportionate to risk.
21. **Business Continuity Plan for AI Systems** — BCP covering AI-specific performance degradation and drift.
22. **AI Incident Reporting & Sectoral Risk Intelligence** — a good-faith incident-reporting framework for system-wide learning.

**Risk Mitigation — Assurance Pillar**
23. **AI Inventory & Sector-Wide Repository** — a semi-annually updated internal AI model inventory.
24. **AI Audit Framework** — a calibrated, risk-based audit spanning inputs, models, and outputs.
25. **Disclosures by REs** — standardized public disclosures on AI governance and metrics.
26. **AI Toolkit** — a standardized toolkit to validate, benchmark, and demonstrate compliance.
