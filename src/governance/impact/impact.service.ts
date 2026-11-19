/**
 * Impact assessments (E1.4): a dated, signed snapshot of a model's context
 * profile, its risks and the pack questionnaires. DRAFT → FINAL (signed,
 * hashed, immutable) → REVALIDATION_REQUIRED (set by the E1.3 re-review
 * triggers) or SUPERSEDED by a newer FINAL. An in-scope, high-impact or
 * HIGH/CRITICAL model needs a FINAL assessment to go live (block or warn per
 * the organisation's gate setting).
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AIModelEntity, ImpactAssessmentEntity, ProjectEntity } from '../../database/entities';
import { contextView } from '../context/context-profile';
import { assertFlag, modelForUser } from '../governance-access';
import { governanceHooks } from '../hooks';
import { canonicalJson } from '../packs/pack-loader';
import { RisksService } from '../risks/risks.service';
import { GovernanceSettingsService } from '../settings/settings.service';
import { gateTierOf } from '../settings/settings.model';
import { checkAnswers, defaultQuestionnaires, deriveFlags, prefillAnswers, QUESTIONNAIRES, questionnaireById } from './questionnaires';
import { renderReport, REPORT_LAYOUTS } from './reports';
import { scopeModelWhere } from '../project-scope';

export const IA_SIGNERS: Role[] = [Role.OWNER, Role.CISO, Role.APPROVER];

@Injectable()
export class ImpactAssessmentService implements OnModuleInit {
  constructor(
    @InjectRepository(ImpactAssessmentEntity) private readonly rows: Repository<ImpactAssessmentEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    private readonly settings: GovernanceSettingsService,
    private readonly risks: RisksService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    // Re-review triggers (incident, drift, red team, material or context change) invalidate a signed assessment.
    this.risks.onEvent(async (modelId, event, detail) => {
      if (!this.flags.isEnabled('impactAssessment')) return;
      await this.requireRevalidation(modelId, `${event.toLowerCase().replace(/_/g, ' ')}${detail?.ref ? ` (${detail.ref})` : ''}`);
    });
    // Gate: in scope / high impact / HIGH+ models need a FINAL assessment.
    this.risks.addGateContributor(async (model) => {
      if (!this.flags.isEnabled('impactAssessment')) return [];
      const latest = await this.latestNonDraft(model.id);
      const tier = gateTierOf(model.riskLevel);
      const required = tier === 'HIGH' || tier === 'CRITICAL' || latest?.inScope === true || latest?.highImpact === true;
      if (!required || latest?.status === 'FINAL') return [];
      return [{
        code: 'impact_assessment_required' as const,
        message: latest?.status === 'REVALIDATION_REQUIRED'
          ? `Impact assessment v${latest.version} needs revalidation (${latest.revalidationReason ?? 'a re-review trigger fired'})`
          : 'No final (signed) impact assessment for this model',
      }];
    });
    // ISO 6.1.4 / 8.4 control becomes register-backed.
    const prev = governanceHooks.modelGovernanceFacts;
    governanceHooks.modelGovernanceFacts = async (modelId, orgId) => {
      const base = (await prev?.(modelId, orgId)) ?? {};
      if (!this.flags.isEnabled('impactAssessment')) return Object.keys(base).length ? base : undefined;
      const ia = await this.latestNonDraft(modelId);
      return { ...base, impactAssessment: ia ? { id: ia.id, version: ia.version, status: ia.status, signedAt: ia.signedAt?.toISOString().slice(0, 10) ?? null } : null };
    };
  }

  private assert(): void {
    assertFlag(this.flags, 'impactAssessment');
  }

  private async latestNonDraft(modelId: string): Promise<ImpactAssessmentEntity | null> {
    const rows = await this.rows.find({ where: { modelId }, order: { version: 'DESC' } });
    return rows.find((r) => r.status !== 'DRAFT' && r.status !== 'SUPERSEDED') ?? null;
  }

  private async load(user: CurrentUser, id: string): Promise<ImpactAssessmentEntity> {
    const r = await this.rows.findOne({ where: { id } });
    if (!r || (user.role !== Role.ADMIN && r.orgId !== user.tenantId)) throw new NotFoundException('Impact assessment not found');
    return r;
  }

  view(r: ImpactAssessmentEntity) {
    return {
      assessment_id: r.id,
      org_id: r.orgId,
      model_id: r.modelId,
      version: r.version,
      status: r.status,
      questionnaires: r.packIds,
      answers: r.questionnaire,
      in_scope: r.inScope,
      high_impact: r.highImpact,
      materiality: r.materiality,
      signed_by: r.signedBy,
      signed_by_role: r.signedByRole,
      signed_at: r.signedAt,
      revalidation_reason: r.revalidationReason,
      content_hash: r.contentHash,
      // L8: recomputed from the stored snapshot, so tampering outside the API shows.
      hash_verified: r.contentHash ? iaContentHash(r) === r.contentHash : null,
      context_snapshot: r.contextSnapshot,
      risk_snapshot: r.riskSnapshot,
      created_by: r.createdBy,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  }

  templates() {
    this.assert();
    return { questionnaires: QUESTIONNAIRES, layouts: REPORT_LAYOUTS };
  }

  async list(user: CurrentUser, q: { model_id?: string; status?: string; org_id?: string }) {
    this.assert();
    const orgId = user.role === Role.ADMIN && q.org_id ? q.org_id : user.tenantId;
    if (!orgId) throw new BadRequestException('No organization');
    const where: Record<string, any> = { orgId };
    if (q.model_id) where.modelId = q.model_id;
    if (q.status) where.status = q.status;
    const rows = await this.rows.find({ where: await scopeModelWhere(this.models, where), order: { updatedAt: 'DESC' } });
    return { org_id: orgId, assessments: rows.map((r) => this.view(r)) };
  }

  async get(user: CurrentUser, id: string) {
    this.assert();
    return this.view(await this.load(user, id));
  }

  async create(user: CurrentUser, body: Record<string, any>) {
    this.assert();
    const modelId = String(body.model_id ?? '');
    if (!modelId) throw new BadRequestException('model_id is required');
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new BadRequestException('The model is not in an organization');
    if (await this.rows.findOne({ where: { modelId, status: 'DRAFT' } })) throw new ConflictException('This model already has a draft assessment; edit or finalise it');
    const s = (await this.settings.inForce(orgId)).settings;
    const ids: string[] = Array.isArray(body.questionnaires) && body.questionnaires.length
      ? [...new Set(['iso-42001', ...body.questionnaires.map(String)])]
      : defaultQuestionnaires(s.enabledPacks, s.primaryJurisdiction);
    for (const id of ids) if (!questionnaireById(id)) throw new BadRequestException(`Unknown questionnaire ${id}`);
    // Purpose and oversight come from the model record (use case and context profile) unless given.
    const { answers, filled } = body.prefill === false ? { answers: body.answers ?? {}, filled: [] as string[] } : prefillAnswers(ids, body.answers ?? {}, model as any);
    const problems = checkAnswers(ids, answers, false);
    if (problems.length) throw new BadRequestException(problems);
    const last = await this.rows.findOne({ where: { modelId }, order: { version: 'DESC' } });
    const now = new Date();
    const row = await this.rows.save({
      id: uuidv4(), orgId, modelId, packIds: ids, version: (last?.version ?? 0) + 1, questionnaire: answers,
      contextSnapshot: null, riskSnapshot: null, status: 'DRAFT', signedBy: null, signedByRole: null, signedAt: null,
      ...deriveFlags(ids, answers), revalidationReason: null, contentHash: null,
      createdBy: user.email, createdAt: now, updatedAt: now,
    });
    return { ...this.view(row), prefilled: filled };
  }

  async update(user: CurrentUser, id: string, body: Record<string, any>) {
    this.assert();
    const r = await this.load(user, id);
    // Snapshot immutability: once signed, a new version is the only way to change it.
    if (r.status !== 'DRAFT') throw new ConflictException(`A ${r.status} assessment cannot be edited; start a new version`);
    if (Array.isArray(body.questionnaires)) {
      const ids = [...new Set(['iso-42001', ...body.questionnaires.map(String)])];
      for (const q of ids) if (!questionnaireById(q)) throw new BadRequestException(`Unknown questionnaire ${q}`);
      r.packIds = ids;
    }
    if (body.answers) {
      const merged: Record<string, Record<string, any>> = { ...r.questionnaire };
      for (const [qid, a] of Object.entries(body.answers as Record<string, Record<string, any>>)) merged[qid] = { ...(merged[qid] ?? {}), ...a };
      const problems = checkAnswers(r.packIds, merged, false);
      if (problems.length) throw new BadRequestException(problems);
      r.questionnaire = merged;
    }
    Object.assign(r, deriveFlags(r.packIds, r.questionnaire));
    r.updatedAt = new Date();
    await this.rows.save(r);
    return this.view(r);
  }

  /** Sign and freeze: snapshot the context profile and the model's risks, hash it, supersede the previous FINAL. */
  async finalise(user: CurrentUser, id: string, req?: any) {
    this.assert();
    const r = await this.load(user, id);
    if (r.status !== 'DRAFT') throw new ConflictException(`Only a draft can be finalised (this one is ${r.status})`);
    if (!IA_SIGNERS.includes(user.role) || user.tenantId !== r.orgId) throw new ForbiddenException('Only the Owner, CISO or an Approver of the organization can sign an impact assessment');
    const problems = checkAnswers(r.packIds, r.questionnaire, true);
    if (problems.length) throw new BadRequestException(problems);
    const model = await this.models.findOne({ where: { id: r.modelId } });
    if (!model) throw new NotFoundException('Model not found');
    // M5 separation of duties: for HIGH and CRITICAL systems the person who
    // drafted the assessment cannot also sign it.
    const tier = gateTierOf(model.riskLevel);
    if ((tier === 'HIGH' || tier === 'CRITICAL') && r.createdBy === user.email) {
      throw new ForbiddenException(`You drafted this assessment for a ${tier} system; a different Owner, CISO or Approver must sign it`);
    }
    const riskList = this.flags.isEnabled('riskRegister') ? await this.risks.list(user, { model_id: r.modelId, org_id: r.orgId }) : { risks: [] as any[] };
    r.contextSnapshot = {
      model: {
        name: model.name, model_type: model.modelType, functional_area: model.functionalArea, risk_level: model.riskLevel,
        lifecycle_stage: model.lifecycleStage, owner_team: model.ownerTeam, use_case_description: model.useCaseDescription,
        target_customer_segments: model.targetCustomerSegments ?? [], human_oversight_required: model.humanOversightRequired,
      },
      profile: contextView(model.contextProfile as any),
    };
    r.riskSnapshot = jsonRoundTrip(riskList.risks
      .filter((x) => !['DISMISSED'].includes(x.status))
      .map((x) => ({ risk_id: x.risk_id, category: x.category, title: x.title, status: x.status, assessment: x.assessment, acceptance: x.acceptance, within_appetite: x.within_appetite })));
    r.contextSnapshot = jsonRoundTrip(r.contextSnapshot);
    // Whole seconds, so the stored datetime reproduces the hashed value exactly.
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    r.status = 'FINAL';
    r.signedBy = user.email;
    r.signedByRole = user.role;
    r.signedAt = now;
    Object.assign(r, deriveFlags(r.packIds, r.questionnaire));
    r.contentHash = iaContentHash(r);
    r.updatedAt = now;
    // The previous signed version is superseded.
    for (const old of await this.rows.find({ where: { modelId: r.modelId } })) {
      if (old.id !== r.id && (old.status === 'FINAL' || old.status === 'REVALIDATION_REQUIRED')) {
        old.status = 'SUPERSEDED';
        old.updatedAt = now;
        await this.rows.save(old);
      }
    }
    await this.rows.save(r);
    if (req) req.auditSummary = { impact_assessment_signoff: { assessment_id: r.id, model_id: r.modelId, version: r.version, signed_by: r.signedBy, role: r.signedByRole, content_hash: r.contentHash, in_scope: r.inScope, high_impact: r.highImpact, materiality: r.materiality } };
    return this.view(r);
  }

  /** Start a new draft from the latest version's answers (to revalidate or update). */
  async newVersion(user: CurrentUser, id: string) {
    this.assert();
    const r = await this.load(user, id);
    return this.create(user, { model_id: r.modelId, questionnaires: r.packIds, answers: r.questionnaire });
  }

  async requireRevalidation(modelId: string, reason: string): Promise<number> {
    const finals = await this.rows.find({ where: { modelId, status: 'FINAL' } });
    for (const f of finals) {
      f.status = 'REVALIDATION_REQUIRED';
      f.revalidationReason = `${reason} on ${new Date().toISOString().slice(0, 10)}`.slice(0, 300);
      f.updatedAt = new Date();
      await this.rows.save(f);
    }
    return finals.length;
  }

  async report(user: CurrentUser, id: string, layout = 'iso', format = 'json') {
    this.assert();
    const r = await this.load(user, id);
    if (!REPORT_LAYOUTS.some((l) => l.id === layout)) throw new BadRequestException(`layout must be one of ${REPORT_LAYOUTS.map((l) => l.id).join(', ')}`);
    const model = await this.models.findOne({ where: { id: r.modelId } });
    return renderReport(this.view(r), layout, format, model?.name ?? r.modelId);
  }
}

function jsonRoundTrip<T>(v: T): T {
  return v === null || v === undefined ? v : JSON.parse(JSON.stringify(v));
}

/** The signed content of an impact assessment, as hashed at sign-off. */
export function iaContentHash(r: ImpactAssessmentEntity): string {
  return createHash('sha256')
    .update(canonicalJson({
      id: r.id, model_id: r.modelId, version: r.version, questionnaires: r.packIds, answers: r.questionnaire,
      context: r.contextSnapshot, risks: r.riskSnapshot, signed_by: r.signedBy, signed_at: r.signedAt ? new Date(r.signedAt).toISOString() : null,
    }))
    .digest('hex');
}
