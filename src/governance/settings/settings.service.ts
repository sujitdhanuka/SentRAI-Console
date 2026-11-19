/**
 * Governance settings service (E1.2). Owner and CISO change an organisation's
 * settings; everyone in the organisation reads them. Every change is a new
 * effective-dated version with a required reason, recorded with its
 * field-level diff in the hash-chained audit ledger. Enabled packs and
 * appetite parameters feed the pack engine (strictest wins), replacing the
 * environment and hard-coded values with a fallback to them when an
 * organisation has no settings.
 */
import { parameterCatalog } from '../packs/parameter-enforcement';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Role } from '../../common/enums';
import { FeatureFlagsService } from '../../common/feature-flags';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { GovernanceSettingsEntity } from '../../database/entities';
import { assertFlag } from '../governance-access';
import { governanceHooks } from '../hooks';
import { resolveForPacks } from '../packs/pack-engine';
import { BASELINE_PACK_IDS, packRegistry } from '../packs/pack-loader';
import { PacksService } from '../packs/packs.service';
import {
  applyChanges,
  applyFloors,
  BANDS_3X3,
  BANDS_5X5,
  defaultSettings,
  diffSettings,
  floorsFor,
  GovernanceSettingsDoc,
  JURISDICTIONS,
  mergeSettings,
  PEOPLE_ITEMS,
  RISK_CATEGORIES,
  validateSettings,
  OPTIONAL_SETTINGS_KEYS,
} from './settings.model';

export const SETTINGS_EDITORS: Role[] = [Role.OWNER, Role.CISO];

export interface SettingsInForce {
  version: number;
  effectiveFrom: Date | null;
  settings: GovernanceSettingsDoc;
  isDefault: boolean;
}

@Injectable()
export class GovernanceSettingsService implements OnModuleInit {
  constructor(
    @InjectRepository(GovernanceSettingsEntity) private readonly rows: Repository<GovernanceSettingsEntity>,
    private readonly flags: FeatureFlagsService,
    private readonly packs: PacksService,
  ) {}

  onModuleInit(): void {
    // Settings narrow the packs in force and join the strictest-wins vote, only while the flag is on.
    this.packs.setOrgContextProvider(async (orgId, at) => {
      const all = packRegistry().defaultPackIds(at);
      if (!this.flags.isEnabled('governanceSettings') || !orgId) return { packIds: all, extraSources: [] };
      const s = await this.inForce(orgId, at);
      return {
        packIds: [...BASELINE_PACK_IDS, ...s.settings.enabledPacks],
        extraSources: [{ source: 'settings', version: String(s.version), parameters: s.settings.appetite.parameters ?? {} }],
      };
    });
    governanceHooks.orgPackParams = async (orgId, at = new Date()) => {
      if (!this.flags.isEnabled('packEngine') || !this.flags.isEnabled('governanceSettings') || !orgId) return undefined;
      const ctx = await this.packs.contextFor(orgId, at);
      return resolveForPacks(packRegistry().activeAt(at).filter((p) => ctx.packIds.includes(p.definition.id)), ctx.extraSources);
    };
  }

  /** Settings in force for an org on a date (defaults, version 0, when none were ever saved). */
  async inForce(orgId: string, at: Date = new Date()): Promise<SettingsInForce> {
    const row = await this.rows
      .createQueryBuilder('s')
      .where('s.orgId = :orgId AND s.effectiveFrom <= :at', { orgId, at })
      .orderBy('s.effectiveFrom', 'DESC')
      .addOrderBy('s.version', 'DESC')
      .getOne();
    if (!row) return { version: 0, effectiveFrom: null, settings: defaultSettings(), isDefault: true };
    // Merge over defaults so documents saved before a new field existed still resolve.
    return { version: row.version, effectiveFrom: row.effectiveFrom, settings: mergeSettings(defaultSettings(), row.settings as any), isDefault: false };
  }

  private view(s: SettingsInForce, orgId: string, user: CurrentUser) {
    const floors = floorsFor(s.settings.enabledPacks);
    return {
      org_id: orgId,
      version: s.version,
      effective_from: s.effectiveFrom,
      is_default: s.isDefault,
      settings: s.settings,
      can_edit: SETTINGS_EDITORS.includes(user.role),
      floors: Object.entries(floors).map(([name, f]) => ({ name, value: f.value, packs: f.packs })),
      catalog: {
        packs: packRegistry().activeAt().map((p) => ({
          pack_id: p.definition.id, name: p.definition.name, baseline: p.definition.baseline, region: p.definition.region, version: p.definition.version,
        })),
        jurisdictions: JURISDICTIONS,
        risk_categories: RISK_CATEGORIES,
        people_items: PEOPLE_ITEMS,
        band_presets: { '5x5': BANDS_5X5, '3x3': BANDS_3X3 },
        approver_options: ['OWNER', 'CISO', 'APPROVER', 'REVIEWER', 'ACCOUNTABLE_OFFICIAL'],
        parameters: parameterCatalog().map((c) => ({ name: c.name, enforced: c.enforced, enforced_by: c.enforcedBy })),
      },
    };
  }

  async get(user: CurrentUser, orgId: string, asOf?: string) {
    assertFlag(this.flags, 'governanceSettings');
    const at = asOf ? new Date(asOf) : new Date();
    if (Number.isNaN(at.getTime())) throw new BadRequestException('as_of must be an ISO date');
    const current = await this.inForce(orgId, at);
    const upcoming = await this.rows
      .createQueryBuilder('s')
      .where('s.orgId = :orgId AND s.effectiveFrom > :at', { orgId, at })
      .orderBy('s.effectiveFrom', 'ASC')
      .getMany();
    return {
      ...this.view(current, orgId, user),
      upcoming: this.upcomingView(upcoming),
    };
  }

  /** One entry per future date: the newest version on that date is what comes
   *  into force (a carried-forward change sits on top of the scheduled one), and
   *  its change list includes every version saved for that date. */
  private upcomingView(rows: GovernanceSettingsEntity[]) {
    const byDate = new Map<number, GovernanceSettingsEntity[]>();
    for (const r of rows) {
      const k = new Date(r.effectiveFrom).getTime();
      byDate.set(k, [...(byDate.get(k) ?? []), r]);
    }
    return [...byDate.values()].map((group) => {
      group.sort((x, y) => x.version - y.version);
      const top = group[group.length - 1];
      return {
        version: top.version,
        effective_from: top.effectiveFrom,
        reason: group[0].reason,
        changed_by: group[0].changedBy,
        changes: group.flatMap((g) => g.changes ?? []),
        versions: group.map((g) => ({ version: g.version, reason: g.reason, changed_by: g.changedBy })),
      };
    });
  }

  async history(orgId: string) {
    assertFlag(this.flags, 'governanceSettings');
    const rows = await this.rows.find({ where: { orgId }, order: { version: 'DESC' } });
    return {
      org_id: orgId,
      versions: rows.map((r) => ({
        version: r.version,
        effective_from: r.effectiveFrom,
        changed_by: r.changedBy,
        changed_by_role: r.changedByRole,
        reason: r.reason,
        changes: r.changes ?? [],
        created_at: r.createdAt,
      })),
    };
  }

  /**
   * Save a new version. `patch` is merged over the latest saved version (or the
   * defaults); objects merge, lists replace. Owner and CISO of the organisation only.
   */
  async update(
    user: CurrentUser,
    orgId: string,
    body: { settings?: Partial<GovernanceSettingsDoc>; reason?: string; effective_from?: string },
    req?: any,
  ) {
    assertFlag(this.flags, 'governanceSettings');
    if (!SETTINGS_EDITORS.includes(user.role) || user.tenantId !== orgId) {
      throw new ForbiddenException('Only the Owner or CISO of this organization can change governance settings');
    }
    const reason = (body.reason ?? '').trim();
    if (reason.length < 5) throw new BadRequestException('A reason (at least 5 characters) is required for every change');
    const now = new Date();
    const effectiveFrom = body.effective_from ? new Date(body.effective_from) : now;
    if (Number.isNaN(effectiveFrom.getTime())) throw new BadRequestException('effective_from must be an ISO date');
    // Past reports must keep the settings that applied at the time, so a change cannot be back-dated.
    if (effectiveFrom.getTime() < now.getTime() - 60_000) throw new BadRequestException('effective_from cannot be in the past');

    // Phase 3 optional fields are accepted only while their feature is on.
    const phase3Off: Record<string, boolean> = { energy: !this.flags.isEnabled('energy'), externalAi: !this.flags.isEnabled('federalVendor') };
    const known = new Set<string>([...Object.keys(defaultSettings()), ...OPTIONAL_SETTINGS_KEYS.filter((k) => !phase3Off[k])]);
    const unknownKeys = Object.keys(body.settings ?? {}).filter((k) => !known.has(k));
    if (unknownKeys.length) throw new BadRequestException(`Unknown settings field(s): ${unknownKeys.join(', ')}`);

    const latest = await this.rows.findOne({ where: { orgId }, order: { version: 'DESC' } });
    // Build on the settings in force at this change's own effective date, not on the
    // newest version number: a version scheduled for later must not take effect early.
    const base = (await this.inForce(orgId, effectiveFrom)).settings;
    let next = mergeSettings(base, body.settings ?? {});
    // Switching the matrix without new bands takes that matrix's preset bands.
    if (body.settings?.scoringMatrix && !body.settings?.bands && body.settings.scoringMatrix !== base.scoringMatrix) {
      next.bands = (body.settings.scoringMatrix === '3x3' ? BANDS_3X3 : BANDS_5X5).map((b) => ({ ...b }));
      if (body.settings.scoringMatrix === '3x3') {
        delete next.appetite.approvers.CRITICAL;
        for (const k of Object.keys(next.appetite.ceilings)) next.appetite.ceilings[k] = Math.min(next.appetite.ceilings[k], 9);
        if (Object.values(next.appetite.ceilings).every((v) => v === 9)) {
          for (const k of Object.keys(next.appetite.ceilings)) next.appetite.ceilings[k] = 4;
        }
      } else if (!next.appetite.approvers.CRITICAL) {
        next.appetite.approvers.CRITICAL = ['ACCOUNTABLE_OFFICIAL'];
      }
    }
    // Enabling a pack brings its floors with it when the caller did not set those fields.
    if (body.settings?.enabledPacks && !body.settings?.appetite?.requiredAuditType) next = applyFloors(next);

    const problems = validateSettings(next, effectiveFrom);
    for (const [band, who] of Object.entries(next.appetite.approvers ?? {})) {
      for (const w of who ?? []) {
        if (!['OWNER', 'CISO', 'APPROVER', 'REVIEWER', 'ACCOUNTABLE_OFFICIAL'].includes(w)) {
          problems.push({ field: `appetite.approvers.${band}`, message: `${w} is not an approver option` });
        }
      }
    }
    if (problems.length) {
      throw new UnprocessableEntityException({ message: problems.map((p) => `${p.field}: ${p.message}`), problems });
    }
    const changes = diffSettings(base, next);
    if (!changes.length) throw new BadRequestException('No changes');

    // Versions already scheduled after this one would otherwise replace it on their
    // date and silently undo it. Carry this change forward into each of them as a new
    // version on the same date, except for fields that scheduled version itself sets.
    const later = await this.rows
      .createQueryBuilder('s')
      .where('s.orgId = :orgId AND s.effectiveFrom > :at', { orgId, at: effectiveFrom })
      .orderBy('s.effectiveFrom', 'ASC')
      .addOrderBy('s.version', 'ASC')
      .getMany();
    const carryPlans: Array<{ effectiveFrom: Date; ofVersion: number; settings: GovernanceSettingsDoc; changes: Array<{ field: string; from: any; to: any }> }> = [];
    const laterDates = [...new Map(later.map((l) => [l.effectiveFrom.getTime(), l])).values()];
    for (const l of laterDates) {
      const scheduledFields = later.filter((x) => x.effectiveFrom.getTime() === l.effectiveFrom.getTime()).flatMap((x) => (x.changes ?? []).map((c: any) => String(c.field)));
      const carried = changes.filter((c) => !scheduledFields.some((f) => f === c.field || f.startsWith(`${c.field}.`) || c.field.startsWith(`${f}.`)));
      if (!carried.length) continue;
      const atThen = (await this.inForce(orgId, l.effectiveFrom)).settings;
      const doc = applyChanges(atThen, carried);
      const bad = validateSettings(doc, l.effectiveFrom);
      if (bad.length) {
        throw new ConflictException({
          message: `This change conflicts with the version scheduled for ${l.effectiveFrom.toISOString().slice(0, 10)}: ${bad.map((b) => `${b.field}: ${b.message}`).join('; ')}. Schedule this change for that date or later instead.`,
          problems: bad,
        });
      }
      const carriedChanges = diffSettings(atThen, doc);
      if (carriedChanges.length) carryPlans.push({ effectiveFrom: l.effectiveFrom, ofVersion: l.version, settings: doc, changes: carriedChanges });
    }

    let nextVersion = (latest?.version ?? 0) + 1;
    const row = await this.rows.save({
      id: uuidv4(),
      orgId,
      version: nextVersion,
      effectiveFrom,
      settings: next as any,
      changes,
      changedBy: user.email,
      changedByRole: user.role,
      reason,
      createdAt: now,
    });
    const carriedForward: Array<{ version: number; effective_from: string; changes: Array<{ field: string; from: any; to: any }> }> = [];
    for (const plan of carryPlans) {
      nextVersion += 1;
      await this.rows.save({
        id: uuidv4(), orgId, version: nextVersion, effectiveFrom: plan.effectiveFrom, settings: plan.settings as any,
        changes: plan.changes, changedBy: user.email, changedByRole: user.role,
        reason: `Carried forward from v${row.version} over scheduled v${plan.ofVersion}: ${reason}`.slice(0, 1000), createdAt: now,
      });
      carriedForward.push({ version: nextVersion, effective_from: plan.effectiveFrom.toISOString(), changes: plan.changes });
    }
    // The interceptor writes this curated summary to the hash-chained ledger.
    if (req) {
      req.auditSummary = {
        governance_settings_change: {
          org_id: orgId,
          version: row.version,
          effective_from: effectiveFrom.toISOString(),
          reason,
          changes: changes.slice(0, 40),
          ...(changes.length > 40 ? { more_changes: changes.length - 40 } : {}),
          ...(carriedForward.length ? { carried_forward: carriedForward.map((c) => ({ ...c, changes: c.changes.slice(0, 40) })) } : {}),
        },
      };
    }
    return { ...(await this.get(user, orgId)), saved_version: row.version, saved_effective_from: effectiveFrom, changes, carried_forward: carriedForward };
  }
}
