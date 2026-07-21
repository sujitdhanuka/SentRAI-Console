import type {
  AIComponent,
  CalendarEvent,
  CheckStatus,
  DriftStatus,
  Env,
  GovernanceGap,
  GovernanceProvider,
  Grievance,
} from './governance';

/**
 * Live implementation against the SentRAI Console NestJS API. Auth is the same
 * JWT the classic console stores in localStorage ('sentrai_access_token'), so
 * signing in at /console signs you into /dashboard too (same origin).
 *
 * Mappings (documented in README):
 *  - env       ← lifecycle_stage (DEPLOYED/MONITORING→PROD, VALIDATION→STAGING, else DEV)
 *  - riskTier  ← risk_level (LOW/MINIMAL→Minimal, MEDIUM/LIMITED→Limited, else High)
 *  - evidence  ← an 'ok' check links the model's audit PDF only when the model
 *                has attached evidence artifacts; ok-without-evidence stays null
 *                so the amber "compliant-but-unevidenced" dot fires.
 *  - grievances← per-model grievance counters (the backend records counts).
 */

const API = '/api/v1';

const ENV_BY_STAGE: Record<string, Env> = {
  DEPLOYED: 'PROD', MONITORING: 'PROD', VALIDATION: 'STAGING',
  DESIGN: 'DEV', DEVELOPMENT: 'DEV', DECOMMISSIONED: 'DEV',
};
const TIER = (risk: string): AIComponent['riskTier'] =>
  ['LOW', 'MINIMAL'].includes(risk) ? 'Minimal' : ['MEDIUM', 'LIMITED'].includes(risk) ? 'Limited' : 'High';

export const SUTRA_ENUM = [
  'TRUST_IS_THE_FOUNDATION', 'PEOPLE_FIRST', 'INNOVATION_OVER_RESTRAINT', 'FAIRNESS_AND_EQUITY',
  'ACCOUNTABILITY', 'UNDERSTANDABLE_BY_DESIGN', 'SAFETY_RESILIENCE_SUSTAINABILITY',
] as const;

const daysAgo = (iso: string | null): number =>
  iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 9999;

interface MatrixRow {
  model_id: string; name: string; description: string | null; lifecycle_stage: string;
  risk_level: string; owner_team: string | null; model_type: string;
  human_oversight_required: boolean; autonomous_scope: string | null;
  sutras_alignment: string[]; board_policy_ref: string | null;
  last_red_team_date: string | null; next_audit_due: string | null;
  grievance_count: number; has_evidence: boolean; drift: DriftStatus;
  description_source: string;
  risk_rationale: string | null; risk_rationale_source: string | null;
  gap_remediation: string | null; gap_remediation_source: string | null;
  source_refs: string[];
  merge_history: Array<{ source_ref: string; merged_at: string; matched_on: string }>;
  frameworks: Record<'rbi' | 'nist' | 'eu' | 'iso', { status: CheckStatus }>;
}

export class HttpGovernanceProvider implements GovernanceProvider {
  private cache: { rows: MatrixRow[]; gaps: GovernanceGap[]; at: number; scope: string } | null = null;

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const token = localStorage.getItem('sentrai_access_token');
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init?.headers },
    });
    if (res.status === 401) {
      localStorage.removeItem('sentrai_access_token');
      throw new Error('Session expired — sign in via the SentRAI Console.');
    }
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json() as Promise<T>;
  }

  /** One matrix call feeds components AND gaps; a tiny TTL avoids re-fetching
   *  it twice when the dashboard loads both in parallel. Scoped to the active
   *  project when one is selected, so the rail's scope chip actually narrows
   *  the fleet (cache key includes it). */
  private async matrix(): Promise<{ rows: MatrixRow[]; gaps: GovernanceGap[] }> {
    const projectId = localStorage.getItem('sentrai_active_project_id') || '';
    if (this.cache && this.cache.scope === projectId && Date.now() - this.cache.at < 2000) return this.cache;
    const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    const data = await this.api<{ components: MatrixRow[]; gaps: Array<Record<string, string>> }>(`/compliance/matrix${qs}`);
    const dueFor = (row?: MatrixRow) => {
      if (!row?.next_audit_due) return 'open';
      const d = Math.round((new Date(row.next_audit_due).getTime() - Date.now()) / 86_400_000);
      return d < 0 ? 'OVERDUE' : `${d}d`;
    };
    const gaps: GovernanceGap[] = data.gaps.map((g, i) => ({
      id: `gap-${i}`,
      severity: g.severity as GovernanceGap['severity'],
      componentId: g.model_id,
      framework: g.framework,
      description: g.description,
      due: dueFor(data.components.find((c) => c.model_id === g.model_id)),
    }));
    this.cache = { rows: data.components, gaps, at: Date.now(), scope: projectId };
    return this.cache;
  }

  async getComponents(): Promise<AIComponent[]> {
    const { rows } = await this.matrix();
    return rows.map((r) => {
      const evidence = (status: CheckStatus) =>
        status === 'ok' && r.has_evidence ? `${API}/inventory/models/${r.model_id}/export-pdf` : null;
      return {
        id: r.model_id,
        name: r.name,
        description: r.description ?? '',
        env: ENV_BY_STAGE[r.lifecycle_stage] ?? 'DEV',
        riskTier: TIER(r.risk_level),
        owner: r.owner_team ?? 'UNASSIGNED',
        model: r.model_type.toLowerCase(),
        version: r.model_id.slice(0, 8),
        humanOversight: r.human_oversight_required,
        autonomousScope: r.autonomous_scope,
        drift: r.drift,
        lastRedTeamDaysAgo: daysAgo(r.last_red_team_date),
        sutrasDeclared: r.sutras_alignment.length,
        incidents30d: r.grievance_count,
        boardPolicyRef: r.board_policy_ref,
        sutras: r.sutras_alignment,
        descriptionSource: r.description_source,
        riskRationale: r.risk_rationale ?? undefined,
        riskRationaleSource: r.risk_rationale_source,
        gapRemediation: r.gap_remediation,
        gapRemediationSource: r.gap_remediation_source,
        sourceRefs: r.source_refs ?? [],
        mergeHistory: r.merge_history ?? [],
        frameworks: {
          rbi: { status: r.frameworks.rbi.status, evidenceUrl: evidence(r.frameworks.rbi.status) },
          nist: { status: r.frameworks.nist.status, evidenceUrl: evidence(r.frameworks.nist.status) },
          eu: { status: r.frameworks.eu.status, evidenceUrl: evidence(r.frameworks.eu.status) },
          iso: { status: r.frameworks.iso.status, evidenceUrl: evidence(r.frameworks.iso.status) },
        },
      };
    });
  }

  async getGaps(): Promise<GovernanceGap[]> {
    return (await this.matrix()).gaps;
  }

  /** Governance calendar synthesized from the fleet's real dates: red-team
   *  reviews fall due 90 days after the last one; audits from next_audit_due. */
  async getCalendar(): Promise<CalendarEvent[]> {
    const { rows } = await this.matrix();
    const events: Array<CalendarEvent & { ts: number }> = [];
    const fmt = (d: Date) => d.toLocaleDateString('en', { month: 'short', day: '2-digit' });
    for (const r of rows) {
      if (r.last_red_team_date) {
        const due = new Date(new Date(r.last_red_team_date).getTime() + 90 * 86_400_000);
        events.push({ date: fmt(due), label: `${r.name} · red-team review`, type: 'redteam', overdue: due.getTime() < Date.now(), ts: due.getTime() });
      }
      if (r.next_audit_due) {
        const due = new Date(r.next_audit_due);
        events.push({ date: fmt(due), label: `${r.name} · audit due`, type: 'audit', overdue: due.getTime() < Date.now(), ts: due.getTime() });
      }
      if (r.drift === 'alert') {
        events.push({ date: 'now', label: `${r.name} · drift review`, type: 'drift', overdue: true, ts: 0 });
      }
    }
    return events.sort((a, b) => a.ts - b.ts).slice(0, 10).map(({ ts: _ts, ...e }) => e);
  }

  /** The backend tracks per-model grievance counters — surface them as rows. */
  async getGrievances(): Promise<Grievance[]> {
    const { rows } = await this.matrix();
    return rows
      .filter((r) => r.grievance_count > 0)
      .map((r) => ({
        id: `GRV-${r.model_id.slice(0, 6)}`,
        subject: `${r.grievance_count} grievance(s) · ${r.name}`,
        description: 'Recorded against this model in the console.',
        status: 'open' as const,
        filedAt: '',
      }));
  }

  async saveComponent(c: Partial<AIComponent> & { id: string }): Promise<void> {
    const body: Record<string, unknown> = { actor: 'dashboard' };
    if (c.owner !== undefined) body.owner_team = c.owner;
    if (c.boardPolicyRef !== undefined) body.board_policy_ref = c.boardPolicyRef ?? '';
    if (c.humanOversight !== undefined) body.human_oversight_required = c.humanOversight;
    if (c.autonomousScope !== undefined && c.autonomousScope) body.autonomous_scope = c.autonomousScope;
    if (c.useCase !== undefined) body.use_case_description = c.useCase;
    if (c.riskRationale !== undefined && c.riskRationale) body.risk_rationale = c.riskRationale;
    if (c.lastRedTeamDaysAgo !== undefined && c.lastRedTeamDaysAgo < 9999) {
      body.last_red_team_date = new Date(Date.now() - c.lastRedTeamDaysAgo * 86_400_000).toISOString();
    }
    if (c.sutras !== undefined && c.sutras.length) body.sutras_alignment = c.sutras;
    await this.api(`/inventory/models/${c.id}/governance`, { method: 'PATCH', body: JSON.stringify(body) });
    this.cache = null;
  }

  async fileGrievance(g: { subject: string; description: string; componentId?: string }): Promise<{ id: string }> {
    if (!g.componentId) throw new Error('Pick the AI component the grievance concerns.');
    const res = await this.api<{ model_id: string; grievance_count: number }>(
      `/inventory/models/${g.componentId}/grievances`,
      { method: 'PATCH', body: JSON.stringify({ count_delta: 1, resolution_notes: `${g.subject} — ${g.description}` }) },
    );
    this.cache = null;
    return { id: `GRV-${res.model_id.slice(0, 6)}-${res.grievance_count}` };
  }

  /** The PDF endpoint needs the bearer header, so fetch → blob URL → open. */
  async exportAudit(): Promise<{ url: string }> {
    const token = localStorage.getItem('sentrai_access_token');
    const projectId = localStorage.getItem('sentrai_active_project_id') || '';
    const res = await fetch(`${API}/compliance/portfolio/export-pdf${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`PDF export failed (${res.status})`);
    return { url: URL.createObjectURL(await res.blob()) };
  }
}
