/**
 * 7 Sutras compliance validator — validates a model against all 7 SentrAI
 * foundational principles. Port of src/sentrai/compliance/sutras_validator.py.
 */
import { RiskLevel, SutraAlignment } from '../common/enums';
import { AIModelEntry } from '../domain/model-inventory';

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

export function validateSutrasCompliance(entry: AIModelEntry): SutrasComplianceReport {
  const checks: SutraCheck[] = [];
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

  // Sutra 4: Fairness and Equity — sutras alignment declared
  const fairnessOk = entry.sutrasAlignment.includes(SutraAlignment.FAIRNESS);
  checks.push({
    sutra: SutraAlignment.FAIRNESS,
    passed: fairnessOk,
    evidence: fairnessOk ? 'Fairness sutra declared in model registration' : '',
    gap: fairnessOk ? '' : 'Fairness & Equity sutra not declared. Bias testing must be documented.',
    mandatory: isMedOrHigh,
  });

  // Sutra 5: Accountability — owner team documented
  const accountabilityOk = entry.ownerTeam !== '' && !entry.ownerTeam.toLowerCase().includes('unassigned');
  checks.push({
    sutra: SutraAlignment.ACCOUNTABILITY,
    passed: accountabilityOk,
    evidence: accountabilityOk ? `Owner team: ${entry.ownerTeam}` : '',
    gap: accountabilityOk ? '' : 'No accountability chain (owner team) defined.',
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
      : 'No explainability mechanism declared for MEDIUM/HIGH risk model. REC 24 audit will fail.',
    mandatory: isMedOrHigh,
  });

  // Sutra 7: Safety, Resilience, Sustainability — red-team for HIGH
  const safetyOk = entry.riskLevel === RiskLevel.HIGH ? entry.lastRedTeamDate !== null : true;
  checks.push({
    sutra: SutraAlignment.SAFETY,
    passed: safetyOk,
    evidence: safetyOk ? `Last red-team: ${entry.lastRedTeamDate}` : '',
    gap: safetyOk
      ? ''
      : 'HIGH risk model with no red-team exercise on record. REC 20 mandates semi-annual red-teaming.',
    mandatory: true,
  });

  return { modelId: entry.modelId, modelName: entry.name, checks };
}
