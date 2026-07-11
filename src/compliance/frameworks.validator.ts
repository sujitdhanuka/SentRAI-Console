/**
 * Regulatory framework validators (NIST AI RMF, EU AI Act, ISO 42001) used by
 * the inventory compliance-check, governance, metrics, and PDF endpoints.
 * Port of src/sentrai/compliance/frameworks_validator.py.
 */
import { ModelType, RiskLevel } from '../common/enums';
import { AIModelEntry } from '../domain/model-inventory';

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

export function validateNistRmf(entry: AIModelEntry): FrameworkComplianceReport {
  const checks: FrameworkCheck[] = [];

  const ownerStr = entry.ownerTeam || '';
  const hasOwner = Boolean(ownerStr) && !ownerStr.toLowerCase().includes('unassigned');
  checks.push(
    check(
      'GOVERN-1.1',
      'Organizational Ownership & Responsibility',
      hasOwner,
      hasOwner ? `Owner team: ${entry.ownerTeam}` : 'No owner team assigned',
      'Organizational governance requires a designated owner team.',
    ),
  );

  const hasPolicy = Boolean(entry.boardPolicyRef && entry.boardPolicyRef.trim());
  checks.push(
    check(
      'MAP-1.1',
      'Board Policy Alignment',
      hasPolicy,
      hasPolicy ? `Board policy reference: ${entry.boardPolicyRef}` : 'No board policy reference provided',
      'Model context must align with a board-approved AI policy reference.',
    ),
  );

  let hasRedTeam = false;
  let evidenceRt = 'No red teaming date recorded';
  if (entry.lastRedTeamDate) {
    const d = daysSince(entry.lastRedTeamDate);
    if (d < 365) {
      hasRedTeam = true;
      evidenceRt = `Last red teamed ${d} days ago (${entry.lastRedTeamDate.toISOString().slice(0, 10)})`;
    } else {
      evidenceRt = `Red teaming stale: last performed ${d} days ago`;
    }
  }
  checks.push(
    check(
      'MEASURE-2.1',
      'Security Red Teaming & Bias Auditing',
      hasRedTeam,
      evidenceRt,
      'Measure stage requires a bias audit / red teaming review within the last 12 months.',
    ),
  );

  const hasOversight = !(entry.riskLevel === RiskLevel.HIGH && !entry.humanOversightRequired);
  checks.push(
    check(
      'MANAGE-1.1',
      'Human Oversight Controls',
      hasOversight,
      entry.humanOversightRequired
        ? 'High risk model has human-in-the-loop oversight enabled'
        : 'No oversight controls required (Low/Medium risk)',
      'High-risk decisions require a human-in-the-loop oversight control.',
    ),
  );

  return { frameworkName: 'NIST AI RMF', modelId: entry.modelId, modelName: entry.name, riskTier: 'Minimal', checks };
}

export function validateEuAiAct(entry: AIModelEntry): FrameworkComplianceReport {
  const checks: FrameworkCheck[] = [];
  const fa = (entry.functionalArea || '').toLowerCase();
  const isHighRiskDomain = ['credit_underwriting', 'loan_decisioning', 'fund_movement'].includes(fa);

  let riskTier: string;
  if (isHighRiskDomain) riskTier = 'High Risk';
  else if (entry.modelType === ModelType.GENERATIVE_AI || fa.includes('chatbot')) riskTier = 'Limited Risk';
  else riskTier = 'Minimal Risk';

  if (riskTier === 'High Risk') {
    const hasSource = Boolean(entry.sourceRef);
    checks.push(
      check(
        'Art-12',
        'Traceability & Technical Documentation',
        hasSource,
        hasSource ? `Source codebase ref: ${entry.sourceRef}` : 'Missing repository codebase reference',
        'High-risk AI systems must have complete source file traceability.',
      ),
    );
    checks.push(
      check(
        'Art-14',
        'Human Oversight Gate',
        entry.humanOversightRequired,
        entry.humanOversightRequired ? 'Human-in-the-loop is active' : 'Oversight deactivated',
        'High-risk systems require explicit human-in-the-loop oversight gates.',
      ),
    );
  } else if (riskTier === 'Limited Risk') {
    const descStr = entry.useCaseDescription || '';
    const hasDesc = descStr.length > 10;
    checks.push(
      check(
        'Art-52',
        'Transparency & Disclosure',
        hasDesc,
        hasDesc ? `Use case transparency text: ${descStr.slice(0, 100)}...` : 'No transparency statement',
        'Limited risk systems must provide clear use case descriptions for user transparency.',
      ),
    );
  } else {
    checks.push(check('Art-Minimal', 'General Compliance Guidelines', true, 'Minimal risk model. Complies by default.', ''));
  }

  return { frameworkName: 'EU AI Act', modelId: entry.modelId, modelName: entry.name, riskTier, checks };
}

export function validateIso42001(entry: AIModelEntry): FrameworkComplianceReport {
  const checks: FrameworkCheck[] = [];

  const hasRisk = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH].includes(entry.riskLevel);
  checks.push(
    check(
      'AIMS-6.1.2',
      'AI System Risk Assessment',
      hasRisk,
      hasRisk ? `System evaluated risk tier: ${entry.riskLevel}` : 'Risk level unclassified',
      'ISO 42001 requires systematic risk classification for each AI system.',
    ),
  );

  const useCase = entry.useCaseDescription || '';
  const hasImpact = Boolean(useCase && useCase.length > 10);
  checks.push(
    check(
      'AIMS-8.2',
      'AI System Impact Assessment',
      hasImpact,
      hasImpact ? `Impact assessment description provided (${useCase.length} chars)` : 'No impact description recorded',
      'Clause 8.2 requires documented AI system impact assessments.',
    ),
  );

  const hasDataGov = Boolean(entry.sourceRef || (entry.dependencies && entry.dependencies.length));
  checks.push(
    check(
      'AIMS-8.3',
      'Data & Codebase Governance',
      hasDataGov,
      hasDataGov ? `Source/data references tracked: ${entry.sourceRef || 'Dependencies list'}` : 'No codebase or data dependencies registered',
      'AIMS Data Governance requires tracking source repository or third-party dependencies.',
    ),
  );

  return { frameworkName: 'ISO 42001', modelId: entry.modelId, modelName: entry.name, riskTier: 'Minimal', checks };
}
