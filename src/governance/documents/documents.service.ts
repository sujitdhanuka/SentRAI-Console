/**
 * Document control (E1.8, ISO 7.5): versions, approver and approval date,
 * review and retention dates, and a SHA-256 hash on policies and evidence.
 * Superseded versions are kept; evidence artifacts can point to a controlled
 * document. Review-due reminders run daily.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { In, LessThan, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { NotifierService } from '../../common/notifier.service';
import { AIModelEntity, ControlledDocumentEntity, ProjectEntity } from '../../database/entities';
import { governanceHooks } from '../hooks';
import { assertFlag } from '../governance-access';

export const DOC_TYPES = ['POLICY', 'PROCEDURE', 'EVIDENCE', 'RECORD', 'REPORT', 'OTHER'] as const;
export const DOC_APPROVERS: Role[] = [Role.OWNER, Role.CISO, Role.APPROVER];

const parseDate = (v: any, field: string): Date | null => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} must be a date`);
  return d;
};

@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(ControlledDocumentEntity) private readonly docs: Repository<ControlledDocumentEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    private readonly flags: FeatureFlagsService,
    private readonly notifier: NotifierService,
  ) {}

  onModuleInit(): void {
    governanceHooks.evidenceDocument = async (modelId, documentId) => {
      if (!this.flags.isEnabled('documentControl')) return undefined;
      const model = await this.models.findOne({ where: { id: modelId } });
      const project = model?.projectId ? await this.projects.findOne({ where: { id: model.projectId } }) : null;
      const d = await this.assertUsable(project?.tenantId ?? null, documentId);
      return { document_id: d.id, version: d.version, hash: d.hash };
    };
  }

  private assert(): void {
    assertFlag(this.flags, 'documentControl');
  }

  private orgOf(user: CurrentUser, requested?: string): string {
    const org = user.role === Role.ADMIN && requested ? requested : user.tenantId;
    if (!org) throw new BadRequestException('No organization');
    return org;
  }

  async load(user: CurrentUser, id: string): Promise<ControlledDocumentEntity> {
    const d = await this.docs.findOne({ where: { id } });
    if (!d || (user.role !== Role.ADMIN && d.orgId !== user.tenantId)) throw new NotFoundException('Document not found');
    return d;
  }

  /** A document an evidence artifact or AIMS record may point to: same org and APPROVED (L6). */
  async assertUsable(orgId: string | null, id: string): Promise<ControlledDocumentEntity> {
    const d = await this.docs.findOne({ where: { id } });
    if (!d || d.orgId !== orgId) throw new BadRequestException('document_id is not a controlled document of this organization');
    if (d.status !== 'APPROVED') throw new BadRequestException(`document_id points to a ${d.status.toLowerCase()} document; link the approved version`);
    return d;
  }

  view(d: ControlledDocumentEntity) {
    const now = Date.now();
    return {
      document_id: d.id, series_id: d.seriesId, doc_type: d.docType, title: d.title, description: d.description,
      version: d.version, hash: d.hash, uri: d.uri, status: d.status, approved_by: d.approvedBy, approved_at: d.approvedAt,
      review_due_at: d.reviewDueAt, review_overdue: d.status === 'APPROVED' && !!d.reviewDueAt && d.reviewDueAt.getTime() < now,
      retention_until: d.retentionUntil, supersedes_id: d.supersedesId, created_by: d.createdBy, created_at: d.createdAt, updated_at: d.updatedAt,
    };
  }

  private hashOf(body: Record<string, any>): string {
    if (body.hash) {
      const h = String(body.hash).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(h)) throw new BadRequestException('hash must be a SHA-256 hex digest (64 characters)');
      if (body.content !== undefined && createHash('sha256').update(String(body.content)).digest('hex') !== h) {
        throw new BadRequestException('hash does not match content');
      }
      return h;
    }
    if (body.content !== undefined) return createHash('sha256').update(String(body.content)).digest('hex');
    throw new BadRequestException('Give the document content or its SHA-256 hash');
  }

  async list(user: CurrentUser, q: { doc_type?: string; all_versions?: string; status?: string; org_id?: string }) {
    this.assert();
    const orgId = this.orgOf(user, q.org_id);
    const where: Record<string, any> = { orgId };
    if (q.doc_type) where.docType = q.doc_type;
    if (q.status) where.status = In(q.status.split(','));
    const rows = await this.docs.find({ where, order: { seriesId: 'ASC', version: 'DESC' } });
    const out = q.all_versions === 'true' ? rows : rows.filter((r, i) => rows.findIndex((x) => x.seriesId === r.seriesId) === i);
    return {
      org_id: orgId,
      documents: out.map((d) => this.view(d)),
      review_overdue: rows.filter((d) => this.view(d).review_overdue).length,
    };
  }

  async get(user: CurrentUser, id: string) {
    this.assert();
    const d = await this.load(user, id);
    const versions = await this.docs.find({ where: { seriesId: d.seriesId }, order: { version: 'DESC' } });
    return { ...this.view(d), versions: versions.map((v) => this.view(v)) };
  }

  async create(user: CurrentUser, body: Record<string, any>) {
    this.assert();
    const orgId = this.orgOf(user, body.org_id);
    const docType = String(body.doc_type ?? '').toUpperCase();
    if (!(DOC_TYPES as readonly string[]).includes(docType)) throw new BadRequestException(`doc_type must be one of ${DOC_TYPES.join(', ')}`);
    const title = String(body.title ?? '').trim();
    if (title.length < 3) throw new BadRequestException('title is required');
    const uri = String(body.uri ?? '').trim();
    if (!uri) throw new BadRequestException('uri is required (where the controlled copy lives)');
    const now = new Date();
    const id = uuidv4();
    const d = await this.docs.save({
      id, orgId, seriesId: id, docType, title: title.slice(0, 300), description: body.description ?? null, version: 1,
      hash: this.hashOf(body), uri: uri.slice(0, 1000), status: 'DRAFT', approvedBy: null, approvedAt: null,
      reviewDueAt: parseDate(body.review_due_at, 'review_due_at'), retentionUntil: parseDate(body.retention_until, 'retention_until'),
      supersedesId: null, createdBy: user.email, createdAt: now, updatedAt: now,
    });
    return this.view(d);
  }

  /** New version: a DRAFT that supersedes the current approved version once it is approved. */
  async newVersion(user: CurrentUser, id: string, body: Record<string, any>) {
    this.assert();
    const d = await this.load(user, id);
    const latest = await this.docs.findOne({ where: { seriesId: d.seriesId }, order: { version: 'DESC' } });
    if (latest!.status === 'DRAFT') throw new ConflictException(`Version ${latest!.version} is still a draft; approve or edit it first`);
    const now = new Date();
    const n = await this.docs.save({
      id: uuidv4(), orgId: d.orgId, seriesId: d.seriesId, docType: d.docType, title: (body.title ?? d.title).slice(0, 300),
      description: body.description ?? d.description, version: latest!.version + 1, hash: this.hashOf(body),
      uri: String(body.uri ?? d.uri).slice(0, 1000), status: 'DRAFT', approvedBy: null, approvedAt: null,
      reviewDueAt: parseDate(body.review_due_at, 'review_due_at') ?? d.reviewDueAt,
      retentionUntil: parseDate(body.retention_until, 'retention_until') ?? d.retentionUntil,
      supersedesId: latest!.id, createdBy: user.email, createdAt: now, updatedAt: now,
    });
    return this.view(n);
  }

  async approve(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    const d = await this.load(user, id);
    if (!DOC_APPROVERS.includes(user.role) || user.tenantId !== d.orgId) throw new ForbiddenException('Only the Owner, CISO or an Approver of the organization can approve documents');
    if (d.status !== 'DRAFT') throw new ConflictException(`Only a draft can be approved (this one is ${d.status})`);
    // M5 separation of duties: a policy is approved by someone other than its author.
    if (d.docType === 'POLICY' && d.createdBy === user.email) throw new ForbiddenException('You drafted this policy; a different Owner, CISO or Approver must approve it');
    const now = new Date();
    if (body.review_due_at !== undefined) d.reviewDueAt = parseDate(body.review_due_at, 'review_due_at');
    if (!d.reviewDueAt) d.reviewDueAt = new Date(now.getTime() + 365 * 86_400_000);
    d.status = 'APPROVED';
    d.approvedBy = user.email;
    d.approvedAt = now;
    d.updatedAt = now;
    for (const prev of await this.docs.find({ where: { seriesId: d.seriesId, status: 'APPROVED' } })) {
      if (prev.id === d.id) continue;
      prev.status = 'SUPERSEDED';
      prev.updatedAt = now;
      await this.docs.save(prev);
    }
    await this.docs.save(d);
    if (req) req.auditSummary = { document_approval: { document_id: d.id, series_id: d.seriesId, version: d.version, hash: d.hash, approved_by: user.email } };
    return this.view(d);
  }

  async retire(user: CurrentUser, id: string, reason: string) {
    this.assert();
    const d = await this.load(user, id);
    if (!DOC_APPROVERS.includes(user.role) || user.tenantId !== d.orgId) throw new ForbiddenException('Only the Owner, CISO or an Approver can retire documents');
    if ((reason ?? '').trim().length < 5) throw new BadRequestException('A reason is required');
    // Retiring only stops a document being current; the record is kept (never deleted) for its retention period.
    d.status = 'RETIRED';
    d.description = `${d.description ?? ''}\nRetired: ${reason.trim()}`.trim();
    d.updatedAt = new Date();
    await this.docs.save(d);
    return this.view(d);
  }

  async orgFacts(orgId: string) {
    const rows = await this.docs.find({ where: { orgId, status: 'APPROVED' } });
    const now = Date.now();
    return {
      approved: rows.length,
      policies_approved: rows.filter((r) => r.docType === 'POLICY').length,
      review_overdue: rows.filter((r) => r.reviewDueAt && r.reviewDueAt.getTime() < now).length,
    };
  }

  /** Daily: notify each organisation of approved documents past their review date. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async reviewReminders(now = new Date()): Promise<number> {
    if (!this.flags.isEnabled('documentControl')) return 0;
    const due = await this.docs.find({ where: { status: 'APPROVED', reviewDueAt: LessThan(now) } });
    const byOrg = new Map<string, ControlledDocumentEntity[]>();
    for (const d of due) byOrg.set(d.orgId, [...(byOrg.get(d.orgId) ?? []), d]);
    for (const [orgId, list] of byOrg) {
      await this.notifier.notify('document_review_due', {
        tenant_id: orgId,
        documents: list.map((d) => ({ document_id: d.id, title: d.title, version: d.version, review_due_at: d.reviewDueAt!.toISOString() })),
      });
    }
    if (due.length) this.logger.log(`document control: ${due.length} document(s) past review date`);
    return due.length;
  }
}
