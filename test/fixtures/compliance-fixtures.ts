/**
 * Representative model fixtures for the golden compliance baseline (E0.1).
 *
 * Dates are relative to "now" (days ago / days ahead) so the pass/fail outcome
 * of every check is stable whenever the suite runs. Each fixture pairs a model
 * entry with the operational context the inventory service would gather.
 */
import { ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment } from '../../src/common/enums';
import { AIModelEntry } from '../../src/domain/model-inventory';
import { ValidationContext } from '../../src/compliance/frameworks.validator';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);

function base(overrides: Partial<AIModelEntry>): AIModelEntry {
  const now = new Date();
  return {
    modelId: 'fixture',
    name: 'Fixture',
    modelType: ModelType.MACHINE_LEARNING,
    functionalArea: 'general_purpose',
    useCaseDescription: '',
    targetCustomerSegments: [],
    riskLevel: RiskLevel.LOW,
    lifecycleStage: ModelLifecycleStage.DESIGN,
    ownerTeam: '',
    developedBy: '',
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

const healthy: ValidationContext = {
  ledgerEventCount: 12,
  driftReportCount: 4,
  lastDriftAt: daysAgo(3),
  overdueIncidentCount: 0,
  bcpConfigured: true,
};

const governedHigh = {
  modelType: ModelType.MACHINE_LEARNING,
  functionalArea: 'credit_underwriting',
  useCaseDescription: 'Scores SME credit applications and recommends approve / refer / decline.',
  targetCustomerSegments: ['sme'],
  riskLevel: RiskLevel.HIGH,
  lifecycleStage: ModelLifecycleStage.DEPLOYED,
  ownerTeam: 'Credit Risk Engineering',
  developedBy: 'internal',
  deploymentDate: daysAgo(200),
  dependencies: ['xgboost'],
  performanceBenchmarks: [{ metric: 'auc', value: 0.81 }],
  sutrasAlignment: [SutraAlignment.FAIRNESS, SutraAlignment.EXPLAINABILITY],
  humanOversightRequired: true,
  boardPolicyRef: 'AI-POLICY-2026-001',
  lastRedTeamDate: daysAgo(40),
  nextAuditDue: daysAhead(90),
  sourceRef: 'git@example.com:bank/credit.git',
  evidenceArtifacts: [
    { type: 'bias_test', ref: 'doc://bias', added_at: daysAgo(30).toISOString() },
    { type: 'model_card', ref: 'doc://card', added_at: daysAgo(30).toISOString() },
    { type: 'dpia', ref: 'doc://dpia', added_at: daysAgo(30).toISOString() },
  ],
} as Partial<AIModelEntry>;

export interface ComplianceFixture {
  id: string;
  entry: AIModelEntry;
  ctx: ValidationContext;
}

export const COMPLIANCE_FIXTURES: ComplianceFixture[] = [
  { id: 'high-governed', entry: base({ ...governedHigh, modelId: 'high-governed', name: 'Governed credit scorer' }), ctx: healthy },
  {
    id: 'high-ungoverned',
    entry: base({
      modelId: 'high-ungoverned', name: 'Ungoverned GenAI underwriter', modelType: ModelType.GENERATIVE_AI,
      functionalArea: 'credit_underwriting', useCaseDescription: 'LLM', riskLevel: RiskLevel.HIGH, ownerTeam: 'unassigned',
    }),
    ctx: {},
  },
  {
    id: 'high-redteam-200d',
    entry: base({ ...governedHigh, modelId: 'high-redteam-200d', name: 'Red team 200 days old', lastRedTeamDate: daysAgo(200) }),
    ctx: healthy,
  },
  {
    id: 'high-redteam-400d',
    entry: base({ ...governedHigh, modelId: 'high-redteam-400d', name: 'Red team 400 days old', lastRedTeamDate: daysAgo(400) }),
    ctx: { ...healthy, bcpConfigured: false, overdueIncidentCount: 2 },
  },
  {
    id: 'high-report-only',
    entry: base({
      ...governedHigh, modelId: 'high-report-only', name: 'Red-team report, no date', lastRedTeamDate: null,
      evidenceArtifacts: [...(governedHigh.evidenceArtifacts ?? []), { type: 'red_team', ref: 'doc://rt', added_at: daysAgo(10).toISOString() }],
    }),
    ctx: { ...healthy, lastDriftAt: daysAgo(45) },
  },
  {
    id: 'medium-partial',
    entry: base({
      modelId: 'medium-partial', name: 'Fraud detector', functionalArea: 'fraud_detection',
      useCaseDescription: 'Flags suspicious card transactions for analyst review.', targetCustomerSegments: ['retail'],
      riskLevel: RiskLevel.MEDIUM, ownerTeam: 'Fraud Ops', developedBy: 'vendor', boardPolicyRef: 'AI-POLICY-2026-001',
      humanOversightRequired: true, nextAuditDue: daysAgo(5), sutrasAlignment: [SutraAlignment.FAIRNESS],
    }),
    ctx: { ledgerEventCount: 2, driftReportCount: 0, lastDriftAt: null, overdueIncidentCount: 0, bcpConfigured: false },
  },
  {
    id: 'medium-short-usecase',
    entry: base({
      modelId: 'medium-short-usecase', name: 'Short use case', functionalArea: 'risk_scoring',
      useCaseDescription: 'Risk scores', riskLevel: RiskLevel.MEDIUM, ownerTeam: 'Risk', boardPolicyRef: 'P-1',
      humanOversightRequired: true, sourceRef: 'repo',
      evidenceArtifacts: [{ type: 'bias_test', ref: 'doc://b', added_at: daysAgo(3).toISOString() }],
    }),
    ctx: healthy,
  },
  {
    id: 'low-minimal',
    entry: base({
      modelId: 'low-minimal', name: 'Internal doc classifier', functionalArea: 'document_classification',
      useCaseDescription: 'Routes inbound documents to the right back-office queue.', riskLevel: RiskLevel.LOW,
      ownerTeam: 'Ops Tech', developedBy: 'internal', boardPolicyRef: 'AI-POLICY-2026-001',
    }),
    ctx: { ledgerEventCount: 1 },
  },
  {
    id: 'genai-chatbot',
    entry: base({
      modelId: 'genai-chatbot', name: 'Customer chatbot', modelType: ModelType.GENERATIVE_AI, functionalArea: 'customer_chatbot',
      useCaseDescription: 'Answers customer FAQs; escalates account questions to an agent.', targetCustomerSegments: ['retail'],
      riskLevel: RiskLevel.MEDIUM, ownerTeam: 'Digital', developedBy: 'vendor', boardPolicyRef: 'AI-POLICY-2026-001',
      humanOversightRequired: false, autonomousScope: 'faq_only',
    }),
    ctx: healthy,
  },
  {
    id: 'critical-no-oversight',
    entry: base({
      ...governedHigh, modelId: 'critical-no-oversight', name: 'Autonomous trader', functionalArea: 'autonomous_trading',
      riskLevel: RiskLevel.CRITICAL, humanOversightRequired: false, autonomousScope: 'intraday', evidenceArtifacts: [],
    }),
    ctx: healthy,
  },
];
