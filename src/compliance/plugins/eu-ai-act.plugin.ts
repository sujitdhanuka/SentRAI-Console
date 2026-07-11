/**
 * EU AI Act compliance plugin.
 * Port of src/sentrai/compliance/frameworks/eu_ai_act.py.
 */
import {
  buildReport,
  ComplianceFrameworkPlugin,
  control,
  ControlResult,
  ControlSeverity,
  PluginComplianceReport,
} from './base-plugin';

const EU_HIGH_RISK_AREAS = [
  'credit_scoring', 'credit_underwriting', 'loan_decisioning',
  'fraud_detection', 'kyc', 'identity_verification',
  'employment', 'recruitment', 'benefits_assessment',
  'biometric', 'law_enforcement', 'border_control',
  'administration_of_justice',
];

export class EUAIActPlugin implements ComplianceFrameworkPlugin {
  frameworkId = 'EU_AI_ACT';
  frameworkName = 'EU Artificial Intelligence Act (2024/1689)';
  frameworkVersion = '2024';

  private classifyEuRisk(asset: Record<string, any>): string {
    const functionalArea = String(asset.functional_area ?? '').toLowerCase().replace(/ /g, '_');
    if (EU_HIGH_RISK_AREAS.some((kw) => functionalArea.includes(kw))) return 'HIGH';
    const riskLevel = asset.risk_level ?? 'LOW';
    if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') return 'HIGH';
    return 'LIMITED';
  }

  evaluate(asset: Record<string, any>): PluginComplianceReport {
    const results: ControlResult[] = [];
    const euTier = this.classifyEuRisk(asset);

    results.push(
      control('EUAIA-Art6', 'EU AI Act risk tier classification', true, ControlSeverity.MINOR,
        `Classified as ${euTier} risk under EU AI Act`, ''),
    );

    if (euTier === 'HIGH') {
      results.push(
        control('EUAIA-Art9', 'Risk management system (High Risk)', Boolean(asset.board_policy_ref), ControlSeverity.BLOCKING,
          asset.board_policy_ref ? 'Board policy reference present' : 'HIGH risk model requires documented risk management',
          'Document risk management system and link via board_policy_ref'),
      );
      results.push(
        control('EUAIA-Art10', 'Training data governance (High Risk)', Boolean(asset.owner_team), ControlSeverity.MAJOR,
          asset.owner_team ? 'Owner team assigned — data governance accountability exists' : 'No owner team — data governance not accountable',
          'Assign an owner team with data governance responsibility'),
      );
    }

    const lifecycle: string = asset.lifecycle_stage ?? '';
    results.push(
      control('EUAIA-Art12', 'Logging and audit trail',
        ['DEPLOYED', 'MONITORING', 'DECOMMISSIONED'].includes(lifecycle),
        euTier === 'HIGH' ? ControlSeverity.MAJOR : ControlSeverity.MINOR,
        `Model is in '${lifecycle}' stage — logging expected for deployed models`,
        'Ensure deployment includes structured logging of inference events'),
    );

    results.push(
      control('EUAIA-Art13', 'Transparency and user information', Boolean(asset.use_case_description),
        euTier === 'HIGH' ? ControlSeverity.MAJOR : ControlSeverity.MINOR,
        asset.use_case_description ? 'Use case documented' : 'No use case description — users cannot understand AI system',
        'Add a use_case_description that explains model behaviour and limitations'),
    );

    results.push(
      control('EUAIA-Art14', 'Human oversight measures', Boolean(asset.human_oversight_required),
        euTier === 'HIGH' ? ControlSeverity.BLOCKING : ControlSeverity.MAJOR,
        asset.human_oversight_required ? 'Human oversight flag set' : 'No human oversight declared',
        'Set human_oversight_required=True and document override procedures'),
    );

    if (euTier === 'HIGH') {
      results.push(
        control('EUAIA-Art17', 'Quality management system',
          Boolean(asset.board_policy_ref) && Boolean(asset.owner_team), ControlSeverity.MAJOR,
          asset.board_policy_ref ? 'Quality management indicators present' : 'Quality management system not documented',
          'Establish quality management procedures and document them'),
      );
    }

    return buildReport(
      { frameworkId: this.frameworkId, frameworkName: this.frameworkName, frameworkVersion: this.frameworkVersion, assetId: String(asset.model_id ?? '') },
      results,
    );
  }
}
