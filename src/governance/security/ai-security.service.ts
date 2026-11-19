/**
 * AI security (E3.6, RBI Rec 19, NIST MEASURE 2.7, ISO A.6.2.6): a versioned
 * threat model per system built from the attack-category template, approved by
 * an officer other than its author, with applicable threats raised as SECURITY
 * risks; and security evaluations recorded against the same categories, each
 * stored as 'security_eval' evidence on the model.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AIModelEntity, ProjectEntity, SecurityEvaluationEntity, ThreatModelEntity } from '../../database/entities';
import { InventoryService } from '../../inventory/inventory.service';
import { assertFlag, modelForUser } from '../governance-access';
import { addModelFacts } from '../hooks';
import { MAINTAINERS, OFFICERS, optDate, optText, orgFor, orgModels, reqText, requireRole } from '../phase2-util';
import { RisksService } from '../risks/risks.service';
import {
  approvalProblems, ATTACK_CATEGORIES, EvalCategory, mergeThreats, parseEvalCategories, securityFacts, templateThreats, Threat,
} from './ai-security.model';

export const TEMPLATE_ID = 'sentrai-ai-threats-2026.1';

@Injectable()
export class AiSecurityService implements OnModuleInit {
  constructor(
    @InjectRepository(ThreatModelEntity) private readonly tms: Repository<ThreatModelEntity>,
    @InjectRepository(SecurityEvaluationEntity) private readonly evals: Repository<SecurityEvaluationEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    private readonly inventory: InventoryService,
    private readonly risks: RisksService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addModelFacts(async (modelId) => {
      if (!this.flags.isEnabled('aiSecurity')) return undefined;
      return { aiSecurity: await this.factsFor(modelId) };
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'aiSecurity');
  }

  async factsFor(modelId: string) {
    const tm = await this.latest(modelId);
    const evals = await this.evals.find({ where: { modelId }, order: { evaluatedAt: 'DESC' }, take: 50 });
    return securityFacts(tm ? { status: tm.status, threats: tm.threats } : null, evals.map((e) => ({ evaluatedAt: e.evaluatedAt, categories: e.categories })));
  }

  private latest(modelId: string) {
    return this.tms.findOne({ where: { modelId }, order: { version: 'DESC' } });
  }

  private tmView(t: ThreatModelEntity) {
    return {
      threat_model_id: t.id, model_id: t.modelId, version: t.version, template_id: t.templateId, status: t.status,
      threats: (t.threats as Threat[]).map((x) => ({ ...x, ...catRef(x.category) })),
      problems: t.status === 'DRAFT' ? approvalProblems(t.threats) : [],
      approved_by: t.approvedBy, approved_at: t.approvedAt, created_by: t.createdBy, created_at: t.createdAt, updated_at: t.updatedAt,
    };
  }

  private evalView(e: SecurityEvaluationEntity) {
    return { evaluation_id: e.id, model_id: e.modelId, ref: e.ref, evaluator: e.evaluator, categories: e.categories, evaluated_at: e.evaluatedAt, recorded_by: e.recordedBy, created_at: e.createdAt };
  }

  template() {
    this.assert();
    return { template_id: TEMPLATE_ID, categories: ATTACK_CATEGORIES };
  }

  async overview(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const models = await orgModels(this.models, this.projects, orgId);
    const rows: Array<Record<string, any>> = [];
    for (const m of models) rows.push({ model_id: m.id, name: m.name, model_type: m.modelType, ...(await this.factsFor(m.id)) });
    return { org_id: orgId, template_id: TEMPLATE_ID, models: rows };
  }

  async forModel(user: CurrentUser, modelId: string) {
    this.assert();
    await modelForUser(this.models, this.projects, user, modelId);
    const versions = await this.tms.find({ where: { modelId }, order: { version: 'DESC' }, take: 20 });
    const evals = await this.evals.find({ where: { modelId }, order: { evaluatedAt: 'DESC' }, take: 100 });
    return {
      model_id: modelId, facts: await this.factsFor(modelId),
      threat_model: versions[0] ? this.tmView(versions[0]) : null,
      versions: versions.map((v) => ({ threat_model_id: v.id, version: v.version, status: v.status, approved_by: v.approvedBy, approved_at: v.approvedAt })),
      evaluations: evals.map((e) => this.evalView(e)),
    };
  }

  /** A new DRAFT version: from the template, or carrying the latest version's answers forward. */
  async createThreatModel(user: CurrentUser, modelId: string, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'write threat models');
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new BadRequestException('The model has no organization');
    const prev = await this.latest(modelId);
    if (prev?.status === 'DRAFT') throw new BadRequestException(`Version ${prev.version} is still a draft; edit or approve it first`);
    const base = templateThreats(model.modelType);
    const threats = prev ? base.map((t) => ({ ...t, ...((prev.threats as Threat[]).find((p) => p.category === t.category) ?? {}) })) : base;
    const now = new Date();
    const row = await this.tms.save(this.tms.create({
      id: uuidv4(), orgId, modelId, version: (prev?.version ?? 0) + 1, templateId: TEMPLATE_ID, threats, status: 'DRAFT',
      approvedBy: null, approvedAt: null, createdBy: user.email, createdAt: now, updatedAt: now,
    }));
    if (req) req.auditSummary = { threat_model_created: { model_id: modelId, version: row.version } };
    return this.tmView(row);
  }

  private async tmInOrg(user: CurrentUser, id: string) {
    const t = await this.tms.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Threat model not found');
    await modelForUser(this.models, this.projects, user, t.modelId);
    return t;
  }

  async updateThreatModel(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'write threat models');
    const t = await this.tmInOrg(user, id);
    if (t.status !== 'DRAFT') throw new BadRequestException('Only a draft can be edited; start a new version');
    try {
      t.threats = mergeThreats(t.threats, body.threats);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    t.updatedAt = new Date();
    await this.tms.save(t);
    if (req) req.auditSummary = { threat_model_updated: { threat_model_id: t.id, version: t.version } };
    return this.tmView(t);
  }

  /** Officer approval (not the author). Applicable threats with no linked risk are raised as SECURITY risks when the register is on. */
  async approve(user: CurrentUser, id: string, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'approve threat models');
    const t = await this.tmInOrg(user, id);
    if (t.status !== 'DRAFT') throw new BadRequestException('The threat model is not a draft');
    if (t.createdBy === user.email) throw new ForbiddenException('The author cannot approve their own threat model');
    const problems = approvalProblems(t.threats);
    if (problems.length) throw new BadRequestException({ message: 'The threat model is incomplete', problems });
    const threats = (t.threats as Threat[]).map((x) => ({ ...x }));
    let raised = 0;
    if (this.flags.isEnabled('riskRegister')) {
      for (const th of threats) {
        if (!th.applicable || th.risk_id) continue;
        const c = ATTACK_CATEGORIES.find((x) => x.id === th.category)!;
        const r = await this.risks.create(user, {
          scope_type: 'MODEL', scope_id: t.modelId, category: 'SECURITY', title: `AI threat: ${c.label}`,
          description: `From threat model v${t.version} (${t.templateId}). Likelihood ${th.likelihood}, impact ${th.impact}. Mitigations: ${th.mitigations}`,
        });
        th.risk_id = (r as any).risk_id ?? (r as any).id ?? null;
        raised++;
      }
    }
    // Earlier approved versions are superseded.
    await this.tms.update({ modelId: t.modelId, status: 'APPROVED' }, { status: 'SUPERSEDED', updatedAt: new Date() });
    t.threats = threats;
    t.status = 'APPROVED';
    t.approvedBy = user.email;
    t.approvedAt = new Date();
    t.updatedAt = t.approvedAt;
    await this.tms.save(t);
    if (req) req.auditSummary = { threat_model_approved: { threat_model_id: t.id, version: t.version, risks_raised: raised } };
    return { ...this.tmView(t), risks_raised: raised };
  }

  async recordEvaluation(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record security evaluations');
    const { orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new BadRequestException('The model has no organization');
    const ref = reqText(body.ref, 'ref', 3, 500);
    let categories: EvalCategory[];
    try {
      categories = parseEvalCategories(body.categories);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const at = optDate(body.evaluated_at, 'evaluated_at') ?? new Date();
    if (at.getTime() > Date.now() + 60_000) throw new BadRequestException('evaluated_at cannot be in the future');
    const row = await this.evals.save(this.evals.create({
      id: uuidv4(), orgId, modelId, ref, evaluator: optText(body.evaluator, 'evaluator', 255), categories, evaluatedAt: at, recordedBy: user.email, createdAt: new Date(),
    }));
    const failed = categories.filter((c) => c.result !== 'PASS').length;
    await this.inventory.addEvidence(modelId, {
      type: 'security_eval', ref, description: `Security evaluation: ${categories.length} categories, ${failed} not passed`,
    }, user.email);
    if (req) req.auditSummary = { security_eval_recorded: { model_id: modelId, categories: categories.length, not_passed: failed } };
    return this.evalView(row);
  }
}

function catRef(id: string) {
  const c = ATTACK_CATEGORIES.find((x) => x.id === id);
  return c ? { label: c.label, atlas: c.atlas, owasp: c.owasp, nist: c.nist, area: c.area } : {};
}
