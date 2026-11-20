/**
 * Model card v2: comparison of two card versions (spec §10, §12). Works on
 * the card view (a frozen version's content, or the live card), so the
 * previous approved version can always be compared with what changed since.
 */

export interface CardLike {
  record?: { workflow_state?: string | null } | null;
  summary?: Record<string, any> | null;
  sections?: Array<{ section_id: string; title: string; fields: Array<{ field_id: string; label: string; value: { value: any; status: string; provenance: string | null; accepted_by: string | null } }> }>;
  frameworks?: Array<{ framework_id: string; revision: number; controls: Array<{ control_id: string; status: string }> }>;
  scores?: Array<{ id: string; numerator: number; denominator: number }>;
}

export interface Change {
  kind: 'field' | 'control' | 'score' | 'summary';
  key: string;
  label: string;
  section?: string;
  before: unknown;
  after: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fieldState = (v: { value: any; status: string; provenance: string | null; accepted_by: string | null } | undefined) =>
  v ? { value: v.value ?? null, status: v.status, provenance: v.provenance, accepted: Boolean(v.accepted_by) } : null;

/** What changed from `a` to `b`. Fields that are empty in both are not listed. */
export function diffCards(a: CardLike, b: CardLike): { changes: Change[]; counts: Record<Change['kind'], number> } {
  const changes: Change[] = [];

  for (const k of new Set([...Object.keys(a.summary ?? {}), ...Object.keys(b.summary ?? {})])) {
    if (!same(a.summary?.[k], b.summary?.[k])) changes.push({ kind: 'summary', key: k, label: k.replace(/_/g, ' '), before: a.summary?.[k] ?? null, after: b.summary?.[k] ?? null });
  }
  if (!same(a.record?.workflow_state, b.record?.workflow_state)) {
    changes.push({ kind: 'summary', key: 'workflow_state', label: 'workflow state', before: a.record?.workflow_state ?? null, after: b.record?.workflow_state ?? null });
  }

  const fieldsOf = (c: CardLike) => new Map((c.sections ?? []).flatMap((s) => s.fields.map((f) => [f.field_id, { ...f, section: s.title }] as const)));
  const fa = fieldsOf(a);
  const fb = fieldsOf(b);
  for (const id of new Set([...fa.keys(), ...fb.keys()])) {
    const x = fieldState(fa.get(id)?.value);
    const y = fieldState(fb.get(id)?.value);
    const empty = (s: ReturnType<typeof fieldState>) => !s || (s.value === null && s.status === 'NOT_ASSESSED');
    if (empty(x) && empty(y)) continue;
    if (!same(x, y)) changes.push({ kind: 'field', key: id, label: (fb.get(id) ?? fa.get(id))!.label, section: (fb.get(id) ?? fa.get(id))!.section, before: x, after: y });
  }

  const controlsOf = (c: CardLike) => new Map((c.frameworks ?? []).flatMap((f) => f.controls.map((x) => [`${f.framework_id}:${x.control_id}`, x.status] as const)));
  const ca = controlsOf(a);
  const cb = controlsOf(b);
  for (const k of new Set([...ca.keys(), ...cb.keys()])) {
    if (!same(ca.get(k), cb.get(k))) changes.push({ kind: 'control', key: k, label: k, before: ca.get(k) ?? null, after: cb.get(k) ?? null });
  }

  const scoresOf = (c: CardLike) => new Map((c.scores ?? []).map((s) => [s.id, `${s.numerator}/${s.denominator}`]));
  const sa = scoresOf(a);
  const sb = scoresOf(b);
  for (const k of new Set([...sa.keys(), ...sb.keys()])) {
    if (!same(sa.get(k), sb.get(k))) changes.push({ kind: 'score', key: k, label: k.replace(/_/g, ' '), before: sa.get(k) ?? null, after: sb.get(k) ?? null });
  }

  const counts = { field: 0, control: 0, score: 0, summary: 0 } as Record<Change['kind'], number>;
  for (const c of changes) counts[c.kind] += 1;
  return { changes, counts };
}
