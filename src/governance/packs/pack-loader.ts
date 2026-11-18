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
import { getFeatureFlags, PHASE2_FLAGS } from '../../common/feature-flags';
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
  for (const c of def.clauses ?? []) {
    const where = `${def.id} ${c.code}`;
    if (!c.code || !c.name) errors.push(`${where}: clause needs code and name`);
    if (!getControl(c.control)) errors.push(`${where}: unknown control ${c.control}`);
    if (c.flag && !(c.flag in getFeatureFlags({}))) errors.push(`${where}: unknown flag ${c.flag}`);
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

  /** Packs behind a governance flag are invisible while that flag is off (read live). */
  private available(): PackDefinition[] {
    const flags = getFeatureFlags();
    return this.defs.filter((d) => !d.flag || flags[d.flag]);
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
   * The hash covers the content actually served. Phase 2 clauses (and their changelog note) whose flag is
   * off are left out, so with Phase 2 off every existing pack hashes exactly as it did before Phase 2.
   */
  private hashOf(d: PackDefinition): string {
    const flags = getFeatureFlags();
    const off = new Set<string>(PHASE2_FLAGS.filter((f) => !flags[f]));
    const served = (d.clauses ?? []).filter((c) => !(c.flag && off.has(c.flag)));
    const phase2On = served.some((c) => c.flag && (PHASE2_FLAGS as readonly string[]).includes(c.flag));
    const key = `${[...off].sort().join(',')}`;
    let byKey = this.hashes.get(d);
    if (!byKey) { byKey = new Map(); this.hashes.set(d, byKey); }
    let h = byKey.get(key);
    if (!h) {
      const changelog = Array.isArray((d as any).changelog) && !phase2On ? (d as any).changelog.filter((l: unknown) => !/\(Phase 2\)/.test(String(l))) : (d as any).changelog;
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
