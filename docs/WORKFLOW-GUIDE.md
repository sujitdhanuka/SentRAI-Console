# SentRAI Workflow Guide

This guide walks through SentRAI the way a team actually uses it: from importing a codebase for the first time to producing a board report and keeping the pipeline gated. Each stage says **what you do**, **where in the console**, **who can do it**, and **what SentRAI does behind the scenes**, with the matching API call for teams that automate.

For a tab-by-tab reference of every screen, see the in-app **Docs** page (`public/docs/HELP.md`). For the pipeline gate, see [CI-WORKFLOW.md](CI-WORKFLOW.md).

---

## The workflow at a glance

```
 0. Set up          org, users, roles, AI provider
        │
 1. Import code     Projects → New Project → GitHub / Zip / Folder
        │
 2. Detect models   automatic scan → review candidates → import into inventory
        │
 3. Triage          risk tier, framework checks, open-gaps queue
        │
 4. Plan audits     governance calendar, audit cadence by risk tier, owners
        │
 5. Test & audit    bias / eval / red-team evidence, drift baseline, 3-dimension audit
        │
 6. Review findings audit findings, verdicts, CI gate violations
        │
 7. Close gaps      model page → Save & Re-check
        │
 8. Approve & ship  board sign-off → lifecycle promotion → CI gate
        │
 9. Operate         drift, runtime telemetry, incidents, grievances, kill switch
        │
10. Report          Compliance Rollup, Readiness PDF, Board Report, audit trail
        │
        └──► repeat: re-scan, attestation campaigns, next audit due
```

| Stage | Console location | Typical role |
|---|---|---|
| 0. Set up | Organizations, Users, AI Settings | ADMIN, OWNER |
| 1. Import code | Projects | OWNER, CISO, ADMIN |
| 2. Detect models | Scan results review → Model Inventory | OWNER, APPROVER, CISO, ADMIN |
| 3. Triage | Model Inventory, Compliance Rollup | everyone |
| 4. Plan audits | Model Inventory (Governance Calendar), Audit Trail | CISO, OWNER |
| 5. Test & audit | Model page, Drift Monitoring, Audit Trail | model owners, auditors |
| 6. Review findings | Audit Trail, CI Gate Ledger | REVIEWER, CISO |
| 7. Close gaps | Model Inventory → Edit | model owners |
| 8. Approve & ship | Alignment, CI Gate Ledger | APPROVER, CISO |
| 9. Operate | Drift Monitoring, Runtime Visibility, Incidents, Consumer Grievances | operations, CISO |
| 10. Report | Compliance Rollup, Audit Trail | CISO, board |

---

## Stage 0 — Set up the workspace

Do this once per organization.

1. **Sign in.** Open `/console`. On a fresh install the seeded admin is `admin@sentrai.local` (password from `SEED_ADMIN_PASSWORD`, or `admin123` in local dev). Change it immediately.
2. **Create the organization** *(global ADMIN)*: **Organizations → New Organization**. Each organization is fully isolated: projects, models, gate history and users never cross tenants.
3. **Add users** *(ADMIN, OWNER)*: **Users → + Add User**. Pick least-privilege roles:

   | Role | Use it for |
   |---|---|
   | VIEWER | Read-only stakeholders |
   | OWNER | Org / model owners; manage their org's users (up to CISO), projects and models |
   | REVIEWER | Auditors reviewing audits and the CI Gate Ledger |
   | APPROVER | Board sign-off and CI gate overrides |
   | CISO | Broad governance authority in the org; mints CI tokens; kill switch |
   | ADMIN | Global superuser across all organizations |

4. **Choose the AI drafting provider** *(ADMIN, CISO, OWNER)*: **AI Settings → AI Providers**. Pick a preset (OpenAI, Anthropic, Gemini, Ollama for fully local, any OpenAI-compatible endpoint), enter URL, model and key, then **⚡ Test**. Keys are encrypted at rest (`APP_ENCRYPTION_KEY`). With no provider configured, every ✨ button falls back to the built-in rule-based drafter ("⚙ Auto-draft"), so nothing is blocked.
   - The provider you configure is registered automatically in the inventory under the project **"AI Governance Tooling"**, so the LLM used for governance is governed too.
   - Optional: edit the prompts SentRAI sends in **AI Settings → Prompt Vault** (every save is a new version).

---

## Stage 1 — Import code (create a project)

A **project** is one application's codebase with its own scan history and model inventory. Create one project per app you govern.

**Console:** **Projects → + New Project**. The wizard has two steps.

1. **Name** — project name and optional description.
2. **Codebase** — pick one source:

   | Source | When to use | Notes |
   |---|---|---|
   | **GitHub** | Repo is on GitHub | Paste the repo URL. A `…/tree/<branch>` URL sets the branch for you; otherwise enter it (default `main`). Private repos need an access token, which is used once to download and is never stored. |
   | **Zip** | Offline / air-gapped, or quick one-off | Exclude `node_modules` and build folders first; very large archives can hit the host's upload limit. |
   | **Folder** | Large or dependency-heavy repos | Uploads source files directly and skips `node_modules` / `.git`. |

3. Click **Import & scan**. The scan starts automatically.

**Then:** on the project card, click **⚡ Select & Activate Project**. Most tabs (Model Inventory, Drift Monitoring, Audit Trail, Incidents, Lineage) work on the active project.

**API equivalent**

```bash
# create the project
curl -X POST "$SENTRAI_URL/api/v1/projects" -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" -d '{"name":"Retail Lending","description":"Core lending app"}'

# attach a GitHub codebase (scans automatically)
curl -X POST "$SENTRAI_URL/api/v1/projects/$PROJECT_ID/codebase/github" -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" -d '{"owner":"acme","repo":"lending","branch":"main"}'
# zip upload:     POST /api/v1/projects/:projectId/codebase          (multipart)
# folder upload:  POST /api/v1/projects/:projectId/codebase/folder   (multipart)
```

> **Re-importing** a repo (for example a feature branch via its `/tree/<branch>` URL) re-scans it. Models already in the inventory are matched and merged rather than duplicated, and known files have their line numbers refreshed.

---

## Stage 2 — Detect models (discovery and inventory)

### What the scanner looks for

The scanner walks the source with **tree-sitter AST parsing plus regex**, resolving aliases (a renamed client like `from transformers import Pipeline as rogue_ai` is still attributed to its SDK) and lightweight data flow (`from_pretrained`, ONNX `InferenceSession`, artifact loads). It finds:

- **LLM calls** (OpenAI, Anthropic, Gemini, Hugging Face, and others)
- **ML / DL models** (scikit-learn, XGBoost, PyTorch, TensorFlow, ONNX, …)
- **Agents** (LangChain and similar) and the **tools/capabilities** they invoke: named tools (`@tool`, `server.tool("…")`) and primitives like shell exec, network egress, filesystem writes, database, cloud, email, payments
- **MCP servers**
- **Embedded prompts** and **hardcoded secrets** (one shared pattern library covering AWS, GitHub, Google, Slack, Stripe, provider keys, JWTs, PEM keys)

Each scan reports its `ast_coverage`. Infrastructure (Kubernetes / Triton) can be scanned separately via `POST /api/v1/discovery/scan-infrastructure`.

### Review the candidates

When the scan finishes, the **scan results review** opens:

1. **Check each candidate.** Columns show the component, confidence, and where it was found. Expand a row to see the **detection evidence**: every signal with its line number and the matched code (e.g. `L8  LLM_API_CALL  openai.chat.completions.create(`), plus any prompts and secrets.
2. **Watch the risk floor.** A file with a hardcoded secret is floored to **HIGH** risk regardless of self-assessment. LLM/agent usage in a sensitive path (credit, loan, fraud, anomaly, trading) is also classed HIGH.
3. **Set batch governance fields** in the footer (optional but recommended): **Owner team** (default `UNASSIGNED — pending review`) and **Board policy reference** (e.g. `BP-AI-2026-04`).
4. Click **Import N into inventory**, or **Skip for now**. The toast reports *"N new · M merged"*.

**Merging.** If the same model appears in several files (for example a batch job and a service), SentRAI merges them into one record that lists every source file, and writes a merge event to the model ledger. A model's **Source** section lists each file with the line numbers where it was found.

**Auto-drafted governance.** On import, SentRAI drafts the **use-case summary**, **risk rationale** and a **gap-remediation plan** for each model. Each draft carries provenance (✨ AI-drafted / ⚙ Auto-draft / ✓ human-confirmed) and only becomes part of the record once a human saves it.

### Models that aren't in code

Models whose only trace is a row in your application's database are invisible to a code scan. Register them:

- **Manually:** **Model Inventory → + Register Model** (name, type, functional area, owner team, use case, board policy, customer segments, human oversight, autonomous scope, Sutras declared).
- **In bulk / on a schedule:** `ci-integration/sync-models.mjs` pushes rows from a JSON export (or your DB) into the inventory. It is idempotent. See [CI-WORKFLOW.md § Sync models](CI-WORKFLOW.md#5-keep-the-inventory-in-sync-from-your-database).

### Keep it current

**Model Inventory → 🔄 Re-scan Models** re-reads the codebase for models linked to a source file and re-evaluates risk. Your governance edits (owner, policy, Sutras, lifecycle) are preserved.

**API equivalent**

```bash
POST /api/v1/discovery/scan            # scan uploaded code, returns candidates
POST /api/v1/discovery/scan-remote     # scan a GitHub/GitLab repo
POST /api/v1/discovery/import          # import reviewed candidates into the inventory
POST /api/v1/inventory/models          # register a model by hand
POST /api/v1/inventory/models/rescan   # body: {"project_id": "..."}
GET  /api/v1/inventory/models          # list the inventory
```

---

## Stage 3 — Triage: understand risk and gaps

Open **Model Inventory** with the project active.

- **Asset-kind filter** — **All · LLM · ML · Agents · MCP** narrows the matrix, KPI band, gaps queue and calendar to one kind of asset.
- **KPI band** — registered models, high-risk count, open gaps, incidents, active circuit breakers.
- **Compliance matrix** — one row per model with its type, **risk level**, **lifecycle stage**, drift state, and a pass/fail per framework: **RBI FREE-AI (7 Sutras)**, **NIST AI RMF**, **EU AI Act**, **ISO/IEC 42001**.
- **Open Gaps · Prioritized** — every failing control, sorted overdue-first then by severity (HIGH, MED, LOW), tagged with its framework. A gap is a computed finding, not a to-do: it clears only when its cause is fixed. Clicking one opens that model in the governance workspace.

For the portfolio view across all projects, open **Compliance Rollup**: headline readiness, framework pass rates, the most common blocking gaps in plain English, and the CI gate signal (gate readiness %, blocked gates, shadow AI assets).

**Prioritize in this order:** shadow / unregistered HIGH models → models with hardcoded secrets → HIGH models missing owner or board policy → overdue audits → everything else.

---

## Stage 4 — Set up the audit plan

SentRAI builds the audit plan from each model's risk tier and dates, and shows it on the **Governance Calendar** in Model Inventory.

### 4.1 Know the cadence

| Risk tier | Audit interval (`next_audit_due`) | Red-team review: compliance checks | BCP drill (`GOVERNANCE_V2` on) |
|---|---|---|---|
| HIGH / CRITICAL | every 6 months (180 days) | within 90 days with `GOVERNANCE_V2` on; within 365 days when off | a passed drill within 365 days |
| MEDIUM | every 12 months (365 days) | within 180 days with `GOVERNANCE_V2` on; within 365 days when off | recommended |
| LOW | every 24 months (730 days) | within 365 days | recommended |

With `GOVERNANCE_V2` off (the default), the NIST red-team check (MEASURE-2.7) uses one 12-month rule for every tier and Sutra 7 only needs a red-team record for HIGH models. With it on, both use the per-tier intervals above (RBI FREE-AI Rec 20: frequency proportionate to risk), CRITICAL models follow the HIGH rules, and HIGH / CRITICAL models also need a passed BCP drill (Rec 21; record drills on the Monitoring page, interval `BCP_DRILL_INTERVAL_DAYS`). A failed drill is recorded but does not count. The Governance Calendar still shows red-team reviews 90 days after the last one for every tier.

The next-audit date is set automatically each time an audit is recorded. You can also set `next_audit_due` and `last_red_team_date` when registering a model, which seeds the calendar for models that have never been audited in SentRAI.

### 4.2 Build the plan

1. **Assign accountability.** For every model in scope, set **Owner team** and **Board policy reference** on the model page (Model Inventory → select model → **Open model page**); name a person as owner next to the team. Audits and attestations route to owners.
2. **Set the red-team baseline.** Enter **Last red-team date** for each model that has been tested. The calendar then shows each model's next red-team review.
3. **Seed first audits.** For models never audited, run an initial audit (Stage 5.4) so SentRAI stamps `next_audit_due`. Start with HIGH models.
4. **Read the Governance Calendar.** It lists the next ten dates in the active scope: `<model> · audit due`, `<model> · red-team review`, and `<model> · drift review` (shown as *now* when drift is in alert). Overdue items are highlighted in red. Select a model to scope the calendar to it.
5. **Schedule re-certification.** In **Alignment → Attestations**, open an attestation campaign: title, cadence in days, optional risk-tier scope. SentRAI snapshots every in-scope active model into a checklist for owners to **Attest** or **Flag**. A daily job escalates items still pending past the due date.
6. **Decide on the gate policy.** Decide which evidence is mandatory before deploy (for example a bias test for every HIGH model) and encode it in `.sentrai/policy.yaml`. See [CI-WORKFLOW.md](CI-WORKFLOW.md#3-write-the-policy).

> **Tip:** run the attestation campaign on the same cadence as your HIGH-tier audits (180 days) so owners re-confirm scope just before each audit.

---

## Stage 5 — Run tests and audits

### 5.1 Bias tests

A bias-test report is attached to the model as a typed **`bias_test` evidence artifact**. It satisfies the RBI FREE-AI **Fairness & Equity** Sutra and the `bias_test_evidence` requirement in CI policies.

```bash
curl -X POST "$SENTRAI_URL/api/v1/inventory/models/$MODEL_ID/evidence" \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"type":"bias_test",
       "ref":"https://reports.example.com/fraud-graph/bias-test-2026-11.pdf",
       "description":"Disparate impact by gender/age/region; all ratios within 0.8–1.25"}'

GET /api/v1/inventory/models/$MODEL_ID/evidence     # list attached artifacts
```

In the console, use **Attach evidence** on the model's governance record (model page → Overview, or Quick edit): pick the type, give the report link and, optionally, the controlled document it belongs to. Other evidence types use the same endpoint: `model_card`, `dpia`, `explainability`, `validation_report`, `data_sheet`. A bias test is not a red team: don't put its date in the red-team record.

### 5.2 Behavioral evals (LLMs and agents)

**Model page → Overview → Behavioral eval evidence.** Ingest an eval run (promptfoo, garak, PyRIT, or a custom suite: suite name plus passed/total). It is stored as a `behavioral_eval` artifact with its pass rate, so reviewers see results, not just a link.

```bash
POST /api/v1/inventory/models/:modelId/eval-evidence
{"suite":"promptfoo","passed":47,"total":50,"report_ref":"…","failed_checks":["pii-leak-3"]}
```

### 5.3 Red-team / adversarial tests

**Model page → Overview → Record red team** (the same form is on Governance → Red team & audit). There is one red-team record: enter the date, the reviewer's summary and the report link (required for HIGH and CRITICAL models), and optionally the tool results: suite, total probes, breaches and categories such as jailbreak, prompt injection, PII leak, toxicity. SentRAI stores one `red_team` artifact and sets the model's last-red-team date in one step; the date isn't typed anywhere else. A breach notifies the governance contacts.

```bash
POST /api/v1/governance/models/:modelId/red-team
{"performed_at":"2026-11-10","summary":"Quarterly garak run, 3 breaches triaged","ref":"https://…/report",
 "suite":"garak","total_probes":400,"failures":3,"categories":["jailbreak","prompt_injection"]}
```

The older `POST /api/v1/inventory/models/:modelId/adversarial-evidence` still works for pipelines that already call it.

### 5.4 Drift baseline

Drift checks need a **reference** window (training/validation scores) and a **live** window (production scores). Serving systems push them; SentRAI computes **PSI** and **1-D Wasserstein distance**.

```bash
POST /api/v1/monitoring/scores/:modelId   {"kind":"reference","scores":[…],"accuracy":0.91}
POST /api/v1/monitoring/scores/:modelId   {"kind":"live","scores":[…],"accuracy":0.90}
POST /api/v1/monitoring/drift/:modelId/evaluate
```

Or in the console: **Drift Monitoring → Evaluate Model Drift**. A fresh evaluation satisfies the NIST **Measure** and ISO/IEC 42001 **9.1** monitoring checks. Drift evidence expires after 30 days, so have serving push live scores regularly.

### 5.5 The formal audit

**Audit Trail → Initiate Audit** (model selected). Fill in:

- **Audit type** — Internal, Third party, or Supervisory
- **Auditor reference**
- The three-dimension checklist:

| Dimension | Checks |
|---|---|
| **Input data** | training-data bias checked · data consent verified · data sources documented · sensitive attributes excluded |
| **Model & algorithm** | architecture reviewed · decision logic documented · adversarial robustness tested · performance benchmarks met |
| **Output & behaviour** | fairness metrics · explainability score · BCP verified · human override tested |
| **7 Sutras** | trust · human oversight · innovation · fairness metrics passed · accountability chain · explainability |

SentRAI records the audit with an initial verdict (**COMPLIANT** when checks pass and all Sutras hold, otherwise **CONDITIONAL**) and sets the model's next audit date from its risk tier.

```bash
POST /api/v1/audit/models/:modelId/initiate
{"auditor_ref":"IA-2026-031","audit_type":"INTERNAL","audit_period_days":180,
 "training_data_bias_checked":true,"data_sources_documented":true,
 "model_architecture_reviewed":true,"fairness_metrics":{"disparate_impact":0.91},
 "explainability_score":0.78,"human_override_tested":true, "...": "..."}
```

### 5.6 Explainability evidence

**Audit Trail → Test Decision Explainability** records per-decision explanations (SHAP/LIME-style top features, outcome, confidence, a human-readable summary, and whether the decision is contestable).

```bash
POST /api/v1/audit/explainability/record
```

---

## Stage 6 — Review findings

Findings come from three places.

### 6.1 Audit findings

In **Audit Trail → Audit History**, open an audit and **add a finding**: category, severity, description, the Sutra violated (optional), and a remediation deadline in days. Findings move the verdict:

| Finding severity | Effect on the audit verdict |
|---|---|
| `critical` | → **NON_COMPLIANT** |
| `major` | → **CONDITIONAL** |
| `minor`, `observation` | verdict unchanged |

Each finding starts with remediation status **OPEN** and a deadline.

```bash
POST /api/v1/audit/models/:modelId/findings/:auditId
{"category":"data","severity":"major","description":"Region used as a proxy for caste",
 "sutra_violated":"FAIRNESS_AND_EQUITY","remediation_deadline_days":30}
```

### 6.2 Framework gaps

The **Open Gaps** queue (Stage 3) is a live list of every failing framework control. Open a model's **Close Governance Gaps** drawer to see verdict cards per framework with the exact control and what's missing.

### 6.3 CI gate violations

**CI Gate Ledger → Audit →** on a failed event shows each blocking violation, the flagged file and line in an inline code viewer, the missing controls, and the exact SARIF the pipeline uploaded. See [CI-WORKFLOW.md § Review gate results](CI-WORKFLOW.md#7-review-gate-results-in-the-console).

### 6.4 Verify the record

**Audit Trail → activity log → Verify chain** recomputes the SHA-256 hash chain over every audit event. Any edited, deleted or reordered record breaks the chain and the verdict names where.

---

## Stage 7 — Close gaps

**Model Inventory → select a model → Open model page.** The Overview tab shows verdict cards on the left and the governance record on the right; the other tabs hold the model's context, risks, impact assessments, tests, approvals, operations and suppliers. **Quick edit** opens the same record in a popup without leaving the inventory.

1. Fix the fields behind each gap:

   | Field | Typically clears |
   |---|---|
   | Owner team and named owner | accountability gaps (RBI, NIST Govern, ISO) |
   | Board policy reference (pick an approved AIMS policy) | board-approved policy gaps (RBI Rec. 14, ISO) |
   | Human oversight / Autonomous scope | human-in-the-loop gaps (RBI People First, EU AI Act) |
   | Sutras declared | 7 Sutras alignment |
   | Record red team (Stage 5.3) | red-teaming (RBI Rec. 20, NIST Measure) |
   | Behavioral eval evidence | eval / measurement gaps |
   | `bias_test` evidence (Stage 5.1) | Fairness & Equity Sutra, `bias_test_evidence` in CI |
   | Tool authorization | agent tool-boundary violations |
   | Use case description / Risk rationale / Remediation plan | documentation gaps (use ✨ Draft, then review) |

2. Click **Save & Re-check**. Verdicts recompute in place, and fixed gaps drop out of the queue.
3. **Tool authorization (agents and MCP servers).** In **Tool Authorization**, tick the tools the model is *permitted* to use. Any detected tool left unticked is a violation and blocks the CI gate.
4. **Remediate audit findings** with the same edits, then record a follow-up audit so the verdict and next-due date update.
5. **Re-scan** if the fix was in code (for example removing a hardcoded secret), so the risk floor lifts.

```bash
PATCH /api/v1/inventory/models/:modelId/governance
{"owner_team":"Fraud Engineering","board_policy_ref":"BP-AI-2026-04",
 "human_oversight_required":true,"permitted_tools":["lookup_statement"],"actor":"jane@acme"}
GET   /api/v1/inventory/models/:modelId/compliance-check
```

---

## Stage 8 — Approve and ship

### 8.1 Board sign-off

A **MEDIUM- or HIGH-risk model cannot move to DEPLOYED or MONITORING without a recorded board approval.**

1. **Alignment → Deployment approvals → Request** *(owner)*: choose the target stage and how many approvals are needed.
2. Independent approvers *(APPROVER, CISO, ADMIN)* **Approve** or **Reject**. The requester can never decide their own request, and no one votes twice.
3. Once quorum is met, click **Promote**. The approval status also appears on the model page (Overview and Approvals & lifecycle).

Approvers start from **Alignment → Inbox & due soon**, which lists every decision waiting on them (deployment approvals, risk acceptances, impact assessments, validations, retirements, threat models, documents) next to everything due in the next 30 days.

LOW-risk models keep a lighter self-service path.

### 8.2 Lifecycle

Models move through `DESIGN → DEVELOPMENT → VALIDATION → DEPLOYED → MONITORING → DECOMMISSIONED`. Promotion is gated on governance completeness: a model can't advance until its required controls are satisfied.

```bash
PATCH /api/v1/inventory/models/:modelId/lifecycle  {"stage":"VALIDATION","actor":"jane@acme","notes":"…"}
```

### 8.3 The CI gate

Every pull request and push runs the SentRAI gate, which blocks a deploy that introduces ungoverned AI, a leaked secret, an unauthorized agent tool, or a risk escalation. Full setup: [CI-WORKFLOW.md](CI-WORKFLOW.md).

---

## Stage 9 — Operate and monitor

| Area | What you do |
|---|---|
| **Drift Monitoring** | Evaluate drift on demand or let serving push scores. The **circuit breaker** trips when PSI > 0.20 or accuracy drops more than 5 points, activating the **BCP fallback** (rule-based) until a human reviews. Thresholds: `PSI_WARNING_THRESHOLD` (0.10), `PSI_ALERT_THRESHOLD` (0.20). |
| **Kill switch** | *ADMIN/CISO:* model page → Overview → **Operational control → Suspend**. Deployed agents poll `GET /api/v1/control/models/:id/poll` each loop and halt. |
| **Runtime Visibility** | Agents post telemetry (`tool_call`, `decision`, `handoff`, `output`, `error`) to `POST /api/v1/telemetry/events`, tagged with the `SENTRAI_MODEL_ID` returned by the CI scan. A tool call outside the permitted set is flagged on arrival, and repeated ones surface as **scope deviations**. The **cross-ledger timeline** shows governance events, gates, incidents, drift and runtime actions for one model in one view. |
| **Incidents** | **Report AI Incident**: model, type (bias, drift, privacy breach, explainability failure, adversarial attack, unintended autonomous action) and severity. Severity sets the reporting clock: P1 6h, P2 24h, P3 72h, P4 7d. A gate failure on code that already landed on the default branch raises an incident automatically. |
| **Consumer Grievances** | File complaints against a model; SLA by severity (HIGH 7 days, MEDIUM 15, LOW 30). States: `RECEIVED → ACKNOWLEDGED → INVESTIGATING → RESOLVED / REJECTED → CLOSED`. Every model has a public transparency card at `/card/<id>` with a no-login **File a grievance** button. |
| **Webhook** | Set `WEBHOOK_URL` to receive gate failures, drift alerts, kill-switch events and SLA escalations. |

---

## Stage 10 — Report

| Output | Where | Contents |
|---|---|---|
| **Readiness PDF** | Compliance Rollup → ⬇ Readiness PDF | One-page portfolio snapshot: framework readiness, risk tiers, top gaps |
| **Board Report** | Compliance Rollup → ⬇ Board Report | Full board pack: executive summary with AI-drafted narrative (grounded in the on-screen numbers), framework readiness, controls in force (CI gate, tool authorization, audit-ledger integrity), incidents and consumer redress, priority remediation |
| **Model PDF** | `GET /api/v1/inventory/models/:id/export-pdf` | Per-model compliance record |
| **Model ledger** | Model detail / Runtime Visibility timeline | Every approval, merge, gate, incident, suspend and resume for one model |
| **Audit trail** | Audit Trail → activity log | Every mutating action, PII-masked, hash-chained; **Verify chain** proves integrity |
| **CI evidence** | CI Gate Ledger | Every pass/fail/override with SARIF |
| **LLM usage** | LLM Usage | AI calls, success rate, tokens and latency by use case, model, provider and actor |

```bash
GET  /api/v1/compliance/portfolio                 # rollup data
POST /api/v1/compliance/exec-narrative            # draft board narrative
GET  /api/v1/compliance/portfolio/export-pdf      # Readiness PDF
GET  /api/v1/compliance/board-report/export-pdf   # Board Report
```

---

## The repeating cycle

After the first pass, the steady-state loop is:

1. **Every PR** — the CI gate scans the change; failures land in the CI Gate Ledger.
2. **Nightly** — `sync-models.mjs` mirrors DB-registered models; scheduled jobs escalate overdue attestations, grievance SLAs and scope deviations.
3. **Monthly** — serving pushes live scores; review drift and the Governance Calendar.
4. **Per risk tier (90 / 180 / 365 days)** — red-team re-test for models due on the calendar; with `GOVERNANCE_V2` on, a BCP drill for HIGH / CRITICAL models at least yearly.
5. **Per risk tier (6 / 12 / 24 months)** — formal audit; attestation campaign just before.
6. **Quarterly / board cycle** — Board Report from Compliance Rollup.
