/**
 * Federal-vendor support (E3.8): the external-AI policy (settings
 * externalAi.mode, with ATTESTED_ONLY honouring current no-training
 * attestations) enforced on every AI provider path through the
 * externalAiPolicy hook; the attestation register; and the full
 * organisation data export (one JSON file per table, secrets removed).
 */
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import AdmZip from 'adm-zip';
import { createHash } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AiProviderAttestationEntity, AiProviderConfigEntity } from '../../database/entities';
import { isPolicyLocalEndpoint } from '../../ai/ai-providers.service';
import { DocumentsService } from '../documents/documents.service';
import { assertFlag } from '../governance-access';
import { externalCallAllowed, governanceHooks } from '../hooks';
import { OFFICERS, optDate, orgFor, reqText, requireRole } from '../phase2-util';
import { GovernanceSettingsService } from '../settings/settings.service';
import { attestationCurrent, attestedProviders, providerEndpoint, scrubRow } from './federal.model';

const CHUNK = 400;

@Injectable()
export class FederalVendorService implements OnModuleInit {
  constructor(
    @InjectRepository(AiProviderAttestationEntity) private readonly atts: Repository<AiProviderAttestationEntity>,
    @InjectRepository(AiProviderConfigEntity) private readonly providers: Repository<AiProviderConfigEntity>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: GovernanceSettingsService,
    private readonly documents: DocumentsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    governanceHooks.externalAiPolicy = async (tenantId) => {
      if (!tenantId || !this.flags.isEnabled('federalVendor')) return undefined;
      const mode = (await this.settings.inForce(tenantId)).settings.externalAi?.mode;
      if (!mode || mode === 'ALLOWED') return undefined;
      return { mode, attestedProviderIds: await this.attestedIds(tenantId) };
    };
  }

  private assert(): void {
    assertFlag(this.flags, 'federalVendor');
  }

  private async endpoints(orgId: string): Promise<Map<string, string>> {
    return new Map((await this.providers.find({ where: { tenantId: orgId } })).map((p) => [p.id, providerEndpoint(p)]));
  }

  private async attestedIds(orgId: string): Promise<string[]> {
    return attestedProviders(await this.atts.find({ where: { orgId } }), new Date(), await this.endpoints(orgId));
  }

  private view(a: AiProviderAttestationEntity, endpoints: Map<string, string>, now = new Date()) {
    const current = attestationCurrent(a, now, endpoints.get(a.providerId) ?? '\u0000');
    const moved = a.noTraining && !a.revokedAt && !(a.expiresAt && a.expiresAt <= now) && !current;
    return {
      attestation_id: a.id, provider_id: a.providerId, no_training: a.noTraining, retention_days: a.retentionDays, reference: a.reference,
      document_id: a.documentId, attested_by: a.attestedBy, attested_at: a.attestedAt, expires_at: a.expiresAt, revoked_at: a.revokedAt,
      status: a.revokedAt ? 'REVOKED' : a.expiresAt && a.expiresAt <= now ? 'EXPIRED' : current ? 'CURRENT' : moved ? 'PROVIDER_CHANGED' : 'NOT_NO_TRAINING',
    };
  }

  /** The policy in force and what it means for each of the organisation's providers. */
  async policy(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const mode = (await this.settings.inForce(orgId)).settings.externalAi?.mode ?? 'ALLOWED';
    const attested = await this.attestedIds(orgId);
    const policy = { mode, attestedProviderIds: attested };
    const provs = await this.providers.find({ where: { tenantId: orgId } });
    return {
      org_id: orgId, mode,
      providers: provs.map((p) => {
        const local = isPolicyLocalEndpoint(p.baseUrl);
        return { provider_id: p.id, label: p.label, base_url_host: hostOf(p.baseUrl), local, attested: attested.includes(p.id), allowed: externalCallAllowed(policy, local, p.id) };
      }),
    };
  }

  async list(user: CurrentUser, q: { org_id?: string }) {
    this.assert();
    const orgId = orgFor(user, q.org_id);
    const rows = await this.atts.find({ where: { orgId }, order: { attestedAt: 'DESC' } });
    const endpoints = await this.endpoints(orgId);
    return { org_id: orgId, attestations: rows.map((r) => this.view(r, endpoints)) };
  }

  async create(user: CurrentUser, body: Record<string, any>, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'record provider attestations');
    const orgId = orgFor(user, body.org_id);
    const p = await this.providers.findOne({ where: { id: String(body.provider_id ?? '') } });
    if (!p || p.tenantId !== orgId) throw new BadRequestException('provider_id must be one of this organization\'s AI providers');
    if (typeof body.no_training !== 'boolean') throw new BadRequestException('no_training must be true or false');
    let retention: number | null = null;
    if (body.retention_days !== undefined && body.retention_days !== null && body.retention_days !== '') {
      retention = Number(body.retention_days);
      if (!Number.isInteger(retention) || retention < 0 || retention > 3650) throw new BadRequestException('retention_days must be 0 to 3650');
    }
    const expires = optDate(body.expires_at, 'expires_at');
    if (expires && expires <= new Date()) throw new BadRequestException('expires_at must be in the future');
    let documentId: string | null = null;
    if (body.document_id) documentId = (await this.documents.assertUsable(orgId, String(body.document_id))).id;
    const a = await this.atts.save(this.atts.create({
      id: uuidv4(), orgId, providerId: p.id, noTraining: body.no_training, retentionDays: retention,
      reference: reqText(body.reference, 'reference', 3, 500), endpoint: providerEndpoint(p), documentId, attestedBy: user.email, attestedAt: new Date(), expiresAt: expires, revokedAt: null,
    }));
    if (req) req.auditSummary = { provider_attestation_recorded: { attestation_id: a.id, provider_id: p.id, no_training: a.noTraining } };
    return this.view(a, await this.endpoints(orgId));
  }

  async revoke(user: CurrentUser, id: string, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'revoke provider attestations');
    const a = await this.atts.findOne({ where: { id } });
    if (!a || a.orgId !== orgFor(user, a.orgId)) throw new NotFoundException('Attestation not found');
    if (a.revokedAt) throw new BadRequestException('The attestation is already revoked');
    a.revokedAt = new Date();
    await this.atts.save(a);
    if (req) req.auditSummary = { provider_attestation_revoked: { attestation_id: a.id, provider_id: a.providerId } };
    return this.view(a, await this.endpoints(a.orgId));
  }

  /**
   * Every row the organisation owns, one JSON file per table, with a manifest
   * of row counts and SHA-256 per file. Secret columns (password hashes,
   * encrypted keys and webhook secrets) and URL credentials are removed.
   * Tables with no organisation (pack versions) are listed as skipped.
   */
  async exportOrg(user: CurrentUser, q: { org_id?: string }, req?: any) {
    this.assert();
    requireRole(user, OFFICERS, 'export organisation data');
    const orgId = orgFor(user, q.org_id);
    const org = await this.ds.query('SELECT id FROM organizations WHERE id = ?', [orgId]).catch(() => []);
    if (!org.length) throw new NotFoundException('Organization not found');
    const fetch = async (table: string, column: string, values: string[]) => {
      const out: any[] = [];
      for (let i = 0; i < values.length; i += CHUNK) {
        const part = values.slice(i, i + CHUNK);
        if (!part.length) continue;
        out.push(...(await this.ds.getRepository(table).find({ where: { [column]: In(part) } as any })));
      }
      return out;
    };
    const projectIds = (await this.ds.getRepository('ProjectEntity').find({ where: { tenantId: orgId }, select: ['id'] as any })).map((p: any) => p.id);
    const modelIds = (await fetch('AIModelEntity', 'projectId', projectIds)).map((m: any) => m.id);
    const riskIds = (await this.ds.getRepository('RiskEntity').find({ where: { orgId }, select: ['id'] as any })).map((r: any) => r.id);
    const emails = (await this.ds.getRepository('UserEntity').find({ where: { tenantId: orgId }, select: ['email'] as any })).map((u: any) => u.email);

    const zip = new AdmZip();
    const manifest: Array<{ table: string; scope: string; rows: number; sha256: string }> = [];
    const skipped: string[] = [];
    for (const meta of [...this.ds.entityMetadatas].sort((a, b) => a.tableName.localeCompare(b.tableName))) {
      const cols = new Set(meta.columns.map((c) => c.propertyName));
      const name = meta.target as any;
      // Every way a row can belong to the organisation counts (a manually reported
      // incident has no project but has a model; some rows carry a null tenant).
      const scopes: Array<[string, string[]]> = [];
      if (meta.tableName === 'organizations') scopes.push(['id', [orgId]]);
      else {
        if (cols.has('orgId')) scopes.push(['orgId', [orgId]]);
        if (cols.has('tenantId')) scopes.push(['tenantId', [orgId]]);
        if (cols.has('projectId')) scopes.push(['projectId', projectIds]);
        if (cols.has('modelId')) scopes.push(['modelId', modelIds]);
        if (cols.has('riskId')) scopes.push(['riskId', riskIds]);
        if (meta.tableName === 'audit_events') scopes.push(['actor', emails]);
      }
      if (meta.tableName === 'ai_models') scopes.push(['projectId', projectIds]);
      if (!scopes.length) { skipped.push(meta.tableName); continue; }
      const key = (r: any) => meta.primaryColumns.map((c) => String(r[c.propertyName])).join('|');
      const byKey = new Map<string, any>();
      for (const [col, vals] of scopes) for (const r of await fetch(name, col, vals)) byKey.set(key(r), r);
      const rows = [...byKey.values()];
      const scope = scopes.map(([c]) => c).filter((c, i, a) => a.indexOf(c) === i).join(' or ');
      const body = Buffer.from(JSON.stringify(rows.map((r) => scrubRow(r)), null, 2));
      zip.addFile(`${meta.tableName}.json`, body);
      manifest.push({ table: meta.tableName, scope, rows: rows.length, sha256: createHash('sha256').update(body).digest('hex') });
    }
    const generatedAt = new Date().toISOString();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ org_id: orgId, generated_at: generatedAt, generated_by: user.email, tables: manifest, skipped, secrets_removed: true }, null, 2)));
    if (req) req.auditSummary = { org_data_exported: { org_id: orgId, tables: manifest.length, rows: manifest.reduce((a, m) => a + m.rows, 0) } };
    return { filename: `sentrai-org-export-${generatedAt.slice(0, 10)}.zip`, type: 'application/zip', body: zip.toBuffer() };
  }
}

function hostOf(u: string): string | null {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}
