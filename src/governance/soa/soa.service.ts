/**
 * Statement of Applicability (E3.1, ISO/IEC 42001 6.1.3 d). Every Annex A
 * control is listed as included or excluded with a justification, and its
 * implementation status comes from the control library's results across the
 * organisation's AI systems. Officers edit justifications and approve a
 * version, which freezes the rows and their hash; PDF and XLSX exports.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { generateGovernancePdf } from '../../compliance/pdf-generator';
import { AIModelEntity, OrganizationEntity, ProjectEntity, SoaEntryEntity, SoaStatementEntity } from '../../database/entities';
import { InventoryService } from '../../inventory/inventory.service';
import { modelEntityToEntry } from '../../inventory/model.mapper';
import { AimsService, ORG_ENTRY } from '../aims/aims.service';
import { getControl } from '../controls/control-library';
import { buildXlsx } from '../disclosures/xlsx';
import { assertFlag } from '../governance-access';
import { resolveForPacks } from '../packs/pack-engine';
import { packRegistry } from '../packs/pack-loader';
import { PacksService } from '../packs/packs.service';
import { OFFICERS, oneOf, optText, orgFor, orgModels, requireRole } from '../phase2-util';
import { ANNEX_A, approvalProblems, buildSoa, ControlTally, MANUAL_STATUSES, SoaEntryInput, SoaRow, soaHash, soaSummary } from './soa.model';

@Injectable()
export class SoaService {
  constructor(
    @InjectRepository(SoaEntryEntity) private readonly entries: Repository<SoaEntryEntity>,
    @InjectRepository(SoaStatementEntity) private readonly statements: Repository<SoaStatementEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>,
    private readonly inventory: InventoryService,
    private readonly aims: AimsService,
    private readonly packs: PacksService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private assert(): void {
    assertFlag(this.flags, 'soa');
  }

  /**
   * A library control is available when some pack clause maps it without a
   * flag, or with a flag that is on. A control whose feature is off counts as
   * not assessed, so it never reads as implemented or as a failure.
   */
  private available(controlId: string): { ok: boolean; opts: Record<string, any> } {
    const flags = this.flags.flags;
    const defs = packRegistry().activeAt().map((p) => p.definition);
    const clauses = defs.flatMap((d) => d.clauses.filter((c) => c.control === controlId).map((c) => ({ c, iso: d.id.startsWith('iso') })));
    const on = clauses.filter(({ c }) => !c.flag || flags[c.flag]);
    const pick = on.find((x) => x.iso) ?? on[0];
    return { ok: on.length > 0, opts: pick?.c.opts ?? {} };
  }

  /** Each Annex A source control's results across the organisation. */
  async tallies(orgId: string, now = new Date()): Promise<Map<string, ControlTally>> {
    const ids = [...new Set(ANNEX_A.flatMap((a) => a.controls))];
    const ctxPacks = await this.packs.contextFor(orgId, now);
    const params = resolveForPacks(packRegistry().activeAt(now).filter((p) => ctxPacks.packIds.includes(p.definition.id)), ctxPacks.extraSources);
    const flags = this.flags.flags;
    const out = new Map<string, ControlTally>();
    const bump = (id: string, k: keyof ControlTally) => {
      const t = out.get(id) ?? { pass: 0, fail: 0, notAssessed: 0 };
      t[k] += 1;
      out.set(id, t);
    };
    const models = await orgModels(this.models, this.projects, orgId);
    const modelIds = ids.filter((id) => getControl(id)?.scope === 'MODEL');
    const orgIds = ids.filter((id) => getControl(id)?.scope === 'ORG');
    for (const m of models) {
      const entry = modelEntityToEntry(m);
      const ctx = await this.inventory.buildValidationContext(m.id);
      for (const id of modelIds) {
        const a = this.available(id);
        if (!a.ok) { bump(id, 'notAssessed'); continue; }
        const o = getControl(id)!.evaluate({ entry, ctx: ctx as any, params, flags, opts: a.opts, now });
        bump(id, o.notAssessed ? 'notAssessed' : o.passed ? 'pass' : 'fail');
      }
    }
    if (orgIds.length) {
      const org = await this.aims.orgFacts(orgId);
      for (const id of orgIds) {
        const a = this.available(id);
        if (!a.ok) { bump(id, 'notAssessed'); continue; }
        const o = getControl(id)!.evaluate({ entry: ORG_ENTRY, ctx: { org }, params, flags, opts: a.opts, now });
        bump(id, o.notAssessed ? 'notAssessed' : o.passed ? 'pass' : 'fail');
      }
    }
    return out;
  }

  private async entryMap(orgId: string): Promise<Map<string, SoaEntryInput>> {
    const rows = await this.entries.find({ where: { orgId } });
    return new Map(rows.map((r) => [r.annexRef, { included: r.included, justification: r.justification, manualStatus: r.manualStatus, manualNote: r.manualNote }]));
  }

  async rows(orgId: string): Promise<SoaRow[]> {
    return buildSoa(await this.entryMap(orgId), await this.tallies(orgId));
  }

  private statementView(s: SoaStatementEntity, withContent = false) {
    return {
      version: s.version, approved_by: s.approvedBy, approved_at: s.approvedAt, content_hash: s.contentHash, note: s.note,
      summary: s.content?.summary ?? null, ...(withContent ? { rows: s.content?.rows ?? [] } : {}),
    };
  }

  private async latest(orgId: string): Promise<SoaStatementEntity | null> {
    return this.statements.findOne({ where: { orgId }, order: { version: 'DESC' } });
  }

  async get(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const rows = await this.rows(orgId);
    const latest = await this.latest(orgId);
    const hash = soaHash(rows);
    return {
      org_id: orgId,
      standard: 'ISO/IEC 42001:2023 Annex A',
      summary: soaSummary(rows),
      rows,
      content_hash: hash,
      approval_problems: approvalProblems(rows),
      approved: latest ? { ...this.statementView(latest), changed_since: latest.contentHash !== hash } : null,
      manual_statuses: MANUAL_STATUSES,
    };
  }

  async update(user: CurrentUser, ref: string, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'edit the Statement of Applicability');
    const orgId = orgFor(user, body.org_id);
    const control = ANNEX_A.find((a) => a.ref === ref);
    if (!control) throw new NotFoundException(`Unknown Annex A control ${ref}`);
    const row = (await this.entries.findOne({ where: { orgId, annexRef: ref } })) ?? this.entries.create({ id: uuidv4(), orgId, annexRef: ref, included: true, justification: null, manualStatus: null, manualNote: null });
    if (body.included !== undefined) {
      if (typeof body.included !== 'boolean') throw new BadRequestException('included must be true or false');
      row.included = body.included;
    }
    if (body.justification !== undefined) row.justification = optText(body.justification, 'justification', 2000);
    if (body.manual_status !== undefined) row.manualStatus = body.manual_status ? oneOf(body.manual_status, MANUAL_STATUSES, 'manual_status') : null;
    if (body.manual_note !== undefined) row.manualNote = optText(body.manual_note, 'manual_note', 2000);
    // ISO 6.1.3 asks for the reason a control is left out.
    if (!row.included && (!row.justification || row.justification.length < 10)) throw new BadRequestException('Excluding a control needs a justification of at least 10 characters');
    row.updatedBy = user.email;
    row.updatedAt = new Date();
    await this.entries.save(row);
    if (req) req.auditSummary = { soa_entry_updated: { ref, included: row.included, manual_status: row.manualStatus } };
    return (await this.rows(orgId)).find((r) => r.ref === ref);
  }

  async approve(user: CurrentUser, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'approve the Statement of Applicability');
    const orgId = orgFor(user, body.org_id);
    const rows = await this.rows(orgId);
    const problems = approvalProblems(rows);
    if (problems.length) throw new BadRequestException({ message: 'The Statement of Applicability cannot be approved yet', problems });
    const latest = await this.latest(orgId);
    const hash = soaHash(rows);
    const s = await this.statements.save(this.statements.create({
      id: uuidv4(), orgId, version: (latest?.version ?? 0) + 1, content: { rows, summary: soaSummary(rows) }, contentHash: hash,
      approvedBy: user.email, approvedAt: new Date(), note: optText(body.note, 'note', 1000),
    }));
    if (req) req.auditSummary = { soa_approved: { version: s.version, content_hash: hash } };
    return this.statementView(s, true);
  }

  async versions(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    return { org_id: orgId, versions: (await this.statements.find({ where: { orgId }, order: { version: 'DESC' } })).map((s) => this.statementView(s)) };
  }

  async version(user: CurrentUser, version: number, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const s = await this.statements.findOne({ where: { orgId, version } });
    if (!s) throw new NotFoundException('No such approved version');
    return this.statementView(s, true);
  }

  /** PDF or XLSX of the live statement, or of an approved version. */
  async export(user: CurrentUser, q: { org_id?: string; format?: string; version?: string }): Promise<{ body: Buffer; type: string; filename: string }> {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const format = (q.format ?? 'pdf').toLowerCase();
    if (!['pdf', 'xlsx'].includes(format)) throw new BadRequestException('format must be pdf or xlsx');
    let rows: SoaRow[];
    let meta: { version: string; approvedBy: string; approvedAt: string; hash: string };
    if (q.version) {
      const s = await this.statements.findOne({ where: { orgId, version: Number(q.version) } });
      if (!s) throw new NotFoundException('No such approved version');
      rows = s.content.rows;
      meta = { version: `v${s.version}`, approvedBy: s.approvedBy, approvedAt: s.approvedAt.toISOString().slice(0, 10), hash: s.contentHash };
    } else {
      rows = await this.rows(orgId);
      meta = { version: 'working draft (not approved)', approvedBy: '—', approvedAt: '—', hash: soaHash(rows) };
    }
    const org = await this.orgs.findOne({ where: { id: orgId } });
    const name = org?.name ?? orgId;
    if (format === 'xlsx') {
      const body = buildXlsx('Statement of Applicability', ['Control', 'Theme', 'Title', 'Included', 'Justification', 'Implementation status', 'Status source', 'Evidencing controls', 'Results (pass / fail / not assessed)', 'Note'],
        rows.map((r) => [r.ref, r.theme, r.title, r.included ? 'Yes' : 'No', r.justification, r.status, r.status_source, r.evidence.controls.join(', '), `${r.evidence.pass} / ${r.evidence.fail} / ${r.evidence.not_assessed}`, r.manual_note ?? '']));
      return { body, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'statement-of-applicability.xlsx' };
    }
    const sum = soaSummary(rows);
    const themes = [...new Set(rows.map((r) => r.theme))];
    const body = await generateGovernancePdf({
      title: 'Statement of Applicability',
      subtitle: `${name} · ISO/IEC 42001:2023 Annex A`,
      facts: [['Version', meta.version], ['Approved by', meta.approvedBy], ['Approved on', meta.approvedAt], ['Content hash', meta.hash],
        ['Summary', `${sum.included} included, ${sum.excluded} excluded; ${sum.implemented} implemented, ${sum.partial} partial, ${sum.not_implemented} not implemented, ${sum.not_assessed} not assessed`]],
      sections: themes.map((t) => ({
        heading: t,
        rows: rows.filter((r) => r.theme === t).map((r) => ({
          title: `${r.ref} ${r.title}: ${r.included ? r.status.replace(/_/g, ' ').toLowerCase() : 'excluded'}`,
          tone: (r.status === 'IMPLEMENTED' ? 'positive' : r.status === 'NOT_IMPLEMENTED' ? 'negative' : 'neutral') as 'positive' | 'negative' | 'neutral',
          lines: [r.justification, r.status_source === 'MANUAL' ? `Status recorded by the organisation${r.manual_note ? `: ${r.manual_note}` : ''}` : r.evidence.controls.length ? `Evidenced by ${r.evidence.controls.join(', ')} (${r.evidence.pass} pass, ${r.evidence.fail} fail, ${r.evidence.not_assessed} not assessed)` : 'No platform control evidences this item.'],
        })),
      })),
      footer: 'Implementation status is derived from SentRAI control results at the time of export. A manual status is shown only where no platform control evidences the item.',
    });
    return { body, type: 'application/pdf', filename: 'statement-of-applicability.pdf' };
  }
}
