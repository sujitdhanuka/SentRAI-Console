/**
 * Coverage disclosure — the single source of truth for what SentRAI actually
 * evaluates per framework, published at /coverage and /api/v1/compliance/coverage.
 *
 * HONESTY CONTRACT: every control listed here MUST correspond to a check that
 * exists in sutras.validator.ts or frameworks.validator.ts. When a validator
 * gains or loses a check, this file changes in the same commit. Overstating
 * coverage here is a product-integrity bug of the highest severity — this page
 * exists precisely so our claims can never drift from our code.
 */

export interface CoverageControl {
  code: string;
  name: string;
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
      { code: 'REC-14', name: 'Board-approved AI policy (checked per model; gates live promotion)' },
      { code: 'REC-16', name: 'Accountability chain / named owner (gates live promotion)' },
      { code: 'REC-20', name: 'Bias-test evidence for MEDIUM/HIGH risk' },
      { code: 'REC-24', name: 'Explainability mechanism for MEDIUM/HIGH risk' },
    ],
    universe: { total: 26, unit: 'committee recommendations' },
    statement:
      'All 7 sutras are evaluated on every model. Of the committee report’s 26 recommendations, ' +
      '4 are enforced as explicit per-model controls (14, 16, 20, 24); several others are implemented ' +
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
      { code: 'GOVERN-1.1', name: 'Organizational Ownership & Responsibility' },
      { code: 'GOVERN-1.2', name: 'Board Policy Alignment' },
      { code: 'GOVERN-1.3', name: 'Audit Cadence Defined' },
      { code: 'MAP-1.1', name: 'Purpose & Use-Case Documentation' },
      { code: 'MAP-1.2', name: 'Deployment Context & Affected Users' },
      { code: 'MAP-1.3', name: 'Source & Dependency Provenance' },
      { code: 'MEASURE-2.1', name: 'Security Red Teaming & Bias Auditing' },
      { code: 'MEASURE-2.2', name: 'Performance Drift Measurement' },
      { code: 'MEASURE-2.3', name: 'Performance Benchmarks Recorded' },
      { code: 'MANAGE-1.1', name: 'Human Oversight Controls' },
      { code: 'MANAGE-1.2', name: 'Fallback / Business-Continuity Plan' },
      { code: 'MANAGE-1.3', name: 'Incident Reporting Hygiene' },
      { code: 'MANAGE-2.1', name: 'Risk Response Resourcing (Named Owner)' },
      { code: 'MEASURE-3.1', name: 'Risk Tracking Mechanisms (Ledger History)' },
    ],
    universe: { total: 72, unit: 'playbook subcategories' },
    statement:
      '14 of the playbook’s 72 subcategories are evaluated as per-model controls across all four ' +
      'functions (GOVERN, MAP, MEASURE, MANAGE), chosen for signal over ceremony. A verdict here means ' +
      'those 14 controls pass; it is an indicative posture signal, not full-framework conformance. ' +
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
      { code: 'Art-25', name: 'Provider Responsibilities Along the Value Chain' },
      { code: 'Art-27', name: 'Fundamental Rights Impact Assessment' },
      { code: 'Art-50', name: 'Transparency & Disclosure' },
      { code: 'Art-72', name: 'Post-Market Monitoring' },
      { code: 'Art-Min', name: 'Minimal-risk general guidelines check' },
    ],
    universe: { total: 113, unit: 'articles in the Act' },
    statement:
      'Twelve articles are evaluated per model: the core high-risk provider obligations ' +
      '(Articles 9–15), value-chain and deployer duties (Articles 25, 27), post-market ' +
      'monitoring (Article 72), and the Article 50 transparency duty, plus a risk-tier check for ' +
      'minimal-risk systems. Annex III use-case classification, conformity assessment and ' +
      'CE-marking workflows are not yet implemented and are on the pack roadmap.',
  },
  {
    id: 'iso_42001',
    name: 'ISO/IEC 42001',
    jurisdiction: 'International',
    depth: 'partial',
    evaluated: [
      { code: 'AIMS-6.1.2', name: 'AI System Risk Assessment' },
      { code: 'AIMS-8.2', name: 'AI System Impact Assessment' },
      { code: 'AIMS-8.3', name: 'Data & Codebase Governance' },
      { code: 'AIMS-7.2', name: 'Competence & Accountability' },
      { code: 'AIMS-9.1', name: 'Performance Monitoring & Measurement' },
      { code: 'AIMS-9.2', name: 'Internal Audit Cadence' },
      { code: 'AIMS-10.1', name: 'Nonconformity & Corrective Action' },
      { code: 'AIMS-A.6.2', name: 'AI System Documentation (Model Card)' },
    ],
    universe: { total: 38, unit: 'Annex A controls' },
    statement:
      'Eight management-system checks spanning clauses 6, 7, 8, 9 and 10 plus Annex A documentation ' +
      'are evaluated per model. The full 38 Annex A controls are not yet individually mapped; SentRAI ' +
      'supports an ISO 42001 programme — it does not by itself constitute certifiable conformance. ' +
      'Complete Annex A mapping is on the pack roadmap.',
  },
];

export function coverageSummary() {
  return {
    generated_from: 'src/compliance/coverage.data.ts — kept in lockstep with the validators by contract',
    frameworks: COVERAGE.map((f) => ({
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
