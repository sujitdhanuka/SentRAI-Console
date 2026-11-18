/**
 * AI training and literacy (E2.6): who must complete which course, and
 * whether each person's completion is current. Pure functions so the rules
 * are unit-tested without a database.
 */
export const COURSE_KINDS = ['COURSE', 'POLICY_ACK', 'BRIEFING'] as const;
export const TRAINING_TOPICS = [
  'ai_literacy', 'responsible_ai', 'policy_ack', 'model_risk', 'fair_lending', 'privacy', 'security', 'au_ethics_principles', 'other',
] as const;
/** A completion expiring within this many days shows as EXPIRING. */
export const EXPIRING_DAYS = 30;

export type TrainingStatus = 'CURRENT' | 'EXPIRING' | 'EXPIRED' | 'MISSING';

export interface CourseLike {
  id: string;
  mandatory: boolean;
  active: boolean;
  targetRoles: string[] | null;
  topic: string | null;
  kind?: string;
}
export interface RecordLike {
  courseId: string;
  userId: string;
  completedAt: Date;
  expiresAt: Date | null;
  evidenceDocId?: string | null;
  evidenceRef?: string | null;
}
export interface PersonLike {
  id: string;
  role: string;
  isActive: boolean;
}

/** A course applies to a person when it is active and targets all roles or theirs. */
export function applies(course: CourseLike, person: PersonLike): boolean {
  return course.active && person.isActive && (!course.targetRoles?.length || course.targetRoles.includes(person.role));
}

export function statusOf(rec: RecordLike | undefined, now: Date): TrainingStatus {
  if (!rec) return 'MISSING';
  if (!rec.expiresAt) return 'CURRENT';
  const left = rec.expiresAt.getTime() - now.getTime();
  if (left <= 0) return 'EXPIRED';
  return left < EXPIRING_DAYS * 86_400_000 ? 'EXPIRING' : 'CURRENT';
}

/** Latest completion per (course, user). */
export function latestRecords(records: RecordLike[]): Map<string, RecordLike> {
  const out = new Map<string, RecordLike>();
  for (const r of records) {
    const k = `${r.courseId}|${r.userId}`;
    const prev = out.get(k);
    if (!prev || prev.completedAt.getTime() < r.completedAt.getTime()) out.set(k, r);
  }
  return out;
}

export interface MatrixCell {
  courseId: string;
  status: TrainingStatus;
  completedAt: Date | null;
  expiresAt: Date | null;
  required: boolean;
}

/** One row per person: a cell per applicable course and whether they are compliant with the mandatory ones. */
export function matrix(courses: CourseLike[], people: PersonLike[], records: RecordLike[], now: Date) {
  const latest = latestRecords(records);
  return people.filter((p) => p.isActive).map((p) => {
    const cells: MatrixCell[] = courses.filter((c) => applies(c, p)).map((c) => {
      const r = latest.get(`${c.id}|${p.id}`);
      return { courseId: c.id, status: statusOf(r, now), completedAt: r?.completedAt ?? null, expiresAt: r?.expiresAt ?? null, required: c.mandatory };
    });
    const due = cells.filter((c) => c.required && (c.status === 'MISSING' || c.status === 'EXPIRED')).length;
    return { userId: p.id, cells, overdue: due, compliant: due === 0 };
  });
}

/** Organisation facts for CTL-ORG-TRAINING and the people controls. */
export function trainingFacts(courses: CourseLike[], people: PersonLike[], records: RecordLike[], now: Date) {
  const rows = matrix(courses, people, records, now);
  const latest = latestRecords(records);
  const activeIds = new Set(people.filter((p) => p.isActive).map((p) => p.id));
  const kindOf = new Map(courses.map((c) => [c.id, c.kind ?? 'COURSE']));
  const hasEvidence = (r: RecordLike) => !!r.evidenceDocId || (!!r.evidenceRef && r.evidenceRef !== 'self-acknowledged');
  const topics: Record<string, { courses: number; completed: number; overdue: number }> = {};
  for (const c of courses.filter((x) => x.active && x.topic)) {
    const t = (topics[c.topic!] ??= { courses: 0, completed: 0, overdue: 0 });
    t.courses++;
    for (const p of people.filter((x) => applies(c, x))) {
      const s = statusOf(latest.get(`${c.id}|${p.id}`), now);
      if (s === 'CURRENT' || s === 'EXPIRING') t.completed++;
      else if (c.mandatory) t.overdue++;
    }
  }
  return {
    mandatoryCourses: courses.filter((c) => c.active && c.mandatory).length,
    staff: rows.length,
    compliant: rows.filter((r) => r.compliant).length,
    overdue: rows.filter((r) => !r.compliant).length,
    completions: [...latest.values()].filter((r) => activeIds.has(r.userId) && statusOf(r, now) !== 'EXPIRED').length,
    // ISO 7.2 competence: current course completions backed by evidence (a certificate, LMS export or document).
    competence: [...latest.values()].filter((r) => activeIds.has(r.userId) && statusOf(r, now) !== 'EXPIRED' && kindOf.get(r.courseId) === 'COURSE' && hasEvidence(r)).length,
    // ISO 7.3 awareness: current policy acknowledgements, whatever their topic.
    awareness: [...latest.values()].filter((r) => activeIds.has(r.userId) && statusOf(r, now) !== 'EXPIRED' && kindOf.get(r.courseId) === 'POLICY_ACK').length,
    topics,
  };
}
