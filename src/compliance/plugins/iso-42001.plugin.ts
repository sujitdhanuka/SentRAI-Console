/**
 * ISO 42001 — AI Management System compliance plugin.
 * Port of src/sentrai/compliance/frameworks/iso_42001.py.
 */
import {
  buildReport,
  ComplianceFrameworkPlugin,
  control,
  ControlResult,
  ControlSeverity,
  PluginComplianceReport,
} from './base-plugin';

export class ISO42001Plugin implements ComplianceFrameworkPlugin {
  frameworkId = 'ISO_42001';
  frameworkName = 'ISO/IEC 42001:2023 — AI Management System';
  frameworkVersion = '2023';

  evaluate(asset: Record<string, any>): PluginComplianceReport {
    const results: ControlResult[] = [];

    results.push(
      control('ISO42001-6.1', 'Risk identification', Boolean(asset.risk_level), ControlSeverity.BLOCKING,
        asset.risk_level ? 'Risk level assigned' : 'No risk level assigned',
        'Set risk_level to LOW, MEDIUM, HIGH, or CRITICAL'),
    );
    results.push(
      control('ISO42001-6.2', 'AI objectives documented', Boolean(asset.use_case_description), ControlSeverity.MAJOR,
        asset.use_case_description ? 'Use case documented' : 'No use case description',
        "Add a use_case_description explaining the model's purpose and scope"),
    );
    results.push(
      control('ISO42001-8.4', 'Risk assessment performed', Boolean(asset.board_policy_ref), ControlSeverity.BLOCKING,
        asset.board_policy_ref ? 'Board policy reference present' : 'No board policy reference',
        'Link model to an approved board AI policy document'),
    );
    results.push(
      control('ISO42001-8.6', 'Transparency information', Boolean(asset.use_case_description), ControlSeverity.MAJOR,
        asset.use_case_description ? 'Use case description provides transparency' : 'Transparency not documented',
        'Document model decisions and limitations clearly'),
    );

    const lifecycle: string = asset.lifecycle_stage ?? '';
    const inMonitoring = lifecycle === 'DEPLOYED' || lifecycle === 'MONITORING';
    results.push(
      control('ISO42001-9.1', 'Monitoring in place',
        inMonitoring || ['DESIGN', 'DEVELOPMENT', 'VALIDATION'].includes(lifecycle),
        ControlSeverity.MAJOR, `Lifecycle stage: ${lifecycle}`,
        'Deployed models must have drift monitoring enabled'),
    );
    results.push(
      control('ISO42001-9.3', 'Owner team assigned', Boolean(asset.owner_team), ControlSeverity.BLOCKING,
        `Owner team: ${asset.owner_team ?? 'MISSING'}`, 'Assign an owner_team responsible for this model'),
    );

    const humanOversight = Boolean(asset.human_oversight_required);
    results.push(
      control('ISO42001-10.1', 'Human oversight declared', humanOversight, ControlSeverity.MINOR,
        humanOversight ? 'Human oversight declared' : 'No human oversight flag set',
        'Set human_oversight_required=True or document autonomous scope'),
    );

    return buildReport(
      { frameworkId: this.frameworkId, frameworkName: this.frameworkName, frameworkVersion: this.frameworkVersion, assetId: String(asset.model_id ?? '') },
      results,
    );
  }
}
