/**
 * Model card v2: the v1 → v2 migration (spec §13). Additive only: it writes
 * card_records and card_field_values rows and a ledger event, and never
 * updates or deletes ai_models or model_cards rows. The dry run reports what
 * would happen per record and writes nothing. The real run skips records that
 * already have a v2 card, so running it twice changes nothing.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../../../common/feature-flags';
import { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { frameworkLabel, frameworkReportOf, frameworkScopeForOrg } from '../../../../compliance/framework-scope';
import {
  AIModelEntity, CardControlAssessmentEntity, CardFieldValueEntity, CardRecordEntity, DatasetEntity, ModelDatasetEntity, ModelLedgerEventEntity, ProjectEntity, UserEntity,
} from '../../../../database/entities';
import { InventoryService } from '../../../../inventory/inventory.service';
import { assertFlag } from '../../../governance-access';
import { governanceHooks } from '../../../hooks';
import { OFFICERS, orgFor, orgModels, requireRole } from '../../../phase2-util';
import { CATALOGUE_VERSION } from '../catalogue';
import { registryIdForV1Label } from '../controls';
import { FrameworkRegistryService } from '../registry/framework-registry.service';
import { FrameworkDef } from '../registry/types';
import { MigrationPlan, planV1Migration, V1Context } from './v1-mapper';

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

@Injectable()
export class CardV2MigrationService {
  private readonly log = new Logger(CardV2MigrationService.name);

  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(ModelDatasetEntity) private readonly modelDatasets: Repository<ModelDatasetEntity>,
    @InjectRepository(DatasetEntity) private readonly datasets: Repository<DatasetEntity>,
    @InjectRepository(CardRecordEntity) private readonly records: Repository<CardRecordEntity>,
    private readonly registry: FrameworkRegistryService,
    private readonly inventory: InventoryService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /** What the v1 card showed for this record, as the mapper's input. */
  private async context(m: AIModelEntity, orgId: string): Promise<V1Context> {
    const owner = m.ownerUserId ? await this.users.findOne({ where: { id: m.ownerUserId } }) : null;
    const links = await this.modelDatasets.find({ where: { modelId: m.id } });
    const sets = links.length ? await this.datasets.find({ where: { id: In(links.map((l) => l.datasetId)) } }) : [];
    const scope = await frameworkScopeForOrg(orgId);
    const report = await this.inventory.complianceCheck(m.id);
    const verdicts = scope.frameworks.map((id) => {
      const r = frameworkReportOf(report, id);
      return { framework: frameworkLabel(id), pass: Boolean(r?.overall_pass), gaps: (r?.blocking_gaps ?? []).length };
    });
    const governance = (await governanceHooks.cardGovernance?.(m.id)) ?? {};
    return {
      orgId,
      owner: owner ? { id: owner.id, fullName: owner.fullName, email: owner.email, isActive: owner.isActive, tenantId: owner.tenantId, role: owner.role, accountType: owner.accountType } : null,
      datasetPersonalData: sets.some((d) => d.personalData),
      verdicts,
      governance,
      record: {
        id: m.id, name: m.name, modelType: m.modelType, functionalArea: m.functionalArea, useCaseDescription: m.useCaseDescription ?? null,
        descriptionSource: m.descriptionSource ?? null, targetCustomerSegments: m.targetCustomerSegments ?? [], riskLevel: m.riskLevel,
        riskRationale: m.riskRationale ?? null, riskRationaleSource: m.riskRationaleSource ?? null, lifecycleStage: m.lifecycleStage,
        operationalState: m.operationalState, deploymentDate: iso(m.deploymentDate), ownerTeam: m.ownerTeam, ownerUserId: m.ownerUserId ?? null,
        developedBy: m.developedBy ?? null, humanOversightRequired: m.humanOversightRequired, autonomousScope: m.autonomousScope ?? null,
        dependencies: m.dependencies ?? [], sourceRefs: m.sourceRefs ?? (m.sourceRef ? [m.sourceRef] : []), detectionSignals: m.detectionSignals ?? [],
        detectedTools: m.detectedTools ?? [], boardPolicyRef: m.boardPolicyRef ?? null, lastRedTeamDate: iso(m.lastRedTeamDate), nextAuditDue: iso(m.nextAuditDue),
        grievanceCount: m.grievanceCount ?? 0, energyKwh: m.energyKwh ?? null, registeredAt: iso(m.registeredAt) ?? new Date(0).toISOString(),
      },
    };
  }

  /** Per-record plans for the organisation; `dryRun` writes nothing. */
  async migrate(user: CurrentUser, opts: { orgId?: string | null; dryRun: boolean }) {
    assertFlag(this.flags, 'modelCardV2');
    requireRole(user, OFFICERS, opts.dryRun ? 'preview the model card v2 migration' : 'run the model card v2 migration');
    const orgId = orgFor(user, opts.orgId);
    const models = await orgModels(this.models, this.projects, orgId);
    const ids = models.map((m) => m.id);
    const existing = new Set(ids.length ? (await this.records.find({ where: { modelId: In(ids) }, select: ['modelId'] })).map((r) => r.modelId) : []);
    const at = new Date();
    const out: Array<ReturnType<typeof summarise> & { already_migrated: boolean; written: boolean }> = [];
    for (const m of models) {
      const plan = planV1Migration(await this.context(m, orgId), at);
      const already = existing.has(m.id);
      if (!opts.dryRun && !already) await this.write(orgId, plan, user, at);
      out.push({ ...summarise(plan), already_migrated: already, written: !opts.dryRun && !already });
    }
    if (!opts.dryRun) this.log.log(`model card v2 migration: org ${orgId}, ${out.filter((r) => r.written).length} written, ${existing.size} skipped`);
    return { org_id: orgId, dry_run: opts.dryRun, catalogue_version: CATALOGUE_VERSION, records: out };
  }

  private async write(orgId: string, plan: MigrationPlan, user: CurrentUser, at: Date): Promise<void> {
    const note = [
      'Created by the v1 migration. Every imported value is unaccepted until a person reviews it.',
      `Risk tier ${plan.risk.imported_tier ?? '(none)'}: ${plan.risk.status}.`,
      ...plan.verdicts_reset.map((v) => `${v.framework}: v1 showed "${v.v1_verdict}", now ${v.v2_status}.`),
    ].join('\n');
    // Registry entries first (reading may seed the registry), then every write in one transaction.
    const frameworks: Array<{ verdict: string; fw: FrameworkDef }> = [];
    for (const v of plan.verdicts_reset) {
      const id = registryIdForV1Label(v.framework);
      if (id) frameworks.push({ verdict: v.v1_verdict, fw: await this.registry.get(id) });
    }
    await this.records.manager.transaction(async (em) => {
      await em.save(CardRecordEntity, {
        id: uuidv4(), orgId, modelId: plan.model_id, catalogueVersion: CATALOGUE_VERSION, workflowState: 'DRAFT', author: null,
        nextReviewAt: null, lastApprovedVersion: null, migratedFromV1: true, migrationNote: note, createdAt: at, updatedAt: at,
      });
      await em.save(CardFieldValueEntity, plan.fields.map((f) => ({
        id: uuidv4(), orgId, modelId: plan.model_id, fieldId: f.field_id, value: f.value, status: f.status, provenance: f.provenance, sourceRef: f.source_ref,
        enteredBy: f.entered_by, enteredAt: f.entered_at ? new Date(f.entered_at) : null, acceptedBy: f.accepted_by, acceptedAt: f.accepted_at ? new Date(f.accepted_at) : null,
        suggestion: f.suggestion, naJustification: f.na_justification, naDecidedBy: f.na_decided_by, evidenceRefs: f.evidence_refs, verifiedBy: null, verifiedAt: null,
        catalogueVersion: CATALOGUE_VERSION, updatedAt: at,
      })));
      // Every v1 framework verdict becomes NOT_ASSESSED on each control of the matching registry entry, keeping the old verdict.
      for (const { verdict, fw } of frameworks) {
        if (!fw.controls.length) continue;
        await em.save(CardControlAssessmentEntity, fw.controls.map((c) => ({
          id: uuidv4(), orgId, modelId: plan.model_id, frameworkId: fw.framework_id, frameworkRevision: fw.revision, controlId: c.control_id,
          status: 'NOT_ASSESSED', justification: null, evidenceRefs: [], assessedBy: null, assessedAt: null, implementedBy: null, verifiedBy: null,
          migratedFromV1Verdict: verdict.slice(0, 100), updatedAt: at,
        })));
      }
      await em.save(ModelLedgerEventEntity, {
        id: uuidv4(), modelId: plan.model_id, eventType: 'CARD_MIGRATED_FROM_V1', actor: user.email, occurredAt: at,
        eventData: {
          record_type_proposed: plan.record_type.value, fields: plan.fields.length, consistency: plan.consistency.map((c) => c.code),
          owner: plan.owner.ok ? 'ok' : plan.owner.code, risk: plan.risk, verdicts_reset: plan.verdicts_reset,
        },
      });
    });
  }
}

/** The dry-run view of one record (no field values, which may be long). */
function summarise(p: MigrationPlan) {
  return {
    model_id: p.model_id,
    model_name: p.model_name,
    record_type_proposed: p.record_type,
    fields_imported: p.fields.filter((f) => f.provenance === 'IMPORTED_V1').map((f) => f.field_id),
    fields_scanned: p.fields.filter((f) => f.provenance === 'CODE_SCAN').map((f) => f.field_id),
    suggestions: p.fields.filter((f) => f.suggestion).map((f) => ({ field_id: f.field_id, removed: f.suggestion!.removed })),
    consistency: p.consistency,
    owner: p.owner,
    risk: p.risk,
    verdicts_reset: p.verdicts_reset,
    notes: p.notes,
  };
}
