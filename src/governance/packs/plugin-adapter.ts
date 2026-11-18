/**
 * E1.1: with the pack engine on, the framework plugin registry evaluates
 * through the packs too, so the plugins print the same codes and verdicts as
 * the validators. This closes the deferred Phase 0 item: the ISO plugin no
 * longer passes A.6.2.2 / A.8.2 on any use-case text (the ISO pack judges
 * intended purpose through the impact assessment and context profile epics).
 */
import { ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment } from '../../common/enums';
import { FeatureFlags } from '../../common/feature-flags';
import { AIModelEntry } from '../../domain/model-inventory';
import { buildReport, control, ControlResult, ControlSeverity, PluginComplianceReport } from '../../compliance/plugins/base-plugin';
import { evaluatePackById } from './pack-engine';

export const PLUGIN_PACKS: Record<string, string> = {
  RBI_FREE_AI: 'rbi-free-ai',
  NIST_AI_RMF: 'nist-ai-rmf',
  ISO_42001: 'iso-42001',
  EU_AI_ACT: 'eu-ai-act',
};

const date = (v: any): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Snake-case plugin asset → the inventory entry the controls read. */
export function assetToEntry(asset: Record<string, any>): AIModelEntry {
  return {
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
    deploymentDate: date(asset.deployment_date),
    dependencies: asset.dependencies ?? [],
    performanceBenchmarks: asset.performance_benchmarks ?? [],
    sutrasAlignment: (asset.sutras_alignment ?? []) as SutraAlignment[],
    humanOversightRequired: asset.human_oversight_required ?? false,
    autonomousScope: asset.autonomous_scope ?? null,
    boardPolicyRef: asset.board_policy_ref ?? '',
    lastRedTeamDate: date(asset.last_red_team_date),
    nextAuditDue: date(asset.next_audit_due),
    grievanceCount: 0,
    grievanceResolutionNotes: '',
    sourceRef: asset.source_ref ?? null,
    registeredAt: new Date(),
    updatedAt: new Date(),
    isActive: true,
    projectId: null,
    evidenceArtifacts: asset.evidence_artifacts ?? [],
  };
}

export function evaluatePluginViaPack(frameworkId: string, asset: Record<string, any>, flags: FeatureFlags): PluginComplianceReport {
  const packId = PLUGIN_PACKS[frameworkId];
  const entry = assetToEntry(asset);
  const ev = evaluatePackById(packId, entry, { bcpDrillLastConducted: date(asset.bcp_drill_last_conducted) }, { flags });
  const results: ControlResult[] = ev.clauses.map((c) => {
    const sev = c.mandatory ? ControlSeverity.BLOCKING : c.notAssessed ? ControlSeverity.MINOR : ControlSeverity.MAJOR;
    const r = control(c.code, c.name, c.passed, sev, c.passed ? c.evidence : c.gap || c.evidence, c.passed ? '' : c.gap);
    r.evidenceRequired = c.evidenceRefs;
    return r;
  });
  return buildReport(
    { frameworkId, frameworkName: ev.definition.name, frameworkVersion: ev.definition.version, assetId: String(asset.model_id ?? '') },
    results,
  );
}
