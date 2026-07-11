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
