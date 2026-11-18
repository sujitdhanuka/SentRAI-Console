/**
 * Pack engine service (E1.1): lists packs and versions with their hashes and
 * diffs, exposes the control library with the clauses that map to each
 * control, resolves parameters (strictest wins, naming the pack that set each
 * value) and evaluates a model's controls once for every pack in force,
 * optionally as of a past date.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  AIModelEntity,
  ControlResultEntity,
  PackVersionEntity,
  ProjectEntity,
} from '../../database/entities';
import { InventoryService } from '../../inventory/inventory.service';
import { modelEntityToEntry } from '../../inventory/model.mapper';
import { listControls } from '../controls/control-library';
import { assertFlag, modelForUser } from '../governance-access';
import { diffPacks } from './pack-diff';
import { evaluatePack, resolveForPacks } from './pack-engine';
import { BASELINE_PACK_IDS, packRegistry } from './pack-loader';
import { LoadedPackVersion } from './pack.types';
import { parameterSpec } from './parameter-resolver';

/** Hook later epics (governance settings) use to narrow packs and add parameter sources per org. */
export interface OrgPackContext {
  packIds: string[];
  extraSources: Array<{ source: string; version?: string; parameters: Record<string, any> }>;
}
export type OrgPackContextProvider = (orgId: string | null, at: Date) => Promise<OrgPackContext>;

@Injectable()
export class PacksService {
  private synced = false;
  private orgContext: OrgPackContextProvider | null = null;

  constructor(
    @InjectRepository(PackVersionEntity) private readonly versions: Repository<PackVersionEntity>,
    @InjectRepository(ControlResultEntity) private readonly results: Repository<ControlResultEntity>,
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    private readonly inventory: InventoryService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /** Governance settings (E1.2) registers how an org narrows packs and tightens parameters. */
  setOrgContextProvider(p: OrgPackContextProvider): void {
    this.orgContext = p;
  }

  async contextFor(orgId: string | null, at: Date): Promise<OrgPackContext> {
    if (this.orgContext) return this.orgContext(orgId, at);
    // Before settings exist every pack in force applies, as today.
    return { packIds: packRegistry().activeAt(at).map((p) => p.definition.id), extraSources: [] };
  }

  private assert(): void {
    assertFlag(this.flags, 'packEngine');
  }

  /** Record every pack version and hash we serve (idempotent; status refreshed). */
  async syncVersions(now = new Date()): Promise<void> {
    if (this.synced) return;
    for (const id of packRegistry().packIds()) {
      for (const v of packRegistry().versions(id, now)) {
        const d = v.definition;
        const row = await this.versions.findOne({ where: { packId: d.id, version: d.version } });
        if (row) {
          if (row.status !== v.status || row.contentHash !== v.contentHash) {
            row.status = v.status;
            row.contentHash = v.contentHash;
            await this.versions.save(row);
          }
          continue;
        }
        await this.versions.save({
          id: uuidv4(), packId: d.id, version: d.version, effectiveFrom: new Date(d.effectiveFrom),
          contentHash: v.contentHash, status: v.status, loadedAt: now,
        });
      }
    }
    this.synced = true;
  }

  private packView(v: LoadedPackVersion) {
    const d = v.definition;
    return {
      pack_id: d.id,
      name: d.name,
      version: d.version,
      effective_from: d.effectiveFrom,
      status: v.status,
      content_hash: v.contentHash,
      baseline: d.baseline,
      region: d.region,
      jurisdiction: d.jurisdiction,
      legacy_framework_id: d.legacyId,
      clause_count: d.clauses.length,
      control_ids: [...new Set(d.clauses.map((c) => c.control))],
      source: d.source,
    };
  }

  async listPacks() {
    this.assert();
    await this.syncVersions();
    return {
      baseline: BASELINE_PACK_IDS,
      packs: packRegistry().packIds().map((id) => {
        const active = packRegistry().versionAt(id);
        const upcoming = packRegistry().upcoming(id);
        return {
          ...(active ? this.packView(active) : { pack_id: id }),
          upcoming: upcoming.map((u) => ({ version: u.definition.version, effective_from: u.definition.effectiveFrom, diff: active ? diffPacks(active.definition, u.definition) : null })),
        };
      }),
    };
  }

  async packVersions(id: string) {
    this.assert();
    await this.syncVersions();
    const list = packRegistry().versions(id);
    if (!list.length) throw new NotFoundException(`Unknown pack ${id}`);
    const seen = await this.versions.find({ where: { packId: id } });
    return {
      pack_id: id,
      versions: list.map((v) => ({
        ...this.packView(v),
        changelog: v.definition.changelog,
        first_loaded_at: seen.find((s) => s.version === v.definition.version)?.loadedAt ?? null,
      })),
    };
  }

  async packDiff(id: string, from?: string, to?: string) {
    this.assert();
    const list = packRegistry().versions(id);
    if (!list.length) throw new NotFoundException(`Unknown pack ${id}`);
    const active = packRegistry().versionAt(id);
    const pick = (v: string | undefined, fallback: LoadedPackVersion | undefined) =>
      v ? list.find((x) => x.definition.version === v) : fallback;
    const a = pick(from, active ?? list[0]);
    const b = pick(to, packRegistry().upcoming(id)[0] ?? active ?? list[list.length - 1]);
    if (!a || !b) throw new BadRequestException('Unknown version');
    return diffPacks(a.definition, b.definition);
  }

  controlLibrary() {
    this.assert();
    const packs = packRegistry().activeAt();
    return {
      controls: listControls().map((c) => ({
        control_id: c.id,
        title: c.title,
        scope: c.scope,
        evidence_types: c.evidenceTypes,
        parameters: c.parameters,
        mapped_by: packs.flatMap((p) =>
          p.definition.clauses.filter((cl) => cl.control === c.id).map((cl) => ({ pack_id: p.definition.id, code: cl.code, clause: cl.clause ?? null })),
        ),
      })),
    };
  }

  async parameters(orgId: string | null, asOf?: string) {
    this.assert();
    const at = this.parseAsOf(asOf);
    const ctx = await this.contextFor(orgId, at);
    const packs = packRegistry().activeAt(at).filter((p) => ctx.packIds.includes(p.definition.id));
    const resolved = resolveForPacks(packs, ctx.extraSources);
    return {
      as_of: at.toISOString(),
      packs: packs.map((p) => ({ pack_id: p.definition.id, version: p.definition.version })),
      parameters: Object.entries(resolved.sources).map(([name, s]) => ({
        name,
        rule: parameterSpec(name)?.rule ?? 'min',
        unit: parameterSpec(name)?.unit ?? null,
        description: parameterSpec(name)?.description ?? '',
        value: s.applied,
        set_by: s.setBy,
        candidates: s.candidates,
      })),
    };
  }

  private parseAsOf(asOf?: string): Date {
    if (!asOf) return new Date();
    const d = new Date(asOf);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('as_of must be an ISO date');
    if (d.getTime() > Date.now()) throw new BadRequestException('as_of cannot be in the future');
    return d;
  }

  /**
   * Evaluate one model against every pack in force for its organisation. Each
   * control is evaluated once and reported under every clause that maps to it.
   */
  async evaluateModel(user: CurrentUser, modelId: string, asOf?: string) {
    this.assert();
    const at = this.parseAsOf(asOf);
    const { model, orgId } = await modelForUser(this.models, this.projects, user, modelId);
    const entry = modelEntityToEntry(model);
    const ctx = await this.inventory.buildValidationContext(modelId);
    const orgCtx = await this.contextFor(orgId, at);
    const packs = packRegistry().activeAt(at).filter((p) => orgCtx.packIds.includes(p.definition.id));
    const params = resolveForPacks(packs, orgCtx.extraSources);
    const flags = this.flags.flags;

    const controls = new Map<string, { control_id: string; passed: boolean; not_assessed: boolean; evidence_refs: Set<string>; clauses: string[] }>();
    const reports = packs.map((p) => {
      const ev = evaluatePack(p, entry, ctx, { flags, params, now: new Date() });
      for (const c of ev.clauses) {
        const row = controls.get(c.controlId) ?? { control_id: c.controlId, passed: true, not_assessed: false, evidence_refs: new Set<string>(), clauses: [] };
        // A control evaluated with different clause options can differ by pack: fail wins.
        row.passed = row.passed && c.passed;
        row.not_assessed = row.not_assessed || c.notAssessed;
        c.evidenceRefs.forEach((r) => row.evidence_refs.add(r));
        row.clauses.push(`${p.definition.id}:${c.code}`);
        controls.set(c.controlId, row);
      }
      return {
        pack_id: p.definition.id,
        version: p.definition.version,
        content_hash: p.contentHash,
        tier: ev.tier,
        clauses: ev.clauses.map((c) => ({
          code: c.code, clause: c.clause, name: c.name, control_id: c.controlId, passed: c.passed,
          mandatory: c.mandatory, not_assessed: c.notAssessed, evidence: c.evidence, gap: c.gap, evidence_refs: c.evidenceRefs,
        })),
      };
    });
    return {
      model_id: modelId,
      org_id: orgId,
      as_of: at.toISOString(),
      pack_versions: Object.fromEntries(packs.map((p) => [p.definition.id, p.definition.version])),
      controls: [...controls.values()].map((c) => ({
        control_id: c.control_id,
        status: c.not_assessed ? 'NOT_ASSESSED' : c.passed ? 'PASS' : 'FAIL',
        evidence_refs: [...c.evidence_refs],
        clauses: c.clauses,
      })),
      packs: reports,
    };
  }

  /** Evaluate and record one control_results row per control (evidence collected once, reused by every pack). */
  async recordEvaluation(user: CurrentUser, modelId: string) {
    const ev = await this.evaluateModel(user, modelId);
    const now = new Date();
    const rows = ev.controls.map((c) => ({
      id: uuidv4(), orgId: ev.org_id, modelId, controlId: c.control_id, status: c.status,
      evidenceRefs: c.evidence_refs, clauses: c.clauses, packVersionSet: ev.pack_versions,
      evaluatedBy: user.email, evaluatedAt: now,
    }));
    await this.results.save(rows);
    return { ...ev, recorded: rows.length, evaluated_at: now.toISOString() };
  }

  async latestResults(user: CurrentUser, modelId: string) {
    this.assert();
    await modelForUser(this.models, this.projects, user, modelId);
    const rows = await this.results.find({ where: { modelId }, order: { evaluatedAt: 'DESC' } });
    const latestAt = rows[0]?.evaluatedAt?.getTime();
    return {
      model_id: modelId,
      evaluated_at: rows[0]?.evaluatedAt ?? null,
      results: rows.filter((r) => r.evaluatedAt.getTime() === latestAt).map((r) => ({
        control_id: r.controlId, status: r.status, evidence_refs: r.evidenceRefs ?? [], clauses: r.clauses ?? [],
        pack_versions: r.packVersionSet, evaluated_by: r.evaluatedBy,
      })),
    };
  }
}
