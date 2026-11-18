/**
 * AI training and literacy (E2.6, EU AI Act Art. 4, ISO 42001 7.2 / 7.3,
 * OMB M-25-21 workforce, DTA policy v2.1): a course and policy catalogue with
 * target roles and validity, completion records with evidence, a role by
 * course matrix, self-service policy acknowledgement, overdue reminders and
 * the organisation facts the training and competence controls read.
 */
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { NotifierService } from '../../common/notifier.service';
import { ControlledDocumentEntity, OrganizationEntity, TrainingCourseEntity, TrainingRecordEntity, UserEntity } from '../../database/entities';
import { assertFlag } from '../governance-access';
import { addOrgFacts } from '../hooks';
import { addMonths, MAINTAINERS, OFFICERS, oneOf, optDate, optText, orgFor, orgMember, reqText, requireRole, selfUserId, toCsv } from '../phase2-util';
import { COURSE_KINDS, matrix, statusOf, latestRecords, TRAINING_TOPICS, trainingFacts } from './training.model';

const ALL_ROLES = Object.values(Role) as string[];

@Injectable()
export class TrainingService implements OnModuleInit {
  private readonly logger = new Logger(TrainingService.name);

  constructor(
    @InjectRepository(TrainingCourseEntity) private readonly courses: Repository<TrainingCourseEntity>,
    @InjectRepository(TrainingRecordEntity) private readonly records: Repository<TrainingRecordEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(ControlledDocumentEntity) private readonly docs: Repository<ControlledDocumentEntity>,
    private readonly notifier: NotifierService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addOrgFacts(async (orgId) => {
      if (!this.flags.isEnabled('training')) return undefined;
      return { training: await this.orgFacts(orgId) };
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'training');
  }

  private async load(orgId: string) {
    const [courses, people, records] = await Promise.all([
      this.courses.find({ where: { orgId }, order: { title: 'ASC' } }),
      this.users.find({ where: { tenantId: orgId } }),
      this.records.find({ where: { orgId } }),
    ]);
    return { courses, people, records };
  }

  async orgFacts(orgId: string, now = new Date()) {
    const { courses, people, records } = await this.load(orgId);
    return trainingFacts(courses, people, records, now);
  }

  /* --------------------------------------------------------------- courses */

  private courseView(c: TrainingCourseEntity) {
    return {
      course_id: c.id, org_id: c.orgId, title: c.title, description: c.description, kind: c.kind, target_roles: c.targetRoles ?? [],
      validity_months: c.validityMonths, mandatory: c.mandatory, topic: c.topic, document_id: c.documentId, active: c.active,
      created_by: c.createdBy, created_at: c.createdAt, updated_at: c.updatedAt,
    };
  }

  private parseRoles(v: unknown): string[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((r) => !ALL_ROLES.includes(String(r).toUpperCase()))) throw new BadRequestException(`target_roles must be a list of ${ALL_ROLES.join(', ')}`);
    return [...new Set(v.map((r) => String(r).toUpperCase()))];
  }

  private parseValidity(v: unknown): number | null {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 120) throw new BadRequestException('validity_months must be a whole number of months from 1 to 120');
    return n;
  }

  private async parseDoc(orgId: string, v: unknown): Promise<string | null> {
    if (v === undefined || v === null || v === '') return null;
    const d = await this.docs.findOne({ where: { id: String(v) } });
    if (!d || d.orgId !== orgId) throw new BadRequestException('document_id must be a controlled document of this organization');
    return d.id;
  }

  catalogue() {
    this.assert();
    return { kinds: COURSE_KINDS, topics: TRAINING_TOPICS, roles: ALL_ROLES };
  }

  async listCourses(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    return { org_id: orgId, courses: (await this.courses.find({ where: { orgId }, order: { title: 'ASC' } })).map((c) => this.courseView(c)) };
  }

  async createCourse(user: CurrentUser, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'set training requirements');
    const orgId = orgFor(user, body.org_id);
    const now = new Date();
    const c = await this.courses.save(this.courses.create({
      id: uuidv4(), orgId, title: reqText(body.title, 'title', 3, 200), description: optText(body.description, 'description', 4000),
      kind: oneOf(body.kind, COURSE_KINDS, 'kind', 'COURSE'), targetRoles: this.parseRoles(body.target_roles),
      validityMonths: this.parseValidity(body.validity_months), mandatory: body.mandatory !== false,
      topic: body.topic ? oneOf(String(body.topic).toUpperCase(), TRAINING_TOPICS.map((t) => t.toUpperCase()), 'topic').toLowerCase() : null,
      documentId: await this.parseDoc(orgId, body.document_id), active: true, createdBy: user.email, createdAt: now, updatedAt: now,
    }));
    if (req) req.auditSummary = { training_course_created: { course_id: c.id, title: c.title, mandatory: c.mandatory } };
    return this.courseView(c);
  }

  private async courseInOrg(user: CurrentUser, id: string): Promise<TrainingCourseEntity> {
    const c = await this.courses.findOne({ where: { id } });
    if (!c || c.orgId !== orgFor(user, c.orgId)) throw new NotFoundException('Course not found');
    return c;
  }

  async updateCourse(user: CurrentUser, id: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'set training requirements');
    const c = await this.courseInOrg(user, id);
    if (body.title !== undefined) c.title = reqText(body.title, 'title', 3, 200);
    if (body.description !== undefined) c.description = optText(body.description, 'description', 4000);
    if (body.kind !== undefined) c.kind = oneOf(body.kind, COURSE_KINDS, 'kind');
    if (body.target_roles !== undefined) c.targetRoles = this.parseRoles(body.target_roles);
    if (body.validity_months !== undefined) c.validityMonths = this.parseValidity(body.validity_months);
    if (body.mandatory !== undefined) c.mandatory = body.mandatory === true;
    if (body.topic !== undefined) c.topic = body.topic ? oneOf(String(body.topic).toUpperCase(), TRAINING_TOPICS.map((t) => t.toUpperCase()), 'topic').toLowerCase() : null;
    if (body.document_id !== undefined) c.documentId = await this.parseDoc(c.orgId, body.document_id);
    if (body.active !== undefined) c.active = body.active === true;
    c.updatedAt = new Date();
    await this.courses.save(c);
    if (req) req.auditSummary = { training_course_updated: { course_id: c.id, mandatory: c.mandatory, active: c.active } };
    return this.courseView(c);
  }

  /* --------------------------------------------------------------- records */

  private recordView(r: TrainingRecordEntity) {
    return {
      record_id: r.id, course_id: r.courseId, user_id: r.userId, completed_at: r.completedAt, expires_at: r.expiresAt,
      evidence_doc_id: r.evidenceDocId, evidence_ref: r.evidenceRef, recorded_by: r.recordedBy, created_at: r.createdAt,
    };
  }

  private async save(c: TrainingCourseEntity, userId: string, completedAt: Date, actor: string, evidenceDocId: string | null, evidenceRef: string | null) {
    if (completedAt.getTime() > Date.now() + 60_000) throw new BadRequestException('completed_at cannot be in the future');
    return this.records.save(this.records.create({
      id: uuidv4(), orgId: c.orgId, courseId: c.id, userId, completedAt,
      expiresAt: c.validityMonths ? addMonths(completedAt, c.validityMonths) : null,
      evidenceDocId, evidenceRef, recordedBy: actor, createdAt: new Date(),
    }));
  }

  /** A maintainer records a completion for a member (certificate, LMS export, attendance sheet). */
  async record(user: CurrentUser, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record training');
    const c = await this.courseInOrg(user, String(body.course_id ?? ''));
    const person = await orgMember(this.users, c.orgId, body.user_id, 'user_id');
    const completedAt = optDate(body.completed_at, 'completed_at') ?? new Date();
    const docId = await this.parseDoc(c.orgId, body.evidence_doc_id);
    const ref = optText(body.evidence_ref, 'evidence_ref', 500);
    // A maintainer recording their own completion must point at evidence someone else can check.
    if (person.email?.toLowerCase() === user.email.toLowerCase() && !docId && !ref) throw new BadRequestException('Recording your own completion needs evidence (evidence_doc_id or evidence_ref)');
    if (completedAt.getTime() > Date.now() + 86_400_000) throw new BadRequestException('completed_at cannot be in the future');
    const r = await this.save(c, person.id, completedAt, user.email, docId, ref);
    if (req) req.auditSummary = { training_recorded: { course_id: c.id, user_id: person.id, completed_at: completedAt } };
    return this.recordView(r);
  }

  /** Anyone acknowledges a policy or briefing for themselves; a course needs a recorded completion. */
  async acknowledge(user: CurrentUser, courseId: string, req?: any) {
    this.assert();
    const c = await this.courseInOrg(user, courseId);
    if (!c.active) throw new BadRequestException('This course is retired');
    if (c.kind === 'COURSE') throw new ForbiddenException('Course completions are recorded by a governance maintainer with evidence');
    if (!user.tenantId || user.tenantId !== c.orgId) throw new ForbiddenException('Only members of the organization can acknowledge its policies');
    const me = await selfUserId(this.users, user);
    if (!me) throw new ForbiddenException('No user record for the caller');
    const r = await this.save(c, me, new Date(), user.email, null, 'self-acknowledged');
    if (req) req.auditSummary = { policy_acknowledged: { course_id: c.id, user_id: me } };
    return this.recordView(r);
  }

  async listRecords(user: CurrentUser, q: { org_id?: string; user_id?: string; course_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    // Everyone sees their own history; maintainers see everyone's.
    const self = !MAINTAINERS.includes(user.role);
    const where: Record<string, any> = { orgId };
    if (self) where.userId = (await selfUserId(this.users, user)) ?? '-';
    else if (q.user_id) where.userId = q.user_id;
    if (q.course_id) where.courseId = q.course_id;
    return { org_id: orgId, records: (await this.records.find({ where, order: { completedAt: 'DESC' }, take: 2000 })).map((r) => this.recordView(r)) };
  }

  /* ---------------------------------------------------------------- matrix */

  async matrixView(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const { courses, people, records } = await this.load(orgId);
    const now = new Date();
    const visible = MAINTAINERS.includes(user.role) ? people : people.filter((p) => p.email === user.email);
    const rows = matrix(courses, visible, records, now);
    const byId = new Map(people.map((p) => [p.id, p]));
    return {
      org_id: orgId,
      courses: courses.filter((c) => c.active).map((c) => this.courseView(c)),
      rows: rows.map((r) => ({
        user_id: r.userId, email: byId.get(r.userId)?.email, full_name: byId.get(r.userId)?.fullName, role: byId.get(r.userId)?.role,
        compliant: r.compliant, overdue: r.overdue,
        cells: r.cells.map((c) => ({ course_id: c.courseId, status: c.status, completed_at: c.completedAt, expires_at: c.expiresAt, required: c.required })),
      })),
      facts: trainingFacts(courses, people, records, now),
    };
  }

  /** Per-user compliance badge for the Users page. */
  async userStatus(user: CurrentUser, q: { org_id?: string }) {
    const m = await this.matrixView(user, q);
    return { org_id: m.org_id, users: Object.fromEntries(m.rows.map((r) => [r.user_id, { compliant: r.compliant, overdue: r.overdue, expiring: r.cells.filter((c) => c.status === 'EXPIRING').length }])) };
  }

  async exportMatrix(user: CurrentUser, q: { org_id?: string }) {
    const m = await this.matrixView(user, q);
    const titles = new Map(m.courses.map((c) => [c.course_id, c.title]));
    const rows = m.rows.flatMap((r) => r.cells.map((c) => ({
      email: r.email, name: r.full_name, role: r.role, course: titles.get(c.course_id) ?? c.course_id, required: c.required ? 'yes' : 'no',
      status: c.status, completed_at: c.completed_at, expires_at: c.expires_at,
    })));
    return toCsv([
      { key: 'email', label: 'Email' }, { key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'course', label: 'Course' },
      { key: 'required', label: 'Mandatory' }, { key: 'status', label: 'Status' }, { key: 'completed_at', label: 'Completed' }, { key: 'expires_at', label: 'Expires' },
    ], rows);
  }

  /** Daily: notify each organisation whose staff have mandatory training missing, expired or expiring. */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async reminders(now = new Date()): Promise<number> {
    if (!this.flags.isEnabled('training')) return 0;
    let sent = 0;
    for (const org of await this.orgs.find()) {
      try {
        const { courses, people, records } = await this.load(org.id);
        if (!courses.some((c) => c.active && c.mandatory)) continue;
        const latest = latestRecords(records);
        const due: Array<{ user_id: string; email: string; course: string; status: string }> = [];
        for (const p of people.filter((x) => x.isActive)) {
          for (const c of courses.filter((x) => x.active && x.mandatory && (!x.targetRoles?.length || x.targetRoles.includes(p.role)))) {
            const s = statusOf(latest.get(`${c.id}|${p.id}`), now);
            if (s !== 'CURRENT') due.push({ user_id: p.id, email: p.email, course: c.title, status: s });
          }
        }
        if (!due.length) continue;
        await this.notifier.notify('training_due', { tenant_id: org.id, due: due.slice(0, 500), total: due.length });
        sent++;
      } catch (e) {
        this.logger.warn(`Training reminder skipped for org ${org.id}: ${String(e).slice(0, 200)}`);
      }
    }
    if (sent) this.logger.log(`Training reminders sent to ${sent} org(s)`);
    return sent;
  }
}
