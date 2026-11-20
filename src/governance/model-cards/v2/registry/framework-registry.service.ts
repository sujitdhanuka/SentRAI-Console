/**
 * Model card v2: the framework registry in the database (spec §2). Seeded
 * lazily from registry-seed.json the first time it is read (revision 1 of
 * any entry not yet in the table), so a deployment with the flag off writes
 * nothing. Changes create a new revision; nothing is overwritten, and
 * assessments keep the revision they were made against.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Role } from '../../../../common/enums';
import { FeatureFlagsService } from '../../../../common/feature-flags';
import { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { FrameworkControlEntity, FrameworkRegistryEntity } from '../../../../database/entities';
import { assertFlag } from '../../../governance-access';
import { normaliseFramework, SEED_FRAMEWORKS, SEED_VERSION, validateFrameworks } from './registry';
import { FrameworkDef } from './types';

/** Keys an edit may change. framework_id and revision are set by the registry. */
const EDITABLE = [
  'type', 'title', 'short_title', 'jurisdiction', 'issuer', 'requires_adoption', 'applicability_rule_id', 'pack_id', 'effective_from',
  'effective_note', 'phases', 'organisational_only', 'verification_status', 'notes', 'controls',
] as const;

@Injectable()
export class FrameworkRegistryService {
  private seeded: Promise<void> | null = null;
  private cache: FrameworkDef[] | null = null;

  constructor(
    @InjectRepository(FrameworkRegistryEntity) private readonly rows: Repository<FrameworkRegistryEntity>,
    @InjectRepository(FrameworkControlEntity) private readonly controls: Repository<FrameworkControlEntity>,
    private readonly flags: FeatureFlagsService,
  ) {}

  /** Insert revision 1 of every seed entry that is not in the table yet. Never changes an existing row. */
  private ensureSeeded(): Promise<void> {
    this.seeded ??= (async () => {
      const have = new Set((await this.rows.find({ select: ['frameworkId'] })).map((r) => r.frameworkId));
      const at = new Date();
      for (const f of SEED_FRAMEWORKS.filter((x) => !have.has(x.framework_id))) {
        await this.insert(f, `Seeded from registry-seed.json ${SEED_VERSION}. Unverified: requires legal review.`, 'system:seed', at);
      }
    })().catch((e) => {
      this.seeded = null;
      throw e;
    });
    return this.seeded;
  }

  private async insert(f: FrameworkDef, reason: string, by: string, at: Date): Promise<void> {
    await this.rows.save(this.rows.create({
      id: uuidv4(), frameworkId: f.framework_id, revision: f.revision, type: f.type, title: f.title, verificationStatus: f.verification_status,
      definition: f, reason, createdBy: by, createdAt: at,
    }));
    if (f.controls.length) {
      await this.controls.save(f.controls.map((c) => this.controls.create({
        id: uuidv4(), frameworkId: f.framework_id, frameworkRevision: f.revision, controlId: c.control_id, title: c.title,
        verificationStatus: c.verification_status, definition: c,
      })));
    }
    this.cache = null;
  }

  /** The latest revision of every entry. */
  async current(): Promise<FrameworkDef[]> {
    await this.ensureSeeded();
    if (this.cache) return this.cache;
    const all = await this.rows.find({ order: { frameworkId: 'ASC', revision: 'DESC' } });
    const latest = new Map<string, FrameworkRegistryEntity>();
    for (const r of all) if (!latest.has(r.frameworkId)) latest.set(r.frameworkId, r);
    this.cache = [...latest.values()].map((r) => normaliseFramework(r.definition, r.revision));
    return this.cache;
  }

  /** One entry at a revision (the latest when none is given). Pinned assessments read their revision here. */
  async get(frameworkId: string, revision?: number): Promise<FrameworkDef> {
    await this.ensureSeeded();
    const row = revision
      ? await this.rows.findOne({ where: { frameworkId, revision } })
      : await this.rows.findOne({ where: { frameworkId }, order: { revision: 'DESC' } });
    if (!row) throw new NotFoundException(`Framework ${frameworkId}${revision ? ` revision ${revision}` : ''} is not in the registry`);
    return normaliseFramework(row.definition, row.revision);
  }

  async history(frameworkId: string) {
    await this.ensureSeeded();
    const rows = await this.rows.find({ where: { frameworkId }, order: { revision: 'ASC' } });
    if (!rows.length) throw new NotFoundException(`Framework ${frameworkId} is not in the registry`);
    return rows.map((r) => ({ revision: r.revision, verification_status: r.verificationStatus, reason: r.reason, created_by: r.createdBy, created_at: r.createdAt }));
  }

  // ---- API ----

  async list() {
    assertFlag(this.flags, 'modelCardV2');
    return { seed_version: SEED_VERSION, frameworks: await this.current() };
  }

  async read(frameworkId: string, revision?: number) {
    assertFlag(this.flags, 'modelCardV2');
    return { framework: await this.get(frameworkId, revision), history: await this.history(frameworkId) };
  }

  /**
   * A new revision of an entry, or a new entry. The registry is shared by
   * every organisation, so only a platform administrator may change it, and
   * every change needs a reason. Marking an entry LEGAL_REVIEWED is recorded
   * like any other change, with the reviewer as the actor.
   */
  async revise(user: CurrentUser, frameworkId: string, body: { changes?: Record<string, unknown>; reason?: string }) {
    assertFlag(this.flags, 'modelCardV2');
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Only a platform administrator can change the framework registry, which every organisation shares');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 10) throw new BadRequestException('Give a reason of at least 10 characters for the change');
    const changes = body?.changes && typeof body.changes === 'object' ? body.changes : {};
    const unknown = Object.keys(changes).filter((k) => !(EDITABLE as readonly string[]).includes(k));
    if (unknown.length) throw new BadRequestException(`These keys cannot be changed: ${unknown.join(', ')}`);

    await this.ensureSeeded();
    const prev = await this.rows.findOne({ where: { frameworkId }, order: { revision: 'DESC' } });
    const base = prev ? normaliseFramework(prev.definition, prev.revision) : { framework_id: frameworkId };
    const next = normaliseFramework({ ...base, ...changes, framework_id: frameworkId, revision: (prev?.revision ?? 0) + 1 });
    const problems = validateFrameworks([next]);
    if (problems.length) throw new BadRequestException({ message: 'The registry entry is not valid', problems });
    await this.insert(next, reason, user.email, new Date());
    return { framework: next, history: await this.history(frameworkId) };
  }
}
