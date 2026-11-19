/**
 * Coverage disclosure — the single source of truth for what SentRAI actually
 * evaluates per framework, published at /coverage and /api/v1/compliance/coverage.
 *
 * HONESTY CONTRACT: every control listed here MUST correspond to a check that
 * exists in code. There are two evaluation paths and the page follows the one
 * this deployment runs:
 *
 *  - Built-in validators (default): sutras.validator.ts and
 *    frameworks.validator.ts. The curated COVERAGE list below describes them,
 *    and changes in the same commit as any validator change.
 *  - Framework pack engine (GOVERNANCE_V2 + GOV_E1_1_PACKS): the validators
 *    become adapters over the pack definitions in
 *    src/governance/packs/definitions. In that mode the list is generated
 *    from the packs themselves (clause by clause, with each clause's flag,
 *    scope, tier and mandatory rule), so it cannot drift from what runs.
 *
 * Overstating coverage here is a product-integrity bug of the highest
 * severity — this page exists precisely so our claims can never drift from
 * our code. Checks behind an off-by-default governance flag are listed only
 * while that flag is on, and a check whose evidence comes from an epic that is
 * off is listed as NOT ASSESSED, never as evaluated.
 */
import { FeatureFlags, getFeatureFlags } from '../common/feature-flags';
import { getControl } from '../governance/controls/control-library';
import { BUILT_IN_PACKS } from '../governance/packs/pack-loader';
import type { PackClause, PackDefinition } from '../governance/packs/pack.types';
import { IMPLEMENTATION_ASSESSED, implementationSummary, ImplementationSummary } from './implementation-status.data';

type Flag = keyof Omit<FeatureFlags, 'governanceV2'>;

export interface CoverageControl {
  code: string;
  name: string;
  /** Listed only when this governance flag is on. */
  flag?: Flag;
  /** Official clause reference (pack mode). */
  clause?: string;
  /** Per model, or once for the organisation (pack mode). */
  scope?: 'model' | 'organisation';
  /** Reported but never blocks a verdict (pack mode: mandatory false). */
  advisory?: boolean;
  /** Only evaluated for these tiers of the framework's own classifier (pack mode). */
  appliesTo?: string[];
  /** A plain statement of what the check does and does not do, where that matters. */
  note?: string;
}

export interface OperationalItem {
  text: string;
  /** Listed only when this governance flag is on. */
  flag?: Flag;
}

export interface FrameworkCoverage {
  id: string;
  name: string;
  jurisdiction: string;
  depth: 'deep' | 'partial';
  /** Controls the validators evaluate today (verifiable in source). */
  evaluated: CoverageControl[];
  /** Listed in the framework pack but reported NOT ASSESSED in this deployment (pack mode). */
  notAssessed?: CoverageControl[];
  /** The size of the regime we measure ourselves against, what that number counts, and how much of it the checks reach. */
  universe: { total: number; unit: string; covered?: number };
  /** Plain-language statement of what is and is not covered. */
  statement: string;
  /** What operational machinery (beyond per-model checks) implements the regime. */
  operational?: Array<string | OperationalItem>;
  /** Who it applies to, when that is not every organisation (opt-in region packs). */
  availability?: string;
  /** Pack id, version and effective date the list was generated from (pack mode). */
  basis?: string;
  /** Reviewed implementation status per requirement with this deployment's flags (pack mode). */
  implementation?: ImplementationSummary & { assessedOn: string; commit: string };
}

/**
 * Pack mode: a framework is DEEP when the reviewed assessment finds at least
 * this share of its applicable requirements implemented with the flags this
 * deployment runs; otherwise PARTIAL. Frameworks with no assessment keep their
 * stated depth.
 */
export const DEEP_THRESHOLD = 0.8;

/* =================================================================== */
/* Built-in validators (GOV_E1_1_PACKS off)                            */
/* =================================================================== */

export const COVERAGE: FrameworkCoverage[] = [
  {
    id: 'rbi_free_ai',
    name: 'RBI FREE-AI (7 Sutras)',
    jurisdiction: 'India',
    depth: 'deep',
    evaluated: [
      { code: 'SUTRA-1', name: 'Trust is the Foundation' },
      { code: 'SUTRA-2', name: 'People First' },
      { code: 'SUTRA-3', name: 'Innovation over Restraint' },
      { code: 'SUTRA-4', name: 'Fairness and Equity' },
      { code: 'SUTRA-5', name: 'Accountability' },
      { code: 'SUTRA-6', name: 'Understandable by Design' },
      { code: 'SUTRA-7', name: 'Safety, Resilience & Sustainability' },
      {
        code: 'REC-14',
        name: 'Board-approved AI policy and accountability: policy reference and named owner (via Sutras 1 and 5; gates live promotion)',
      },
      { code: 'REC-20', name: 'Red-team exercise on record for HIGH risk (via Sutra 7)' },
      { code: 'REC-21', name: 'BCP drill within the drill interval for HIGH risk (via Sutra 7)', flag: 'bcpDrills' },
    ],
    universe: { total: 26, unit: 'committee recommendations' },
    statement:
      'All 7 sutras are evaluated on every model, including bias testing (Sutra 4), accountability ' +
      '(Sutra 5) and explainability (Sutra 6). Of the committee report’s 26 recommendations, ' +
      '{recCount} are checked per model through the sutra checks ({recList}); several others are implemented ' +
      'as platform machinery rather than per-model checks (see operational list). Remaining ' +
      'recommendations are on the pack roadmap.',
    operational: [
      'Incident reporting with severity-driven regulatory deadline clocks',
      'Consumer grievance tracking per model',
      'Lifecycle gating: ungoverned models cannot be promoted to live stages',
      'Statistical drift monitoring with circuit breaker and business-continuity fallback',
      'Append-only model ledger and PII-masked audit trail',
      { text: 'BCP drill records per model, with reminders before a drill falls due', flag: 'bcpDrills' },
    ],
  },
  {
    id: 'nist_ai_rmf',
    name: 'NIST AI RMF 1.0',
    jurisdiction: 'United States',
    depth: 'partial',
    evaluated: [
      { code: 'GOVERN-2.1', name: 'Organizational Ownership & Responsibility' },
      { code: 'GOVERN-1.2', name: 'Board Policy Alignment' },
      { code: 'GOVERN-1.5', name: 'Audit Cadence Defined' },
      { code: 'GOVERN-3.2', name: 'Human Oversight Controls' },
      { code: 'MAP-1.1', name: 'Purpose & Use-Case Documentation' },
      { code: 'MAP-1.1', name: 'Deployment Context & Affected Users' },
      { code: 'MAP-4.1', name: 'Source & Dependency Provenance' },
      { code: 'MEASURE-2.3', name: 'Performance Benchmarks Recorded' },
      { code: 'MEASURE-2.4', name: 'Performance Drift Measurement' },
      { code: 'MEASURE-2.7', name: 'Security Red Teaming (red-team date or report on record)' },
      { code: 'MEASURE-2.10', name: 'Privacy Risk Examined (DPIA / Privacy Review)', flag: 'nistPrivacy' },
      { code: 'MEASURE-3.1', name: 'Risk Tracking Mechanisms (Ledger History)' },
      { code: 'MANAGE-2.1', name: 'Risk Response Resourcing (Named Owner)' },
      { code: 'MANAGE-2.4', name: 'Fallback / Business-Continuity Plan' },
      { code: 'MANAGE-4.3', name: 'Incident Reporting Hygiene' },
    ],
    universe: { total: 72, unit: 'playbook subcategories' },
    statement:
      '{checkCount} per-model checks cover {subCount} of the playbook’s 72 subcategories across all four ' +
      'functions (GOVERN, MAP, MEASURE, MANAGE), chosen for signal over ceremony. A verdict here means ' +
      'those checks pass; it is an indicative posture signal, not full-framework conformance. ' +
      'Wider subcategory coverage comes with the framework pack engine and governance epics, which are off in this deployment.',
  },
  {
    id: 'eu_ai_act',
    name: 'EU AI Act',
    jurisdiction: 'European Union',
    depth: 'partial',
    evaluated: [
      { code: 'Art-9', name: 'Risk Management System' },
      { code: 'Art-10', name: 'Data & Data Governance' },
      { code: 'Art-11', name: 'Technical Documentation' },
      { code: 'Art-12', name: 'Record-Keeping (Automatic Logs)' },
      { code: 'Art-13', name: 'Transparency & Information to Deployers' },
      { code: 'Art-14', name: 'Human Oversight Gate' },
      { code: 'Art-15', name: 'Accuracy, Robustness & Cybersecurity' },
      { code: 'Art-17', name: 'Quality Management System' },
      { code: 'Art-25', name: 'Provider Responsibilities Along the Value Chain' },
      { code: 'Art-26', name: 'Deployer Operational Record' },
      { code: 'Art-27', name: 'Fundamental Rights Impact Assessment' },
      { code: 'Art-50', name: 'Transparency & Disclosure' },
      { code: 'Art-72', name: 'Post-Market Monitoring' },
      {
        code: 'Art-Minimal',
        name: 'Minimal-risk systems: general guidelines',
        note: 'Recorded as passing for minimal-risk systems; no obligation is checked.',
      },
    ],
    universe: { total: 113, unit: 'articles in the Act' },
    statement:
      'Thirteen articles are evaluated per model: the core high-risk provider obligations ' +
      '(Articles 9–15, 17), value-chain and deployer duties (Articles 25, 26, 27) and post-market ' +
      'monitoring (Article 72) for high-risk systems, and the Article 50 transparency duty for ' +
      'limited-risk systems. Minimal-risk systems are recorded as passing the general guidelines ' +
      'entry without a check. The risk tier comes from the model’s functional area. Conformity ' +
      'assessment, CE-marking and EU-database registration (e.g. Article 16) are process/paperwork ' +
      'obligations we do not implement — we deliberately do not claim them. Full Annex III use-case ' +
      'classification is on the roadmap.',
  },
  {
    id: 'iso_42001',
    name: 'ISO/IEC 42001',
    jurisdiction: 'International',
    depth: 'partial',
    evaluated: [
      { code: 'AIMS-5.3', name: 'Roles, Responsibilities & Accountability' },
      { code: 'AIMS-6.1.2', name: 'AI System Risk Assessment (risk tier set)' },
      { code: 'AIMS-9.1', name: 'Performance Monitoring & Measurement' },
      { code: 'AIMS-9.2', name: 'Internal Audit Cadence' },
      { code: 'AIMS-10.2', name: 'Nonconformity & Corrective Action' },
      { code: 'AIMS-A.6.2.7', name: 'AI System Technical Documentation (Model Card)' },
      { code: 'AIMS-A.7.5', name: 'Data & Codebase Provenance' },
    ],
    universe: { total: 38, unit: 'Annex A controls' },
    statement:
      'Seven checks spanning clauses 5, 6, 9 and 10 plus Annex A documentation and provenance ' +
      'are evaluated per model. The AI system impact assessment (6.1.4 / 8.4) is reported as NOT ASSESSED: ' +
      'with the governance epics off SentRAI does not record impact assessments, so it makes no claim there. ' +
      'The 38 Annex A controls are not individually mapped in this mode; SentRAI supports an ISO 42001 ' +
      'programme — it does not by itself constitute certifiable conformance.',
  },
];

/* =================================================================== */
/* Framework pack engine (GOVERNANCE_V2 + GOV_E1_1_PACKS)              */
/* =================================================================== */

/**
 * Controls whose evidence comes from an epic: with that epic off they report
 * NOT ASSESSED (see the control's evaluate()), so the page must not count them.
 * Clauses that carry the epic's flag themselves are simply hidden instead.
 */
const CONTROL_NEEDS: Record<string, Flag> = {
  'CTL-IMPACT-01': 'impactAssessment',
  'CTL-RISK-02': 'riskRegister',
  'CTL-ORG-ACCOUNTABLE': 'accountability',
  'CTL-DATA-02': 'dataRegister',
  'CTL-DOC-02': 'documentControl',
  'CTL-TEVV-01': 'tevv',
  'CTL-SEC-AI-01': 'aiSecurity',
  'CTL-INC-02': 'incidentExtensions',
  'CTL-ORG-POLICY': 'aims',
  'CTL-ORG-TRAINING': 'training',
};

/** Clause references that a control only evidences while an epic is on. */
const REF_NEEDS: Record<string, Flag> = {
  'Rec 21': 'bcpDrills',
};

/** What a check does and does not do, where a reader could assume more. */
const CONTROL_NOTES: Record<string, string> = {
  'CTL-ENERGY-01':
    'Reads energy readings someone records: posted GPU power samples, an nvidia-smi CSV log or a metered kWh figure. ' +
    'SentRAI does not sample GPUs or attribute power to models automatically.',
  'CTL-SEC-AI-01':
    'Checks for an approved threat model and recorded evaluations of each applicable attack category; SentRAI does not run the attacks.',
  'CTL-TEVV-01': 'Checks recorded test sets, acceptance criteria, results and metric reviews; SentRAI does not run the tests.',
  'CTL-NONE': 'Recorded as passing for minimal-risk systems; no obligation is checked.',
  'CTL-ORG-DISCLOSURE': 'Checks that the statement is published and within its review date; the wording is the organisation’s.',
  'CTL-EU-ART5': 'Reads the signed Article 5 screening; the answers are the organisation’s own assessment, not a legal opinion.',
  'CTL-EU-CLASS': 'Reads the signed Annex III / Annex I classification; SentRAI applies the Article 6(3) rules to the answers given.',
  'CTL-EU-CONFORMITY': 'Checks the signed Annex VI checklist or a recorded Annex VII certificate; SentRAI does not perform the assessment.',
  'CTL-EU-CE': 'Checks that CE marking is recorded; SentRAI cannot affix the marking.',
  'CTL-EU-REGISTRATION': 'Checks that a registration id and date are recorded; the submission to the EU database is made by the organisation.',
};

interface Counts {
  model: number;
  org: number;
  covered: number;
  coveredList: string[];
  /** Codes of the evaluated checks. */
  codes: string[];
  notAssessed: CoverageControl[];
  flags: FeatureFlags;
}

interface PackMeta {
  id: string;
  name: string;
  jurisdiction: string;
  depth: 'deep' | 'partial';
  universe: { total: number; unit: string };
  /** The regime units a clause reaches, from its code and clause reference. */
  units: (c: PackClause, flags: FeatureFlags) => string[];
  statement: (n: Counts) => string;
  operational?: OperationalItem[];
}

const refs = (c: PackClause) => (c.clause ?? '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const notAssessedLine = (n: Counts) =>
  n.notAssessed.length
    ? ` ${list(n.notAssessed.map((c) => c.code))} ${n.notAssessed.length === 1 ? 'is' : 'are'} reported NOT ASSESSED because the epic that records the evidence is off.`
    : '';
const checksLine = (n: Counts, perWhat = 'per-model') =>
  `${plural(n.model, `${perWhat} check`)}${n.org ? ` and ${plural(n.org, 'organisation-level check')}` : ''}`;

const PACK_META: Record<string, PackMeta> = {
  'rbi-free-ai': {
    id: 'rbi_free_ai',
    name: 'RBI FREE-AI (7 Sutras)',
    jurisdiction: 'India',
    depth: 'deep',
    universe: { total: 26, unit: 'committee recommendations' },
    units: (c, flags) =>
      refs(c)
        .filter((r) => /^Rec \d+$/.test(r))
        .filter((r) => !REF_NEEDS[r] || flags[REF_NEEDS[r]])
        .concat(c.code.startsWith('REC-') ? [`Rec ${c.code.slice(4)}`] : []),
    statement: (n) =>
      `All 7 sutras are evaluated on every model through the RBI FREE-AI pack, including bias testing (Sutra 4), ` +
      `accountability (Sutra 5) and explainability (Sutra 6). In all, ${checksLine(n)} reach ${n.covered} of the ` +
      `committee report’s 26 recommendations (Recs ${list(n.coveredList.map((r) => r.replace('Rec ', '')))}). ` +
      `Most of Recommendations 1 to 13 are sector-level (aimed at regulators and the ecosystem) and are not claimed; ` +
      `others are implemented as platform machinery rather than checks (see the operational list).${notAssessedLine(n)}`,
    operational: [
      { text: 'Incident reporting with severity-driven regulatory deadline clocks' },
      { text: 'Consumer grievance tracking per model, with SLA clocks and public filing from the transparency card' },
      { text: 'Lifecycle gating: ungoverned models cannot be promoted to live stages' },
      { text: 'Statistical drift monitoring with circuit breaker and business-continuity fallback' },
      { text: 'Append-only, hash-chained model ledger and PII-masked audit trail' },
      { text: 'BCP drill records per model, with reminders before a drill falls due', flag: 'bcpDrills' },
      { text: 'Risk register with residual-risk acceptance by the approver the risk appetite names', flag: 'riskRegister' },
      { text: 'RBI inspection export of the AI inventory (JSON, CSV, XLSX)', flag: 'disclosures' },
      { text: 'Senior sign-off and a notice to affected people before a P1/P2 incident is closed', flag: 'incidentExtensions' },
    ],
  },
  'nist-ai-rmf': {
    id: 'nist_ai_rmf',
    name: 'NIST AI RMF 1.0',
    jurisdiction: 'United States',
    depth: 'partial',
    universe: { total: 72, unit: 'playbook subcategories' },
    units: (c) => [c.code],
    statement: (n) =>
      `${checksLine(n)} cover ${n.covered} of the playbook’s 72 subcategories across all four functions ` +
      `(GOVERN, MAP, MEASURE, MANAGE). Subcategories a check only cross-references are not counted. A verdict ` +
      `here means those checks pass; it is an indicative posture signal, not full-framework conformance.${notAssessedLine(n)}`,
    operational: [
      { text: 'Risk register with inherent and residual ratings, treatments and re-review triggers', flag: 'riskRegister' },
      { text: 'Accountable official, governance board and named model owners', flag: 'accountability' },
      { text: 'Incident integrations to Jira, ServiceNow, SIEM or a webhook, with a CISA playbook mapping', flag: 'incidentExtensions' },
    ],
  },
  'eu-ai-act': {
    id: 'eu_ai_act',
    name: 'EU AI Act',
    jurisdiction: 'European Union',
    depth: 'partial',
    universe: { total: 113, unit: 'articles in the Act' },
    units: (c) => (c.code === 'Art-Minimal' ? [] : [c.code]),
    statement: (n) =>
      n.flags.euAiAct
        ? `${checksLine(n)} reach ${n.covered} articles. Each AI system records whether it is in scope and which ` +
          `operator role the organisation holds (provider, deployer, importer, distributor, authorised representative), ` +
          `and only the clauses for that role and in force on the evaluation date apply. A signed Article 5 screening ` +
          `blocks the deploy gate when a prohibited practice is answered yes. The risk tier comes from a signed Annex III ` +
          `and Annex I classification with the Article 6(3) derogation rules; the functional-area keyword match is kept ` +
          `only as a hint until it is signed. Conformity assessment (Annex VI checklist or Annex VII certificate), the ` +
          `Annex V declaration, CE marking and EU database registration (Annex VIII) are recorded per system: SentRAI ` +
          `records them and assembles the documents, but the organisation still signs, affixes and submits them. ` +
          `Advisory clauses read the risk, dataset, document, TEVV, AI security, impact assessment, incident, AIMS and ` +
          `training registers as they are switched on.${notAssessedLine(n)}`
        : `${checksLine(n)} reach ${n.covered} articles: the core high-risk provider obligations (Articles 9–15, 17), ` +
          `value-chain and deployer duties (Articles 25, 26, 27) and post-market monitoring (Article 72) for high-risk ` +
          `systems, and the Article 50 transparency duty for limited-risk systems. Minimal-risk systems are recorded as ` +
          `passing the general guidelines entry without a check. The risk tier comes from the model’s functional area. ` +
          `Conformity assessment, CE-marking and EU-database registration are handled by the EU AI Act workspace ` +
          `(GOV_E5_1_EU_ACT), which is off in this deployment, so they are not claimed here.${notAssessedLine(n)}`,
    operational: [
      { text: 'Scope test and operator role per AI system; provider identity, contact and authorised representative', flag: 'euAiAct' },
      { text: 'Article 5 prohibited-practice screening with officer sign-off; a yes blocks the deploy gate in every gate mode', flag: 'euAiAct' },
      { text: 'Annex III / Annex I classification with the Article 6(3) derogation record, signed, setting the EU risk tier', flag: 'euAiAct' },
      { text: 'Annex VI internal-control checklist or Annex VII certificate, Annex V declaration of conformity, CE marking record', flag: 'euAiAct' },
      { text: 'EU database registration export (Annex VIII sections A, B and C) with the registration id and date', flag: 'euAiAct' },
      { text: 'Annex IV technical documentation and Article 13 instructions for use, built from the model card, with a readiness score', flag: 'euAiAct' },
      { text: 'Article 73 serious-incident classification with the 2, 10 and 15-day clocks, report template and pre-change system state', flag: 'euAiAct' },
      { text: 'Article 86 explanation requests from affected persons, with a public request path and a 30-day answer clock', flag: 'euAiAct' },
      { text: 'Article 20 non-conformity actions, Article 25 substantial-modification checks on material changes, Article 60 real-world test plans', flag: 'euAiAct' },
      { text: '10-year retention floor for EU documentation and a 6-month minimum for automatic logs (Articles 18, 19, 26(6))', flag: 'euAiAct' },
      { text: 'Authority request bundle for one system: Annex IV documentation, declaration, registration, incidents and logs', flag: 'euAiAct' },
    ],
  },
  'iso-42001': {
    id: 'iso_42001',
    name: 'ISO/IEC 42001',
    jurisdiction: 'International',
    depth: 'partial',
    universe: { total: 38, unit: 'Annex A controls' },
    units: (c) => (c.code.startsWith('AIMS-A.') ? [c.code] : []),
    statement: (n) => {
      const nums = [...new Set(n.codes.filter((c) => /^AIMS-\d/.test(c)).map((c) => Number(c.slice(5).split('.')[0])))].sort((a, b) => a - b);
      const clauses = `clause${nums.length === 1 ? '' : 's'} ${list(nums.map(String))}`;
      return (
        `${checksLine(n)} span ${clauses} and ${n.covered} of the 38 Annex A controls. ` +
        (n.org ? 'Organisation-level checks read the organisation’s own records in SentRAI (AIMS workspace, corrective actions, controlled documents, disclosures and engagement records, as switched on). ' : '') +
        (n.flags.soa
          ? 'The Statement of Applicability lists all 38 Annex A controls with inclusion, justification and a status taken from the mapped checks; a control no check evidences shows the status the organisation recorded. '
          : '') +
        `SentRAI records these processes; the organisation still runs them, and SentRAI does not by itself constitute certifiable conformance.${notAssessedLine(n)}`
      );
    },
    operational: [
      { text: 'Statement of Applicability for all 38 Annex A controls, officer approval of hashed versions, PDF and XLSX export', flag: 'soa' },
      { text: 'Impact assessments from the context profile and risk register: draft, signed final (hashed), revalidation on re-review triggers', flag: 'impactAssessment' },
      { text: 'Controlled documents with approver, review and retention dates and a content hash', flag: 'documentControl' },
      { text: 'Retirement workflow: approval by a second officer, checklist and a ledger record', flag: 'tevv' },
    ],
  },
  'au-dta': {
    id: 'au_dta',
    name: 'Australian Government AI policy (DTA v2.1)',
    jurisdiction: 'Australia',
    depth: 'partial',
    universe: { total: 29, unit: 'policy requirements (SentRAI’s SO / PO / IA / AD labels)' },
    units: (c) => refs(c).filter((r) => /^(SO|PO|IA|AD)-\d+$/.test(r)),
    statement: (n) =>
      `${checksLine(n, 'per-use-case')} cover ${n.covered} of the 29 policy requirements as SentRAI labels them ` +
      `(strategy and oversight, preparedness and operations, use case impact assessment, Appendices C and D). ` +
      `The Appendix C in-scope test decides which use cases the register and assessment checks apply to; high-risk checks ` +
      `apply only to in-scope HIGH or CRITICAL use cases. The requirement labels and the pack’s effective date are ` +
      `SentRAI’s reading of the published policy and still need compliance review. Strategy documents (SO-2) are ` +
      `outside the product.${notAssessedLine(n)}`,
    operational: [
      { text: 'DTA-format AI use case register view and CSV / XLSX export, share record and 6-monthly reminder' },
      { text: 'In-scope tracker with bulk draft assessments; high-risk report by the accountable official' },
      { text: 'DTA incident notification record', flag: 'incidentExtensions' },
    ],
  },
  'us-2026': {
    id: 'us_2026',
    name: 'US AI policy pack (OMB, SR 26-2, ECOA / Reg B, FTC Act, Colorado)',
    jurisdiction: 'United States',
    depth: 'partial',
    universe: {
      total: 44,
      unit: 'requirements across OMB M-25-21 / M-25-22, SR 26-2, ECOA / Reg B, FTC Act s.5, Colorado SB 26-189 and the AI Action Plan (SentRAI labels)',
    },
    units: (c) => refs(c).filter((r) => /^(M21|M22|SR|FL|FT|CO|AP)-\d+$/.test(r)),
    statement: (n) =>
      `${checksLine(n)} cover ${n.covered} of the 44 requirements in SentRAI’s US gap analysis. Impact-assessment and ` +
      `appeal checks apply to systems the pack classifies as high impact. Adverse-action checks read the decision ` +
      `records and notices SentRAI generates from the model’s own explanations; they are not legal advice, and the ` +
      `requirement mapping still needs compliance review. Strategy items (for example M21-2) are outside the product.${notAssessedLine(n)}`,
    operational: [
      { text: 'Reason-code maps, adverse-action notices, appeals and human reconsideration, with a public request path' },
      { text: 'SR 26-2 validations with independence checks, officer attestation and temporary-use exceptions', flag: 'modelValidation' },
      { text: 'OMB inventory export and Colorado developer disclosures with material-update notices', flag: 'disclosures' },
      { text: 'External-AI policy (allowed, attested only, blocked), provider no-training attestations, full organisation export', flag: 'federalVendor' },
    ],
  },
};

/** The version of a pack in force on `at`, read from the built-in definitions with the given flags. */
function packInForce(id: string, flags: FeatureFlags, at: Date): PackDefinition | null {
  const defs = BUILT_IN_PACKS.filter((d) => d.id === id && (!d.flag || flags[d.flag]) && Date.parse(d.effectiveFrom) <= at.getTime());
  defs.sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom));
  return defs[0] ?? null;
}

function packCoverage(flags: FeatureFlags, at: Date): FrameworkCoverage[] {
  const out: FrameworkCoverage[] = [];
  for (const [packId, meta] of Object.entries(PACK_META)) {
    const def = packInForce(packId, flags, at);
    if (!def) continue;
    const evaluated: CoverageControl[] = [];
    const notAssessed: CoverageControl[] = [];
    const units = new Set<string>();
    let model = 0;
    let org = 0;
    for (const c of def.clauses) {
      if (c.flag && !flags[c.flag]) continue;
      const control = getControl(c.control);
      if (!control) continue;
      const scope = control.scope === 'ORG' ? 'organisation' : 'model';
      const item: CoverageControl = {
        code: c.code,
        name: c.name,
        ...(c.clause ? { clause: c.clause } : {}),
        scope,
        ...(c.mandatory === false ? { advisory: true } : {}),
        ...(c.appliesWhenTier ? { appliesTo: c.appliesWhenTier } : {}),
        ...(CONTROL_NOTES[c.control] ? { note: CONTROL_NOTES[c.control] } : {}),
      };
      const needs = CONTROL_NEEDS[c.control];
      if (needs && !flags[needs]) {
        notAssessed.push(item);
        continue;
      }
      evaluated.push(item);
      if (scope === 'organisation') org++;
      else model++;
      for (const u of meta.units(c, flags)) units.add(u);
    }
    const coveredList = [...units].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const impl = implementationSummary(meta.id, flags);
    const depth: 'deep' | 'partial' = impl ? (impl.applicable && impl.implemented / impl.applicable >= DEEP_THRESHOLD ? 'deep' : 'partial') : meta.depth;
    const counts: Counts = { model, org, covered: units.size, coveredList, codes: evaluated.map((e) => e.code), notAssessed, flags };
    out.push({
      id: meta.id,
      name: meta.name,
      jurisdiction: meta.jurisdiction,
      depth,
      evaluated,
      ...(notAssessed.length ? { notAssessed } : {}),
      universe: { ...meta.universe, covered: units.size },
      statement: meta.statement(counts),
      operational: (meta.operational ?? []).filter((o) => !o.flag || flags[o.flag]).map((o) => o.text),
      ...(def.optIn
        ? { availability: 'Opt-in: applies only to organisations that switch this pack on in Governance settings. It never changes results for anyone else.' }
        : {}),
      basis: `Pack ${def.id} v${def.version}, in force from ${def.effectiveFrom}`,
      ...(impl ? { implementation: { ...impl, assessedOn: IMPLEMENTATION_ASSESSED.on, commit: IMPLEMENTATION_ASSESSED.commit } } : {}),
    });
  }
  return out;
}

/* =================================================================== */

/** Coverage as it stands with the given flags: flagged checks appear only when on,
 *  and the statement counts are computed from what is listed. */
export function getCoverage(flags: FeatureFlags = getFeatureFlags(), at: Date = new Date()): FrameworkCoverage[] {
  if (flags.packEngine) return packCoverage(flags, at);
  return COVERAGE.map((f) => {
    const evaluated = f.evaluated.filter((c) => !c.flag || flags[c.flag]);
    const recs = evaluated.filter((c) => c.code.startsWith('REC-')).map((c) => c.code.slice(4));
    // Distinct codes only: two checks sharing MAP-1.1 count once, and no check
    // is credited with a subcategory it does not evidence.
    const subCount = new Set(evaluated.map((c) => c.code)).size;
    const words = ['zero', 'one', 'two', 'three', 'four', 'five'];
    const statement = f.statement
      .replace('{recCount}', words[recs.length] ?? String(recs.length))
      .replace('{recList}', `Recs ${recs.join(', ').replace(/, ([^,]*)$/, ' and $1')}`)
      .replace('{checkCount}', String(evaluated.length))
      .replace('{subCount}', String(subCount));
    const operational = (f.operational ?? [])
      .filter((o) => typeof o === 'string' || !o.flag || flags[o.flag])
      .map((o) => (typeof o === 'string' ? o : o.text));
    return {
      ...f,
      evaluated: evaluated.map(({ code, name, note }) => ({ code, name, ...(note ? { note } : {}) })),
      statement,
      operational,
    };
  });
}

/** Which evaluation path this deployment runs, in words for the page. */
export function coverageMode(flags: FeatureFlags = getFeatureFlags()): { mode: 'packs' | 'validators'; description: string } {
  return flags.packEngine
    ? {
        mode: 'packs',
        description:
          'This deployment evaluates through the framework pack engine (GOVERNANCE_V2 with GOV_E1_1_PACKS). The lists below are generated from the packs in force, clause by clause, and include only the checks whose governance flag is on here.',
      }
    : {
        mode: 'validators',
        description:
          'This deployment evaluates with the built-in validators. The governance epics (risk register, impact assessments, AIMS, region packs and the rest) are switched off here, so nothing they add is claimed below.',
      };
}

export function coverageSummary(flags: FeatureFlags = getFeatureFlags()) {
  const mode = coverageMode(flags);
  return {
    generated_from: flags.packEngine
      ? 'src/governance/packs/definitions (packs in force), filtered by this deployment’s governance flags'
      : 'src/compliance/coverage.data.ts — kept in lockstep with the validators by contract',
    mode: mode.mode,
    mode_description: mode.description,
    frameworks: getCoverage(flags).map((f) => ({
      id: f.id,
      name: f.name,
      jurisdiction: f.jurisdiction,
      depth: f.depth,
      controls_evaluated: f.evaluated.length,
      universe_total: f.universe.total,
      universe_unit: f.universe.unit,
      ...(f.universe.covered !== undefined ? { universe_covered: f.universe.covered } : {}),
      statement: f.statement,
      operational: (f.operational ?? []) as string[],
      ...(f.availability ? { availability: f.availability } : {}),
      ...(f.basis ? { basis: f.basis } : {}),
      evaluated: f.evaluated,
      ...(f.notAssessed ? { not_assessed: f.notAssessed } : {}),
      ...(f.implementation ? { implementation: f.implementation } : {}),
    })),
  };
}
