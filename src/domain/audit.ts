/**
 * Module C domain — AI audit-trail factory (REC 24).
 * Port of generate_audit_trail_payload() in src/sentrai/domain/audit.py.
 */
import { AuditType, RiskLevel, SutraAlignment } from '../common/enums';

export interface AuditTrailPayload {
  auditId: string;
  modelId: string;
  auditType: AuditType;
  auditorRef: string;
  riskLevel: RiskLevel;
  auditPeriodStart: Date;
  auditPeriodEnd: Date;

  // Dimension 1 — Input Data Audit
  trainingDataBiasChecked: boolean;
  dataConsentVerified: boolean;
  dataSourcesDocumented: boolean;
  sensitiveAttributesExcluded: boolean;

  // Dimension 2 — Model & Algorithm Audit
  modelArchitectureReviewed: boolean;
  decisionLogicDocumented: boolean;
  adversarialRobustnessTested: boolean;
  performanceBenchmarksMet: boolean;

  // Dimension 3 — Output & Behaviour Audit
  fairnessMetrics: Record<string, number>;
  explainabilityScore: number;
  bcpVerified: boolean;
  humanOverrideTested: boolean;

  sutrasCompliance: Record<string, boolean>;
  overallVerdict: string;
  nextAuditDue: Date | null;
  createdAt: Date;
}

export interface AuditChecklist {
  training_data_bias_checked?: boolean;
  data_consent_verified?: boolean;
  data_sources_documented?: boolean;
  sensitive_attributes_excluded?: boolean;
  model_architecture_reviewed?: boolean;
  decision_logic_documented?: boolean;
  adversarial_robustness_tested?: boolean;
  performance_benchmarks_met?: boolean;
  fairness_metrics?: Record<string, number>;
  explainability_score?: number;
  bcp_verified?: boolean;
  human_override_tested?: boolean;
  trust_verified?: boolean;
  human_oversight_verified?: boolean;
  innovation_not_stifled?: boolean;
  fairness_metrics_passed?: boolean;
  accountability_chain_documented?: boolean;
  explainability_verified?: boolean;
}

/**
 * Factory: constructs a structured audit-trail payload ready for persistence.
 * Enforces all 7 Sutras compliance checks.
 */
export function generateAuditTrailPayload(
  auditId: string,
  modelId: string,
  auditType: AuditType,
  auditorRef: string,
  riskLevel: RiskLevel,
  auditPeriodStart: Date,
  auditPeriodEnd: Date,
  checklist: AuditChecklist,
): AuditTrailPayload {
  const sutrasCompliance: Record<string, boolean> = {
    [SutraAlignment.TRUST]: checklist.trust_verified ?? false,
    [SutraAlignment.PEOPLE_FIRST]: checklist.human_oversight_verified ?? false,
    [SutraAlignment.INNOVATION]: checklist.innovation_not_stifled ?? true,
    [SutraAlignment.FAIRNESS]: checklist.fairness_metrics_passed ?? false,
    [SutraAlignment.ACCOUNTABILITY]: checklist.accountability_chain_documented ?? false,
    [SutraAlignment.EXPLAINABILITY]: checklist.explainability_verified ?? false,
    [SutraAlignment.SAFETY]: checklist.bcp_verified ?? false,
  };

  return {
    auditId,
    modelId,
    auditType,
    auditorRef,
    riskLevel,
    auditPeriodStart,
    auditPeriodEnd,
    trainingDataBiasChecked: checklist.training_data_bias_checked ?? false,
    dataConsentVerified: checklist.data_consent_verified ?? false,
    dataSourcesDocumented: checklist.data_sources_documented ?? false,
    sensitiveAttributesExcluded: checklist.sensitive_attributes_excluded ?? false,
    modelArchitectureReviewed: checklist.model_architecture_reviewed ?? false,
    decisionLogicDocumented: checklist.decision_logic_documented ?? false,
    adversarialRobustnessTested: checklist.adversarial_robustness_tested ?? false,
    performanceBenchmarksMet: checklist.performance_benchmarks_met ?? false,
    fairnessMetrics: checklist.fairness_metrics ?? {},
    explainabilityScore: checklist.explainability_score ?? 0.0,
    bcpVerified: checklist.bcp_verified ?? false,
    humanOverrideTested: checklist.human_override_tested ?? false,
    sutrasCompliance,
    overallVerdict: 'PENDING',
    nextAuditDue: null,
    createdAt: new Date(),
  };
}
