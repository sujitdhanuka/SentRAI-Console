/**
 * RBI FREE-AI compliance plugin — wraps the 7-Sutras validator under the
 * standard plugin interface. Port of frameworks/rbi_free_ai.py.
 *
 * Note: the Python original constructs an AIModelEntry with a subset of its
 * required fields, so it always fell into the except branch and returned an
 * error placeholder. Here we build a complete entry so the plugin actually
 * evaluates the sutras (a fixed latent bug); the passed-controls list is kept
 * empty to match the original scoring shape.
 */
import { ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment } from '../../common/enums';
import { AIModelEntry } from '../../domain/model-inventory';
import { sutrasBlockingGaps, sutrasOverallPass, validateSutrasCompliance } from '../sutras.validator';
import {
  ComplianceFrameworkPlugin,
  control,
  ControlResult,
  ControlSeverity,
  PluginComplianceReport,
} from './base-plugin';

export class RBIFreeAIPlugin implements ComplianceFrameworkPlugin {
  frameworkId = 'RBI_FREE_AI';
  frameworkName = 'RBI FREE-AI Framework (2025)';
  frameworkVersion = '2025';

  evaluate(asset: Record<string, any>): PluginComplianceReport {
    const entry: AIModelEntry = {
      modelId: String(asset.model_id ?? ''),
      name: asset.name ?? '',
      modelType: (asset.model_type ?? ModelType.MACHINE_LEARNING) as ModelType,
      functionalArea: asset.functional_area ?? '',
      useCaseDescription: asset.use_case_description ?? '',
      targetCustomerSegments: asset.target_customer_segments ?? [],
      riskLevel: (asset.risk_level ?? RiskLevel.MEDIUM) as RiskLevel,
      lifecycleStage: (asset.lifecycle_stage ?? ModelLifecycleStage.DESIGN) as ModelLifecycleStage,
      ownerTeam: asset.owner_team ?? '',
      developedBy: asset.developed_by ?? '',
      deploymentDate: null,
      dependencies: [],
      performanceBenchmarks: [],
      sutrasAlignment: (asset.sutras_alignment ?? []) as SutraAlignment[],
      humanOversightRequired: asset.human_oversight_required ?? false,
      autonomousScope: null,
      boardPolicyRef: asset.board_policy_ref as string,
      lastRedTeamDate: null,
      nextAuditDue: null,
      grievanceCount: 0,
      grievanceResolutionNotes: '',
      sourceRef: null,
      registeredAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      projectId: null,
    };

    // Operational evidence the caller can supply on the asset: the latest
    // successful BCP drill (Sutra 7 / Rec 21 when GOV_E0_4_BCP_DRILLS is on).
    const drill = asset.bcp_drill_last_conducted ? new Date(asset.bcp_drill_last_conducted) : null;
    const report = validateSutrasCompliance(entry, {
      bcpDrillLastConducted: drill && !Number.isNaN(drill.getTime()) ? drill : null,
    });
    const gaps = sutrasBlockingGaps(report);

    const blocking: ControlResult[] = gaps.map((g, i) =>
      control(`RBI-${i}`, g, false, ControlSeverity.BLOCKING, g),
    );
    // Mirrors the original: passed-controls list is derived from a non-existent
    // attribute and is therefore always empty.
    const passedControls: ControlResult[] = [];
    const score = passedControls.length / Math.max(blocking.length + passedControls.length, 1);

    return {
      frameworkId: this.frameworkId,
      frameworkName: this.frameworkName,
      frameworkVersion: this.frameworkVersion,
      assetId: String(asset.model_id ?? ''),
      overallPass: sutrasOverallPass(report),
      score,
      blockingGaps: blocking,
      majorGaps: [],
      minorGaps: [],
      passedControls,
    };
  }
}
