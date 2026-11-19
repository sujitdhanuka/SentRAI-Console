/**
 * Australia pack services (E2.1, DTA policy v2.1): the internal AI use case
 * register (view and CSV / XLSX export with the minimum fields), the record
 * that it was shared with the DTA plus a reminder when the next share is due,
 * the high-risk use case report record, bulk in-scope assessment with
 * deadline tracking for existing use cases (30 April 2027), and the
 * register-backed facts the au-dta pack controls read.
 */
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { RiskLevel, Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { NotifierService } from '../../common/notifier.service';
import {
  AIModelEntity,
  ImpactAssessmentEntity,
  OrganizationEntity,
  ProjectEntity,
  RegulatorySubmissionEntity,
  UserEntity,
} from '../../database/entities';
import { assertFlag, modelForUser } from '../governance-access';
import { addModelFacts, addOrgFacts } from '../hooks';
import { ImpactAssessmentService } from '../impact/impact.service';
import { canonicalJson } from '../packs/pack-loader';
import { phase2Param } from '../packs/parameter-resolver';
import { PacksService } from '../packs/packs.service';
import { addMonths, DAY_MS, OFFICERS, optText, orgFor, scopedOrgModels, orgParams, packApplies, reqText, requireRole, toCsv } from '../phase2-util';
import { AU_ETHICS_PRINCIPLES, AU_TECHNICAL_STANDARD_STAGES, auHighRiskArea } from './au-reference';
import { buildXlsx } from './xlsx';

export const AU_PACK_ID = 'au-dta';
/** DTA policy v2.1: existing use cases must be assessed against the in-scope criteria by this date (IA-2). */
export const AU_EXISTING_USE_CASE_DEADLINE = '2027-04-30';

const REGISTER_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'use_case_id', label: 'Use case ID' },
  { key: 'name', label: 'Use case name' },
  { key: 'description', label: 'Description' },
  { key: 'usage_pattern', label: 'Usage pattern (Appendix D)' },
  { key: 'domain', label: 'Domain (Appendix D)' },
  { key: 'in_scope', label: 'In scope (Appendix C)' },
  { key: 'risk_rating', label: 'Risk rating' },
  { key: 'high_risk', label: 'High-risk use case' },
  { key: 'accountable_owner', label: 'Accountable use case owner' },
  { key: 'accountable_official', label: 'Accountable official' },
  { key: 'lifecycle_stage', label: 'Status' },
  { key: 'impact_assessment', label: 'Impact assessment' },
  { key: 'last_review', label: 'Last review' },
  { key: 'reported_to_dta', label: 'Reported to DTA' },
  { key: 'updated_at', label: 'Last updated' },
];

const isHigh = (r: string) => r === RiskLevel.HIGH || r === RiskLevel.CRITICAL;
const d10 = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

@Injectable()
export class AuDtaService implements OnModuleInit {
  private readonly logger = new Logger(AuDtaService.name);

  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(ImpactAssessmentEntity) private readonly ias: Repository<ImpactAssessmentEntity>,
    @InjectRepository(RegulatorySubmissionEntity) private readonly submissions: Repository<RegulatorySubmissionEntity>,
    private readonly impact: ImpactAssessmentService,
    private readonly packs: PacksService,
    private readonly notifier: NotifierService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addModelFacts(async (modelId, orgId) => {
      if (!this.flags.isEnabled('auPack') || !orgId) return undefined;
      return { auDta: await this.modelFacts(modelId, orgId) };
    });
    addOrgFacts(async (orgId) => {
      if (!this.flags.isEnabled('auPack')) return {};
      const out: Record<string, any> = { dtaRegister: await this.shareStatus(orgId) };
      if (this.flags.isEnabled('accountability')) {
        const org = await this.orgs.findOne({ where: { id: orgId } });
        out.accountableOfficial = Boolean(org?.accountableOfficialUserId);
      }
      return out;
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'auPack');
  }

  /* ---------------------------------------------------------------- facts */

  /** Latest non-draft assessment that answered the au-dta questionnaire. */
  private async latestAuAssessment(modelId: string): Promise<ImpactAssessmentEntity | null> {
    const rows = await this.ias.find({ where: { modelId }, order: { version: 'DESC' } });
    return rows.find((r) => !['DRAFT', 'SUPERSEDED'].includes(r.status) && (r.packIds ?? []).includes('au-dta')) ?? null;
  }

  private async lastReview(modelId: string): Promise<Date | null> {
    const rows = await this.ias.find({ where: { modelId, status: In(['FINAL', 'SUPERSEDED', 'REVALIDATION_REQUIRED']) }, order: { signedAt: 'DESC' } });
    return rows.find((r) => r.signedAt)?.signedAt ?? null;
  }

  private async lastReport(modelId: string): Promise<RegulatorySubmissionEntity | null> {
    return this.submissions.findOne({ where: { modelId, kind: 'DTA_HIGH_RISK_REPORT' }, order: { submittedAt: 'DESC' } });
  }

  async modelFacts(modelId: string, orgId: string) {
    const m = await this.models.findOne({ where: { id: modelId } });
    const ia = await this.latestAuAssessment(modelId);
    const report = await this.lastReport(modelId);
    const params = await orgParams(this.packs, orgId);
    return {
      inScope: ia?.inScope ?? null,
      assessedAt: ia?.signedAt ?? null,
      iaStatus: ia?.status ?? null,
      ownerNamed: m?.ownerUserId ?? null,
      reportedToDta: report?.submittedAt ?? null,
      lastReviewAt: await this.lastReview(modelId),
      reviewMonths: phase2Param(params, 'highRiskReviewMonths'),
    };
  }

  /* ------------------------------------------------------------- register */

  async register(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const org = await this.orgs.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    const models = await scopedOrgModels(this.models, this.projects, orgId);
    const userIds = [...new Set([...models.map((m) => m.ownerUserId), org.accountableOfficialUserId].filter((x): x is string => !!x))];
    const people = userIds.length ? await this.users.find({ where: { id: In(userIds) } }) : [];
    const who = (id: string | null | undefined) => {
      const u = people.find((p) => p.id === id);
      return u ? `${u.fullName} <${u.email}>` : null;
    };
    const rows: any[] = [];
    for (const m of models) {
      const ia = await this.latestAuAssessment(m.id);
      const latest = (await this.ias.find({ where: { modelId: m.id }, order: { version: 'DESC' }, take: 1 }))[0] ?? null;
      const report = await this.lastReport(m.id);
      const cp = (m.contextProfile ?? {}) as Record<string, any>;
      const inScope = ia?.inScope ?? null;
      rows.push({
        use_case_id: m.id,
        name: m.name,
        description: m.useCaseDescription,
        usage_pattern: cp.dtaUsagePattern ?? null,
        domain: cp.dtaDomain ?? null,
        in_scope: inScope === null ? 'Not assessed' : inScope ? 'Yes' : 'No',
        risk_rating: m.riskLevel,
        high_risk: inScope === true && isHigh(m.riskLevel) ? 'Yes' : 'No',
        accountable_owner: who(m.ownerUserId),
        accountable_official: who(org.accountableOfficialUserId),
        lifecycle_stage: m.lifecycleStage,
        impact_assessment: latest ? `v${latest.version} ${latest.status}` : null,
        last_review: d10(await this.lastReview(m.id)),
        reported_to_dta: d10(report?.submittedAt),
        updated_at: d10(m.updatedAt),
        triage_hint: auHighRiskArea(m.functionalArea),
      });
    }
    const share = await this.shareStatus(orgId);
    return {
      org_id: orgId,
      organization: org.name,
      generated_at: new Date().toISOString(),
      pack_enabled: await packApplies(this.packs, orgId, AU_PACK_ID),
      columns: REGISTER_COLUMNS,
      rows,
      share,
    };
  }

  async exportRegister(user: CurrentUser, q: { org_id?: string; format?: string }): Promise<{ contentType: string; filename: string; body: Buffer | string }> {
    const reg = await this.register(user, q);
    const format = (q.format ?? 'csv').toLowerCase();
    const stamp = reg.generated_at.slice(0, 10);
    if (format === 'csv') {
      return { contentType: 'text/csv; charset=utf-8', filename: `dta-ai-register-${stamp}.csv`, body: toCsv(REGISTER_COLUMNS, reg.rows) };
    }
    if (format === 'xlsx') {
      const body = buildXlsx('AI use case register', REGISTER_COLUMNS.map((c) => c.label), reg.rows.map((r) => REGISTER_COLUMNS.map((c) => (r as any)[c.key])));
      return { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `dta-ai-register-${stamp}.xlsx`, body };
    }
    throw new BadRequestException('format must be csv or xlsx');
  }

  /** When the register was last shared with the DTA and when the next share is due. */
  async shareStatus(orgId: string) {
    const last = await this.submissions.findOne({ where: { orgId, kind: 'DTA_REGISTER_SHARE' }, order: { submittedAt: 'DESC' } });
    const intervalMonths = phase2Param(await orgParams(this.packs, orgId), 'dtaRegisterShareMonths');
    const nextDueAt = last ? addMonths(last.submittedAt, intervalMonths) : null;
    return {
      lastSharedAt: last?.submittedAt ?? null,
      lastReference: last?.reference ?? null,
      intervalMonths,
      nextDueAt,
      overdue: !last || (nextDueAt !== null && nextDueAt.getTime() < Date.now()),
    };
  }

  /** Record that the register was shared with the DTA (hash of the register as shared). */
  async recordShare(user: CurrentUser, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'record a register share');
    const reg = await this.register(user, { org_id: body.org_id });
    const reference = reqText(body.reference, 'reference', 3, 200);
    const payload = { columns: reg.columns.map((c) => c.key), rows: reg.rows };
    const now = new Date();
    const row = await this.submissions.save({
      id: uuidv4(), orgId: reg.org_id, kind: 'DTA_REGISTER_SHARE', modelId: null, submittedAt: now, submittedBy: user.email,
      recipient: optText(body.recipient, 'recipient', 200) ?? 'Digital Transformation Agency', reference, notes: optText(body.notes, 'notes'),
      payloadHash: createHash('sha256').update(canonicalJson(payload)).digest('hex'), payload: { use_cases: reg.rows.length }, createdAt: now,
    });
    if (req) req.auditSummary = { dta_register_shared: { submission_id: row.id, reference, use_cases: reg.rows.length, hash: row.payloadHash } };
    return { submission_id: row.id, submitted_at: now, reference, payload_hash: row.payloadHash, use_cases: reg.rows.length, share: await this.shareStatus(reg.org_id) };
  }

  /**
   * IA-11: once deployment is decided, a high-risk use case is reported to the
   * DTA through the accountable official, so only that person may record it.
   */
  async recordHighRiskReport(user: CurrentUser, modelId: string, body: Record<string, any>, req?: any) {
    this.assert();
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    if (!orgId) throw new BadRequestException('The model is not in an organization');
    const org = await this.orgs.findOne({ where: { id: orgId } });
    if (!org?.accountableOfficialUserId) throw new BadRequestException('Designate an accountable official first: the report goes through them');
    const official = await this.users.findOne({ where: { id: org.accountableOfficialUserId } });
    if (!official || official.email.toLowerCase() !== user.email.toLowerCase()) throw new ForbiddenException('Only the accountable official can record the report to the DTA');
    const ia = await this.latestAuAssessment(modelId);
    if (ia?.inScope !== true || !isHigh(model.riskLevel)) {
      throw new BadRequestException('Only in-scope HIGH or CRITICAL use cases are reported to the DTA (answer the in-scope test first)');
    }
    const reasons = reqText(body.reasons, 'reasons (why the use case is high risk)', 10);
    const mitigations = reqText(body.mitigations, 'mitigations', 10);
    const now = new Date();
    const payload = { model_id: modelId, name: model.name, risk: model.riskLevel, reasons, mitigations, residual_risk: optText(body.residual_risk, 'residual_risk') };
    const row = await this.submissions.save({
      id: uuidv4(), orgId, kind: 'DTA_HIGH_RISK_REPORT', modelId, submittedAt: now, submittedBy: user.email,
      recipient: 'Digital Transformation Agency', reference: optText(body.reference, 'reference', 200), notes: optText(body.notes, 'notes'),
      payloadHash: createHash('sha256').update(canonicalJson(payload)).digest('hex'), payload, createdAt: now,
    });
    if (req) req.auditSummary = { dta_high_risk_report: { submission_id: row.id, model_id: modelId, reported_by: user.email } };
    return this.submissionView(row);
  }

  submissionView(r: RegulatorySubmissionEntity) {
    return {
      submission_id: r.id, org_id: r.orgId, kind: r.kind, model_id: r.modelId, submitted_at: r.submittedAt, submitted_by: r.submittedBy,
      recipient: r.recipient, reference: r.reference, notes: r.notes, payload_hash: r.payloadHash, payload: r.payload,
    };
  }

  async submissionsList(user: CurrentUser, q: { org_id?: string; model_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const where: Record<string, any> = { orgId };
    if (q.model_id) where.modelId = q.model_id;
    return { org_id: orgId, submissions: (await this.submissions.find({ where, order: { submittedAt: 'DESC' } })).map((r) => this.submissionView(r)) };
  }

  /* ----------------------------------------------------- in-scope tracker */

  /** IA-1, IA-2, IA-13: every use case's in-scope status against the deadline for existing use cases. */
  async inScopeTracker(user: CurrentUser, q: { org_id?: string; deadline?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const deadline = new Date(q.deadline ?? AU_EXISTING_USE_CASE_DEADLINE);
    if (Number.isNaN(deadline.getTime())) throw new BadRequestException('deadline must be a date');
    const models = await scopedOrgModels(this.models, this.projects, orgId);
    const rows: any[] = [];
    for (const m of models) {
      const ia = await this.latestAuAssessment(m.id);
      const draft = await this.ias.findOne({ where: { modelId: m.id, status: 'DRAFT' } });
      const draftHasAu = !!draft && (draft.packIds ?? []).includes('au-dta');
      const state = ia ? (ia.status === 'REVALIDATION_REQUIRED' ? 'REASSESS' : 'ASSESSED') : draftHasAu ? 'IN_PROGRESS' : 'NOT_STARTED';
      rows.push({
        model_id: m.id, name: m.name, risk_level: m.riskLevel, lifecycle_stage: m.lifecycleStage,
        in_scope: ia?.inScope ?? null, state, assessment_id: ia?.id ?? draft?.id ?? null,
        assessed_at: ia?.signedAt ?? null, high_risk_area: auHighRiskArea(m.functionalArea),
        needs_action: state !== 'ASSESSED',
      });
    }
    const days = Math.ceil((deadline.getTime() - Date.now()) / DAY_MS);
    return {
      org_id: orgId,
      deadline: deadline.toISOString().slice(0, 10),
      days_left: days,
      summary: {
        total: rows.length,
        assessed: rows.filter((r) => r.state === 'ASSESSED').length,
        in_scope: rows.filter((r) => r.in_scope === true).length,
        out_of_scope: rows.filter((r) => r.in_scope === false).length,
        outstanding: rows.filter((r) => r.needs_action).length,
        overdue: days < 0 ? rows.filter((r) => r.needs_action).length : 0,
      },
      use_cases: rows,
    };
  }

  /** Start a draft impact assessment with the au-dta questionnaire for every outstanding use case (or the ones named). */
  async bulkStart(user: CurrentUser, body: Record<string, any>) {
    this.assert();
    if (![Role.OWNER, Role.CISO, Role.ADMIN, Role.APPROVER, Role.REVIEWER].includes(user.role)) throw new ForbiddenException('You cannot start assessments');
    const tracker = await this.inScopeTracker(user, { org_id: body.org_id });
    const wanted: string[] | null = Array.isArray(body.model_ids) ? body.model_ids.map(String) : null;
    const started: string[] = [];
    const skipped: Array<{ model_id: string; reason: string }> = [];
    for (const r of tracker.use_cases) {
      if (wanted && !wanted.includes(r.model_id)) continue;
      if (r.state !== 'NOT_STARTED' && r.state !== 'REASSESS') { skipped.push({ model_id: r.model_id, reason: r.state.toLowerCase() }); continue; }
      try {
        const ia = await this.impact.create(user, { model_id: r.model_id, questionnaires: ['au-dta'] });
        started.push(ia.assessment_id);
      } catch (e) {
        skipped.push({ model_id: r.model_id, reason: e instanceof Error ? e.message : 'failed' });
      }
    }
    return { started: started.length, assessment_ids: started, skipped };
  }

  reference() {
    this.assert();
    return {
      pack_id: AU_PACK_ID,
      note: 'Paraphrased reference content and an indicative SentRAI mapping; confirm with your compliance reviewer before relying on it.',
      ethics_principles: AU_ETHICS_PRINCIPLES,
      technical_standard: AU_TECHNICAL_STANDARD_STAGES,
      existing_use_case_deadline: AU_EXISTING_USE_CASE_DEADLINE,
    };
  }

  /* ------------------------------------------------------------- reminders */

  /** Daily: one reminder per organisation whose register share is due within 14 days or overdue. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async shareReminders(now = new Date()): Promise<number> {
    if (!this.flags.isEnabled('auPack')) return 0;
    let sent = 0;
    for (const org of await this.orgs.find()) {
      // One organisation's bad settings must not stop reminders for the rest.
      try {
        if (!(await packApplies(this.packs, org.id, AU_PACK_ID, now))) continue;
        const s = await this.shareStatus(org.id);
        const soon = s.nextDueAt ? s.nextDueAt.getTime() - now.getTime() < 14 * DAY_MS : true;
        if (!soon) continue;
        await this.notifier.notify('dta_register_share_due', { tenant_id: org.id, last_shared_at: s.lastSharedAt, next_due_at: s.nextDueAt, overdue: s.overdue });
        sent++;
      } catch (e) {
        this.logger.warn(`DTA share reminder skipped for org ${org.id}: ${String(e).slice(0, 200)}`);
      }
    }
    if (sent) this.logger.log(`DTA register share reminders: ${sent}`);
    return sent;
  }
}
