/**
 * Regulatory framework validators (NIST AI RMF, EU AI Act, ISO 42001) used by
 * the inventory compliance-check, governance, metrics, and PDF endpoints.
 *
 * Checks fall into two groups:
 *  - declarative: judged from the model's registered metadata and attached
 *    evidence artifacts (bias-test / red-team reports — not checkboxes);
 *  - operational: judged from what the platform has actually observed —
 *    ledger events, drift evaluations, BCP state, incident hygiene — passed
 *    in as a ValidationContext by the caller.
 */
import { ModelType, RiskLevel } from '../common/enums';
import { AIModelEntry, hasEvidence } from '../domain/model-inventory';

/** Operational evidence gathered from the platform's own records. */
export interface ValidationContext {
  ledgerEventCount?: number;
  driftReportCount?: number;
  lastDriftAt?: Date | null;
  overdueIncidentCount?: number;
  bcpConfigured?: boolean;
  /** EU AI Act high-risk functional areas (env-configurable). */
  euHighRiskDomains?: string[];
}

export interface FrameworkCheck {
  controlCode: string;
  name: string;
  passed: boolean;
  evidence: string;
  gap: string;
  mandatory: boolean;
}

export interface FrameworkComplianceReport {
  frameworkName: string;
  modelId: string;
  modelName: string;
  riskTier: string;
  checks: FrameworkCheck[];
}

export function frameworkOverallPass(r: FrameworkComplianceReport): boolean {
  return r.checks.filter((c) => c.mandatory && !c.passed).length === 0;
}

export function frameworkBlockingGaps(r: FrameworkComplianceReport): string[] {
  return r.checks.filter((c) => c.mandatory && !c.passed && c.gap).map((c) => c.gap);
}

export function frameworkReportAsDict(r: FrameworkComplianceReport): Record<string, any> {
  return {
    framework_name: r.frameworkName,
    model_id: String(r.modelId),
    model_name: r.modelName,
    risk_tier: r.riskTier,
    overall_pass: frameworkOverallPass(r),
    blocking_gaps: frameworkBlockingGaps(r),
    checks: r.checks.map((c) => ({
      control_code: c.controlCode,
      name: c.name,
      passed: c.passed,
      evidence: c.evidence,
      gap: c.gap,
      mandatory: c.mandatory,
    })),
  };
}

function check(
  controlCode: string,
  name: string,
  passed: boolean,
  evidence: string,
  gap: string,
  mandatory = true,
): FrameworkCheck {
  return { controlCode, name, passed, evidence, gap, mandatory };
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

const DRIFT_RECENCY_DAYS = 30;

function recentDrift(ctx: ValidationContext): { ok: boolean; evidence: string } {
  if (ctx.lastDriftAt) {
    const d = daysSince(ctx.lastDriftAt);
    if (d <= DRIFT_RECENCY_DAYS) return { ok: true, evidence: `Last drift evaluation ${d} day(s) ago` };
    return { ok: false, evidence: `Drift evaluation stale: last run ${d} days ago` };
  }
  return { ok: false, evidence: 'No drift evaluations recorded for this model' };
}

/* ------------------------------- NIST AI RMF ------------------------------ */

export function validateNistRmf(entry: AIModelEntry, ctx: ValidationContext = {}): FrameworkComplianceReport {
  const checks: FrameworkCheck[] = [];
  const isHigh = entry.riskLevel === RiskLevel.HIGH || entry.riskLevel === RiskLevel.CRITICAL;

  // GOVERN — accountability structures
  const ownerStr = entry.ownerTeam || '';
  const hasOwner = Boolean(ownerStr) && !ownerStr.toLowerCase().includes('unassigned');
  checks.push(check(
    'GOVERN-1.1',
    'Organizational Ownership & Responsibility',
    hasOwner,
    hasOwner ? `Owner team: ${entry.ownerTeam}` : 'No owner team assigned',
    'Organizational governance requires a designated owner team.',
  ));

  const hasPolicy = Boolean(entry.boardPolicyRef && entry.boardPolicyRef.trim());
  checks.push(check(
    'GOVERN-1.2',
    'Board Policy Alignment',
    hasPolicy,
    hasPolicy ? `Board policy reference: ${entry.boardPolicyRef}` : 'No board policy reference provided',
    'Governance requires alignment with a board-approved AI policy reference.',
  ));

  const hasAuditCadence = Boolean(entry.nextAuditDue);
  checks.push(check(
    'GOVERN-1.3',
    'Audit Cadence Defined',
    hasAuditCadence,
    hasAuditCadence ? `Next audit due: ${entry.nextAuditDue!.toISOString().slice(0, 10)}` : 'No audit schedule recorded',
    'A recurring audit schedule must be defined for each model.',
  ));

  // MAP — context is understood and documented
  const desc = entry.useCaseDescription || '';
  checks.push(check(
    'MAP-1.1',
    'Purpose & Use-Case Documentation',
    desc.trim().length >= 20,
    desc.trim().length >= 20 ? `Use case documented (${desc.length} chars)` : 'Use case missing or too thin to review',
    'Map stage requires a substantive documented purpose for the system.',
  ));

  const hasContext = Boolean(entry.functionalArea) && (entry.targetCustomerSegments ?? []).length > 0;
  checks.push(check(
    'MAP-1.2',
    'Deployment Context & Affected Users',
    hasContext,
    hasContext
      ? `Functional area '${entry.functionalArea}' affecting segments: ${entry.targetCustomerSegments.join(', ')}`
      : 'Functional area or affected customer segments not documented',
    'Document the functional area and the customer segments the model affects.',
    false,
  ));

  const hasProvenance = Boolean(entry.sourceRef) || (entry.dependencies ?? []).length > 0;
  checks.push(check(
    'MAP-1.3',
    'Source & Dependency Provenance',
    hasProvenance,
    hasProvenance ? `Provenance: ${entry.sourceRef ?? 'dependency list'}` : 'No source reference or dependencies recorded',
    'Track the source repository or third-party dependencies behind the model.',
    false,
  ));

  // MEASURE — the system is actually tested and measured
  let redTeamOk = false;
  let redTeamEvidence = 'No red-team / bias-audit evidence on record';
  if (entry.lastRedTeamDate) {
    const d = daysSince(entry.lastRedTeamDate);
    redTeamOk = d < 365;
    redTeamEvidence = redTeamOk
      ? `Last red teamed ${d} days ago (${entry.lastRedTeamDate.toISOString().slice(0, 10)})`
      : `Red teaming stale: last performed ${d} days ago`;
  } else if (hasEvidence(entry, 'red_team')) {
    redTeamOk = true;
    redTeamEvidence = 'Red-team report attached as evidence artifact';
  }
  checks.push(check(
    'MEASURE-2.1',
    'Security Red Teaming & Bias Auditing',
    redTeamOk,
    redTeamEvidence,
    'Measure stage requires a bias audit / red-team review within the last 12 months (date or attached report).',
  ));

  const drift = recentDrift(ctx);
  checks.push(check(
    'MEASURE-2.2',
    'Performance Drift Measurement',
    drift.ok,
    drift.evidence,
    'Measure stage requires recent drift evaluation over live inference scores (push windows to /monitoring/scores).',
  ));

  const hasBenchmarks = (entry.performanceBenchmarks ?? []).length > 0;
  checks.push(check(
    'MEASURE-2.3',
    'Performance Benchmarks Recorded',
    hasBenchmarks,
    hasBenchmarks ? `${entry.performanceBenchmarks.length} benchmark(s) recorded` : 'No performance benchmarks recorded',
    'Record baseline performance benchmarks for comparison over time.',
    false,
  ));

  // MANAGE — risks are actively managed
  const hasOversight = !(isHigh && !entry.humanOversightRequired);
  checks.push(check(
    'MANAGE-1.1',
    'Human Oversight Controls',
    hasOversight,
    entry.humanOversightRequired
      ? 'Human-in-the-loop oversight enabled'
      : 'No oversight controls required (Low/Medium risk)',
    'High-risk decisions require a human-in-the-loop oversight control.',
  ));

  const bcpOk = Boolean(ctx.bcpConfigured);
  checks.push(check(
    'MANAGE-1.2',
    'Fallback / Business-Continuity Plan',
    bcpOk,
    bcpOk ? 'BCP fallback state configured for this model' : 'No BCP fallback configured',
    'High-risk models need a configured business-continuity fallback (activate via /monitoring/bcp).',
    isHigh,
  ));

  const overdue = ctx.overdueIncidentCount ?? 0;
  checks.push(check(
    'MANAGE-1.3',
    'Incident Reporting Hygiene',
    overdue === 0,
    overdue === 0 ? 'No overdue incident reports' : `${overdue} incident(s) past their reporting deadline`,
    'Report incidents within their severity SLA before deadlines lapse.',
  ));

  return { frameworkName: 'NIST AI RMF', modelId: entry.modelId, modelName: entry.name, riskTier: isHigh ? 'High' : 'Standard', checks };
}

/* -------------------------------- EU AI Act ------------------------------- */

const DEFAULT_EU_HIGH_RISK_DOMAINS = [
  'credit_underwriting',
  'loan_decisioning',
  'fund_movement',
  'credit_scoring',
  'insurance_pricing',
];

export function validateEuAiAct(entry: AIModelEntry, ctx: ValidationContext = {}): FrameworkComplianceReport {
  const checks: FrameworkCheck[] = [];
  const fa = (entry.functionalArea || '').toLowerCase();
  const highRiskDomains = ctx.euHighRiskDomains ?? DEFAULT_EU_HIGH_RISK_DOMAINS;
  const isHighRiskDomain = highRiskDomains.includes(fa);

  let riskTier: string;
  if (isHighRiskDomain) riskTier = 'High Risk';
  else if (entry.modelType === ModelType.GENERATIVE_AI || fa.includes('chatbot')) riskTier = 'Limited Risk';
  else riskTier = 'Minimal Risk';

  if (riskTier === 'High Risk') {
    const riskClassified = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL].includes(entry.riskLevel);
    checks.push(check(
      'Art-9',
      'Risk Management System',
      riskClassified && Boolean(entry.boardPolicyRef),
      riskClassified && entry.boardPolicyRef
        ? `Risk tier ${entry.riskLevel} under board policy ${entry.boardPolicyRef}`
        : 'Risk classification or governing policy reference missing',
      'High-risk AI systems require a documented risk-management system (classification + board policy).',
    ));

    const dataGovOk = hasEvidence(entry, 'bias_test') || (entry.dependencies ?? []).length > 0;
    checks.push(check(
      'Art-10',
      'Data & Data Governance',
      dataGovOk,
      dataGovOk
        ? hasEvidence(entry, 'bias_test')
          ? 'Bias-test evidence artifact attached'
          : 'Training data dependencies documented'
        : 'No bias-testing evidence or data dependencies recorded',
      'High-risk systems must document training data governance and bias testing (attach a bias_test artifact).',
    ));

    const hasSource = Boolean(entry.sourceRef);
    const docOk = hasSource && (entry.useCaseDescription || '').trim().length >= 20;
    checks.push(check(
      'Art-11',
      'Technical Documentation',
      docOk,
      docOk ? `Source codebase ref: ${entry.sourceRef}; purpose documented` : 'Missing source traceability or substantive purpose documentation',
      'High-risk AI systems must have complete technical documentation including source traceability.',
    ));

    const recordsOk = (ctx.ledgerEventCount ?? 0) > 0 && (ctx.driftReportCount ?? 0) > 0;
    checks.push(check(
      'Art-12',
      'Record-Keeping (Automatic Logs)',
      recordsOk,
      recordsOk
        ? `${ctx.ledgerEventCount} ledger event(s), ${ctx.driftReportCount} drift evaluation(s) on record`
        : 'Insufficient operational records: model needs ledger history and drift evaluations',
      'High-risk systems require automatically generated operational logs (ledger events + drift evaluations).',
    ));

    checks.push(check(
      'Art-14',
      'Human Oversight Gate',
      entry.humanOversightRequired,
      entry.humanOversightRequired ? 'Human-in-the-loop is active' : 'Oversight deactivated',
      'High-risk systems require explicit human-in-the-loop oversight gates.',
    ));

    const drift = recentDrift(ctx);
    const robustnessOk = drift.ok;
    checks.push(check(
      'Art-15',
      'Accuracy, Robustness & Cybersecurity',
      robustnessOk,
      drift.evidence,
      'High-risk systems require continuous accuracy/robustness monitoring (recent drift evaluations).',
    ));
  } else if (riskTier === 'Limited Risk') {
    const descStr = entry.useCaseDescription || '';
    const hasDesc = descStr.length > 10;
    checks.push(check(
      'Art-50',
      'Transparency & Disclosure',
      hasDesc,
      hasDesc ? `Use case transparency text: ${descStr.slice(0, 100)}...` : 'No transparency statement',
      'Limited risk systems must provide clear use case descriptions for user transparency.',
    ));
  } else {
    checks.push(check('Art-Minimal', 'General Compliance Guidelines', true, 'Minimal risk model. Complies by default.', ''));
  }

  return { frameworkName: 'EU AI Act', modelId: entry.modelId, modelName: entry.name, riskTier, checks };
}

/* ------------------------------- ISO/IEC 42001 ---------------------------- */

export function validateIso42001(entry: AIModelEntry, ctx: ValidationContext = {}): FrameworkComplianceReport {
  const checks: FrameworkCheck[] = [];
  const isMedOrHigh = [RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL].includes(entry.riskLevel);

  const hasRisk = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL].includes(entry.riskLevel);
  checks.push(check(
    'AIMS-6.1.2',
    'AI System Risk Assessment',
    hasRisk,
    hasRisk ? `System evaluated risk tier: ${entry.riskLevel}` : 'Risk level unclassified',
    'ISO 42001 requires systematic risk classification for each AI system.',
  ));

  const useCase = entry.useCaseDescription || '';
  const hasImpact = Boolean(useCase && useCase.length > 10);
  checks.push(check(
    'AIMS-8.2',
    'AI System Impact Assessment',
    hasImpact,
    hasImpact ? `Impact assessment description provided (${useCase.length} chars)` : 'No impact description recorded',
    'Clause 8.2 requires documented AI system impact assessments.',
  ));

  const hasDataGov = Boolean(entry.sourceRef || (entry.dependencies && entry.dependencies.length));
  checks.push(check(
    'AIMS-8.3',
    'Data & Codebase Governance',
    hasDataGov,
    hasDataGov ? `Source/data references tracked: ${entry.sourceRef || 'Dependencies list'}` : 'No codebase or data dependencies registered',
    'AIMS Data Governance requires tracking source repository or third-party dependencies.',
  ));

  const drift = recentDrift(ctx);
  checks.push(check(
    'AIMS-9.1',
    'Performance Monitoring & Measurement',
    drift.ok,
    drift.evidence,
    'Clause 9.1 requires active performance monitoring of deployed AI systems.',
    isMedOrHigh,
  ));

  const auditOk = Boolean(entry.nextAuditDue) && entry.nextAuditDue!.getTime() > Date.now();
  checks.push(check(
    'AIMS-9.2',
    'Internal Audit Cadence',
    auditOk,
    auditOk
      ? `Next audit scheduled for ${entry.nextAuditDue!.toISOString().slice(0, 10)}`
      : entry.nextAuditDue
        ? 'Audit is past due'
        : 'No internal audit scheduled',
    'Clause 9.2 requires internal audits at planned intervals; schedule the next audit.',
    false,
  ));

  const overdue = ctx.overdueIncidentCount ?? 0;
  checks.push(check(
    'AIMS-10.1',
    'Nonconformity & Corrective Action',
    overdue === 0,
    overdue === 0 ? 'No overdue incident reports' : `${overdue} incident(s) past reporting deadline`,
    'Clause 10 requires timely handling of nonconformities: report overdue incidents.',
    false,
  ));

  return { frameworkName: 'ISO 42001', modelId: entry.modelId, modelName: entry.name, riskTier: isMedOrHigh ? 'Elevated' : 'Standard', checks };
}
