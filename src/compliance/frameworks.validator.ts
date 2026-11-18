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
import { FeatureFlags, getFeatureFlags } from '../common/feature-flags';
import {
  AIModelEntry,
  daysBetween,
  hasEvidence,
  LEGACY_RED_TEAM_INTERVAL_DAYS,
  lastRedTeamEvidenceAt,
  redTeamIntervalDays,
} from '../domain/model-inventory';

/** Operational evidence gathered from the platform's own records. */
export interface ValidationContext {
  ledgerEventCount?: number;
  driftReportCount?: number;
  lastDriftAt?: Date | null;
  overdueIncidentCount?: number;
  bcpConfigured?: boolean;
  /** EU AI Act high-risk functional areas (env-configurable). */
  euHighRiskDomains?: string[];
  /** Date of the model's last recorded BCP drill (E0.4). */
  bcpDrillLastConducted?: Date | null;
  /** Governance feature flags; read from the environment when omitted. */
  flags?: FeatureFlags;
}

export interface FrameworkCheck {
  controlCode: string;
  name: string;
  passed: boolean;
  evidence: string;
  gap: string;
  mandatory: boolean;
  /** True when SentRAI cannot assess the control yet: reported as NOT ASSESSED,
   *  never as a pass, and never blocking. */
  notAssessed?: boolean;
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
      ...(c.notAssessed ? { not_assessed: true } : {}),
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

/** A model has a real accountable owner when the field is set and isn't the
 *  import placeholder ("UNASSIGNED — pending review"). */
function ownerAssigned(entry: AIModelEntry): boolean {
  const o = (entry.ownerTeam || '').trim();
  return o.length > 0 && !/^unassigned/i.test(o);
}

/* ------------------------------- NIST AI RMF ------------------------------ */

export function validateNistRmf(entry: AIModelEntry, ctx: ValidationContext = {}): FrameworkComplianceReport {
  const checks: FrameworkCheck[] = [];
  const isHigh = entry.riskLevel === RiskLevel.HIGH || entry.riskLevel === RiskLevel.CRITICAL;

  // GOVERN — accountability structures
  const ownerStr = entry.ownerTeam || '';
  const hasOwner = Boolean(ownerStr) && !ownerStr.toLowerCase().includes('unassigned');
  // Roles and responsibilities for AI risk (GOVERN 2.1).
  checks.push(check(
    'GOVERN-2.1',
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
  // Periodic review of risk management planned (GOVERN 1.5).
  checks.push(check(
    'GOVERN-1.5',
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
  // Deployment setting and affected people are part of context (MAP 1.1).
  checks.push(check(
    'MAP-1.1',
    'Deployment Context & Affected Users',
    hasContext,
    hasContext
      ? `Functional area '${entry.functionalArea}' affecting segments: ${entry.targetCustomerSegments.join(', ')}`
      : 'Functional area or affected customer segments not documented',
    'Document the functional area and the customer segments the model affects.',
    false,
  ));

  const hasProvenance = Boolean(entry.sourceRef) || (entry.dependencies ?? []).length > 0;
  // Mapping the system's components and third-party dependencies (MAP 4.1).
  checks.push(check(
    'MAP-4.1',
    'Source & Dependency Provenance',
    hasProvenance,
    hasProvenance ? `Provenance: ${entry.sourceRef ?? 'dependency list'}` : 'No source reference or dependencies recorded',
    'Track the source repository or third-party dependencies behind the model.',
    false,
  ));

  // MEASURE — the system is actually tested and measured
  // Security and resilience evaluated (MEASURE 2.7). It passes on a red-team
  // date or report alone, so it is not claimed as bias evidence (MEASURE 2.11).
  const flags = ctx.flags ?? getFeatureFlags();
  let redTeamOk = false;
  let redTeamEvidence = 'No red-team evidence on record';
  let redTeamGap = 'Measure stage requires a red-team review within the last 12 months (date or attached report).';
  if (flags.redTeamIntervals) {
    // E0.3: one interval per risk tier, the same rule Sutra 7 uses.
    const interval = redTeamIntervalDays(entry.riskLevel);
    const at = lastRedTeamEvidenceAt(entry);
    redTeamGap = `Measure stage requires a red-team review within ${interval} days for ${entry.riskLevel} risk (date or attached report).`;
    if (at) {
      const d = daysBetween(at);
      redTeamOk = d <= interval;
      redTeamEvidence = redTeamOk
        ? `Last red teamed ${d} days ago (${at.toISOString().slice(0, 10)}); ${entry.riskLevel} interval is ${interval} days`
        : `Red teaming stale: last performed ${d} days ago; ${entry.riskLevel} interval is ${interval} days`;
    }
  } else if (entry.lastRedTeamDate) {
    const d = daysSince(entry.lastRedTeamDate);
    redTeamOk = d < LEGACY_RED_TEAM_INTERVAL_DAYS;
    redTeamEvidence = redTeamOk
      ? `Last red teamed ${d} days ago (${entry.lastRedTeamDate.toISOString().slice(0, 10)})`
      : `Red teaming stale: last performed ${d} days ago`;
  } else if (hasEvidence(entry, 'red_team')) {
    redTeamOk = true;
    redTeamEvidence = 'Red-team report attached as evidence artifact';
  }
  checks.push(check(
    'MEASURE-2.7',
    'Security Red Teaming',
    redTeamOk,
    redTeamEvidence,
    redTeamGap,
  ));

  const drift = recentDrift(ctx);
  // Functionality and behaviour monitored in production (MEASURE 2.4).
  checks.push(check(
    'MEASURE-2.4',
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
  // Human-AI configuration and oversight roles (GOVERN 3.2; also MAP 3.5).
  checks.push(check(
    'GOVERN-3.2',
    'Human Oversight Controls',
    hasOversight,
    entry.humanOversightRequired
      ? 'Human-in-the-loop oversight enabled'
      : 'No oversight controls required (Low/Medium risk)',
    'High-risk decisions require a human-in-the-loop oversight control.',
  ));

  const bcpOk = Boolean(ctx.bcpConfigured);
  // Mechanisms to supersede or disengage the system (MANAGE 2.4).
  checks.push(check(
    'MANAGE-2.4',
    'Fallback / Business-Continuity Plan',
    bcpOk,
    bcpOk ? 'BCP fallback state configured for this model' : 'No BCP fallback configured',
    'High-risk models need a configured business-continuity fallback (activate via /monitoring/bcp).',
    isHigh,
  ));

  const overdue = ctx.overdueIncidentCount ?? 0;
  // Incidents tracked and communicated (MANAGE 4.3).
  checks.push(check(
    'MANAGE-4.3',
    'Incident Reporting Hygiene',
    overdue === 0,
    overdue === 0 ? 'No overdue incident reports' : `${overdue} incident(s) past their reporting deadline`,
    'Report incidents within their severity SLA before deadlines lapse.',
  ));

  // MANAGE-2.1 — risk response is resourced: a real team owns this model.
  checks.push(check(
    'MANAGE-2.1',
    'Risk Response Resourcing',
    ownerAssigned(entry),
    ownerAssigned(entry) ? `Risk response owned by ${entry.ownerTeam}` : 'No team resourced to respond to this model’s risks',
    'A named, resourced owner must be accountable for responding to the model’s risks.',
  ));

  // MEASURE-3.1 — identified risks are tracked over time via the append-only ledger.
  const trackingOk = (ctx.ledgerEventCount ?? 0) > 0;
  checks.push(check(
    'MEASURE-3.1',
    'Risk Tracking Mechanisms',
    trackingOk,
    trackingOk ? `${ctx.ledgerEventCount} ledger event(s) tracking this model over time` : 'No risk-tracking history recorded for this model',
    'Identified risks must be tracked over time (an append-only ledger history for the model).',
  ));

  // E0.5 — privacy risk examined and documented (MEASURE 2.10). Reuses the
  // dpia evidence type the EU AI Act Art-27 check already reads.
  if (flags.nistPrivacy) {
    const privacyOk = hasEvidence(entry, 'dpia');
    checks.push(check(
      'MEASURE-2.10',
      'Privacy Risk Examined (DPIA / Privacy Review)',
      privacyOk,
      privacyOk ? 'DPIA / privacy-review artifact attached' : 'No DPIA or privacy-review artifact attached',
      'Measure stage requires the system’s privacy risk to be examined and documented (attach a dpia artifact).',
    ));
  }

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

    // Art-13 — the deployer must be told what the system does and who owns it.
    const infoOk = (entry.useCaseDescription || '').trim().length >= 20 && ownerAssigned(entry);
    checks.push(check(
      'Art-13',
      'Transparency & Information to Deployers',
      infoOk,
      infoOk
        ? `Documented purpose with a named owner (${entry.ownerTeam})`
        : 'Deployer information incomplete: needs a substantive purpose and a named accountable owner',
      'High-risk systems must give deployers clear use instructions and an identified accountable owner.',
    ));

    // Art-25 — the provider along the value chain must be identified.
    const providerOk = Boolean((entry.developedBy || '').trim());
    checks.push(check(
      'Art-25',
      'Provider Responsibilities Along the Value Chain',
      providerOk,
      providerOk ? `Provider recorded: ${entry.developedBy}` : 'No provider / build origin recorded for this system',
      'High-risk systems must identify the provider (internal or third party) responsible along the value chain.',
    ));

    // Art-27 — high-risk deployers must run a fundamental-rights impact assessment.
    const friaOk = hasEvidence(entry, 'dpia');
    checks.push(check(
      'Art-27',
      'Fundamental Rights Impact Assessment',
      friaOk,
      friaOk ? 'Fundamental-rights / data-protection impact assessment attached' : 'No FRIA/DPIA artifact attached',
      'High-risk deployers must complete a fundamental-rights impact assessment (attach a dpia artifact).',
    ));

    // Art-72 — an active post-market monitoring plan, distinct from live accuracy checks.
    const postMarketOk = Boolean(ctx.bcpConfigured) && drift.ok;
    checks.push(check(
      'Art-72',
      'Post-Market Monitoring',
      postMarketOk,
      postMarketOk
        ? 'Active post-market monitoring: business-continuity plan configured with recent drift evaluations'
        : 'Post-market monitoring incomplete: needs a configured continuity plan and recent drift evaluations',
      'High-risk providers must operate a documented post-market monitoring plan (continuity plan + ongoing drift evaluation).',
    ));

    // Art-17 — a quality-management system, evidenced by a planned internal audit cadence.
    const qmsOk = Boolean(entry.nextAuditDue) && entry.nextAuditDue!.getTime() > Date.now();
    checks.push(check(
      'Art-17',
      'Quality Management System',
      qmsOk,
      qmsOk
        ? `Planned internal audit on ${entry.nextAuditDue!.toISOString().slice(0, 10)}`
        : entry.nextAuditDue
          ? 'Quality-management audit is past due'
          : 'No quality-management audit cadence scheduled',
      'High-risk providers must operate a quality-management system with a planned internal audit cadence.',
    ));

    // Art-26 — the deployer keeps an operational deployment record, so operation
    // can be monitored from the moment the system is put into service.
    const deployRecordOk = entry.deploymentDate != null;
    checks.push(check(
      'Art-26',
      'Deployer Operational Record',
      deployRecordOk,
      deployRecordOk
        ? `Put into service on ${entry.deploymentDate!.toISOString().slice(0, 10)}`
        : 'No deployment date recorded — operation cannot be monitored from a known start',
      'Deployers of high-risk systems must record the deployment date so operation is monitored from putting-into-service.',
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

  // AI system impact assessment (6.1.4, performed per 8.4). SentRAI has no
  // impact-assessment record yet, and use-case text is not one, so this is
  // reported NOT ASSESSED rather than passed. Never blocking.
  checks.push({
    ...check(
      'AIMS-8.4',
      'AI System Impact Assessment (6.1.4 / 8.4)',
      false,
      'NOT ASSESSED: SentRAI does not yet record AI system impact assessments; a use-case description is not one',
      'Clauses 6.1.4 and 8.4 require documented AI system impact assessments; keep yours outside SentRAI until the impact-assessment workflow ships.',
      false,
    ),
    notAssessed: true,
  });

  const hasDataGov = Boolean(entry.sourceRef || (entry.dependencies && entry.dependencies.length));
  // Data and component provenance (Annex A.7.5).
  checks.push(check(
    'AIMS-A.7.5',
    'Data & Codebase Provenance',
    hasDataGov,
    hasDataGov ? `Source/data references tracked: ${entry.sourceRef || 'Dependencies list'}` : 'No codebase or data dependencies registered',
    'Annex A.7.5 requires recorded provenance: track the source repository or third-party dependencies.',
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
    'AIMS-10.2',
    'Nonconformity & Corrective Action',
    overdue === 0,
    overdue === 0 ? 'No overdue incident reports' : `${overdue} incident(s) past reporting deadline`,
    'Clause 10.2 requires timely handling of nonconformities: report overdue incidents.',
    false,
  ));

  // AIMS-5.3 — roles, responsibilities and authorities: a named team owns the system.
  checks.push(check(
    'AIMS-5.3',
    'Roles, Responsibilities & Accountability',
    ownerAssigned(entry),
    ownerAssigned(entry) ? `Accountable team assigned: ${entry.ownerTeam}` : 'No accountable team assigned to this AI system',
    'Clause 5.3 requires assigned roles and responsibilities: assign a named owner team.',
  ));

  // AIMS-A.6.2.7 — AI system technical documentation (a model card). Best-practice, not a hard gate.
  const modelCardOk = hasEvidence(entry, 'model_card');
  checks.push(check(
    'AIMS-A.6.2.7',
    'AI System Technical Documentation',
    modelCardOk,
    modelCardOk ? 'Model card / system documentation artifact attached' : 'No model card attached',
    'Annex A.6.2.7 recommends technical documentation for relevant parties (attach a model_card artifact).',
    false,
  ));

  return { frameworkName: 'ISO 42001', modelId: entry.modelId, modelName: entry.name, riskTier: isMedOrHigh ? 'Elevated' : 'Standard', checks };
}
