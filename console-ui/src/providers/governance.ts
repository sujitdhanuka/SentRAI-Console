/**
 * The data contract for sentRAI Console. The UI only ever talks to
 * `GovernanceProvider`; MockGovernanceProvider seeds demo data and stubs the
 * append-only audit ledger the real backend owns. Swap in an HTTP
 * implementation without touching a single component (see README).
 */

export type CheckStatus = 'ok' | 'gap' | 'na';
export type DriftStatus = 'ok' | 'warn' | 'alert';
export type Env = 'PROD' | 'STAGING' | 'DEV';

export interface FrameworkCheck {
  status: CheckStatus;
  evidenceUrl: string | null;
}

export interface AIComponent {
  id: string;
  name: string;
  description: string;
  env: Env;
  riskTier: 'Minimal' | 'Limited' | 'High';
  owner: string;
  model: string;
  version: string;
  humanOversight: boolean;
  autonomousScope: string | null;
  drift: DriftStatus;
  lastRedTeamDaysAgo: number;
  sutrasDeclared: number; // out of 7
  incidents30d: number;
  boardPolicyRef: string | null;
  useCase?: string;
  riskRationale?: string;
  /** Exact sutra enum values when known (HTTP mode); count-only in the mock. */
  sutras?: string[];
  frameworks: {
    rbi: FrameworkCheck;
    nist: FrameworkCheck;
    eu: FrameworkCheck;
    iso: FrameworkCheck;
  };
}

export interface GovernanceGap {
  id: string;
  severity: 'HIGH' | 'MED' | 'LOW';
  componentId: string;
  framework: string;
  description: string;
  due: string; // "3d" | "14d" | "OVERDUE" | "gate"
}

export interface CalendarEvent {
  date: string;
  label: string;
  type: 'redteam' | 'drift' | 'audit' | 'policy';
  overdue: boolean;
}

export interface Grievance {
  id: string;
  subject: string;
  description: string;
  status: 'open' | 'in_review' | 'resolved';
  filedAt: string;
}

export interface LedgerEntry {
  ts: string;
  actor: string;
  action: string;
  targetId: string;
}

export interface GovernanceProvider {
  getComponents(): Promise<AIComponent[]>;
  getGaps(): Promise<GovernanceGap[]>;
  getCalendar(): Promise<CalendarEvent[]>;
  getGrievances(): Promise<Grievance[]>;
  saveComponent(c: Partial<AIComponent> & { id: string }): Promise<void>;
  /** Returns the generated id so the UI can toast it. componentId targets the
   *  model the grievance concerns (required by the live backend; mock ignores). */
  fileGrievance(g: Pick<Grievance, 'subject' | 'description'> & { componentId?: string }): Promise<{ id: string }>;
  exportAudit(): Promise<{ url: string }>;
}

export const SUTRAS = [
  'Trust is the Foundation',
  'People First',
  'Innovation over Restraint',
  'Fairness and Equity',
  'Accountability',
  'Understandable by Design',
  'Safety Resilience Sustainability',
] as const;

/* ── Mock implementation ──────────────────────────────────────────────────── */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ev = (n: string) => `https://evidence.sentrai.demo/${n}.pdf`;

const seedComponents: AIComponent[] = [
  {
    id: 'cmp-001', name: 'Customer Support Copilot', env: 'PROD', riskTier: 'Limited',
    description: 'LLM assistant drafting replies to customer tickets; agents approve before send.',
    owner: 'Support Platform', model: 'gpt-4o-mini', version: '2.4.1', humanOversight: true,
    autonomousScope: null, drift: 'warn', lastRedTeamDaysAgo: 38, sutrasDeclared: 6,
    incidents30d: 1, boardPolicyRef: 'AI-POL-2026-014',
    frameworks: { rbi: { status: 'ok', evidenceUrl: ev('rbi-cmp001') }, nist: { status: 'ok', evidenceUrl: null }, eu: { status: 'ok', evidenceUrl: ev('eu-cmp001') }, iso: { status: 'gap', evidenceUrl: null } },
  },
  {
    id: 'cmp-002', name: 'Document Summarizer', env: 'PROD', riskTier: 'Minimal',
    description: 'Summarizes uploaded documents into an internal knowledge base.',
    owner: 'Knowledge Systems', model: 'claude-haiku', version: '1.9.0', humanOversight: true,
    autonomousScope: null, drift: 'ok', lastRedTeamDaysAgo: 21, sutrasDeclared: 7,
    incidents30d: 0, boardPolicyRef: 'AI-POL-2026-014',
    frameworks: { rbi: { status: 'ok', evidenceUrl: ev('rbi-cmp002') }, nist: { status: 'ok', evidenceUrl: ev('nist-cmp002') }, eu: { status: 'na', evidenceUrl: null }, iso: { status: 'ok', evidenceUrl: ev('iso-cmp002') } },
  },
  {
    id: 'cmp-003', name: 'Fraud Signal Model', env: 'PROD', riskTier: 'High',
    description: 'Gradient-boosted classifier flagging suspicious transactions for review.',
    owner: 'Risk Analytics', model: 'xgb-fraud', version: '5.2.0', humanOversight: true,
    autonomousScope: null, drift: 'alert', lastRedTeamDaysAgo: 104, sutrasDeclared: 5,
    incidents30d: 2, boardPolicyRef: null,
    frameworks: { rbi: { status: 'gap', evidenceUrl: null }, nist: { status: 'ok', evidenceUrl: ev('nist-cmp003') }, eu: { status: 'gap', evidenceUrl: null }, iso: { status: 'ok', evidenceUrl: null } },
  },
  {
    id: 'cmp-004', name: 'Recommendation Engine', env: 'PROD', riskTier: 'Limited',
    description: 'Ranks content and product suggestions per user session.',
    owner: 'Growth Eng', model: 'two-tower-rec', version: '3.1.4', humanOversight: false,
    autonomousScope: 'ranked content ordering only', drift: 'warn', lastRedTeamDaysAgo: 62,
    sutrasDeclared: 6, incidents30d: 0, boardPolicyRef: 'AI-POL-2026-009',
    frameworks: { rbi: { status: 'ok', evidenceUrl: null }, nist: { status: 'ok', evidenceUrl: ev('nist-cmp004') }, eu: { status: 'ok', evidenceUrl: ev('eu-cmp004') }, iso: { status: 'ok', evidenceUrl: ev('iso-cmp004') } },
  },
  {
    id: 'cmp-005', name: 'Research Report Generator', env: 'STAGING', riskTier: 'Limited',
    description: 'Drafts long-form research reports from curated sources; analyst reviews.',
    owner: 'Research Tools', model: 'claude-sonnet', version: '0.9.2', humanOversight: true,
    autonomousScope: null, drift: 'ok', lastRedTeamDaysAgo: 47, sutrasDeclared: 5,
    incidents30d: 0, boardPolicyRef: 'AI-POL-2026-014',
    frameworks: { rbi: { status: 'ok', evidenceUrl: ev('rbi-cmp005') }, nist: { status: 'ok', evidenceUrl: null }, eu: { status: 'na', evidenceUrl: null }, iso: { status: 'ok', evidenceUrl: ev('iso-cmp005') } },
  },
  {
    id: 'cmp-006', name: 'Sentiment Scanner', env: 'STAGING', riskTier: 'Minimal',
    description: 'Classifies inbound feedback tone for routing and trend dashboards.',
    owner: 'Insights', model: 'distil-sent', version: '2.0.0', humanOversight: true,
    autonomousScope: null, drift: 'ok', lastRedTeamDaysAgo: 30, sutrasDeclared: 7,
    incidents30d: 0, boardPolicyRef: 'AI-POL-2026-014',
    frameworks: { rbi: { status: 'ok', evidenceUrl: ev('rbi-cmp006') }, nist: { status: 'ok', evidenceUrl: ev('nist-cmp006') }, eu: { status: 'na', evidenceUrl: null }, iso: { status: 'na', evidenceUrl: null } },
  },
  {
    id: 'cmp-007', name: 'Strategy Drafter', env: 'DEV', riskTier: 'High',
    description: 'Agentic workflow proposing operating strategies from internal metrics.',
    owner: 'Applied AI', model: 'gpt-4o', version: '0.3.0', humanOversight: true,
    autonomousScope: null, drift: 'ok', lastRedTeamDaysAgo: 88, sutrasDeclared: 4,
    incidents30d: 0, boardPolicyRef: null,
    frameworks: { rbi: { status: 'gap', evidenceUrl: null }, nist: { status: 'gap', evidenceUrl: null }, eu: { status: 'na', evidenceUrl: null }, iso: { status: 'na', evidenceUrl: null } },
  },
  {
    id: 'cmp-008', name: 'Chat Assistant', env: 'DEV', riskTier: 'Minimal',
    description: 'Internal chat helper answering policy and tooling questions.',
    owner: 'Employee Experience', model: 'llama3.1', version: '1.1.0', humanOversight: true,
    autonomousScope: null, drift: 'ok', lastRedTeamDaysAgo: 12, sutrasDeclared: 7,
    incidents30d: 0, boardPolicyRef: 'AI-POL-2026-014',
    frameworks: { rbi: { status: 'ok', evidenceUrl: ev('rbi-cmp008') }, nist: { status: 'ok', evidenceUrl: null }, eu: { status: 'na', evidenceUrl: null }, iso: { status: 'ok', evidenceUrl: ev('iso-cmp008') } },
  },
];

const seedGaps: GovernanceGap[] = [
  { id: 'gap-01', severity: 'HIGH', componentId: 'cmp-003', framework: 'EU AI Act', description: 'High-risk classification lacks conformity assessment evidence.', due: 'OVERDUE' },
  { id: 'gap-02', severity: 'HIGH', componentId: 'cmp-003', framework: 'RBI FREE-AI', description: 'No board-approved AI policy reference on a High-risk model.', due: '3d' },
  { id: 'gap-03', severity: 'HIGH', componentId: 'cmp-007', framework: 'NIST RMF', description: 'MEASURE: no bias-test artifact attached before promotion.', due: 'gate' },
  { id: 'gap-04', severity: 'MED', componentId: 'cmp-001', framework: 'ISO 42001', description: 'AIMS performance monitoring not configured (Clause 9.1).', due: '14d' },
  { id: 'gap-05', severity: 'LOW', componentId: 'cmp-007', framework: 'RBI FREE-AI', description: 'Sutras declaration incomplete (4/7 declared).', due: '30d' },
];

const seedCalendar: CalendarEvent[] = [
  { date: 'Jul 12', label: 'Fraud Signal Model · red-team review', type: 'redteam', overdue: true },
  { date: 'Jul 24', label: 'Drift review · Recommendation Engine', type: 'drift', overdue: false },
  { date: 'Jul 29', label: 'Q3 internal AI audit kickoff', type: 'audit', overdue: false },
  { date: 'Aug 05', label: 'Board AI policy annual refresh', type: 'policy', overdue: false },
  { date: 'Aug 14', label: 'Customer Support Copilot · red-team', type: 'redteam', overdue: false },
];

const seedGrievances: Grievance[] = [
  { id: 'GRV-1001', subject: 'Support reply felt automated and dismissive', description: 'Customer flagged a copilot-drafted reply as unhelpful.', status: 'open', filedAt: '2026-07-14' },
  { id: 'GRV-1002', subject: 'Recommendation felt discriminatory', description: 'User reports systematically lower-value offers.', status: 'in_review', filedAt: '2026-07-18' },
];

export class MockGovernanceProvider implements GovernanceProvider {
  private components = structuredClone(seedComponents);
  private gaps = structuredClone(seedGaps);
  private calendar = structuredClone(seedCalendar);
  private grievances = structuredClone(seedGrievances);
  private grievanceSeq = 1003;
  /** Stub of the append-only audit trail the real sentRAI backend owns. */
  readonly ledger: LedgerEntry[] = [];

  private append(action: string, targetId: string): void {
    const entry: LedgerEntry = { ts: new Date().toISOString(), actor: 'demo.user@sentrai', action, targetId };
    this.ledger.push(entry);
    // eslint-disable-next-line no-console
    console.info('[sentRAI ledger]', entry);
  }

  async getComponents(): Promise<AIComponent[]> { await delay(600); return structuredClone(this.components); }
  async getGaps(): Promise<GovernanceGap[]> { await delay(600); return structuredClone(this.gaps); }
  async getCalendar(): Promise<CalendarEvent[]> { await delay(600); return structuredClone(this.calendar); }
  async getGrievances(): Promise<Grievance[]> { await delay(600); return structuredClone(this.grievances); }

  async saveComponent(c: Partial<AIComponent> & { id: string }): Promise<void> {
    await delay(300);
    const i = this.components.findIndex((x) => x.id === c.id);
    if (i >= 0) this.components[i] = { ...this.components[i], ...c };
    this.append('saveComponent', c.id);
  }

  async fileGrievance(g: Pick<Grievance, 'subject' | 'description'> & { componentId?: string }): Promise<{ id: string }> {
    await delay(300);
    const id = `GRV-${this.grievanceSeq++}`;
    this.grievances.unshift({ id, subject: g.subject, description: g.description, status: 'open', filedAt: new Date().toISOString().slice(0, 10) });
    this.append('fileGrievance', id);
    return { id };
  }

  async exportAudit(): Promise<{ url: string }> {
    await delay(400);
    this.append('exportAudit', 'portfolio');
    return { url: 'https://reports.sentrai.demo/audit-latest.pdf' };
  }
}
