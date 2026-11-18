/**
 * Pack version diff (E1.1): which clauses were added, removed or changed
 * (control, mandatory rule, wording) and which parameters moved, so an
 * UPCOMING version can be shown with exactly what will change.
 */
import { canonicalJson } from './pack-loader';
import { PackClause, PackDefinition } from './pack.types';

export interface PackDiff {
  packId: string;
  from: string;
  to: string;
  clauses: {
    added: Array<{ code: string; name: string; control: string }>;
    removed: Array<{ code: string; name: string; control: string }>;
    changed: Array<{ code: string; name: string; fields: string[]; controlFrom?: string; controlTo?: string }>;
  };
  parameters: Array<{ name: string; from: any; to: any }>;
  changelog: string[];
}

/** Clauses are matched by code + name (NIST MAP-1.1 has two checks). */
const key = (c: PackClause) => `${c.code}|${c.name}`;

export function diffPacks(a: PackDefinition, b: PackDefinition): PackDiff {
  const before = new Map(a.clauses.map((c) => [key(c), c]));
  const after = new Map(b.clauses.map((c) => [key(c), c]));
  const added = [...after.values()].filter((c) => !before.has(key(c))).map((c) => ({ code: c.code, name: c.name, control: c.control }));
  const removed = [...before.values()].filter((c) => !after.has(key(c))).map((c) => ({ code: c.code, name: c.name, control: c.control }));
  const changed: PackDiff['clauses']['changed'] = [];
  for (const [k, cb] of after) {
    const ca = before.get(k);
    if (!ca) continue;
    const fields = (['control', 'opts', 'mandatory', 'appliesWhenTier', 'flag', 'evidence', 'gap', 'clause'] as const).filter(
      (f) => canonicalJson((ca as any)[f] ?? null) !== canonicalJson((cb as any)[f] ?? null),
    );
    if (fields.length) {
      changed.push({
        code: cb.code,
        name: cb.name,
        fields,
        ...(fields.includes('control') ? { controlFrom: ca.control, controlTo: cb.control } : {}),
      });
    }
  }
  const names = new Set([...Object.keys(a.parameters ?? {}), ...Object.keys(b.parameters ?? {})]);
  const parameters = [...names]
    .filter((n) => canonicalJson(a.parameters?.[n] ?? null) !== canonicalJson(b.parameters?.[n] ?? null))
    .map((n) => ({ name: n, from: a.parameters?.[n] ?? null, to: b.parameters?.[n] ?? null }));
  const changelog = (b.changelog ?? []).filter((l) => !(a.changelog ?? []).includes(l));
  return { packId: b.id, from: a.version, to: b.version, clauses: { added, removed, changed }, parameters, changelog };
}
