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
import { isoCodeExists, nistCodeExists } from '../../compliance/framework-codes';
import { getControl } from '../controls/control-library';
import { LoadedPackVersion, PackDefinition, PackStatus } from './pack.types';
import { parameterSpec } from './parameter-resolver';

import nist10 from './definitions/nist-ai-rmf-1.0.json';
import iso2023 from './definitions/iso-42001-2023.json';
import euAiAct2024 from './definitions/eu-ai-act-2024.json';
import rbi2025 from './definitions/rbi-free-ai-2025.json';

export const BUILT_IN_PACKS: PackDefinition[] = [
  nist10 as unknown as PackDefinition,
  iso2023 as unknown as PackDefinition,
  rbi2025 as unknown as PackDefinition,
  euAiAct2024 as unknown as PackDefinition,
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
  if (!Array.isArray(def.clauses) || def.clauses.length === 0) errors.push(`${def.id}: no clauses`);
  for (const name of Object.keys(def.parameters ?? {})) {
    if (!parameterSpec(name)) errors.push(`${def.id}: unknown parameter ${name}`);
  }
  for (const c of def.clauses ?? []) {
    const where = `${def.id} ${c.code}`;
    if (!c.code || !c.name) errors.push(`${where}: clause needs code and name`);
    if (!getControl(c.control)) errors.push(`${where}: unknown control ${c.control}`);
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

  packIds(): string[] {
    return [...new Set(this.defs.map((d) => d.id))];
  }

  /** Every version of a pack, oldest first, with status as of `now`. */
  versions(id: string, now: Date = new Date()): LoadedPackVersion[] {
    return this.defs
      .filter((d) => d.id === id)
      .sort((a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom))
      .map((d) => ({ definition: d, contentHash: packContentHash(d), status: statusOf(d, this.defs, now) }));
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
