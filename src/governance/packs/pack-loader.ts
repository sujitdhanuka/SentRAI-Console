/**
 * Pack registry (E1.1, design §2.3). Packs ship as JSON files under
 * ./definitions; each version is validated at load, hashed (SHA-256 over a
 * canonical serialisation) and given a status from its effective date:
 * UPCOMING until it takes effect, ACTIVE while it is the newest effective
 * version, RETIRED once superseded. Old versions stay loadable so a past
 * report can be regenerated with the versions in force on that date.
 */
import { createHash } from 'node:crypto';

import { RiskLevel } from '../../common/enums';
import { getFeatureFlags, PHASE2_FLAGS, PHASE3_FLAGS, PHASE5_FLAGS } from '../../common/feature-flags';
import { isoCodeExists, nistCodeExists } from '../../compliance/framework-codes';
import { getControl } from '../controls/control-library';
import { LoadedPackVersion, PackDefinition, PackStatus } from './pack.types';
import { parameterSpec } from './parameter-resolver';

import nist10 from './definitions/nist-ai-rmf-1.0.json';
import iso2023 from './definitions/iso-42001-2023.json';
import euAiAct2024 from './definitions/eu-ai-act-2024.json';
import rbi2025 from './definitions/rbi-free-ai-2025.json';
import auDta21 from './definitions/au-dta-2.1.json';
import us2026 from './definitions/us-2026.json';

export const BUILT_IN_PACKS: PackDefinition[] = [
  nist10 as unknown as PackDefinition,
  iso2023 as unknown as PackDefinition,
  rbi2025 as unknown as PackDefinition,
  euAiAct2024 as unknown as PackDefinition,
  auDta21 as unknown as PackDefinition,
  us2026 as unknown as PackDefinition,
];

/** Baseline packs always apply (design §2.1): NIST AI RMF plus ISO/IEC 42001. */
/** EU AI Act operator roles a clause can name (E5.1). */
const EU_ROLE_VALUES = new Set(['PROVIDER', 'DEPLOYER', 'IMPORTER', 'DISTRIBUTOR', 'AUTHORISED_REP']);

export const BASELINE_PACK_IDS = ['nist-ai-rmf', 'iso-42001'];

/** Stable JSON: object keys sorted, so the hash does not depend on key order. */
export function canonicalJson(v: any): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function packContentHash(def: PackDefinition): string {
  return createHash('sha256').update(canonicalJson(def)).digest('hex');
}

const RISK_VALUES = new Set<string>(Object.values(RiskLevel));

/** Schema validation: returns a list of problems (empty when the pack is valid). */
export function validatePack(def: PackDefinition): string[] {
  const errors: string[] = [];
  const req = ['id', 'version', 'effectiveFrom', 'name', 'reportFormat', 'reportName', 'responseKey', 'legacyId', 'tierClassifier'] as const;
  for (const k of req) if (!(def as any)[k]) errors.push(`${def.id ?? '?'}: missing ${k}`);
  if (Number.isNaN(Date.parse(def.effectiveFrom))) errors.push(`${def.id}: effectiveFrom is not a date`);
  if (!['framework', 'sutras'].includes(def.reportFormat)) errors.push(`${def.id}: bad reportFormat`);
  if (!['nist', 'eu', 'iso', 'au', 'us', 'none'].includes(def.tierClassifier)) errors.push(`${def.id}: bad tierClassifier`);
  if (def.flag && !(def.flag in getFeatureFlags({}))) errors.push(`${def.id}: unknown flag ${def.flag}`);
  if (def.optIn && def.baseline) errors.push(`${def.id}: a baseline pack cannot be opt-in`);
  if (!Array.isArray(def.clauses) || def.clauses.length === 0) errors.push(`${def.id}: no clauses`);
  for (const name of Object.keys(def.parameters ?? {})) {
    if (!parameterSpec(name)) errors.push(`${def.id}: unknown parameter ${name}`);
  }
  for (const [name, flag] of Object.entries(def.parameterFlags ?? {})) {
    if (!(name in (def.parameters ?? {}))) errors.push(`${def.id}: parameterFlags names ${name}, which the pack does not set`);
    if (!(flag in getFeatureFlags({}))) errors.push(`${def.id}: unknown flag ${flag}`);
  }
  for (const c of def.clauses ?? []) {
    const where = `${def.id} ${c.code}`;
    if (!c.code || !c.name) errors.push(`${where}: clause needs code and name`);
    if (!getControl(c.control)) errors.push(`${where}: unknown control ${c.control}`);
    if (c.flag && !(c.flag in getFeatureFlags({}))) errors.push(`${where}: unknown flag ${c.flag}`);
    if (c.roles !== undefined && (!Array.isArray(c.roles) || !c.roles.length || c.roles.some((r) => !EU_ROLE_VALUES.has(r)))) errors.push(`${where}: roles must list operator roles`);
    if (c.effectiveFrom !== undefined && Number.isNaN(Date.parse(c.effectiveFrom))) errors.push(`${where}: effectiveFrom must be a date`);
    if (typeof c.gap !== 'string' && (typeof c.gap !== 'object' || c.gap === null)) errors.push(`${where}: gap must be text or keyed text`);
    if (typeof c.mandatory === 'object') {
      if (!Array.isArray(c.mandatory.riskIn) || c.mandatory.riskIn.some((r) => !RISK_VALUES.has(r))) {
        errors.push(`${where}: mandatory.riskIn must list risk levels`);
      }
    } else if (typeof c.mandatory !== 'boolean') {
      errors.push(`${where}: mandatory must be boolean or { riskIn }`);
    }
    // Codes must be real codes of the framework (prevents the Phase 0 mislabel class of bug).
    if (def.id.startsWith('nist-') && !nistCodeExists(c.code)) errors.push(`${where}: not a NIST AI RMF subcategory`);
    if (def.id.startsWith('iso-') && !isoCodeExists(c.code)) errors.push(`${where}: not an ISO/IEC 42001 clause`);
  }
  return errors;
}

function statusOf(def: PackDefinition, all: PackDefinition[], now: Date): PackStatus {
  const eff = Date.parse(def.effectiveFrom);
  if (eff > now.getTime()) return 'UPCOMING';
  const newerEffective = all.some(
    (o) => o.id === def.id && o !== def && Date.parse(o.effectiveFrom) <= now.getTime() && Date.parse(o.effectiveFrom) > eff,
  );
  return newerEffective ? 'RETIRED' : 'ACTIVE';
}

export class PackRegistry {
  private readonly defs: PackDefinition[];
  /** L10: definitions are fixed once loaded, so each content hash is computed once. */
  private readonly hashes = new WeakMap<PackDefinition, Map<string, string>>();

  constructor(defs: PackDefinition[] = BUILT_IN_PACKS) {
    const problems = defs.flatMap(validatePack);
    if (problems.length) throw new Error(`Invalid governance pack(s):\n${problems.join('\n')}`);
    const seen = new Set<string>();
    for (const d of defs) {
      const key = `${d.id}@${d.version}`;
      if (seen.has(key)) throw new Error(`Duplicate pack version ${key}`);
      seen.add(key);
    }
    this.defs = defs;
  }

  private readonly servedCache = new WeakMap<PackDefinition, Map<string, PackDefinition>>();

  /** Packs behind a governance flag are invisible while that flag is off (read live). */
  private available(): PackDefinition[] {
    const flags = getFeatureFlags();
    return this.defs.filter((d) => !d.flag || flags[d.flag]).map((d) => this.served(d, flags));
  }

  /**
   * E5.1: while GOV_E5_1_EU_ACT is off a pack is served exactly as before it: clause roles and
   * clause effective dates are dropped, and parameters behind a flag that is off are left out.
   * The same object is returned when nothing changes, so hashes and caches keep their identity.
   */
  private served(d: PackDefinition, flags: ReturnType<typeof getFeatureFlags>): PackDefinition {
    const offParams = Object.entries(d.parameterFlags ?? {}).filter(([, f]) => !flags[f]).map(([p]) => p);
    const strip = !flags.euAiAct && (d.clauses ?? []).some((c) => c.roles !== undefined || c.effectiveFrom !== undefined);
    const hasFlagsField = d.parameterFlags !== undefined;
    if (!offParams.length && !strip && !hasFlagsField) return d;
    const key = `${offParams.join(',')}|${strip}`;
    let byKey = this.servedCache.get(d);
    if (!byKey) { byKey = new Map(); this.servedCache.set(d, byKey); }
    let out = byKey.get(key);
    if (!out) {
      const { parameterFlags: _pf, ...rest } = d;
      const parameters = { ...(d.parameters ?? {}) };
      for (const p of offParams) delete parameters[p];
      const clauses = strip ? d.clauses.map(({ roles: _r, effectiveFrom: _e, ...c }) => c) : d.clauses;
      out = { ...rest, parameters, clauses } as PackDefinition;
      // Flag-gated parameters stay listed for the served copy only while their flag is on.
      const onFlags = Object.fromEntries(Object.entries(d.parameterFlags ?? {}).filter(([, f]) => flags[f]));
      if (Object.keys(onFlags).length) out.parameterFlags = onFlags;
      byKey.set(key, out);
    }
    return out;
  }

  packIds(): string[] {
    return [...new Set(this.available().map((d) => d.id))];
  }

  /** Every version of a pack, oldest first, with status as of `now`. */
  versions(id: string, now: Date = new Date()): LoadedPackVersion[] {
    return this.available()
      .filter((d) => d.id === id)
      .sort((a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom))
      .map((d) => ({ definition: d, contentHash: this.hashOf(d), status: statusOf(d, this.defs, now) }));
  }

  /**
   * The hash covers the content actually served. Phase 2 and Phase 3 clauses (and their changelog notes)
   * whose flag is off are left out, so with a phase off every existing pack hashes exactly as it did
   * before that phase.
   */
  private hashOf(d: PackDefinition): string {
    const flags = getFeatureFlags();
    const later = [...PHASE2_FLAGS, ...PHASE3_FLAGS, ...PHASE5_FLAGS];
    const off = new Set<string>(later.filter((f) => !flags[f]));
    const served = (d.clauses ?? []).filter((c) => !(c.flag && off.has(c.flag)));
    const key = `${[...off].sort().join(',')}`;
    let byKey = this.hashes.get(d);
    if (!byKey) { byKey = new Map(); this.hashes.set(d, byKey); }
    let h = byKey.get(key);
    if (!h) {
      let changelog = (d as any).changelog;
      for (const [tag, phaseFlags] of [['Phase 2', PHASE2_FLAGS], ['Phase 3', PHASE3_FLAGS], ['EU', PHASE5_FLAGS]] as const) {
        const phaseOn = served.some((c) => c.flag && (phaseFlags as readonly string[]).includes(c.flag));
        if (!phaseOn && Array.isArray(changelog)) changelog = changelog.filter((l: unknown) => !String(l).includes(`(${tag})`));
      }
      if (Array.isArray(changelog) && Array.isArray((d as any).changelog) && changelog.length === (d as any).changelog.length) changelog = (d as any).changelog;
      const view = served.length === (d.clauses ?? []).length && changelog === (d as any).changelog ? d : { ...d, clauses: served, ...(changelog !== undefined ? { changelog } : {}) };
      h = packContentHash(view as PackDefinition);
      byKey.set(key, h);
    }
    return h;
  }

  /** The version in force on `at` (the newest whose effectiveFrom ≤ at); null before the first. */
  versionAt(id: string, at: Date = new Date()): LoadedPackVersion | null {
    const inForce = this.versions(id, at).filter((v) => v.status === 'ACTIVE');
    return inForce[0] ?? null;
  }

  /** Versions not yet in force (shown as "upcoming" with a diff). */
  upcoming(id: string, now: Date = new Date()): LoadedPackVersion[] {
    return this.versions(id, now).filter((v) => v.status === 'UPCOMING');
  }

  get(id: string, version: string): LoadedPackVersion | null {
    return this.versions(id).find((v) => v.definition.version === version) ?? null;
  }

  /**
   * Packs that apply when an organisation has made no choice (no settings, or
   * settings switched off): every pack in force except the opt-in Phase 2
   * region packs, exactly the set that applied before they existed.
   */
  defaultPackIds(at: Date = new Date()): string[] {
    return this.activeAt(at).filter((p) => !p.definition.optIn).map((p) => p.definition.id);
  }

  /** Packs in force on `at`, in registry order. */
  activeAt(at: Date = new Date()): LoadedPackVersion[] {
    return this.packIds().map((id) => this.versionAt(id, at)).filter((v): v is LoadedPackVersion => v !== null);
  }
}

let defaultRegistry: PackRegistry | null = null;
export function packRegistry(): PackRegistry {
  if (!defaultRegistry) defaultRegistry = new PackRegistry();
  return defaultRegistry;
}
