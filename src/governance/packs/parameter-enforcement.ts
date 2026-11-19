/**
 * Which parameters actually change a result today. A parameter is enforced
 * when a library control reads it, or when one of the named platform features
 * below does. Anything else is recorded (it resolves strictest-wins and shows
 * which pack set it) but is reported as "not yet enforced", so the parameters
 * view and the settings window never imply a check that does not run.
 */
import { FeatureFlags, getFeatureFlags } from '../../common/feature-flags';
import { listControls } from '../controls/control-library';
import { PARAMETER_SPECS } from './parameter-resolver';

/** Consumers outside the control library, by parameter. */
export const PARAMETER_CONSUMERS: Record<string, string[]> = {
  euHighRiskDomains: ['EU AI Act risk-tier classifier'],
  psiAlertThreshold: ['Drift circuit breaker'],
  bcpDrillIntervalDays: ['BCP drill status and reminders'],
  bcpDrillReminderDays: ['BCP drill status and reminders'],
};

/** Phase 2 consumers, which enforce a parameter only while their flag is on. */
export const FLAGGED_CONSUMERS: Record<string, Array<{ by: string; flag: keyof FeatureFlags }>> = {
  decisionRecordRetentionMonths: [{ by: 'Adverse-action notice and appeal retention (E2.2)', flag: 'usKit' }],
  appealResponseDays: [{ by: 'Appeal and reconsideration due dates (E2.2)', flag: 'usKit' }],
  dtaRegisterShareMonths: [{ by: 'DTA register share reminder (E2.1)', flag: 'auPack' }],
  highRiskReviewMonths: [{ by: 'High-risk use case review (E2.1)', flag: 'auPack' }],
  validationValidityMonths: [{ by: 'Model validation expiry (E2.3)', flag: 'modelValidation' }],
  frameworkReviewMonths: [{ by: 'Framework review reminder (E2.8)', flag: 'redTeamAuditRules' }],
  'redTeamPreDeployRequired.HIGH': [{ by: 'Pre-deploy red-team gate (E2.8)', flag: 'redTeamAuditRules' }],
  'auditIntervalDays.HIGH': [{ by: 'Audit interval gate (E2.8)', flag: 'redTeamAuditRules' }],
  logRetentionMonths: [{ by: 'EU log-retention record: values below the minimum are refused (E5.1)', flag: 'euAiAct' }],
  technicalDocRetentionYears: [{ by: 'EU document retention check and apply (E5.1)', flag: 'euAiAct' }],
};

/** Phase 2 controls that read a parameter, which count only while their flag is on. */
export const FLAGGED_CONTROLS: Record<string, keyof FeatureFlags> = {
  'CTL-FL-02': 'fairLending',
  'CTL-EU-ORG': 'euAiAct',
};

export function parameterEnforcement(name: string): { enforced: boolean; enforcedBy: string[] } {
  const flags = getFeatureFlags();
  const controls = listControls()
    .filter((c) => c.parameters.includes(name) && (!FLAGGED_CONTROLS[c.id] || flags[FLAGGED_CONTROLS[c.id]]))
    .map((c) => c.id);
  const flagged = (FLAGGED_CONSUMERS[name] ?? []).filter((c) => flags[c.flag]).map((c) => c.by);
  const enforcedBy = [...controls, ...(PARAMETER_CONSUMERS[name] ?? []), ...flagged];
  return { enforced: enforcedBy.length > 0, enforcedBy };
}

/** Every known parameter with its enforcement status (for the settings window). */
export function parameterCatalog() {
  return PARAMETER_SPECS.map((s) => ({ name: s.name, rule: s.rule, unit: s.unit ?? null, description: s.description, ...parameterEnforcement(s.name) }));
}
