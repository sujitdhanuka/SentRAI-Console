# Model Card v2: Checkpoint 1 plan

Branch: `feature/model-card-v2`, created from `feat/governance-dedupe` at `0121719`.
Status: **phases 1–2 done (analysis and gap analysis). No code has been changed. Waiting for approval before Slice 1.**

Contents

1. Repository analysis
2. Baseline results
3. Gap analysis: the spec against what exists
4. Proposed data model (and why)
5. Migration plan and its risks
6. Delivery slice plan
7. Decisions I need from you
8. Things I can't do, or that need a human

---

## 1. Repository analysis

### 1.1 Stack and conventions

| Area | What the codebase does | Consequence for v2 |
|---|---|---|
| Backend | NestJS 11, TypeORM 0.3, SQLite in dev (`synchronize` on), MariaDB in prod (`synchronize` off) | Follow both engines |
| Schema changes | **No TypeORM migrations exist.** `data-source-options.ts` points at `database/migrations/` but the folder is absent. Prod schema changes go through `SchemaGuardService` (`src/database/schema-guard.service.ts`): `REQUIRED_COLUMNS` adds nullable columns and `REQUIRED_TABLES` runs `CREATE TABLE IF NOT EXISTS`. It is additive only and never drops. | v2 uses the same mechanism (Section 5). |
| Validation | No Zod or class-validator DTOs on governance routes. Hand-written parsers in `src/governance/phase2-util.ts` (`oneOf`, `optText`, `requireRole`, `saveVersioned`) | v2 builds a typed validator from the catalogue's `data_type`, using those helpers. **No new dependency.** |
| "Data, not code" | Framework packs are JSON (`src/governance/packs/definitions/*.json`) loaded by `pack-loader.ts` with versions, effective dates and hashes. The workflow catalogue is typed TS config (`workflows/workflow-catalogue.ts`) with pure status rules and unit tests. | The field catalogue follows the workflow-catalogue pattern. The framework registry follows the pack pattern, but is stored in the database so it can change without a deploy. |
| Feature flags | `GOVERNANCE_V2` master switch, one env flag per epic (`src/common/feature-flags.ts`); routes 404 while off (`assertFlag`) | New flag `GOV_E4_2_MODEL_CARD_V2` (default on under the master switch, like the others). v1 stays behind `GOV_E4_1_MODEL_CARDS`. |
| Tenancy | `modelForUser()` (`governance/governance-access.ts`) resolves the model's org through its project and returns 404 across orgs; `ADMIN` is the platform superuser; `ActingOrgInterceptor` lets a global owner act in an org | Every v2 query goes through `modelForUser` / `orgScope`, and every v2 table carries `orgId`. |
| Roles | `VIEWER, OWNER, REVIEWER, APPROVER, ADMIN, CISO`; `OFFICERS = OWNER, CISO, ADMIN`; `MAINTAINERS = officers + APPROVER, REVIEWER` | Reused for permissions; the risk approver role is configured in governance settings. |
| Audit | `audit_events` (hash-chained, one row per mutating request, masked payload) via an interceptor; `model_ledger_events` (append-only per-model ledger that survives a purge) | v2 field, status, approval and export events go to the model ledger with before/after/why; the request audit continues as is. |
| Settings | `governance_settings` is effective-dated and versioned per org, with reason and pack floors (`governance/settings`) | Risk thresholds, evidence freshness windows and the risk-approver role live here, so they are configurable and versioned without new machinery. |
| PDF | `pdfkit` (`model-card.pdf.ts`, `compliance/pdf-generator.ts`) | v2 PDF uses pdfkit, generated from the catalogue. |
| Frontend | React + Vite + Tailwind + zustand in `console-ui/`, served at `/dashboard/`. Model card tab: `console-ui/src/pages/ModelCard.tsx` (213 lines), shown inside `ModelPage.tsx` | v2 UI replaces the tab's body when the v2 flag is on. Nothing goes in the old `/console`. |

### 1.2 The current model card (v1, E4.1)

Files: `src/governance/model-cards/` (`model-card.model.ts` 376 lines, `model-cards.service.ts` 219, `model-card.pdf.ts` 108, `model-cards.controller.ts` 46, `model-card.spec.ts` 78), entity `src/database/entities/model-card.entity.ts`, UI `console-ui/src/pages/ModelCard.tsx`, e2e test `test/app.e2e-spec.ts:4331`.

How it works:

- **The card is not stored. It is regenerated on every read** from the `ai_models` row plus registers (datasets, approvals, validations, drift, incidents, residual risks through `governanceHooks.cardGovernance`). There are 7 hard-coded sections and about 35 fields in `CARD_SECTIONS`.
- Framework references come from the packs in force for the org (`frameworkRefs`): a section lists common-library control ids, and the clauses come from the pack JSON.
- **Freezing** writes a row to `model_cards` (`version`, `status` DRAFT or FINAL, `content` as JSON, `contentHash`, per-section hashes). A frozen version turns "stale" when the live hash differs. Dev database: 67 models, **0 frozen cards**.
- Exports: JSON, Markdown, PDF (`GET …/model-card/export`).

Where each v1 defect comes from:

| Defect | Root cause in code |
|---|---|
| D1 wrong type | `ai_models.modelType` is the scanner's detected type (`common/enums.ts` `ModelType`). There is no record-type concept, so a settings UI component gets `GENERATIVE_AI`. Nothing links a configuration to the models it selects. (`ai_provider_configs.linkedModelId` exists, but only for SentRAI's own providers.) |
| D2 DESIGN + ACTIVE | `ai_models.operationalState` is `NOT NULL DEFAULT 'ACTIVE'` (schema-guard line for `operationalState`), so **every** record reads ACTIVE whatever its lifecycle. No validator compares the two. |
| D3 LLM preamble | `src/summarizer/configured-llm.summarizer.ts:33` returns the raw LLM text, and `src/inventory/inventory.service.ts:470` (`summarizeModel`) and `:528` (`draftRiskRationale`) write it **straight into the value fields** `useCaseDescription` and `riskRationale`. Provenance exists (`descriptionSource` / `riskRationaleSource` = `ai`/`heuristic`/`human`), but the card ignores it and counts AI text as filled. Nothing strips preambles. The default prompts are in `src/ai/default-prompts.ts` (`model_summary`, `risk_rationale`). |
| D4 "likely" | The `model_summary` prompt asks the LLM to "note if it processes personal data", so it speculates. The card has no personal-data field of its own. |
| D5 LOW rationale | The `risk_rationale` prompt passes `autonomous_scope: 'none declared'`, which the LLM reads as evidence. The rule-based triage (`domain/model-inventory.ts`, `explainTriageFactors`) has no blast-radius or tenant-reach input. |
| D6 oversight wording | `model-card.model.ts:185`: `humanOversightRequired ? 'A person reviews outputs before they are acted on' : …` is a fixed sentence used for every record type. |
| D7 "ISO 42001: compliant" | `model-card.model.ts:221` prints `compliant` when `complianceCheck().overall_pass` is true for the framework. The pack checks pass on what fields are present, not on assessed controls. |
| D8 system owner | `ownerTeam` is free text. `ownerUserId` (E1.9 accountability) links to a user, but the `users` table has **no human/service distinction**. In dev, "Admin Dhancept" is `admin.dhancept@sentrai.local`, role CISO, an ordinary user row. |
| D9 0 vs no data | `incidents: '${total} reported'` and `grievances: String(grievanceCount ?? 0)` are always "filled" (`model-card.model.ts:231–232`). |
| D10 one readiness % | `readiness()` blends required ×2 and recommended ×1 into one percentage (`model-card.model.ts:274`). |

Other "compliant" labels outside the card (relevant to ground rule 6): `compliance.service.ts` (`fully_compliant`, portfolio rollup), `compliance/pdf-generator.ts:97` and `board-report.ts:90` ("Fully compliant"), `console-ui` `ComplianceMatrix.tsx:19`, `StatusCell.tsx:13/27`, `ComplianceRollup.tsx:181`, `Lineage.tsx:125`, `projects.service.ts:60–86`, `metrics.service.ts:56` (Prometheus HELP text). The training "compliant" labels are about course completion, not frameworks, so they are out of scope.

### 1.3 Existing pieces v2 can reuse

| Need in the spec | Existing piece |
|---|---|
| Evidence store with hashes, versions, approval and review dates | Controlled documents (E1.8, `governance/documents`), plus `ai_models.evidenceArtifacts` pointing at them |
| Risk acceptance with approver role, no self-acceptance and expiry | Risk register (E1.3): `risks`, `risk_assessments`, `risk_acceptances` (`acceptedBy`, `role`, `expiresAt`, `waiverRef`) and `risk.model.ts` `acceptanceRole()` |
| Evaluation records | TEVV test sets and runs (E3.4), security evaluations and red team (E2.8 / E3.6), validations (E2.3) |
| Third-party governance | Vendors and vendor assessments (E2.5), with `responsibilitySplit` and `exitPlan`; AI BOM items |
| Data governance | Data register (E2.7): datasets with lawful basis, model links |
| Impact assessment | Impact assessments (E1.4), signed and immutable once final |
| EU AI Act role, classification, Art. 5 screening | EU AI Act workspace (E5.1, `governance/eu-act`), with operator roles and `deriveTier` |
| ISO 42001 Annex A at the organisation level | SoA (E3.1), all 38 Annex A controls |
| AI literacy training | Training (E2.6) |
| Disclosures and labelling | Disclosures (E3.2) |
| Incidents, grievances, drift | Incidents (E3.3), grievances, drift reports |
| Accountable owner | Accountability (E1.9): `ownerUserId` and the owner register |

So most of the 18 sections can show **INTEGRATION** values read from these registers, rather than asking people to retype them. The catalogue needs to support both "entered on the card" and "read from a register" fields.

---

## 2. Baseline results (before any change)

Run on commit `0121719`, in a Linux copy of the repo (`node_modules` copied from your Mac, with `better-sqlite3` rebuilt for Linux; nothing on your Mac was modified).

| Check | Command | Result |
|---|---|---|
| Backend type-check | `npx tsc --noEmit` | **Pass**, 0 errors |
| Console type-check | `cd console-ui && npx tsc --noEmit` | **Pass**, 0 errors |
| Lint | `npm run lint` | **Can't run.** ESLint isn't in `devDependencies` and the repo has no ESLint config. This is pre-existing; I won't add ESLint without your OK. |
| Unit tests | `npx jest` | **25 suites, 684 tests, all pass** |
| e2e tests | `npm run test:e2e` | **3 suites, 92 tests, all pass** (`app` 85, `eu-act` 5, `workflows` 2) |

Note for later runs: the sandbox I use stops a command after 3 minutes, so I ran the e2e file in chunks by test name with `ts-jest` `isolatedModules` (a scratch config outside your repo). Every test ran once and passed. At Checkpoint 2 I'll give you the single command to run the full suite on your Mac as well.

Working tree note: two untracked bundles, `public/dashboard/assets/index-DCo99ua0.js` and `index-DFN7FItw.js`, are leftovers from earlier console builds and aren't referenced by `index.html`. I've left them alone and won't commit them.

---

## 3. Gap analysis

Legend: **Reuse** = exists and fits. **Extend** = exists, needs changes. **New** = must be built.

| Spec § | Requirement | Today | Plan |
|---|---|---|---|
| 1 | Fix D1–D10 | See 1.2 | Each defect has a test (Section 6, golden fixture) |
| 2 | Applicability-based framework registry, versioned, updatable without a deploy, pinned assessments, `STANDARD/LAW/REGULATION/GUIDANCE`, "applies, not yet in force" | Packs are versioned JSON with `effectiveFrom` and clause `effectiveFrom` (EU). Baseline packs (NIST, ISO) apply to **every** org by default. There's no type or binding field and no verification status. Packs are shipped in code, so they need a deploy. | **New** DB registry, seeded from a JSON file. Packs stay as they are for the compliance check, and registry controls can reference pack clauses. |
| 3 | One declarative, versioned field catalogue drives the form, validation, applicability, scoring, mapping and PDF | `CARD_SECTIONS` is code: 7 sections, field logic in closures | **New** typed catalogue, 18 sections; the v1 sections stay for v1 rendering only |
| 4 | Six record types, relationship graph, effective model per tenant, inherited risk, switch blocking, four state fields, consistency validator, Global AI Model Settings specifics | None of these exist (only `modelType`, `lifecycleStage`, `operationalState`) | **New** `recordType`, links table, config resolver, validator |
| 5 | Field provenance on every value; AI text is a suggestion until accepted; strip preambles; `UNKNOWN` not "likely"; no AI on tier, classification, applicability or compliance | Provenance on 3 text fields only, and AI text is written straight into the value | **Extend** the summarizer (sanitiser, prompts); **New** suggestion slot per field value |
| 6 | Server-side, versioned applicability rules; 6 field statuses; N/A with justification and decider; VERIFIED needs evidence and a different verifier | `required: boolean` per field, fixed in code | **New** rule engine plus field-state model |
| 7 | Risk engine: inherent vs residual, explainable contributions, five hard rules, regulatory classification kept separate, acceptance records | Rule-based triage sets `riskLevel`; the risk register (E1.3) has bands, appetite and acceptances | **New** card risk engine; **Reuse** risk-register acceptance; thresholds in governance settings |
| 8 | Control records with an 8-value status; status moves only on human action with evidence; ISO 42001 wording; v1 verdicts become NOT_ASSESSED | Automatic pass/fail from packs | **New** control assessments; **Remove** the verdict from the card |
| 9 | Four separate scores with numerator/denominator and method; finalisation gate | One blended % | **New** |
| 10 | 9-stage card workflow, reviewer assignment, approve with conditions, separation of duties, append-only audit, change-triggered reassessment, next review date, diff | DRAFT/FINAL freeze, staleness hash, officer role for FINAL | **Extend** `model_cards` versions; **New** workflow and approvals; **Reuse** ledger |
| 11 | 18 sections, about 300 fields | 7 sections, ~35 fields | **New** catalogue content |
| 12 | UI, PDF, tests, golden fixture | v1 tab and PDF | **New** v2 tab, PDF and tests |
| 13 | v1 migration with dry-run; v1 cards stay viewable | — | **New** migration service with dry-run |
| 14 | Engineering constraints | — | Follow existing patterns; no new dependencies planned |

---

## 4. Proposed data model

### 4.1 Storage choice: normalised field values, catalogue in typed config, registry in the database

**Field catalogue: typed TypeScript config**, one file per section under `src/governance/model-cards/v2/catalogue/`, with a `CATALOGUE_VERSION` constant.
Why: the codebase already keeps code-reviewed governance definitions as typed config (workflow catalogue, control library, EU profile fields) with pure unit tests. A catalogue change also needs code review because it changes validation and scoring. Each record stores the catalogue version it was assessed against, and old versions remain loadable (catalogue files are append-only by version).

**Field values: one row per record × field** (`card_field_values`).
Why not typed JSON per section: the spec requires values to be queryable per field ("show every card where personal data is UNKNOWN"). With one row per field that is a single indexed query on `(orgId, fieldId)` that works the same on SQLite and MariaDB. JSON-path queries differ between the two engines and can't be indexed in MariaDB without generated columns, which the schema guard doesn't support. Provenance, status, acceptance and verification are per field, so they naturally sit beside the value. Repeating groups (evaluation records, tenant overrides, obligations) are stored as a typed JSON array in the `value` column of one row and validated against the catalogue's column spec.

**Framework registry: database tables seeded from JSON.** The spec requires updates without a deploy and assessments pinned to versions, so registry entries are versioned rows. Every seeded row is `UNVERIFIED_REQUIRES_LEGAL_REVIEW`. An officer edit creates a new version row and never overwrites.

**Applicability rules: typed config** next to the catalogue, as declarative predicates such as `{ all: [{ fact: 'record_type', in: ['AGENT'] }, …] }`, each with an id, a version and a plain-language "why". They are evaluated only on the server. The UI receives the evaluated result and the text of the rule that fired.

### 4.2 New and changed tables

All new tables carry `orgId` and are added to `REQUIRED_TABLES` in the schema guard. No existing column is dropped or retyped.

| Table / column | Purpose | Key columns |
|---|---|---|
| `ai_models.recordType` (new, nullable) | `AI_MODEL / AI_SYSTEM / AI_COMPONENT / MODEL_CONFIGURATION / AGENT / RAG_PIPELINE`. Null means "not yet classified", which blocks FINAL. | — |
| `users.accountType` (new, `HUMAN` by default) | Distinguishes `HUMAN` from `SERVICE` for owner checks (D8) | — |
| `ai_record_links` | Graph edges: `uses_model, selects_model, part_of_system, retrieves_from, calls_tool, overrides` | `fromModelId, toModelId, relation, tenantScope (null = global), attributes JSON, createdBy` |
| `card_records` | v2 card header, one per model | `modelId (unique), catalogueVersion, workflowState, authorUserId, nextReviewAt, lastApprovedVersion, migratedFromV1, migrationNote` |
| `card_field_values` | One row per record × field | `modelId, fieldId, value JSON, status, provenance, sourceRef, enteredBy/At, acceptedBy/At, suggestion JSON (pending AI or code-scan text, kept apart from value), naJustification, naDecidedBy, evidenceRefs JSON, verifiedBy/At, catalogueVersion`; unique `(modelId, fieldId)`, index `(orgId, fieldId)` |
| `framework_registry` | Framework versions | `frameworkId, version, type, bindingStatus, title, jurisdiction, roles, effectiveFrom, phases JSON, verificationStatus, supersedes, createdBy` |
| `framework_controls` | Controls of a framework version | `frameworkId, frameworkVersion, controlId, title (own paraphrase), binding, recordTypes, applicabilityRuleId, linkedFieldIds, evidenceType, assessmentMethod, controlOwnerRole, effectiveFrom, verificationStatus, packClauseRefs` |
| `card_control_assessments` | Control status per record, pinned to a framework version | `modelId, frameworkId, frameworkVersion, controlId, status, justification, evidenceRefs, assessedBy/At, migratedFromV1Verdict` |
| `card_risk_assessments` | Inherent and residual risk, versioned | `modelId, version, inputs JSON, contributions JSON, inherentScore/Tier, residualTier, rationale (human), regulatoryClassification JSON, thresholdsVersion, riskAcceptanceId, assessedBy/At, status (incl. REQUIRES_REASSESSMENT)` |
| `card_approvals` | Reviews and approvals per workflow stage | `modelId, cardVersion, stage, reviewerUserId, decision (APPROVED / REJECTED / APPROVED_WITH_CONDITIONS / EVIDENCE_REQUESTED), conditions JSON (text, owner, due), comment, decidedAt` |
| `model_cards` (existing) | Frozen versions. v1 rows unchanged (`schema: sentrai.model-card/1`). v2 snapshots use `schema: sentrai.model-card/2` with every field's value and state, so a diff needs no other table. `status` widens to the 9 workflow states; the existing column is `varchar(20)`, and the longest state, `EVIDENCE_COLLECTION`, is 19 characters. | — |

Not new tables: the **audit log** reuses `model_ledger_events` (append-only, survives a purge) with event types `CARD_FIELD_CHANGED`, `CARD_STATE_CHANGED`, `CARD_APPROVAL`, `CARD_EXPORTED`, `CARD_REASSESSMENT_TRIGGERED`, recording `{field, before, after, reason}`. **Risk acceptance** reuses the risk register's `risk_acceptances` through a register risk linked to the card. **Evidence** reuses controlled documents and evidence artifacts. **Thresholds and freshness windows** live in `governance_settings`.

### 4.3 Modules (backend)

All under `src/governance/model-cards/v2/`, aiming for files of about 150 lines:

`catalogue/` (18 section files, `types.ts`, `index.ts`) · `applicability/` (rules, engine) · `record-types.ts` · `consistency.ts` · `provenance.ts` (accept/edit/suggest, sanitiser use) · `risk/` (inputs, engine, hard rules) · `registry/` (seed JSON, loader, service) · `controls.ts` · `scores.ts` · `finalisation.ts` · `workflow.ts` (state machine, separation of duties) · `reassessment.ts` · `config-resolver.ts` (effective model per tenant, BYOK) · `migration/` (v1 mapper, dry-run) · `card-v2.service.ts`, `card-v2.controller.ts` · `card-v2.pdf.ts` · `diff.ts`.
Summarizer change: `src/summarizer/sanitise.ts`, used by `configured-llm.summarizer.ts` and `summarizer.service.ts`.

### 4.4 API (new routes, all behind `GOV_E4_2_MODEL_CARD_V2`, all checked with `modelForUser` and roles)

- `GET  /api/v1/governance/models/:id/card-v2`: the live card, applicable sections, field states, four scores, blockers, consistency findings and the effective model per tenant
- `PATCH /…/card-v2/fields/:fieldId`: set a value, N/A plus justification, or UNKNOWN (maintainers)
- `POST /…/card-v2/fields/:fieldId/accept` and `/verify`: accept a suggestion; verify with evidence (verifier ≠ enterer)
- `POST /…/card-v2/suggest`: draft AI suggestions for narrative fields only
- `PUT  /…/card-v2/record-type`, `POST/DELETE /…/card-v2/links`
- `POST /…/card-v2/risk`: risk inputs and human rationale; `POST /…/card-v2/risk/accept` goes through the register
- `PUT  /…/card-v2/controls/:frameworkId/:controlId`: control status, with evidence
- `POST /…/card-v2/transition`, `POST /…/card-v2/reviews`: workflow and approvals
- `GET  /…/card-v2/versions`, `/versions/:a/diff/:b`, `/export?format=pdf|json|md`
- `GET/POST /api/v1/governance/framework-registry` (officers write; every write needs a reason and creates a new version)
- `POST /api/v1/governance/model-cards/migrate-v1?dry_run=true` (officers; ADMIN for all orgs)

The v1 routes are kept unchanged.

---

## 5. Migration plan

**Schema.** Following the codebase convention, new tables and columns go into `SchemaGuardService` (`REQUIRED_TABLES`, `REQUIRED_COLUMNS`), which is additive and idempotent. SQLite dev picks them up through `synchronize`.
**Rollback.** Nothing existing is altered. Reverting the code leaves the new tables and columns unused and harmless. A full rollback is `DROP TABLE` on the 7 new tables plus dropping `ai_models.recordType` and `users.accountType`. I'll ship that as a documented SQL script, `docs/model-card-v2/rollback.sql`, that **you** run; I won't run it. Changing to real TypeORM migrations would be a project-wide change, so I've left it out of scope (see Decision 4).

**Data migration (v1 → v2), additive.** It never updates or deletes `ai_models` or `model_cards` rows.

1. For each model, create a `card_records` row (`migratedFromV1 = true`, workflow `DRAFT`, catalogue version pinned).
2. Map each v1 field to its catalogue field with `provenance = IMPORTED_V1`, `status = NOT_ASSESSED`, never accepted. Text that came from AI (`descriptionSource`/`riskRationaleSource` = `ai` or `heuristic`) also goes into the suggestion slot, sanitised, with the original kept as the imported value for history.
3. Record type: proposed by rules over v1 facts (file path, signals, `GlobalAiModelSettings.tsx`, "settings"/"config" names, a provider config link) as a **CODE_SCAN suggestion** that a human must accept. The golden fixture expects `MODEL_CONFIGURATION`; see Decision 3.
4. The risk tier is kept as an imported value and flagged `REQUIRES_REASSESSMENT`. Framework verdicts become `NOT_ASSESSED` control assessments with a migration note; the old verdict is kept in `migratedFromV1Verdict` and in the ledger.
5. Personal data becomes `UNKNOWN` unless a linked dataset says `personalData = true` (then a CODE_SCAN suggestion of YES, still needing acceptance).
6. `operationalState` is imported as is, and the consistency validator flags DESIGN + ACTIVE.
7. Existing frozen v1 versions stay as v1 rows, viewable and exportable through the v1 renderer. Record ids don't change.

**Dry run** returns, per model: the record-type suggestion, fields mapped, fields left NOT_ASSESSED, consistency findings, verdicts reset, and what would block FINAL. Nothing is written. The real run is idempotent (it skips models that already have a `card_records` row) and is triggered only by an officer.

**Risks**

| Risk | Mitigation |
|---|---|
| A prod table created by the schema guard has a different type from the entity | Same DDL style as the existing guard entries; e2e boots on SQLite; I'll also give you a MariaDB smoke-test command |
| Large `card_field_values` (about 300 rows per model) | 67 models × ~300 = ~20k rows; fine. Only fields with a value or state are written, and absent rows read as NOT_ASSESSED. |
| Re-wording "compliant" across the console breaks users' or tests' expectations | API field names are kept; only user-facing wording changes (Decision 1) |
| Sanitiser over-strips real content | Removes only leading and trailing sentences that match a fixed pattern list; unit tests on real samples, including the fixture's text |
| Clash with other threads editing the same tree | Small commits; the console is rebuilt from the current files at the time of the build |

---

## 6. Delivery slice plan

Each slice ends with type-check, unit and e2e tests. I commit as I go and don't push.

**Slice 1: foundation** (about 6 commits)
1. `recordType`, `accountType`, links table, consistency validator (D1, D2, D8) and tests
2. Catalogue types, the 18 section files (§11 content, ids and short labels; help text in our own words) and a catalogue integrity test (unique ids, rules exist, framework refs exist)
3. Field values, statuses and provenance; N/A justification; VERIFIED rules; summarizer sanitiser and prompt changes (D3, D4)
4. Applicability engine plus the 7 example rules from §6, each with a test
5. Configuration resolver: effective model per tenant, BYOK, inherited inherent risk, switch blocking
6. v1 migration mapper plus dry-run, with the **golden fixture test** for items a, b, c, d, g (with e, f, h after Slice 2)

**Slice 2: governance engine** (about 6 commits)
1. Framework registry tables, seed JSON (all §2 entries, `UNVERIFIED_REQUIRES_LEGAL_REVIEW`), loader, version pinning, "applies, not yet in force"
2. Control assessments with the 8-value status; remove the card verdict; ISO 42001 wording
3. Risk engine: inherent/residual, contributions, hard rules 1–5 (one test each), acceptance through the register
4. Four scores plus the finalisation gate
5. Workflow states, reviews, conditions, separation of duties, ledger events, next review date and overdue status
6. Change-triggered reassessment plus the version snapshot

🛑 **Checkpoint 2:** golden fixture plus all tests, and a sample migrated card (the real "Global Ai Model Settings" record from your `dev.db`, as a dry run).

**Slice 3: experience**
1. Console v2 tab: summary header, applicable sections with completion, per-field badges, "why is this required?", N/A toggle, responsive layout
2. Version diff view
3. PDF from the catalogue: document control, DRAFT watermark, fixed disclaimer, methodology; snapshot test
4. Rebuild `public/dashboard` from the then-current files

**Final:** full test run, type-checks, `docs/model-card-v2/REPORT.md` with the legal-review checklist.

---

## 7. Decisions I need from you

These are my recommendations. Approving the plan as it stands accepts them.

1. **Scope of removing "compliant" (ground rule 6).** The v2 card will never show a verdict. Outside the card, framework results are labelled "Compliant" or "Fully compliant" in the compliance matrix, status cells, rollup, lineage, the readiness PDF, the board report and the Prometheus HELP text.
   *Recommendation:* change only the **wording** everywhere to "No open gaps in mapped checks" (or "All mapped checks pass"), and keep API field names (`fully_compliant`, `overall_pass`) and the metric name so integrations don't break. Any e2e assertion on the old wording gets updated and listed in the report.
2. **EU AI Act dates.** The existing EU workspace (`eu-act.model.ts:96`) uses `general: 2026-08-02` and `annexIProducts: 2027-08-02`. Your spec asks the registry to seed the AI Omnibus dates (Annex III 2 Dec 2027, Annex I 2 Aug 2028).
   *Recommendation:* the registry seeds your dates as UNVERIFIED, and **I don't change the EU workspace constants** in this branch, so the EU AI Act thread's work isn't altered. The discrepancy goes on the legal-review checklist. Once legal review settles the dates, the EU workspace can read them from the registry.
3. **Record type for the golden fixture.** Fixture item (a) says the migrated card must "be classified `MODEL_CONFIGURATION`". Ground rule 4 and §5 say code-derived values are suggestions until a human accepts them.
   *Recommendation:* migration sets `recordType = MODEL_CONFIGURATION` with `provenance = CODE_SCAN`, not accepted. The record is classified for applicability and risk purposes straight away, but "Record type" still counts as unaccepted and blocks FINAL until a person accepts it. The test asserts both.
4. **Migrations vs the schema guard.** Ground rule 7 asks for reversible migrations; the codebase has none and uses the additive schema guard.
   *Recommendation:* follow the schema guard and ship a documented rollback SQL script. Introducing TypeORM migrations would change how every deploy works.
5. **Service accounts.** There is no service-account concept today.
   *Recommendation:* add `users.accountType` (`HUMAN` by default) that an admin can set, so nothing is guessed. The fixture test marks "Admin Dhancept" as `SERVICE` and checks that it's rejected. For the real dev record, it stays a human CISO account unless you mark it otherwise; tell me if it is in fact a shared or system login.
6. **Lint.** There is no ESLint config or dependency. *Recommendation:* leave it out and report it, rather than add a dependency.

---

## 8. Things I can't do, or that need a human

- **Legal and standards content.** I'll seed identifiers and my own one-line paraphrases only, all `UNVERIFIED_REQUIRES_LEGAL_REVIEW`. No regulatory text, and no ISO wording. Dates such as the DPDP phasing, the Korea AI Basic Act start, India's IT Rules 2026 amendment and Colorado SB 26-189 are taken from your spec, not verified by me.
- **Tenant counts and BYOK facts for "Global Ai Model Settings".** That record is a component of the scanned Dhancept app, not of SentRAI, so SentRAI can't observe its tenants, default model or providers. These will be entry fields (`UNKNOWN` until a person enters them). SentRAI's own provider configs (`ai_provider_configs.linkedModelId`) can feed them automatically only for SentRAI's own AI use.
- **Pushing.** Pushing from here fails. I'll give you the push commands at the end.
- **Size.** Seeding about 300 fields across 18 sections is mostly content work. Field ids and labels follow §11 exactly; help text is short and in plain language. Expect the catalogue to need a review pass from you for wording.
