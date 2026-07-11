import { ModelLifecycleStage, ModelType, RiskLevel } from '../common/enums';
import { AIModelEntry } from '../domain/model-inventory';
import { triageAiModel } from '../domain/model-inventory';
import {
  frameworkBlockingGaps,
  frameworkOverallPass,
  validateEuAiAct,
  validateIso42001,
  validateNistRmf,
} from './frameworks.validator';

function entry(overrides: Partial<AIModelEntry> = {}): AIModelEntry {
  const now = new Date();
  return {
    modelId: 'test-id',
    name: 'Test Model',
    modelType: ModelType.GENERATIVE_AI,
    functionalArea: 'credit_underwriting',
    useCaseDescription: 'Uses LLM for credit underwriting.',
    targetCustomerSegments: ['retail'],
    riskLevel: RiskLevel.HIGH,
    lifecycleStage: ModelLifecycleStage.DESIGN,
    ownerTeam: 'unassigned',
    developedBy: 'internal',
    deploymentDate: null,
    dependencies: [],
    performanceBenchmarks: [],
    sutrasAlignment: [],
    humanOversightRequired: false,
    autonomousScope: null,
    boardPolicyRef: '',
    lastRedTeamDate: null,
    nextAuditDue: null,
    grievanceCount: 0,
    grievanceResolutionNotes: '',
    sourceRef: null,
    registeredAt: now,
    updatedAt: now,
    isActive: true,
    projectId: null,
    ...overrides,
  };
}

describe('framework validators (parity with test_frameworks.py)', () => {
  it('NIST RMF fails with 4 blocking gaps when unassigned', () => {
    const report = validateNistRmf(entry());
    expect(frameworkOverallPass(report)).toBe(false);
    expect(frameworkBlockingGaps(report).length).toBe(4);
  });

  it('EU AI Act classifies credit_underwriting as High Risk and fails on missing oversight', () => {
    const report = validateEuAiAct(entry({ ownerTeam: 'Risk Team', boardPolicyRef: 'POLICY-1', sourceRef: 'models/credit.py' }));
    expect(report.riskTier).toBe('High Risk');
    expect(frameworkOverallPass(report)).toBe(false);
    const gaps = frameworkBlockingGaps(report);
    expect(gaps.length).toBe(1);
    expect(gaps[0].toLowerCase()).toContain('human-in-the-loop');
  });

  it('ISO 42001 passes with 3 checks for a documented model', () => {
    const report = validateIso42001(entry({ ownerTeam: 'Risk Team', boardPolicyRef: 'POLICY-1', sourceRef: 'models/credit.py' }));
    expect(frameworkOverallPass(report)).toBe(true);
    expect(report.checks.length).toBe(3);
  });
});

describe('risk triage', () => {
  it('escalates GenAI credit model without oversight to HIGH', () => {
    expect(triageAiModel(entry())).toBe(RiskLevel.HIGH);
  });

  it('classifies an internal tool as LOW', () => {
    expect(triageAiModel(entry({ functionalArea: 'internal_tooling', modelType: ModelType.RULES_BASED, humanOversightRequired: true }))).toBe(
      RiskLevel.LOW,
    );
  });

  it('classifies fraud_detection as MEDIUM', () => {
    expect(triageAiModel(entry({ functionalArea: 'fraud_detection', humanOversightRequired: true }))).toBe(RiskLevel.MEDIUM);
  });
});
