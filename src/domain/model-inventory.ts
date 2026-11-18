/**
 * Module A domain — AI Model Inventory entry + rule-based risk triage.
 * Port of src/sentrai/domain/model_inventory.py.
 */
import { ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment } from '../common/enums';

/** Canonical in-memory representation of a registered AI model, used by the
 * triage engine and all compliance validators. Mirrors AIModelEntry. */
export interface AIModelEntry {
  modelId: string;
  name: string;
  modelType: ModelType;
  functionalArea: string;
  useCaseDescription: string;
  targetCustomerSegments: string[];
  riskLevel: RiskLevel;
  lifecycleStage: ModelLifecycleStage;
  ownerTeam: string;
  developedBy: string;
  deploymentDate: Date | null;
  dependencies: any[];
  performanceBenchmarks: any[];
  sutrasAlignment: SutraAlignment[];
  humanOversightRequired: boolean;
  autonomousScope: string | null;
  boardPolicyRef: string;
  lastRedTeamDate: Date | null;
  nextAuditDue: Date | null;
  grievanceCount: number;
  grievanceResolutionNotes: string;
  sourceRef: string | null;
  registeredAt: Date;
  updatedAt: Date;
  isActive: boolean;
  projectId: string | null;
  /** Attached evidence artifacts (bias-test reports, red-team reports, ...). */
  evidenceArtifacts?: EvidenceArtifact[];
}

export interface EvidenceArtifact {
  type: string; // e.g. 'bias_test' | 'red_team' | 'model_card' | 'dpia' | 'behavioral_eval'
  ref: string; // URL or document reference
  description?: string;
  added_at: string;
  /** Parsed structured summary — e.g. behavioral-eval pass rate + failed checks. */
  data?: Record<string, any>;
}

/** True when the entry carries an attached evidence artifact of the given type. */
export function hasEvidence(entry: AIModelEntry, type: string): boolean {
  return (entry.evidenceArtifacts ?? []).some((a) => a.type === type);
}

const HIGH_USE_CASES = new Set([
  'credit_underwriting',
  'loan_decisioning',
  'autonomous_trading',
  'fund_movement',
  'insurance_decisioning',
  'autonomous_kyc_rejection',
]);

const MEDIUM_USE_CASES = new Set([
  'fraud_detection',
  'customer_chatbot',
  'risk_scoring',
  'recommendation_engine',
  'claims_processing',
]);

/**
 * Rule-based risk triage (REC 14/16). Escalates when governance signals are
 * present. Faithful port of triage_ai_model().
 */
export function triageAiModel(entry: AIModelEntry): RiskLevel {
  const fa = entry.functionalArea.toLowerCase();
  let baseRisk: RiskLevel = HIGH_USE_CASES.has(fa)
    ? RiskLevel.HIGH
    : MEDIUM_USE_CASES.has(fa)
      ? RiskLevel.MEDIUM
      : RiskLevel.LOW;

  // Escalate: autonomous + no human oversight
  if (entry.autonomousScope && !entry.humanOversightRequired) {
    if (baseRisk === RiskLevel.LOW) baseRisk = RiskLevel.MEDIUM;
    else if (baseRisk === RiskLevel.MEDIUM) baseRisk = RiskLevel.HIGH;
  }

  // Escalate: GenAI in customer-facing medium-risk with oversight explicitly off
  if (
    entry.modelType === ModelType.GENERATIVE_AI &&
    baseRisk === RiskLevel.MEDIUM &&
    entry.humanOversightRequired === false
  ) {
    baseRisk = RiskLevel.HIGH;
  }

  return baseRisk;
}

const RISK_SEVERITY: Record<string, number> = {
  [RiskLevel.MINIMAL]: 0,
  [RiskLevel.LOW]: 0,
  [RiskLevel.LIMITED]: 1,
  [RiskLevel.MEDIUM]: 1,
  [RiskLevel.HIGH]: 2,
  [RiskLevel.CRITICAL]: 3,
  [RiskLevel.PROHIBITED]: 4,
};

/**
 * A hardcoded secret / credential in source is a material security finding, not
 * a stylistic one. A model that still carries unremediated secrets must never be
 * triaged below HIGH, regardless of its functional-area risk. Idempotent: once
 * the secrets are removed from the code and the model is re-scanned/re-imported,
 * `secretCount` is 0 and the normal triage risk applies again.
 */
export function floorRiskForSecurityFindings(risk: RiskLevel, secretCount: number): RiskLevel {
  if (secretCount > 0 && (RISK_SEVERITY[risk] ?? 0) < RISK_SEVERITY[RiskLevel.HIGH]) {
    return RiskLevel.HIGH;
  }
  return risk;
}

/**
 * The human-readable reasons behind a model's triaged risk level — mirrors the
 * exact rules in triageAiModel() + the security floor, so an AI-drafted (or
 * heuristic) risk rationale is grounded in what the engine actually did rather
 * than what an LLM guesses it did.
 */
export function explainTriageFactors(entry: AIModelEntry, secretCount = 0): string[] {
  const fa = entry.functionalArea.toLowerCase();
  const factors: string[] = [];
  if (HIGH_USE_CASES.has(fa)) {
    factors.push(`functional area '${entry.functionalArea}' is a high-risk use case (credit/fraud/trading class)`);
  } else if (MEDIUM_USE_CASES.has(fa)) {
    factors.push(`functional area '${entry.functionalArea}' is a medium-risk use case`);
  } else {
    factors.push(`functional area '${entry.functionalArea}' carries no elevated base risk`);
  }
  if (entry.autonomousScope && !entry.humanOversightRequired) {
    factors.push(`declared autonomous scope ('${entry.autonomousScope}') with human oversight disabled escalates risk one level`);
  }
  if (entry.modelType === ModelType.GENERATIVE_AI && entry.humanOversightRequired === false) {
    factors.push('generative-AI output without human oversight escalates customer-facing risk');
  }
  if (entry.humanOversightRequired) {
    factors.push('human-in-the-loop review is required before outputs are acted on');
  }
  if (secretCount > 0) {
    factors.push(`${secretCount} unremediated hardcoded secret(s) in source floor the risk at HIGH until removed`);
  }
  return factors;
}

/* ------------------------- Red-team interval (E0.3) ------------------------ */

/**
 * One red-team interval per risk tier, used by the NIST check, the Sutra 7
 * check and the workflow guide (RBI Rec 20: frequency proportionate to risk).
 * Applied only when the GOV_E0_3_REDTEAM_INTERVALS flag is on; becomes a
 * governance setting in E1.2.
 */
export const RED_TEAM_INTERVAL_DAYS = { HIGH: 90, MEDIUM: 180, LOW: 365 } as const;

/** Interval used while the flag is off: the NIST check's original 12-month rule. */
export const LEGACY_RED_TEAM_INTERVAL_DAYS = 365;

/** HIGH, CRITICAL and PROHIBITED: the tiers the HIGH-risk governance rules apply to. */
export function isHighOrAbove(risk: RiskLevel): boolean {
  return (RISK_SEVERITY[risk] ?? 0) >= RISK_SEVERITY[RiskLevel.HIGH];
}

/** The interval band a risk level falls in (LIMITED counts as MEDIUM, MINIMAL as LOW). */
export function intervalBand(risk: RiskLevel): 'HIGH' | 'MEDIUM' | 'LOW' {
  const sev = RISK_SEVERITY[risk] ?? 0;
  if (sev >= RISK_SEVERITY[RiskLevel.HIGH]) return 'HIGH';
  if (sev >= RISK_SEVERITY[RiskLevel.MEDIUM]) return 'MEDIUM';
  return 'LOW';
}

export function redTeamIntervalDays(risk: RiskLevel): number {
  const sev = RISK_SEVERITY[risk] ?? 0;
  if (sev >= RISK_SEVERITY[RiskLevel.HIGH]) return RED_TEAM_INTERVAL_DAYS.HIGH;
  if (sev >= RISK_SEVERITY[RiskLevel.MEDIUM]) return RED_TEAM_INTERVAL_DAYS.MEDIUM;
  return RED_TEAM_INTERVAL_DAYS.LOW;
}

/** Most recent red-team evidence: the newer of the recorded date and the newest attached red_team report. */
export function lastRedTeamEvidenceAt(entry: AIModelEntry): Date | null {
  const stamps = (entry.evidenceArtifacts ?? [])
    .filter((a) => a.type === 'red_team' && a.added_at)
    .map((a) => new Date(a.added_at).getTime())
    .filter((t) => !Number.isNaN(t));
  if (entry.lastRedTeamDate) stamps.push(entry.lastRedTeamDate.getTime());
  return stamps.length ? new Date(Math.max(...stamps)) : null;
}

/** Whole days between `date` and `now` (floored), the convention every check uses. */
export function daysBetween(date: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

/** Per-tier red-team recency: ok when the newest evidence is no older than the tier's interval. */
export function redTeamWithinInterval(
  entry: AIModelEntry,
  now: Date = new Date(),
): { ok: boolean; ageDays: number | null; intervalDays: number } {
  const intervalDays = redTeamIntervalDays(entry.riskLevel);
  const at = lastRedTeamEvidenceAt(entry);
  if (!at) return { ok: false, ageDays: null, intervalDays };
  const ageDays = daysBetween(at, now);
  return { ok: ageDays <= intervalDays, ageDays, intervalDays };
}
