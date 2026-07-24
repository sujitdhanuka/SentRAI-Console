import { ModelLifecycleStage, ModelType, RiskLevel } from '../common/enums';
import { AIModelEntry } from '../domain/model-inventory';
import { triageAiModel } from '../domain/model-inventory';
import {
  frameworkBlockingGaps,
  frameworkOverallPass,
  ValidationContext,
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
    evidenceArtifacts: [],
    ...overrides,
  };
}

/** Full operational evidence, as gathered for a well-monitored model. */
function healthyContext(): ValidationContext {
  return {
    ledgerEventCount: 5,
    driftReportCount: 3,
    lastDriftAt: new Date(),
    overdueIncidentCount: 0,
    bcpConfigured: true,
  };
}

describe('framework validators', () => {
  it('NIST RMF fails an ungoverned, unmonitored HIGH-risk model on 9 mandatory controls', () => {
    const report = validateNistRmf(entry());
    expect(frameworkOverallPass(report)).toBe(false);
    // 7 original + MANAGE-2.1 (no resourced owner) + MEASURE-3.1 (no ledger history)
    expect(frameworkBlockingGaps(report).length).toBe(9);
  });

  it('NIST RMF MANAGE-2.1 rejects the "unassigned" placeholder owner but accepts a real team', () => {
    const gapsUnassigned = frameworkBlockingGaps(validateNistRmf(entry(), healthyContext()));
    expect(gapsUnassigned.join(' ').toLowerCase()).toContain('resourced');
    const gapsOwned = frameworkBlockingGaps(validateNistRmf(entry({ ownerTeam: 'Risk Team' }), healthyContext()));
    expect(gapsOwned.join(' ').toLowerCase()).not.toContain('resourced');
  });

  it('NIST RMF passes a governed model with operational evidence', () => {
    const report = validateNistRmf(
      entry({
        ownerTeam: 'Risk Team',
        boardPolicyRef: 'POLICY-1',
        nextAuditDue: new Date(Date.now() + 30 * 86_400_000),
        lastRedTeamDate: new Date(Date.now() - 30 * 86_400_000),
        humanOversightRequired: true,
      }),
      healthyContext(),
    );
    expect(frameworkOverallPass(report)).toBe(true);
  });

  it('EU AI Act classifies credit_underwriting as High Risk and reports operational gaps', () => {
    const report = validateEuAiAct(
      entry({ ownerTeam: 'Risk Team', boardPolicyRef: 'POLICY-1', sourceRef: 'models/credit.py' }),
    );
    expect(report.riskTier).toBe('High Risk');
    expect(frameworkOverallPass(report)).toBe(false);
    const gaps = frameworkBlockingGaps(report);
    // Art-10 data governance, Art-12 record-keeping, Art-14 oversight, Art-15 robustness,
    // Art-17 no QMS audit cadence, Art-26 no deployment record, Art-27 no FRIA/DPIA,
    // Art-72 no post-market monitoring
    expect(gaps.length).toBe(8);
    expect(gaps.join(' ').toLowerCase()).toContain('human-in-the-loop');
  });

  it('EU AI Act Art-27 blocks a high-risk model with no FRIA/DPIA, and clears once one is attached', () => {
    const base = {
      ownerTeam: 'Risk Team',
      boardPolicyRef: 'POLICY-1',
      sourceRef: 'models/credit.py',
      humanOversightRequired: true,
      evidenceArtifacts: [{ type: 'bias_test', ref: 'https://reports/bias-q2.pdf', added_at: new Date().toISOString() }],
    };
    const withoutFria = frameworkBlockingGaps(validateEuAiAct(entry(base), healthyContext()));
    expect(withoutFria.join(' ').toLowerCase()).toContain('fundamental-rights');
    const withFria = frameworkBlockingGaps(
      validateEuAiAct(entry({ ...base, evidenceArtifacts: [...base.evidenceArtifacts, { type: 'dpia', ref: 'https://reports/fria.pdf', added_at: new Date().toISOString() }] }), healthyContext()),
    );
    expect(withFria.join(' ').toLowerCase()).not.toContain('fundamental-rights');
  });

  it('EU AI Act passes a fully-governed high-risk model (bias + FRIA, oversight, QMS, deployment record, live records)', () => {
    const report = validateEuAiAct(
      entry({
        ownerTeam: 'Risk Team',
        boardPolicyRef: 'POLICY-1',
        sourceRef: 'models/credit.py',
        humanOversightRequired: true,
        nextAuditDue: new Date(Date.now() + 30 * 86_400_000),
        deploymentDate: new Date(Date.now() - 60 * 86_400_000),
        evidenceArtifacts: [
          { type: 'bias_test', ref: 'https://reports/bias-q2.pdf', added_at: new Date().toISOString() },
          { type: 'dpia', ref: 'https://reports/fria.pdf', added_at: new Date().toISOString() },
        ],
      }),
      healthyContext(),
    );
    expect(report.riskTier).toBe('High Risk');
    expect(frameworkOverallPass(report)).toBe(true);
  });

  it('EU AI Act uses a configurable high-risk domain list', () => {
    const report = validateEuAiAct(entry({ functionalArea: 'internal_tooling', modelType: ModelType.RULES_BASED }), {
      euHighRiskDomains: ['internal_tooling'],
    });
    expect(report.riskTier).toBe('High Risk');
  });

  it('ISO 42001 requires active monitoring for MEDIUM/HIGH models', () => {
    const documented = entry({ ownerTeam: 'Risk Team', boardPolicyRef: 'POLICY-1', sourceRef: 'models/credit.py' });
    const withoutMonitoring = validateIso42001(documented);
    expect(withoutMonitoring.checks.length).toBe(8);
    expect(frameworkOverallPass(withoutMonitoring)).toBe(false); // AIMS-9.1 blocks

    const withMonitoring = validateIso42001(documented, healthyContext());
    expect(frameworkOverallPass(withMonitoring)).toBe(true);
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
