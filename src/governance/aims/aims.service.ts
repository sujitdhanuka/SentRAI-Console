/**
 * AIMS workspace (E1.6): one workspace per organisation for the ISO/IEC 42001
 * management-system records. ORG-scope controls in the ISO and RBI packs read
 * these records, the corrective-action register and document control.
 * SentRAI records these processes; the organisation still runs them.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { governanceHooks } from '../hooks';

import { ModelLifecycleStage, ModelType, RiskLevel, Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { NotifierService } from '../../common/notifier.service';
import { ComplianceService } from '../../compliance/compliance.service';
import { AimsRecordEntity, ControlResultEntity } from '../../database/entities';
import { AIModelEntry } from '../../domain/model-inventory';
import { CorrectiveActionsService } from '../actions/actions.service';
import { DocumentsService } from '../documents/documents.service';
import { assertFlag } from '../governance-access';
import { evaluatePack, resolveForPacks } from '../packs/pack-engine';
import { packRegistry } from '../packs/pack-loader';
import { PacksService } from '../packs/packs.service';
import { GovernanceSettingsService } from '../settings/settings.service';
import { AIMS_TYPES, aimsType, checkContent, missingRec14 } from './aims.model';

export const AIMS_EDITORS: Role[] = [Role.OWNER, Role.CISO, Role.ADMIN];
const MONTH = 30.44 * 86_400_000;

/** Placeholder entry for organisation-level evaluation (ORG controls never read it). */
export const ORG_ENTRY: AIModelEntry = {
  modelId: 'org', name: 'Organisation', modelType: ModelType.MACHINE_LEARNING, functionalArea: '', useCaseDescription: '',
  targetCustomerSegments: [], riskLevel: RiskLevel.LOW, lifecycleStage: ModelLifecycleStage.DESIGN, ownerTeam: '', developedBy: '',
  deploymentDate: null, dependencies: [], performanceBenchmarks: [], sutrasAlignment: [], humanOversightRequired: false,
  autonomousScope: null, boardPolicyRef: '', lastRedTeamDate: null, nextAuditDue: null, grievanceCount: 0,
  grievanceResolutionNotes: '', sourceRef: null, registeredAt: new Date(0), updatedAt: new Date(0), isActive: true, projectId: null,
};

@Injectable()
export class AimsService {
  private readonly logger = new Logger(AimsService.name);

  constructor(
    @InjectRepository(AimsRecordEntity) private readonly rows: Repository<AimsRecordEntity>,
    @InjectRepository(ControlResultEntity) private readonly results: Repository<ControlResultEntity>,
    private readonly settings: GovernanceSettingsService,
    private readonly packs: PacksService,
    private readonly actions: CorrectiveActionsService,
    private readonly documents: DocumentsService,
    private readonly compliance: ComplianceService,
    private readonly notifier: NotifierService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private assert(): void {
    assertFlag(this.flags, 'aims');
  }

  private orgOf(user: CurrentUser, requested?: string): string {
    const org = user.role === Role.ADMIN && requested ? requested : user.tenantId;
    if (!org) throw new BadRequestException('No organization');
    return org;
  }

  private async load(user: CurrentUser, id: string): Promise<AimsRecordEntity> {
    const r = await this.rows.findOne({ where: { id } });
    if (!r || (user.role !== Role.ADMIN && r.orgId !== user.tenantId)) throw new NotFoundException('Record not found');
    return r;
  }

  private canEdit(user: CurrentUser, orgId: string) {
    if (!AIMS_EDITORS.includes(user.role) || user.tenantId !== orgId) {
      throw new ForbiddenException('Only the Owner, CISO or an Admin of the organization can change AIMS records');
    }
  }

  view(r: AimsRecordEntity) {
    return {
      record_id: r.id, org_id: r.orgId, type: r.type, title: r.title, content: r.content, status: r.status,
      owner_user_id: r.ownerUserId, approved_by: r.approvedBy, approved_at: r.approvedAt, review_due_at: r.reviewDueAt,
      review_overdue: r.status === 'APPROVED' && !!r.reviewDueAt && r.reviewDueAt.getTime() < Date.now(),
      document_id: r.documentId, iso_clauses: aimsType(r.type)?.isoClauses ?? [], created_by: r.createdBy, created_at: r.createdAt, updated_at: r.updatedAt,
    };
  }

  types() {
    this.assert();
    return { types: AIMS_TYPES };
  }

  async list(user: CurrentUser, type: string | undefined, orgParam?: string) {
    this.assert();
    const orgId = this.orgOf(user, orgParam);
    const where: Record<string, any> = { orgId };
    if (type) where.type = type.toUpperCase();
    const rows = await this.rows.find({ where, order: { type: 'ASC', updatedAt: 'DESC' } });
    return { org_id: orgId, records: rows.map((r) => this.view(r)) };
  }

  async get(user: CurrentUser, id: string) {
    this.assert();
    return this.view(await this.load(user, id));
  }

  private async peopleGuard(orgId: string, type: string) {
    const t = aimsType(type)!;
    if (!t.peopleItem) return;
    const s = (await this.settings.inForce(orgId)).settings;
    if (s.peopleItems?.[t.peopleItem]?.mode === 'CUSTOMER') {
      throw new ConflictException(`${t.label}s are set as customer responsibility in the governance settings; change the people-side item to keep light records here`);
    }
  }

  async create(user: CurrentUser, type: string, body: Record<string, any>) {
    this.assert();
    const t = aimsType(String(type).toUpperCase());
    if (!t) throw new NotFoundException(`Unknown record type ${type}`);
    const orgId = this.orgOf(user);
    this.canEdit(user, orgId);
    await this.peopleGuard(orgId, t.type);
    const content = body.content ?? {};
    const problems = checkContent(t.type, content);
    if (problems.length) throw new BadRequestException(problems);
    if (body.document_id) await this.documents.assertUsable(orgId, String(body.document_id));
    const now = new Date();
    const r = await this.rows.save({
      id: uuidv4(), orgId, type: t.type, title: String(body.title ?? t.label).slice(0, 300), content, status: 'DRAFT',
      ownerUserId: body.owner_user_id ?? null, approvedBy: null, approvedAt: null,
      reviewDueAt: body.review_due_at ? new Date(body.review_due_at) : null, documentId: body.document_id ?? null,
      createdBy: user.email, createdAt: now, updatedAt: now,
    });
    return this.view(r);
  }

  async update(user: CurrentUser, id: string, body: Record<string, any>) {
    this.assert();
    const r = await this.load(user, id);
    this.canEdit(user, r.orgId);
    if (r.status === 'RETIRED') throw new BadRequestException('A retired record cannot be changed');
    if (body.content !== undefined) {
      const problems = checkContent(r.type, body.content);
      if (problems.length) throw new BadRequestException(problems);
      r.content = body.content;
      // A changed record needs approving again.
      if (r.status === 'APPROVED') { r.status = 'DRAFT'; r.approvedAt = null; r.approvedBy = null; }
    }
    if (body.title !== undefined) r.title = String(body.title).slice(0, 300);
    if (body.owner_user_id !== undefined) r.ownerUserId = body.owner_user_id;
    if (body.review_due_at !== undefined) r.reviewDueAt = body.review_due_at ? new Date(body.review_due_at) : null;
    if (body.document_id !== undefined) {
      if (body.document_id) await this.documents.assertUsable(r.orgId, String(body.document_id));
      r.documentId = body.document_id || null;
    }
    r.updatedAt = new Date();
    await this.rows.save(r);
    return this.view(r);
  }

  /**
   * Approve a record (Owner/CISO; Admin may edit but not approve the policy).
   * Sets the review date from the type's cycle (the policy follows the
   * appetite's review cycle). Management-review actions become corrective
   * actions in the shared register.
   */
  async approve(user: CurrentUser, id: string, req?: any) {
    this.assert();
    const r = await this.load(user, id);
    this.canEdit(user, r.orgId);
    if (r.type === 'POLICY' && user.role === Role.ADMIN) throw new ForbiddenException('The AI policy is approved by the Owner or CISO');
    if (r.status !== 'DRAFT') throw new ConflictException(`Only a draft can be approved (this one is ${r.status})`);
    // M5 separation of duties: the AI policy is approved by someone other than its author.
    if (r.type === 'POLICY' && r.createdBy === user.email) throw new ForbiddenException('You drafted this AI policy; a different Owner or CISO must approve it');
    const now = new Date();
    const s = (await this.settings.inForce(r.orgId)).settings;
    const months = r.type === 'POLICY' ? s.appetite?.reviewCycleMonths ?? 12 : aimsType(r.type)?.reviewMonths;
    if (!r.reviewDueAt && months) r.reviewDueAt = new Date(now.getTime() + months * MONTH);
    r.status = 'APPROVED';
    r.approvedBy = user.email;
    r.approvedAt = now;
    r.updatedAt = now;
    // Only one approved scope / policy / context at a time: earlier approved ones retire.
    if (['SCOPE', 'POLICY', 'CONTEXT', 'AUDIT_PROGRAMME'].includes(r.type)) {
      for (const old of await this.rows.find({ where: { orgId: r.orgId, type: r.type, status: 'APPROVED' } })) {
        if (old.id === r.id) continue;
        old.status = 'RETIRED';
        old.updatedAt = now;
        await this.rows.save(old);
      }
    }
    await this.rows.save(r);
    const raised: string[] = [];
    if (r.type === 'MGMT_REVIEW' && this.flags.isEnabled('correctiveActions')) {
      for (const a of r.content.actions ?? []) {
        const ca = await this.actions.create(user, {
          source: 'MGMT_REVIEW', source_id: r.id, nonconformity: a.nonconformity ?? `Management review decision: ${a.action}`,
          action: a.action, owner_user_id: a.owner_user_id, due_at: a.due_at,
        });
        raised.push(ca.action_id);
      }
    }
    if (req) req.auditSummary = { aims_record_approval: { record_id: r.id, type: r.type, title: r.title, approved_by: user.email } };
    return { ...this.view(r), corrective_actions_raised: raised };
  }

  /** Management review inputs pre-filled from the board pack (ISO 9.3.2). */
  async mgmtReviewInputs(user: CurrentUser) {
    this.assert();
    const orgId = this.orgOf(user);
    // L5: the inputs cover this organisation only, also for a platform Admin
    // (boardReport scopes by tenant for every role except ADMIN).
    const board = await this.compliance.boardReport({ ...user, role: user.role === Role.ADMIN ? Role.OWNER : user.role, tenantId: orgId }, null);
    const ca = this.flags.isEnabled('correctiveActions') ? await this.actions.orgFacts(orgId) : null;
    const prev = await this.rows.findOne({ where: { orgId, type: 'MGMT_REVIEW', status: 'APPROVED' }, order: { approvedAt: 'DESC' } });
    return {
      org_id: orgId,
      previous_review: prev ? { record_id: prev.id, review_date: prev.content.review_date, actions: prev.content.actions ?? [] } : null,
      inputs: {
        compliance: board.summary,
        frameworks: board.frameworks,
        top_gaps: board.top_gaps,
        incidents: board.incidents,
        grievances: board.grievances,
        gate: board.gate,
        audit_ledger: board.audit,
        corrective_actions: ca,
      },
    };
  }

  /** Organisation facts the ORG controls read. */
  async orgFacts(orgId: string) {
    const rows = await this.rows.find({ where: { orgId, status: 'APPROVED' } });
    const now = Date.now();
    const records: Record<string, { approved: number; overdue: number }> = {};
    for (const t of AIMS_TYPES) {
      const list = rows.filter((r) => r.type === t.type);
      records[t.type] = { approved: list.length, overdue: list.filter((r) => r.reviewDueAt && r.reviewDueAt.getTime() < now).length };
    }
    const policy = rows.find((r) => r.type === 'POLICY');
    const mgmt = rows.filter((r) => r.type === 'MGMT_REVIEW').map((r) => Date.parse(r.content.review_date)).filter((x) => !Number.isNaN(x) && x <= now + 86_400_000);
    const audit = rows.find((r) => r.type === 'AUDIT_PROGRAMME');
    const s = (await this.settings.inForce(orgId)).settings;
    return {
      records,
      policy: policy
        ? { approvedAt: policy.approvedAt?.toISOString().slice(0, 10), approvedBy: policy.approvedBy, overdue: !!policy.reviewDueAt && policy.reviewDueAt.getTime() < now, missingRec14: missingRec14(policy.content) }
        : null,
      lastMgmtReviewAt: mgmt.length ? new Date(Math.max(...mgmt)).toISOString() : null,
      auditProgramme: audit ? { planned: (audit.content.audits ?? []).length, independent: (audit.content.audits ?? []).filter((a: any) => a.auditor_independent === true).length } : null,
      peopleItems: s.peopleItems,
      correctiveActions: this.flags.isEnabled('correctiveActions') ? await this.actions.orgFacts(orgId) : undefined,
      documents: this.flags.isEnabled('documentControl') ? await this.documents.orgFacts(orgId) : undefined,
      // Phase 2 registers (training, DTA register share, framework review); each provider checks its own flag.
      ...((await governanceHooks.extraOrgFacts?.(orgId)) ?? {}),
    };
  }

  /** Evaluate the ORG clauses of every pack in force for the organisation. */
  async orgControls(user: CurrentUser, orgParam?: string) {
    this.assert();
    const orgId = this.orgOf(user, orgParam);
    const now = new Date();
    const ctxPacks = await this.packs.contextFor(orgId, now);
    const packs = packRegistry().activeAt(now).filter((p) => ctxPacks.packIds.includes(p.definition.id));
    const params = resolveForPacks(packs, ctxPacks.extraSources);
    const org = await this.orgFacts(orgId);
    const flags = this.flags.flags;
    const reports = packs
      .map((p) => {
        const ev = evaluatePack(p, ORG_ENTRY, { org }, { flags, params, now, scope: 'ORG' });
        return {
          pack_id: p.definition.id, version: p.definition.version,
          clauses: ev.clauses.map((c) => ({ code: c.code, clause: c.clause, name: c.name, control_id: c.controlId, passed: c.passed, not_assessed: c.notAssessed, evidence: c.evidence, gap: c.passed ? '' : c.gap })),
        };
      })
      .filter((r) => r.clauses.length);
    return { org_id: orgId, evaluated_at: now.toISOString(), packs: reports };
  }

  /** Record the ORG control results (control_results rows with modelId null). */
  async recordOrgControls(user: CurrentUser) {
    const res = await this.orgControls(user);
    const byControl = new Map<string, { passed: boolean; na: boolean; clauses: string[] }>();
    for (const p of res.packs) for (const c of p.clauses) {
      const row = byControl.get(c.control_id) ?? { passed: true, na: false, clauses: [] };
      row.passed = row.passed && c.passed;
      row.na = row.na || c.not_assessed;
      row.clauses.push(`${p.pack_id}:${c.code}`);
      byControl.set(c.control_id, row);
    }
    const now = new Date();
    const versions = Object.fromEntries(res.packs.map((p) => [p.pack_id, p.version]));
    await this.results.save([...byControl.entries()].map(([controlId, r]) => ({
      id: uuidv4(), orgId: res.org_id, modelId: null, controlId, status: r.na ? 'NOT_ASSESSED' : r.passed ? 'PASS' : 'FAIL',
      evidenceRefs: null, clauses: r.clauses, packVersionSet: versions, evaluatedBy: user.email, evaluatedAt: now,
    })));
    return { ...res, recorded: byControl.size };
  }

  async summary(user: CurrentUser, orgParam?: string) {
    this.assert();
    const orgId = this.orgOf(user, orgParam);
    const all = await this.rows.find({ where: { orgId } });
    const now = Date.now();
    return {
      org_id: orgId,
      types: AIMS_TYPES.map((t) => {
        const list = all.filter((r) => r.type === t.type);
        return {
          type: t.type, label: t.label, iso_clauses: t.isoClauses,
          approved: list.filter((r) => r.status === 'APPROVED').length,
          drafts: list.filter((r) => r.status === 'DRAFT').length,
          review_overdue: list.filter((r) => r.status === 'APPROVED' && r.reviewDueAt && r.reviewDueAt.getTime() < now).length,
        };
      }),
    };
  }

  /** Daily review reminders for approved records past their review date, one notification per org. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async reviewReminders(now = new Date()): Promise<number> {
    if (!this.flags.isEnabled('aims')) return 0;
    const due = await this.rows.find({ where: { status: 'APPROVED', reviewDueAt: LessThan(now) } });
    const byOrg = new Map<string, AimsRecordEntity[]>();
    for (const r of due) byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), r]);
    for (const [orgId, list] of byOrg) {
      await this.notifier.notify('aims_review_due', {
        tenant_id: orgId,
        records: list.map((r) => ({ record_id: r.id, type: r.type, title: r.title, review_due_at: r.reviewDueAt!.toISOString() })),
      });
    }
    if (due.length) this.logger.log(`AIMS: ${due.length} record(s) past review date`);
    return due.length;
  }

  /** Records due for review soon or overdue (for the console). */
  async dueSoon(orgId: string, days = 30) {
    const until = new Date(Date.now() + days * 86_400_000);
    return (await this.rows.find({ where: { orgId, status: In(['APPROVED']), reviewDueAt: LessThan(until) } })).map((r) => this.view(r));
  }
}
