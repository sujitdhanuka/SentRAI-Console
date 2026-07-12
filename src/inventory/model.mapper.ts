import { AIModelEntity } from '../database/entities';
import { AIModelEntry } from '../domain/model-inventory';
import { ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment } from '../common/enums';

/**
 * Reconstructs a domain AIModelEntry from a persisted row, for re-triage /
 * compliance validation. Mirrors _orm_to_entry() in api/v1/inventory.py.
 */
export function modelEntityToEntry(orm: AIModelEntity): AIModelEntry {
  return {
    modelId: orm.id,
    name: orm.name,
    modelType: orm.modelType as ModelType,
    functionalArea: orm.functionalArea,
    useCaseDescription: orm.useCaseDescription,
    targetCustomerSegments: orm.targetCustomerSegments ?? [],
    riskLevel: orm.riskLevel as RiskLevel,
    lifecycleStage: orm.lifecycleStage as ModelLifecycleStage,
    ownerTeam: orm.ownerTeam,
    developedBy: orm.developedBy,
    deploymentDate: orm.deploymentDate,
    dependencies: orm.dependencies ?? [],
    performanceBenchmarks: orm.performanceBenchmarks ?? [],
    sutrasAlignment: (orm.sutrasAlignment ?? []) as SutraAlignment[],
    humanOversightRequired: orm.humanOversightRequired,
    autonomousScope: orm.autonomousScope,
    boardPolicyRef: orm.boardPolicyRef,
    lastRedTeamDate: orm.lastRedTeamDate,
    nextAuditDue: orm.nextAuditDue,
    grievanceCount: orm.grievanceCount,
    grievanceResolutionNotes: orm.grievanceResolutionNotes,
    sourceRef: orm.sourceRef,
    registeredAt: orm.registeredAt,
    updatedAt: orm.updatedAt,
    isActive: orm.isActive,
    projectId: orm.projectId,
    evidenceArtifacts: orm.evidenceArtifacts ?? [],
  };
}
