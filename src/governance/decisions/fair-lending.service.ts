/**
 * Fair-lending checks (E2.4, ECOA / Reg B, NIST MEASURE 2.11): a proxy scan
 * over a model's inputs, recorded justifications for flagged features, a
 * disparate-impact result as a typed evidence artifact, and the record of the
 * search for less discriminatory alternatives. Evidence is stored on the
 * model's evidence list (types proxy_scan, disparate_impact, lda_search) so
 * every pack that maps to these controls reuses it.
 */
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AdverseActionNoticeEntity, AIModelEntity, ModelLedgerEventEntity, ProjectEntity } from '../../database/entities';
import { EvidenceArtifact } from '../../domain/model-inventory';
import { assertFlag, modelForUser } from '../governance-access';
import { addModelFacts } from '../hooks';
import { MAINTAINERS, optText, reqText, requireRole } from '../phase2-util';
import { GovernanceSettingsService } from '../settings/settings.service';
import { isCreditDecisioning } from './decisions.model';
import { scanFeatures } from './proxy-scan';

const latestOf = (m: AIModelEntity, type: string): EvidenceArtifact | undefined =>
  [...(m.evidenceArtifacts ?? [])].reverse().find((a) => a.type === type) as EvidenceArtifact | undefined;

@Injectable()
export class FairLendingService implements OnModuleInit {
  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(AdverseActionNoticeEntity) private readonly notices: Repository<AdverseActionNoticeEntity>,
    @InjectRepository(ModelLedgerEventEntity) private readonly ledger: Repository<ModelLedgerEventEntity>,
    private readonly settings: GovernanceSettingsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    addModelFacts(async (modelId) => {
      if (!this.flags.isEnabled('fairLending')) return undefined;
      const m = await this.models.findOne({ where: { id: modelId } });
      return m ? { fairLending: this.facts(m) } : undefined;
    });
  }

  private assert(): void {
    assertFlag(this.flags, 'fairLending');
  }

  facts(m: AIModelEntity) {
    const scan = latestOf(m, 'proxy_scan');
    const di = latestOf(m, 'disparate_impact');
    const lda = latestOf(m, 'lda_search');
    return {
      applicable: isCreditDecisioning(m.functionalArea) || Object.keys(m.reasonCodeMap ?? {}).length > 0,
      scannedAt: scan?.added_at ?? null,
      scanned: scan?.data?.features_scanned ?? 0,
      proxyHits: scan?.data?.hits ?? [],
      disparateImpact: di ? { ratio: di.data?.ratio ?? null, metric: di.data?.metric ?? null } : null,
      ldaSearch: Boolean(lda),
    };
  }

  /** Inputs to scan: declared features, the reason-code map, and features the model's notices weighed. */
  private async inputs(m: AIModelEntity, declared: unknown): Promise<string[]> {
    const out = new Set<string>();
    if (declared !== undefined) {
      if (!Array.isArray(declared) || declared.some((x) => typeof x !== 'string')) throw new BadRequestException('features must be a list of names');
      declared.slice(0, 2000).forEach((f: string) => f.trim() && out.add(f.trim().slice(0, 200)));
    }
    Object.keys(m.reasonCodeMap ?? {}).forEach((f) => out.add(f));
    for (const n of await this.notices.find({ where: { modelId: m.id } })) for (const f of (n.topFactors ?? []) as Array<{ feature: string }>) out.add(f.feature);
    const prev = latestOf(m, 'proxy_scan');
    (prev?.data?.declared_features ?? []).forEach((f: string) => out.add(f));
    return [...out];
  }

  private async save(m: AIModelEntity, artifact: EvidenceArtifact, actor: string) {
    m.evidenceArtifacts = [...(m.evidenceArtifacts ?? []), artifact];
    m.updatedAt = new Date();
    await this.models.save(m);
    await this.ledger.save(this.ledger.create({ id: uuidv4(), modelId: m.id, eventType: 'EVIDENCE_ATTACHED', eventData: { type: artifact.type, ref: artifact.ref }, actor, occurredAt: new Date() }));
  }

  async scan(user: CurrentUser, modelId: string, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'run the proxy scan');
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    const features = await this.inputs(model, body.features);
    if (!features.length) throw new BadRequestException('No inputs to scan: list the model’s features, or map reason codes first');
    const extra = orgId ? (await this.settings.inForce(orgId)).settings.fairLending?.proxyTerms ?? [] : [];
    const prev = latestOf(model, 'proxy_scan');
    const justifications: Record<string, any> = { ...(prev?.data?.justifications ?? {}) };
    const hits = scanFeatures(features, extra).map((h) => ({ ...h, justified: Boolean(justifications[h.feature]), justification: justifications[h.feature]?.text ?? null }));
    const declared = [...new Set([...(prev?.data?.declared_features ?? []), ...(Array.isArray(body.features) ? body.features : [])])];
    const artifact: EvidenceArtifact = {
      type: 'proxy_scan', ref: `sentrai:proxy-scan:${uuidv4()}`, added_at: new Date().toISOString(),
      description: hits.length ? `${hits.length} prohibited-basis or proxy match(es) over ${features.length} input(s)` : `No prohibited-basis or proxy matches over ${features.length} input(s)`,
      data: { features_scanned: features.length, declared_features: declared, hits, justifications, scanned_by: user.email },
    };
    await this.save(model, artifact, user.email);
    return { model_id: modelId, ...artifact.data, unjustified: hits.filter((h) => !h.justified).length, ref: artifact.ref };
  }

  /** Record why a flagged feature is acceptable; the latest scan is re-issued with the justification. */
  async justify(user: CurrentUser, modelId: string, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'justify features');
    const { model } = await modelForUser(this.models, this.projects, user, modelId);
    const prev = latestOf(model, 'proxy_scan');
    if (!prev) throw new BadRequestException('Run the proxy scan first');
    const feature = reqText(body.feature, 'feature', 1, 200);
    if (!(prev.data?.hits ?? []).some((h: any) => h.feature === feature)) throw new BadRequestException('That feature was not flagged by the latest scan');
    const text = reqText(body.justification, 'justification', 20, 2000);
    const justifications = { ...(prev.data?.justifications ?? {}), [feature]: { text, by: user.email, at: new Date().toISOString() } };
    const hits = (prev.data?.hits ?? []).map((h: any) => (h.feature === feature ? { ...h, justified: true, justification: text } : h));
    const artifact: EvidenceArtifact = {
      type: 'proxy_scan', ref: `sentrai:proxy-scan:${uuidv4()}`, added_at: new Date().toISOString(),
      description: `${hits.filter((h: any) => !h.justified).length} unjustified match(es) after justification of ${feature}`,
      data: { ...prev.data, hits, justifications },
    };
    await this.save(model, artifact, user.email);
    return { model_id: modelId, hits, unjustified: hits.filter((h: any) => !h.justified).length };
  }

  /** Disparate-impact result as typed evidence: ratio per protected group against the reference group. */
  async disparateImpact(user: CurrentUser, modelId: string, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record disparate-impact results');
    const { model } = await modelForUser(this.models, this.projects, user, modelId);
    const ratio = Number(body.ratio);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 10) throw new BadRequestException('ratio must be a number between 0 and 10 (the lowest group ratio)');
    const groups = Array.isArray(body.groups) ? body.groups.slice(0, 50).map((g: any) => ({ group: String(g.group ?? '').slice(0, 100), ratio: Number(g.ratio) })).filter((g: any) => g.group && Number.isFinite(g.ratio)) : [];
    const artifact: EvidenceArtifact = {
      type: 'disparate_impact', ref: optText(body.ref, 'ref', 500) ?? `sentrai:disparate-impact:${uuidv4()}`, added_at: new Date().toISOString(),
      description: `Disparate-impact ratio ${ratio}${body.metric ? ` (${String(body.metric).slice(0, 60)})` : ''}`,
      data: { ratio, metric: optText(body.metric, 'metric', 60) ?? 'adverse impact ratio', groups, reference_group: optText(body.reference_group, 'reference_group', 100), sample_size: Number(body.sample_size) || null, tested_by: user.email },
    };
    await this.save(model, artifact, user.email);
    return { model_id: modelId, artifact };
  }

  /** The search for less discriminatory alternatives (Reg B disparate-impact defence). */
  async ldaSearch(user: CurrentUser, modelId: string, body: Record<string, any>) {
    this.assert();
    requireRole(user, MAINTAINERS, 'record the alternatives search');
    const { model } = await modelForUser(this.models, this.projects, user, modelId);
    const alternatives = Array.isArray(body.alternatives) ? body.alternatives.slice(0, 50).map((a: any) => ({ description: String(a.description ?? '').slice(0, 500), ratio: Number(a.ratio) || null, performance: a.performance ?? null })) : [];
    if (!alternatives.length) throw new BadRequestException('List the alternatives considered');
    const artifact: EvidenceArtifact = {
      type: 'lda_search', ref: optText(body.ref, 'ref', 500) ?? `sentrai:lda-search:${uuidv4()}`, added_at: new Date().toISOString(),
      description: `Less discriminatory alternatives searched: ${alternatives.length} considered`,
      data: { alternatives, conclusion: reqText(body.conclusion, 'conclusion', 20, 4000), searched_by: user.email },
    };
    await this.save(model, artifact, user.email);
    return { model_id: modelId, artifact };
  }

  async status(user: CurrentUser, modelId: string) {
    this.assert();
    const { model } = await modelForUser(this.models, this.projects, user, modelId);
    const ev = (t: string) => latestOf(model, t) ?? null;
    return { model_id: modelId, ...this.facts(model), proxy_scan: ev('proxy_scan'), disparate_impact: ev('disparate_impact'), lda_search: ev('lda_search') };
  }
}
