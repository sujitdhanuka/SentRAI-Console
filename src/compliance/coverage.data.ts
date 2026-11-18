/**
 * Coverage disclosure — the single source of truth for what SentRAI actually
 * evaluates per framework, published at /coverage and /api/v1/compliance/coverage.
 *
 * HONESTY CONTRACT: every control listed here MUST correspond to a check that
 * exists in sutras.validator.ts or frameworks.validator.ts. When a validator
 * gains or loses a check, this file changes in the same commit. Overstating
 * coverage here is a product-integrity bug of the highest severity — this page
 * exists precisely so our claims can never drift from our code.
 *
 * Checks behind an off-by-default governance flag are listed only while that
 * flag is on (see getCoverage), so the page never claims a check that is not
 * running.
 */
import { FeatureFlags, getFeatureFlags } from '../common/feature-flags';

export interface CoverageControl {
  code: string;
  name: string;
  /** Listed only when this governance flag is on. */
  flag?: keyof Omit<FeatureFlags, 'governanceV2'>;
}

export interface FrameworkCoverage {
  id: string;
  name: string;
  jurisdiction: string;
  depth: 'deep' | 'partial';
  /** Controls the validators evaluate today (verifiable in source). */
  evaluated: CoverageControl[];
  /** The size of the regime we measure ourselves against, and what that number counts. */
  universe: { total: number; unit: string };
  /** Plain-language statement of what is and is not covered. */
  statement: string;
  /** What operational machinery (beyond per-model checks) implements the regime. */
  operational?: string[];
}

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
      { code: 'MEASURE-2.7', name: 'Security Red Teaming & Bias Auditing (also evidences MEASURE 2.11)' },
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
      'Full subcategory coverage ships as a data-driven control pack on the current roadmap.',
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
      { code: 'Art-Min', name: 'Minimal-risk general guidelines check' },
    ],
    universe: { total: 113, unit: 'articles in the Act' },
    statement:
      'Fourteen articles are evaluated per model: the core high-risk provider obligations ' +
      '(Articles 9–15, 17), value-chain and deployer duties (Articles 25, 26, 27), post-market ' +
      'monitoring (Article 72), and the Article 50 transparency duty, plus a risk-tier check for ' +
      'minimal-risk systems. Conformity assessment, CE-marking and EU-database registration ' +
      '(e.g. Article 16) are process/paperwork obligations we do not implement — we deliberately ' +
      'do not claim them. Annex III use-case classification is on the pack roadmap.',
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
      'SentRAI does not yet record impact assessments, so it makes no claim there. The full 38 Annex A ' +
      'controls are not yet individually mapped; SentRAI supports an ISO 42001 programme — it does not by ' +
      'itself constitute certifiable conformance. Complete Annex A mapping is on the pack roadmap.',
  },
];

/** Coverage as it stands with the given flags: flagged checks appear only when on,
 *  and the statement counts are computed from what is listed. */
export function getCoverage(flags: FeatureFlags = getFeatureFlags()): FrameworkCoverage[] {
  return COVERAGE.map((f) => {
    const evaluated = f.evaluated.filter((c) => !c.flag || flags[c.flag]);
    const recs = evaluated.filter((c) => c.code.startsWith('REC-')).map((c) => c.code.slice(4));
    const subCount = new Set(evaluated.map((c) => c.code)).size + (evaluated.some((c) => c.code === 'MEASURE-2.7') ? 1 : 0);
    const words = ['zero', 'one', 'two', 'three', 'four', 'five'];
    const statement = f.statement
      .replace('{recCount}', words[recs.length] ?? String(recs.length))
      .replace('{recList}', `Recs ${recs.join(', ').replace(/, ([^,]*)$/, ' and $1')}`)
      .replace('{checkCount}', String(evaluated.length))
      .replace('{subCount}', String(subCount));
    return { ...f, evaluated: evaluated.map(({ code, name }) => ({ code, name })), statement };
  });
}

export function coverageSummary(flags: FeatureFlags = getFeatureFlags()) {
  return {
    generated_from: 'src/compliance/coverage.data.ts — kept in lockstep with the validators by contract',
    frameworks: getCoverage(flags).map((f) => ({
      id: f.id,
      name: f.name,
      jurisdiction: f.jurisdiction,
      depth: f.depth,
      controls_evaluated: f.evaluated.length,
      universe_total: f.universe.total,
      universe_unit: f.universe.unit,
      statement: f.statement,
      operational: f.operational ?? [],
      evaluated: f.evaluated,
    })),
  };
}
