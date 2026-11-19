/**
 * Organisational engagement records (E3.7, NIST GOVERN 3.1 / 5.1 / MAP 1.2 /
 * 1.6 / 5.2, ISO 4.2, US M-25-21 public input): consultations, expert input,
 * team composition, human-subject studies and non-AI alternatives considered.
 * Three types map to people-side items in the governance settings; when an item
 * is set as customer responsibility the record is kept by the customer and the
 * report says who owns it, never that it passed.
 */
export interface EngagementType {
  type: string;
  label: string;
  peopleItem: string | null;
  needsConsent?: boolean;
  needsModel?: boolean;
}

export const ENGAGEMENT_TYPES: EngagementType[] = [
  { type: 'CONSULTATION', label: 'Stakeholder consultation', peopleItem: 'stakeholder_panels' },
  { type: 'EXPERT_INPUT', label: 'Domain expert input', peopleItem: 'expert_input' },
  { type: 'TEAM_COMPOSITION', label: 'Team composition and disciplines', peopleItem: 'team_diversity' },
  { type: 'HUMAN_SUBJECT', label: 'Human-subject study', peopleItem: null, needsConsent: true },
  { type: 'NON_AI_ALTERNATIVE', label: 'Non-AI alternative considered', peopleItem: null, needsModel: true },
];

export const ENGAGEMENT_ITEMS = ['stakeholder_panels', 'expert_input', 'team_diversity'] as const;
/** Records older than this no longer count as current evidence. */
export const RECORD_WINDOW_DAYS = 730;

export function engagementType(t: unknown): EngagementType | undefined {
  return ENGAGEMENT_TYPES.find((x) => x.type === String(t ?? '').toUpperCase());
}

/**
 * Participants are recorded as roles or groups (for example "Branch customers,
 * Pune", "Credit risk SME"), not as named individuals, so the register holds no
 * more personal data than it needs.
 */
export function parseParticipants(v: unknown): Array<{ role: string; count: number | null }> {
  if (!Array.isArray(v) || !v.length || v.length > 50) throw new Error('participants must list 1 to 50 roles or groups');
  return v.map((p: any, i) => {
    const role = String(typeof p === 'string' ? p : p?.role ?? '').trim();
    if (role.length < 2 || role.length > 200) throw new Error(`participants[${i}].role must be 2 to 200 characters`);
    const raw = typeof p === 'object' && p ? p.count : undefined;
    let count: number | null = null;
    if (raw !== undefined && raw !== null && raw !== '') {
      count = Number(raw);
      if (!Number.isInteger(count) || count < 1 || count > 1_000_000) throw new Error(`participants[${i}].count must be a whole number`);
    }
    return { role, count };
  });
}

export interface PeopleSetting { mode: string; owner?: string | null; note?: string | null }

/** Status per people-side item, in both modes, from the organisation's records. */
export function engagementStatus(
  items: Record<string, PeopleSetting | undefined>,
  records: Array<{ type: string; occurredAt: Date }>,
  now = new Date(),
) {
  const cutoff = now.getTime() - RECORD_WINDOW_DAYS * 86_400_000;
  const out: Record<string, { mode: string; owner: string | null; records: number; last: string | null; status: string }> = {};
  for (const item of ENGAGEMENT_ITEMS) {
    const s = items[item] ?? { mode: 'CUSTOMER', owner: null };
    const types = ENGAGEMENT_TYPES.filter((t) => t.peopleItem === item).map((t) => t.type);
    const mine = records.filter((r) => types.includes(r.type) && r.occurredAt.getTime() >= cutoff).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    const status = s.mode === 'CUSTOMER' ? (s.owner ? 'CUSTOMER_OWNED' : 'NO_OWNER') : mine.length ? 'RECORDED' : 'MISSING';
    out[item] = { mode: s.mode, owner: s.owner ?? null, records: mine.length, last: mine[0]?.occurredAt.toISOString().slice(0, 10) ?? null, status };
  }
  return out;
}
