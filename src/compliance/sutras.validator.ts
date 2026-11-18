/**
 * 7 Sutras compliance validator — validates a model against all 7 SentrAI
 * foundational principles. Port of src/sentrai/compliance/sutras_validator.py.
 */
import { RiskLevel, SutraAlignment } from '../common/enums';
import { FeatureFlags, getFeatureFlags } from '../common/feature-flags';
import { AIModelEntry, hasEvidence, redTeamWithinInterval } from '../domain/model-inventory';
import { bcpDrillIntervalDays, bcpDrillStatus } from '../domain/monitoring';

/** Operational evidence the Sutra checks can use when the caller has it. */
export interface SutrasContext {
  /** Date of the model's last recorded BCP drill (E0.4). */
  bcpDrillLastConducted?: Date | null;
  /** Governance feature flags; read from the environment when omitted. */
  flags?: FeatureFlags;
}

export interface SutraCheck {
  sutra: SutraAlignment;
  passed: boolean;
  evidence: string;
  gap: string;
  mandatory: boolean;
}

export interface SutrasComplianceReport {
  modelId: string;
  modelName: string;
  checks: SutraCheck[];
}

export function sutrasOverallPass(report: SutrasComplianceReport): boolean {
  return report.checks.filter((c) => c.mandatory && !c.passed).length === 0;
}

export function sutrasBlockingGaps(report: SutrasComplianceReport): string[] {
  return report.checks.filter((c) => c.mandatory && !c.passed && c.gap).map((c) => c.gap);
}

export function sutrasReportAsDict(report: SutrasComplianceReport): Record<string, any> {
  return {
    model_id: String(report.modelId),
    model_name: report.modelName,
    overall_pass: sutrasOverallPass(report),
    blocking_gaps: sutrasBlockingGaps(report),
    checks: report.checks.map((c) => ({
      sutra: c.sutra,
      passed: c.passed,
      evidence: c.evidence,
      gap: c.gap,
      mandatory: c.mandatory,
    })),
  };
}

export function validateSutrasCompliance(entry: AIModelEntry, ctx: SutrasContext = {}): SutrasComplianceReport {
  const checks: SutraCheck[] = [];
  const flags = ctx.flags ?? getFeatureFlags();
  const isMedOrHigh = entry.riskLevel === RiskLevel.MEDIUM || entry.riskLevel === RiskLevel.HIGH;

  // Sutra 1: Trust is the Foundation
  const trustOk = entry.boardPolicyRef !== '';
  checks.push({
    sutra: SutraAlignment.TRUST,
    passed: trustOk,
    evidence: trustOk ? `Board policy ref: ${entry.boardPolicyRef}` : '',
    gap: trustOk
      ? ''
      : 'No board-approved AI policy reference. REC 14 mandates a board-approved AI policy.',
    mandatory: true,
  });

  // Sutra 2: People First — human oversight for MEDIUM/HIGH risk
  const peopleOk = entry.humanOversightRequired || entry.riskLevel === RiskLevel.LOW;
  checks.push({
    sutra: SutraAlignment.PEOPLE_FIRST,
    passed: peopleOk,
    evidence: peopleOk ? 'Human oversight configured' : '',
    gap: peopleOk
      ? ''
      : 'MEDIUM/HIGH risk model without human oversight. REC 16 requires human-in-the-loop.',
    mandatory: true,
  });

  // Sutra 3: Innovation over Restraint — autonomous scope defined if used
  const innovationOk =
    entry.humanOversightRequired === false ? entry.autonomousScope !== null && entry.autonomousScope !== undefined : true;
  checks.push({
    sutra: SutraAlignment.INNOVATION,
    passed: innovationOk,
    evidence: innovationOk ? 'Autonomous scope defined' : '',
    gap: innovationOk
      ? ''
      : 'Autonomous model without defined scope boundary. REC 16 requires clear autonomous action limits.',
    mandatory: true,
  });

  // Sutra 4: Fairness and Equity — evidence over attestation. MEDIUM/HIGH risk
  // needs an attached bias-test artifact; a self-declared flag only suffices
  // for LOW risk models.
  const fairnessEvidence = hasEvidence(entry, 'bias_test');
  const fairnessDeclared = entry.sutrasAlignment.includes(SutraAlignment.FAIRNESS);
  const fairnessOk = isMedOrHigh ? fairnessEvidence : fairnessEvidence || fairnessDeclared;
  checks.push({
    sutra: SutraAlignment.FAIRNESS,
    passed: fairnessOk,
    evidence: fairnessOk
      ? fairnessEvidence
        ? 'Bias-test report attached as evidence artifact'
        : 'Fairness sutra declared in model registration'
      : '',
    gap: fairnessOk
      ? ''
      : isMedOrHigh
        ? 'No bias-test evidence attached. MEDIUM/HIGH risk requires a documented bias-test artifact, not a declaration.'
        : 'Fairness & Equity sutra not declared. Bias testing must be documented.',
    mandatory: isMedOrHigh,
  });

  // Sutra 5: Accountability — owner team documented
  const accountabilityOk = entry.ownerTeam !== '' && !entry.ownerTeam.toLowerCase().includes('unassigned');
  checks.push({
    sutra: SutraAlignment.ACCOUNTABILITY,
    passed: accountabilityOk,
    evidence: accountabilityOk ? `Owner team: ${entry.ownerTeam}` : '',
    gap: accountabilityOk ? '' : 'No accountability chain (owner team) defined. REC 14 requires the AI policy to set out accountability.',
    mandatory: true,
  });

  // Sutra 6: Understandable by Design — explainability for MEDIUM/HIGH
  const explainabilityOk =
    entry.sutrasAlignment.includes(SutraAlignment.EXPLAINABILITY) || entry.riskLevel === RiskLevel.LOW;
  checks.push({
    sutra: SutraAlignment.EXPLAINABILITY,
    passed: explainabilityOk,
    evidence: explainabilityOk ? 'Explainability declared' : '',
    gap: explainabilityOk
      ? ''
      : 'No explainability mechanism declared for MEDIUM/HIGH risk model (Sutra 6: Understandable by Design).',
    mandatory: isMedOrHigh,
  });

  // Sutra 7: Safety, Resilience, Sustainability — red-team for HIGH (a date
  // on record or an attached red-team report both count as evidence).
  const isHigh = entry.riskLevel === RiskLevel.HIGH;
  const redTeamGap = 'HIGH risk model with no red-team exercise on record. REC 20 asks for red teaming at a frequency proportionate to risk, and after material changes.';
  let safetyOk = isHigh ? entry.lastRedTeamDate !== null || hasEvidence(entry, 'red_team') : true;
  let safetyEvidence = safetyOk
    ? entry.lastRedTeamDate
      ? `Last red-team: ${entry.lastRedTeamDate}`
      : 'Red-team report attached as evidence artifact'
    : '';
  const gaps: string[] = safetyOk ? [] : [redTeamGap];

  // E0.3: the red-team record must also be within the HIGH tier's interval.
  if (isHigh && flags.redTeamIntervals && safetyOk) {
    const rt = redTeamWithinInterval(entry);
    if (!rt.ok) {
      safetyOk = false;
      gaps.push(`HIGH risk model last red teamed ${rt.ageDays ?? 'an unknown number of'} days ago; REC 20 interval for HIGH risk is ${rt.intervalDays} days.`);
    }
  }

  // E0.4: HIGH risk models need a BCP drill within the interval (REC 21).
  if (isHigh && flags.bcpDrills) {
    const drill = bcpDrillStatus(ctx.bcpDrillLastConducted ?? null);
    if (drill.status === 'NONE' || drill.status === 'OVERDUE') {
      safetyOk = false;
      gaps.push(
        drill.status === 'NONE'
          ? 'HIGH risk model with no BCP drill on record. REC 21 requires business-continuity plans for AI systems to be tested.'
          : `HIGH risk model's last BCP drill was ${drill.ageDays} days ago; the drill interval is ${bcpDrillIntervalDays()} days (REC 21).`,
      );
    } else if (safetyEvidence) {
      safetyEvidence += `; last BCP drill ${drill.ageDays} day(s) ago`;
    }
  }

  checks.push({
    sutra: SutraAlignment.SAFETY,
    passed: safetyOk,
    evidence: safetyOk ? safetyEvidence : '',
    gap: gaps.join(' '),
    mandatory: true,
  });

  return { modelId: entry.modelId, modelName: entry.name, checks };
}
