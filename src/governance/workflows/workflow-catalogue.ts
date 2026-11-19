/**
 * Governance workflows (User Guide v1.8, Part B, W0 to W12) as a checklist.
 *
 * Each step names who does it, where in the console, why it matters and when
 * it counts as done. "Done" is never a tick box: a step reads the records and
 * the framework-pack control results that the compliance check, the deploy
 * gate and the readiness report already use (see workflow.service.ts for how
 * the facts are gathered). A step whose controls are not in scope for the
 * organisation's packs, or whose feature flag is off, is left out.
 *
 * This file is pure: definitions plus the status rules, so they can be unit
 * tested without a database.
 */
import { EpicFlag } from '../../common/feature-flags';

export type WorkflowScope = 'org' | 'model';
export type StepStatus = 'done' | 'in_progress' | 'todo' | 'blocked' | 'overdue' | 'shortcut' | 'action' | 'system';

/** A place in the console the step opens: a route plus its query. */
export interface StepLink {
  route: string;
  query?: Record<string, string>;
}

/** Outcome of one control across the packs in force (worst result wins). */
export interface ControlOutcome {
  passed: boolean;
  notAssessed: boolean;
  gaps: string[];
  clauses: string[];
}

/** What a step's record check found. */
export interface StepCheck {
  done: boolean;
  /** Some work exists (a draft, an open request) but the check does not pass yet. */
  started?: boolean;
  /** It passed once but has lapsed (a review or interval came due). */
  overdue?: boolean;
  detail?: string | null;
  lastDoneAt?: Date | null;
  nextDueAt?: Date | null;
}

export interface FactsBase {
  now: Date;
  flags: (f: EpicFlag | 'governanceV2') => boolean;
  /** Region packs in force for the organisation (pack ids). */
  packs: string[];
  /** Control id → outcome, from the pack engine for this scope. */
  controls: Map<string, ControlOutcome>;
}

export interface StepDef<F extends FactsBase = any> {
  id: string;
  /** The guide's step label, e.g. "W3.2". */
  step: string;
  title: string;
  who: string;
  where: string;
  why: string;
  /** Plain-words completion rule shown under the step. */
  doneWhen?: string;
  /** shortcut: a link, not counted. action: something anyone can start (report an incident). system: SentRAI does it. */
  kind?: 'shortcut' | 'action' | 'system';
  /** Every flag listed must be on. */
  flags?: Array<EpicFlag | 'governanceV2'>;
  /** At least one of these region packs must be in force. */
  packs?: string[];
  applies?: (f: F) => boolean;
  /** Pack controls that must pass (those in scope). */
  controls?: string[];
  /** With no record check, the step only exists while one of its controls is in scope. */
  check?: (f: F) => StepCheck;
  deps?: string[] | ((f: F) => string[]);
  /** It comes due again (shown in W10 when overdue or due soon). */
  recurring?: boolean;
  /** When it is not done, it is also listed as a blocker with this message. */
  blocker?: (f: F) => string | null;
  link: (f: F) => StepLink;
}

export interface StageDef<F extends FactsBase = any> {
  id: string;
  workflow: string;
  title: string;
  summary: string;
  phase: string;
  /** Optional work (retirement): counted only once started. */
  optional?: boolean;
  /** For an optional stage: the step whose record starts it. */
  startedBy?: string;
  /** Periodic review: also lists the recurring steps of the other stages. */
  lens?: boolean;
  steps: StepDef<F>[];
}

/* ------------------------------------------------------------------ facts */

export interface OrgFacts extends FactsBase {
  org: { id: string; accountableOfficial: boolean; board: boolean };
  roles: Record<string, number>;
  settings: {
    isDefault: boolean;
    version: number;
    primaryJurisdiction: string;
    changedFields: Set<string>;
    peopleItemsOpen: number;
  } | null;
  integrations: number;
  aiProviders: number;
  aims: { policyApproved: boolean; policyOverdue: boolean; scopeApproved: boolean; objectives: number; mgmtReviewAt: Date | null } | null;
  documents: number;
  soaApprovedAt: Date | null;
  trainingCourses: number;
  frameworkReview: { lastReviewAt: Date | null; nextDueAt: Date | null; overdue: boolean } | null;
  projects: { total: number; withCode: number; scanned: number; pendingCandidates: number; ciEvents: number; boardNarrativeAt: Date | null };
  models: { total: number; missingOwnerOrPolicy: number };
  attestation: { open: number; lastOpenedAt: Date | null; cadenceDays: number | null };
  datasetsPastRetention: number | null;
  transparencyPublishedAt: Date | null;
  transparencyOverdue: boolean;
}

export interface ModelFacts extends FactsBase {
  m: {
    id: string; name: string; riskLevel: string; modelType: string; lifecycleStage: string; projectId: string | null;
    ownerTeam: string | null; ownerUserId: string | null; riskRationale: string | null; sutras: string[];
    humanOversight: boolean | null; boardPolicyRef: string | null; lastRedTeamDate: Date | null; nextAuditDue: Date | null;
    gapRemediation: string | null; evidenceTypes: string[]; detectedTools: string[]; permittedTools: string[];
    contextProfile: Record<string, any> | null; mrmInScope: boolean | null;
  };
  gov: Record<string, any>;
  gate: { mode: string; tier: string; block: Array<{ message: string }>; warn: Array<{ message: string }> } | null;
  openGaps: number;
  ia: { status: string; version: number; materiality: any; signedAt: Date | null } | null;
  riskActions: number;
  approval: { status: string; targetStage: string } | null;
  threatModel: { status: string } | null;
  securityEvaluations: number;
  audit: { at: Date; verdict: string | null } | null;
  driftAt: Date | null;
  drillPassedAt: Date | null;
  incidents: Array<{ severity: string; status: string; signedOff: boolean; notified: boolean; ticket: boolean; correctiveAction: boolean }>;
  grievances: { open: number; pastSla: number };
  retirement: { status: string } | null;
  card: { status: string } | null;
  attestation: { status: string } | null;
  ciLatest: { verdict: string; overridden: boolean } | null;
  redTeamIntervalDays: number;
}

/* ---------------------------------------------------------------- helpers */

const DAY = 86_400_000;
const HIGH = new Set(['HIGH', 'CRITICAL', 'PROHIBITED']);
const MED_OR_HIGH = new Set(['MEDIUM', 'LIMITED', 'HIGH', 'CRITICAL', 'PROHIBITED']);
const LIVE = new Set(['DEPLOYED', 'MONITORING']);
const LLM_KINDS = new Set(['GENERATIVE_AI', 'NLP', 'AGENT', 'MCP_SERVER', 'TOOL']);
const AGENT_KINDS = new Set(['AGENT', 'MCP_SERVER', 'TOOL']);
const ORG_PACKS = { rbi: 'rbi-free-ai', eu: 'eu-ai-act', au: 'au-dta', us: 'us-2026' };
export const REGION_PACKS = ORG_PACKS;

const nonEmpty = (s: string | null | undefined) => !!s && s.trim().length > 0;
const done = (ok: boolean, detail?: string | null, extra: Partial<StepCheck> = {}): StepCheck => ({ done: ok, detail: detail ?? null, ...extra });
const ago = (d: Date | null, now: Date) => (d ? Math.floor((now.getTime() - d.getTime()) / DAY) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** A check that passes while the last record is within `days`, and is overdue after it. */
function within(last: Date | null, days: number, now: Date, label: string): StepCheck {
  if (!last) return { done: false, detail: `No ${label} recorded yet` };
  const next = new Date(last.getTime() + days * DAY);
  const ok = next.getTime() >= now.getTime();
  return { done: ok, overdue: !ok, lastDoneAt: last, nextDueAt: next, detail: ok ? `Last ${label} ${iso(last)}, next due ${iso(next)}` : `Last ${label} ${iso(last)}, overdue since ${iso(next)}` };
}

const modelLink = (tab: string) => (f: ModelFacts): StepLink => ({ route: 'model', query: { id: f.m.id, tab } });
const govLink = (tab: string) => (f: ModelFacts | OrgFacts): StepLink =>
  ({ route: 'governance', query: { tab, ...('m' in f ? { model: (f as ModelFacts).m.id } : {}) } });
const route = (r: string, query?: Record<string, string>) => (): StepLink => ({ route: r, query });
const withModel = (r: string, extra: Record<string, string> = {}) => (f: ModelFacts): StepLink => ({ route: r, query: { model: f.m.id, ...extra } });

/* ------------------------------------------------------ organisation steps */

export const ORG_STAGES: StageDef<OrgFacts>[] = [
  {
    id: 'org-w0', workflow: 'W0', phase: 'Set up (once, reviewed yearly)', title: 'Set up the organisation',
    summary: 'Organisation, people, packs, appetite, policy and the management system.',
    steps: [
      { id: 'w0-1', step: 'W0.1', title: 'Create the organisation and users, assign roles', who: 'Global ADMIN', where: 'Organizations; Users › Add user',
        why: 'Each organisation is isolated. Approvals need people other than the requester, so add an OWNER or CISO and at least one approver.',
        doneWhen: 'the organisation has an OWNER or CISO',
        check: (f) => done((f.roles.OWNER ?? 0) + (f.roles.CISO ?? 0) > 0, `${Object.entries(f.roles).map(([r, n]) => `${n} ${r}`).join(', ') || 'No users yet'}`),
        link: route('users') },
      { id: 'w0-2', step: 'W0.2', title: 'Choose framework packs, jurisdiction, scoring matrix and deploy-gate mode per tier', who: 'OWNER / CISO',
        where: 'Governance › Setup › Settings & risk appetite', flags: ['governanceSettings'],
        why: 'The jurisdiction decides which packs are in force, and so which steps appear in every workflow. The gate mode decides whether Promote warns or blocks.',
        doneWhen: 'a settings version is saved (jurisdiction and packs chosen)',
        check: (f) => done(!!f.settings && !f.settings.isDefault,
          f.settings && !f.settings.isDefault ? `Version ${f.settings.version} · primary ${f.settings.primaryJurisdiction}` : 'Still on the default settings (NIST + ISO baseline only)'),
        blocker: () => 'Jurisdiction not confirmed yet, so SentRAI applies only the NIST and ISO baseline and no regional steps.',
        link: govLink('settings') },
      { id: 'w0-eu', step: 'W0.EU', title: 'EU AI Act: authorised representative and log retention', who: 'OWNER / CISO',
        where: 'Governance › Transparency & regional › EU AI Act › Organisation', flags: ['euAiAct'], packs: [ORG_PACKS.eu], controls: ['CTL-EU-ORG'], deps: ['w0-2'],
        why: 'Providers outside the EU need an authorised representative (Art. 22), and logs must be kept for at least six months (Art. 19, 26(6)).',
        doneWhen: 'the EU organisation check passes', link: govLink('eu') },
      { id: 'w0-3', step: 'W0.3', title: 'Set risk appetite: approvers per band, intervals, audit type per tier', who: 'OWNER / CISO',
        where: 'Same tab (versioned, needs a reason)', flags: ['governanceSettings'], deps: ['w0-2'], recurring: true,
        why: 'Who accepts each residual band, and the intervals for red teams, audits, drills and drift. You can tighten a pack floor but not loosen it.',
        doneWhen: 'settings are saved (keeping the default appetite is a valid choice)',
        check: (f) => { const changed = !!f.settings && [...f.settings.changedFields].some((k) => k.startsWith('appetite') || k.startsWith('gateMode'));
          return done(!!f.settings && !f.settings.isDefault, f.settings && !f.settings.isDefault ? (changed ? 'Appetite or gate mode set in settings' : 'Default appetite and gate modes kept') : null); },
        link: govLink('settings') },
      { id: 'w0-4', step: 'W0.4', title: 'Decide who keeps people-side records', who: 'OWNER / CISO', where: 'Same tab › People-side items',
        flags: ['governanceSettings'], controls: ['CTL-ORG-COMPETENCE', 'CTL-ORG-AWARENESS'],
        why: 'Training, consultation and similar records are kept by SentRAI or owned by a named person in your organisation.',
        doneWhen: 'every item your organisation owns has a named owner',
        check: (f) => done(!!f.settings && f.settings.peopleItemsOpen === 0, f.settings?.peopleItemsOpen ? `${f.settings.peopleItemsOpen} item(s) without an owner` : null),
        link: govLink('settings') },
      { id: 'w0-5', step: 'W0.5', title: 'Connect Jira, ServiceNow, a SIEM or a webhook', who: 'OWNER / CISO', where: 'Same tab › Integrations',
        flags: ['incidentExtensions'],
        why: 'Incident tickets, gate failures and escalations reach the tools your teams already watch.',
        doneWhen: 'at least one integration is enabled',
        check: (f) => done(f.integrations > 0, f.integrations ? `${f.integrations} enabled` : null), link: govLink('settings') },
      { id: 'w0-6', step: 'W0.6', title: 'Name the accountable official and governance board', who: 'OWNER / CISO', where: 'Governance › Setup › Accountability',
        flags: ['accountability'], controls: ['CTL-ORG-ACCOUNTABLE'], deps: ['w0-1'],
        why: 'The accountable official (the Chief AI Officer in the US) signs off HIGH and CRITICAL residual risk and serious incidents.',
        doneWhen: 'accountable official and board recorded',
        check: (f) => done(f.org.accountableOfficial && f.org.board, !f.org.accountableOfficial ? 'No accountable official' : !f.org.board ? 'No governance board' : null),
        link: govLink('accountability') },
      { id: 'w0-7', step: 'W0.7', title: 'Write the AI policy, AIMS scope, context and objectives; approve them', who: 'OWNER / CISO',
        where: 'Governance › ISO management system › AIMS workspace', flags: ['aims'], deps: ['w0-6'], recurring: true,
        controls: ['CTL-ORG-POLICY', 'CTL-ORG-SCOPE', 'CTL-ORG-OBJECTIVES', 'CTL-ORG-CONTEXT'],
        why: 'Every model must point to an approved board policy. Until one exists the board-policy check fails for every model.',
        doneWhen: 'AI policy, scope and objectives approved and in review',
        check: (f) => !f.aims ? done(false)
          : { done: f.aims.policyApproved && !f.aims.policyOverdue, overdue: f.aims.policyApproved && f.aims.policyOverdue, started: f.aims.scopeApproved || f.aims.objectives > 0,
              detail: !f.aims.policyApproved ? 'No approved AI policy' : f.aims.policyOverdue ? 'AI policy review is overdue' : null },
        blocker: (f) => `No approved AI policy yet. Every model fails the board-policy check${f.packs.includes(ORG_PACKS.rbi) ? ' (RBI FREE-AI Rec 14, ISO 42001 5.2)' : ' (ISO 42001 5.2)'} until one is approved.`,
        link: govLink('aims') },
      { id: 'w0-8', step: 'W0.8', title: 'Load controlled documents and set the Statement of Applicability', who: 'OWNER / CISO',
        where: 'ISO management system › Documents; Statement of Applicability', flags: ['documentControl'], deps: ['w0-7'], controls: ['CTL-ORG-DOCS'],
        why: 'Auditors ask for the SoA first. Document review dates feed the periodic review.',
        doneWhen: 'documents loaded and, where the SoA is on, an approved SoA',
        check: (f) => done(f.documents > 0 && (!f.flags('soa') || !!f.soaApprovedAt), `${f.documents} document(s)${f.flags('soa') ? `, SoA ${f.soaApprovedAt ? `approved ${iso(f.soaApprovedAt)}` : 'not approved'}` : ''}`, { started: f.documents > 0 }),
        link: govLink('soa') },
      { id: 'w0-9', step: 'W0.9', title: 'Set up training and policy acknowledgements', who: 'OWNER / CISO', where: 'ISO management system › Training',
        flags: ['training'], deps: ['w0-7'], controls: ['CTL-ORG-TRAINING'],
        why: 'Shows the people who build and approve AI were trained on the policy.',
        doneWhen: 'at least one active course, and the training controls pass',
        check: (f) => done(f.trainingCourses > 0, f.trainingCourses ? `${f.trainingCourses} active course(s)` : null), link: govLink('training') },
      { id: 'w0-10', step: 'W0.10', title: 'Connect AI providers for drafting', who: 'ADMIN / CISO / OWNER', where: 'AI Settings',
        why: 'Powers the Draft buttons. With no provider SentRAI uses the built-in "⚙ Auto-draft" and nothing leaves your network.',
        doneWhen: 'an enabled provider is configured',
        check: (f) => done(f.aiProviders > 0, f.aiProviders ? `${f.aiProviders} provider(s)` : 'Using ⚙ Auto-draft'), link: route('ai-settings') },
      { id: 'w0-11', step: 'W0.11', title: 'Check what changed', who: 'Anyone', where: 'Governance › Setup › Change history; Audit Trail › API action log',
        kind: 'shortcut', flags: ['governanceSettings'], why: 'Every settings version and API action, with who and why.', link: govLink('history') },
    ],
  },
  {
    id: 'org-w1', workflow: 'W1', phase: 'Bring code in (per project)', title: 'Onboard and inventory a model · project steps',
    summary: 'Steps 1–5: project, code, scan, import and CI. Steps 6–10 are per model.',
    steps: [
      { id: 'w1-1', step: 'W1.1', title: 'Create a project in the right organization', who: 'Model owner', where: 'Projects › + New Project',
        why: 'A project groups the models that ship from one codebase.', doneWhen: 'at least one project',
        check: (f) => done(f.projects.total > 0, `${f.projects.total} project(s)`), link: route('projects') },
      { id: 'w1-2', step: 'W1.2', title: 'Attach code: GitHub, zip or folder', who: 'Model owner', where: 'New project wizard, or the card’s Zip / Folder / GitHub buttons',
        deps: ['w1-1'], why: 'Attaching code starts the scan that finds AI in it, including shadow AI.', doneWhen: 'every project has code attached and scanned',
        check: (f) => done(f.projects.total > 0 && f.projects.scanned === f.projects.total, `${f.projects.scanned} of ${f.projects.total} scanned`, { started: f.projects.withCode > 0 }),
        link: route('projects') },
      { id: 'w1-3', step: 'W1.3', title: 'Scan, review detected components and evidence', who: 'Model owner', where: 'Projects › Scan › AI component(s) discovered',
        deps: ['w1-2'], why: 'Unregistered HIGH models are the first triage priority.', doneWhen: 'every candidate from the latest scans is imported or dismissed',
        check: (f) => done(f.projects.pendingCandidates === 0, f.projects.pendingCandidates ? `${f.projects.pendingCandidates} candidate(s) not yet imported` : null),
        blocker: (f) => (f.projects.pendingCandidates ? `${f.projects.pendingCandidates} detected AI component(s) are not in the inventory yet (possible shadow AI).` : null),
        link: route('projects') },
      { id: 'w1-4', step: 'W1.4', title: 'Import with starting owner team and board policy', who: 'Model owner', where: 'Same window',
        deps: ['w1-3'], why: 'Models start life with an owner and a policy, so they don’t arrive as gaps.', doneWhen: 'every model has an owner team and board policy',
        check: (f) => done(f.models.total > 0 && f.models.missingOwnerOrPolicy === 0, f.models.missingOwnerOrPolicy ? `${f.models.missingOwnerOrPolicy} of ${f.models.total} model(s) missing owner or policy` : `${f.models.total} model(s)`),
        link: route('inventory') },
      { id: 'w1-5', step: 'W1.5', title: 'Wire CI so new AI is caught before merge', who: 'ADMIN / CISO', where: 'CI Gate Ledger › Set up CI',
        deps: ['w1-2'], why: 'Every pull request is scanned. Ungoverned AI, leaked secrets and unauthorised tools are blocked before merge.',
        doneWhen: 'the gate has reported at least one run', check: (f) => done(f.projects.ciEvents > 0, f.projects.ciEvents ? `${f.projects.ciEvents} gate run(s)` : null),
        link: route('ci-ledger') },
    ],
  },
  {
    id: 'org-w10', workflow: 'W10', phase: 'Keep it current', title: 'Periodic review · organisation', lens: true,
    summary: 'Every review clock feeds Alignment › Inbox & due soon. Recurring steps from the other stages are listed here too.',
    steps: [
      { id: 'w9-6', step: 'W9.6', title: 'Framework (policy) review due', who: 'OWNER / CISO', where: 'Governance › Red team & audit › Framework review',
        flags: ['redTeamAuditRules'], controls: ['CTL-ORG-FRAMEWORK-REVIEW'], recurring: true,
        why: 'Confirms the frameworks and packs in force still match how you use AI.', doneWhen: 'a policy or management review approved within the interval',
        check: (f) => !f.frameworkReview ? done(false)
          : { done: !f.frameworkReview.overdue, overdue: !!f.frameworkReview.lastReviewAt && f.frameworkReview.overdue, lastDoneAt: f.frameworkReview.lastReviewAt, nextDueAt: f.frameworkReview.nextDueAt,
              detail: f.frameworkReview.lastReviewAt ? `Last ${iso(f.frameworkReview.lastReviewAt)}, next due ${iso(f.frameworkReview.nextDueAt)}` : 'Never reviewed' },
        link: govLink('assurance') },
      { id: 'w10-mgmt', step: 'W10', title: 'Hold the management review', who: 'OWNER / CISO', where: 'Governance › ISO management system › AIMS workspace',
        flags: ['aims'], controls: ['CTL-ORG-MGMT-REVIEW', 'CTL-ORG-AUDIT'], recurring: true,
        why: 'ISO 42001 9.3: top management reviews the AIMS, with the board pack as input.', doneWhen: 'the management review and audit-programme controls pass',
        link: govLink('aims') },
      { id: 'w10-att', step: 'W6.8', title: 'Open the attestation campaign', who: 'CISO / OWNER', where: 'Alignment › Attestations › Open campaign', recurring: true,
        why: 'Owners re-confirm that each in-scope model’s controls still hold, ahead of the HIGH-tier audits.', doneWhen: 'a campaign is open, or the last one is within its cadence',
        check: (f) => f.attestation.open > 0 ? done(true, `${f.attestation.open} open campaign(s)`)
          : f.attestation.lastOpenedAt ? within(f.attestation.lastOpenedAt, f.attestation.cadenceDays ?? 180, f.now, 'campaign') : done(false, 'No campaign yet'),
        link: route('alignment', { tab: 'attestations' }) },
      { id: 'w10-ret', step: 'W10', title: 'Review data retention', who: 'OWNER / CISO', where: 'Governance › Data register', flags: ['dataRegister'],
        why: 'Datasets past their retention date need a deletion order.', doneWhen: 'no dataset is past retention without an order',
        check: (f) => done((f.datasetsPastRetention ?? 0) === 0, f.datasetsPastRetention ? `${f.datasetsPastRetention} dataset(s) past retention` : null),
        link: govLink('datasets') },
    ],
  },
  {
    id: 'org-w11', workflow: 'W11', phase: 'Report', title: 'Transparency and disclosure · organisation',
    summary: 'Statements, regional reports and the board pack.',
    steps: [
      { id: 'w11-2', step: 'W11.2', title: 'Publish the transparency statement; Colorado disclosure and deployer register (US)', who: 'OWNER / CISO',
        where: 'Governance › Transparency & regional › Disclosures', flags: ['disclosures'], controls: ['CTL-ORG-DISCLOSURE'], recurring: true,
        why: 'A public statement of how you use AI, reviewed every year. The US pack adds the Colorado developer disclosure.',
        doneWhen: 'a statement is published and not past its review date',
        check: (f) => ({ done: !!f.transparencyPublishedAt && !f.transparencyOverdue, overdue: !!f.transparencyPublishedAt && f.transparencyOverdue, lastDoneAt: f.transparencyPublishedAt,
          detail: f.transparencyPublishedAt ? `Published ${iso(f.transparencyPublishedAt)}${f.transparencyOverdue ? ', review overdue' : ''}` : 'Not published' }),
        link: govLink('disclosures') },
      { id: 'w11-4', step: 'W11.4', title: 'Report to the DTA', who: 'OWNER', where: 'Governance › Australia (DTA)', flags: ['auPack'], packs: [ORG_PACKS.au],
        controls: ['CTL-ORG-DTA-REGISTER'], why: 'The use-case register is shared with the DTA, with high-risk use cases reported.',
        doneWhen: 'the DTA register controls pass', link: govLink('au') },
      { id: 'w11-5', step: 'W11.5', title: 'Board report and portfolio PDF', who: 'OWNER / CISO', where: 'Compliance Rollup › Board Report, Readiness PDF', recurring: true,
        why: 'The quarterly board pack, with a narrative grounded in the on-screen numbers.', doneWhen: 'a board narrative drafted in the last 90 days',
        check: (f) => within(f.projects.boardNarrativeAt, 90, f.now, 'board narrative'), link: route('compliance') },
      { id: 'w11-6', step: 'W11.6', title: 'Publish what each verdict covers', who: 'System', where: '/coverage (Compliance Rollup › Coverage disclosure)', kind: 'system',
        why: 'SentRAI publishes the controls behind each verdict automatically.', link: route('compliance') },
    ],
  },
];

/* --------------------------------------------------------- per-model steps */

const incidentsOpen = (f: ModelFacts) => f.incidents.filter((i) => i.status !== 'CLOSED');
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** EU AI Act facts for the model (present only while the workspace applies to the organisation). */
const euOf = (f: ModelFacts): Record<string, any> => f.gov.euAct ?? {};
const EU = { flags: ['euAiAct'] as EpicFlag[], packs: [ORG_PACKS.eu], applies: (f: ModelFacts) => !!f.gov.euAct };
const euProviderHigh = (f: ModelFacts) => !!f.gov.euAct && (euOf(f).roles ?? []).includes('PROVIDER') && !!euOf(f).highRisk;

export const MODEL_STAGES: StageDef<ModelFacts>[] = [
  {
    id: 'm-w1', workflow: 'W1', phase: '1 · Onboard', title: 'Onboard and inventory a model',
    summary: 'Steps 6–10: named owner, context, data and suppliers. Steps 1–5 are per project in the Organisation view.',
    steps: [
      { id: 'w1-6', step: 'W1.6', title: 'Open the model', who: 'Anyone', where: 'Model Inventory › Open model page', kind: 'shortcut',
        why: 'The model page holds every per-model tab.', link: modelLink('overview') },
      { id: 'w1-7', step: 'W1.7', title: 'Name the accountable owner (a person) next to the team', who: 'OWNER / CISO / ADMIN',
        where: 'Model page › Overview & gaps › Owner', controls: ['CTL-ACC-01', 'CTL-OWNER-01'],
        why: 'Audits, attestations and incidents route to a named person.', doneWhen: 'owner team and a named person are set',
        check: (f) => done(nonEmpty(f.m.ownerTeam) && (!f.flags('accountability') || !!f.m.ownerUserId),
          !nonEmpty(f.m.ownerTeam) ? 'No owner team' : f.flags('accountability') && !f.m.ownerUserId ? 'No named owner' : `Owner team: ${f.m.ownerTeam}`, { started: nonEmpty(f.m.ownerTeam) }),
        link: modelLink('overview') },
      { id: 'w1-8', step: 'W1.8', title: 'Describe the context: users, settings, limitations, out-of-scope uses, oversight pattern', who: 'Model owner',
        where: 'Model page › Context, risk & impact › Context profile', flags: ['contextProfile'], controls: ['CTL-CTX-02', 'CTL-CTX-03'],
        why: 'The impact assessment is prefilled from this profile.', doneWhen: 'the context-profile controls pass',
        check: (f) => { const p = f.m.contextProfile ?? {}; const n = ['intendedUsers', 'knownLimitations', 'outOfScopeUses', 'oversightPattern'].filter((k) => Array.isArray(p[k]) ? p[k].length : !!p[k]).length;
          return done(n === 4, `${n} of 4 sections filled`, { started: n > 0 }); },
        link: modelLink('risk') },
      { id: 'w1-9', step: 'W1.9', title: 'Link datasets and suppliers', who: 'Model owner', where: 'Governance › Data register; model page › Data & suppliers (AI BOM)',
        flags: ['dataRegister'], controls: ['CTL-PROV-01', 'CTL-DATA-02', 'CTL-VENDOR-01'],
        why: 'Shows lineage and third-party dependencies in the AI BOM.', doneWhen: 'at least one dataset linked and the data and supplier controls pass',
        check: (f) => done((f.gov.datasets?.linked ?? 0) > 0, `${count(f.gov.datasets?.linked ?? 0, 'dataset')} linked`), link: modelLink('data') },
      { id: 'w1-10', step: 'W1.10', title: 'Australia: add to the DTA use-case register', who: 'OWNER', where: 'Governance › Transparency & regional › Australia (DTA)',
        flags: ['auPack'], packs: [ORG_PACKS.au], controls: ['CTL-AU-INSCOPE', 'CTL-AU-USAGE', 'CTL-AU-REG'],
        why: 'In-scope Australian use cases are listed in the DTA register.', doneWhen: 'the DTA register controls pass', link: govLink('au') },
    ],
  },
  {
    id: 'm-w2', workflow: 'W2', phase: '1 · Onboard', title: 'Classify risk', summary: 'Tier and rationale, model-risk scope, materiality and Sutras.',
    steps: [
      { id: 'w2-1', step: 'W2.1', title: 'Scanner proposes a risk tier from code signals and the risk floor', who: 'System', where: 'Scan results; inventory', kind: 'system',
        why: 'A starting point. A person confirms it in the next step.', link: modelLink('overview') },
      { id: 'w2-2', step: 'W2.2', title: 'Draft and confirm the risk rationale', who: 'Model owner', where: 'Model page › Overview & gaps › Risk rationale',
        why: 'The tier drives audit cadence, the red-team interval and whether board sign-off is needed.', doneWhen: 'a written risk rationale',
        check: (f) => done(nonEmpty(f.m.riskRationale), `Tier ${f.m.riskLevel}`), link: modelLink('overview') },
      { id: 'w2-3', step: 'W2.3', title: 'Mark SR 26-2 scope (banks)', who: 'Reviewer', where: 'Model page › Context, risk & impact › Model validation',
        flags: ['modelValidation'], controls: ['CTL-VAL-SCOPE'],
        why: 'Banks decide whether the model is in model-risk scope, which triggers independent validation.', doneWhen: 'in or out of scope recorded',
        check: (f) => done(f.m.mrmInScope !== null, f.m.mrmInScope === null ? 'Not decided' : f.m.mrmInScope ? 'In scope' : 'Out of scope'), link: modelLink('risk') },
      { id: 'w2-4', step: 'W2.4', title: 'Record materiality and tier justification', who: 'Model owner', where: 'Impact assessment (materiality questionnaire)',
        flags: ['impactAssessment'], why: 'Explains why the tier fits how much the model matters.', doneWhen: 'materiality recorded on the impact assessment',
        check: (f) => done(f.ia?.materiality != null), link: modelLink('risk') },
      { id: 'w2-5', step: 'W2.5', title: 'Declare which of the 7 Sutras the model satisfies', who: 'Model owner', where: 'Model page › Overview & gaps › 7 Sutras declared',
        packs: [ORG_PACKS.rbi], why: 'RBI FREE-AI alignment is checked against what you declare.', doneWhen: 'at least one Sutra declared',
        check: (f) => done(f.m.sutras.length > 0, `${f.m.sutras.length} of 7 declared`), link: modelLink('overview') },
    ],
  },
  {
    id: 'm-eu', workflow: 'EU', phase: '1 · Onboard', title: 'EU AI Act obligations',
    summary: 'Scope and operator role, Article 5 screening, Annex III classification, then the provider or deployer duties for your role.',
    steps: [
      { id: 'eu-1', step: 'EU.1', title: 'Record EU scope and your operator role', who: 'Model owner', where: 'Governance › EU AI Act › Scope & role',
        ...EU, controls: ['CTL-EU-SCOPE'],
        why: 'Provider, deployer, importer and distributor duties differ; only the clauses for your role apply (Art. 2, 3).',
        doneWhen: 'scope answered and at least one operator role recorded',
        check: (f) => { const e = euOf(f); return done(!!e.scopeDecided && (e.roles?.length ?? 0) > 0, e.roles?.length ? `Roles: ${e.roles.join(', ').toLowerCase()}` : 'No operator role yet', { started: !!e.scopeDecided || (e.roles?.length ?? 0) > 0 }); },
        link: govLink('eu') },
      { id: 'eu-2', step: 'EU.2', title: 'Screen for Article 5 prohibited practices and sign', who: 'Model owner, signed by an officer', where: 'Governance › EU AI Act › Article 5',
        ...EU, controls: ['CTL-EU-ART5'], deps: ['eu-1'],
        why: 'Prohibited practices may not be placed on the market or used. A yes without an exception blocks the deploy gate in every mode.',
        doneWhen: 'all eight practices answered, none prohibited, and the screening signed',
        check: (f) => { const a = euOf(f).art5 ?? {}; return done(!!a.signed && !!a.complete && !(a.prohibited?.length), a.prohibited?.length ? `Prohibited: ${a.prohibited.join(', ')}` : a.signed ? 'Signed' : `${a.unanswered?.length ?? 8} unanswered`, { started: (a.unanswered?.length ?? 8) < 8 }); },
        blocker: (f) => (euOf(f).art5?.prohibited?.length ? `${f.m.name} is screened as an Article 5 prohibited practice; the deploy gate blocks it.` : null),
        link: govLink('eu') },
      { id: 'eu-3', step: 'EU.3', title: 'Classify against Annex III and Annex I, record any Article 6(3) derogation, sign', who: 'Model owner, signed by an officer',
        where: 'Governance › EU AI Act › Classification', ...EU, controls: ['CTL-EU-CLASS'], deps: ['eu-1'],
        why: 'The signed classification sets the EU risk tier, replacing the functional-area hint, and decides which obligations apply.',
        doneWhen: 'classification signed',
        check: (f) => { const e = euOf(f); return done(!!e.classification?.signed, `EU tier ${e.tier ?? 'not set'}${e.classification?.signed ? '' : ' (from the hint, not signed)'}`, { started: (e.classification?.annexIII?.length ?? 0) > 0 }); },
        link: govLink('eu') },
      { id: 'eu-4', step: 'EU.4', title: 'Complete the Annex IV documentation, instructions for use, data and monitoring plan', who: 'Model owner',
        where: 'Governance › EU AI Act › Documentation', ...EU, applies: (f) => euProviderHigh(f), deps: ['eu-3'],
        controls: ['CTL-EU-PROVIDER', 'CTL-EU-ANNEX4', 'CTL-EU-INSTRUCTIONS', 'CTL-EU-DATA', 'CTL-EU-PMM'],
        why: 'Providers of high-risk systems draw up Annex IV documentation and Article 13 instructions before placing on the market (Art. 10, 11, 13, 16, 72).',
        doneWhen: 'the Annex IV readiness is complete and the documentation controls pass',
        check: (f) => { const e = euOf(f); return done((e.annexIV?.missing?.length ?? 0) === 0 && (e.instructions?.missing?.length ?? 0) === 0, `Annex IV ${e.annexIV?.score ?? 0}% ready`, { started: (e.annexIV?.score ?? 0) > 0 }); },
        link: govLink('eu') },
      { id: 'eu-5', step: 'EU.5', title: 'Run the conformity assessment (Annex VI or VII) and sign', who: 'An officer', where: 'Governance › EU AI Act › Conformity',
        ...EU, applies: (f) => euProviderHigh(f), deps: ['eu-4'], controls: ['CTL-EU-CONFORMITY'],
        why: 'A high-risk system needs a passed conformity assessment before it is placed on the market, and again after a substantial modification (Art. 43).',
        doneWhen: 'the conformity assessment is passed and current',
        check: (f) => { const c = euOf(f).conformity ?? {}; return done(c.status === 'PASSED', c.problem ?? `Status ${String(c.status ?? 'NONE').toLowerCase().replace(/_/g, ' ')}`, { started: !!c.status && c.status !== 'NONE' }); },
        link: govLink('eu') },
      { id: 'eu-6', step: 'EU.6', title: 'Issue the EU declaration of conformity and record CE marking', who: 'An officer', where: 'Governance › EU AI Act › Conformity',
        ...EU, applies: (f) => euProviderHigh(f), deps: ['eu-5'], controls: ['CTL-EU-DECLARATION', 'CTL-EU-CE'],
        why: 'The Annex V declaration is signed and kept for 10 years; the CE marking is affixed after it (Art. 47, 48). SentRAI records the marking; it cannot affix it.',
        doneWhen: 'a current declaration is issued and CE marking recorded',
        check: (f) => { const e = euOf(f); return done(!!e.declaration?.issued && !e.declaration?.stale && !!e.ce?.affixed, e.declaration?.stale ? 'Declaration out of date' : e.declaration?.issued ? (e.ce?.affixed ? 'Declaration issued, CE recorded' : 'CE marking not recorded') : 'No declaration', { started: !!e.declaration?.issued }); },
        link: govLink('eu') },
      { id: 'eu-7', step: 'EU.7', title: 'Register in the EU database (Annex VIII)', who: 'OWNER / CISO', where: 'Governance › EU AI Act › Registration',
        ...EU, applies: (f) => (euOf(f).registration?.required?.length ?? 0) > 0, deps: ['eu-3'], controls: ['CTL-EU-REGISTRATION'],
        why: 'Annex III high-risk systems, Article 6(3) derogations and public-authority uses are registered before placing on the market or use (Art. 49).',
        doneWhen: 'every required Annex VIII section has a registration id',
        check: (f) => { const r = euOf(f).registration ?? {}; return done(!(r.missing?.length), r.missing?.length ? `Still to register: section ${r.missing.join(', ')}` : 'Registered'); },
        link: govLink('eu') },
      { id: 'eu-8', step: 'EU.8', title: 'Deployer duties: input data, workers, notice to persons and the FRIA', who: 'Model owner', where: 'Governance › EU AI Act › Deployer',
        ...EU, applies: (f) => (euOf(f).roles ?? []).includes('DEPLOYER') && !!euOf(f).highRisk, deps: ['eu-3'], controls: ['CTL-EU-DEPLOYER', 'CTL-EU-FRIA'],
        why: 'Deployers of high-risk systems check input data, inform workers and affected persons and, where required, notify the FRIA results (Art. 26, 27).',
        doneWhen: 'the deployer and FRIA controls pass', link: govLink('eu') },
      { id: 'eu-9', step: 'EU.9', title: 'Transparency: interaction notice, output marking and deployer disclosures', who: 'Model owner', where: 'Governance › EU AI Act › Transparency',
        ...EU, deps: ['eu-1'], controls: ['CTL-EU-ART50'],
        why: 'People are told they are dealing with AI, and synthetic outputs are marked in a machine-readable way (Art. 50).',
        doneWhen: 'the Article 50 questions are answered and the check passes',
        check: (f) => { const m = euOf(f).art50?.missing ?? []; return done(m.length === 0, m.length ? `Missing: ${m.join('; ')}` : null); },
        link: govLink('eu') },
      { id: 'eu-10', step: 'EU.10', title: 'Importer or distributor checks before making the system available', who: 'Model owner', where: 'Governance › EU AI Act › Value chain',
        ...EU, applies: (f) => (euOf(f).roles ?? []).some((r: string) => r === 'IMPORTER' || r === 'DISTRIBUTOR'), deps: ['eu-1'], controls: ['CTL-EU-VERIFY'],
        why: 'Importers and distributors verify the conformity assessment, documentation, CE marking and declaration (Art. 23, 24).',
        doneWhen: 'every verification item is confirmed with a date', link: govLink('eu') },
      { id: 'eu-11', step: 'EU.11', title: 'Review the post-market monitoring plan', who: 'Model owner', where: 'Governance › EU AI Act › Documentation',
        ...EU, applies: (f) => euProviderHigh(f), recurring: true, controls: ['CTL-EU-PMM'],
        why: 'The post-market monitoring plan is part of the technical documentation and is reviewed on its own cycle (Art. 72).',
        doneWhen: 'a plan exists and its review is not overdue',
        check: (f) => { const p = euOf(f).pmm ?? {}; return { done: !(p.missing?.length) && !p.reviewOverdue, overdue: !!p.reviewOverdue, started: !!p.frequency,
          lastDoneAt: p.lastReviewAt ? new Date(p.lastReviewAt) : null, detail: p.missing?.length ? `Plan missing: ${p.missing.join(', ')}` : p.reviewOverdue ? 'Review overdue' : p.frequency ? `Reviewed every ${p.frequency}` : null }; },
        link: govLink('eu') },
      { id: 'eu-12', step: 'EU.12', title: 'Report serious incidents within 2, 10 or 15 days', who: 'Model owner', where: 'Incidents › EU serious incident (or Governance › EU AI Act)',
        ...EU, applies: (f) => (euOf(f).incidents?.serious ?? 0) > 0, controls: ['CTL-EU-INCIDENT'],
        why: 'Serious incidents go to the market surveillance authority: 2 days for widespread or critical-infrastructure harm, 10 for a death, otherwise 15 (Art. 73).',
        doneWhen: 'every serious incident is reported in time',
        check: (f) => { const i = euOf(f).incidents ?? {}; return done(!i.overdue && !(i.problems?.length), i.overdue ? `${count(i.overdue, 'report')} past the deadline` : i.problems?.length ? i.problems.join('; ') : `${count(i.serious, 'serious incident')}`, { started: true }); },
        blocker: (f) => (euOf(f).incidents?.overdue ? `An EU serious-incident report for ${f.m.name} is past its Article 73 deadline.` : null),
        link: govLink('eu') },
      { id: 'eu-13', step: 'EU.13', title: 'Answer explanation requests (Article 86)', who: 'Reviewer', where: 'Governance › EU AI Act › Explanations',
        ...EU, applies: (f) => (euOf(f).explanations?.open ?? 0) > 0,
        why: 'A person affected by a decision can ask for a clear explanation of the system’s role and the main elements of the decision.',
        doneWhen: 'no request left open',
        check: (f) => { const x = euOf(f).explanations ?? {}; return done(false, `${count(x.open, 'open request')}${x.overdue ? `, ${x.overdue} past 30 days` : ''}`, { started: true }); },
        blocker: (f) => (euOf(f).explanations?.overdue ? `${count(euOf(f).explanations.overdue, 'explanation request')} on ${f.m.name} past 30 days.` : null),
        link: govLink('eu') },
      { id: 'eu-14', step: 'EU.14', title: 'Decide whether a change is a substantial modification', who: 'Model owner', where: 'Governance › EU AI Act › Value chain',
        ...EU, applies: (f) => (euOf(f).valueChain?.open ?? 0) > 0, controls: ['CTL-EU-VALUECHAIN'],
        why: 'A substantial modification or a new high-risk purpose makes you the provider and needs a new conformity assessment (Art. 25, 43(4)).',
        doneWhen: 'every material change is assessed',
        check: (f) => done(false, `${count(euOf(f).valueChain?.open ?? 0, 'change')} to assess`, { started: true }), link: govLink('eu') },
      { id: 'eu-15', step: 'EU.15', title: 'Close non-conformity actions and inform the value chain', who: 'Model owner', where: 'Governance › EU AI Act › Non-conformity',
        ...EU, applies: (f) => (euOf(f).nonconformity?.open ?? 0) + (euOf(f).nonconformity?.informPending ?? 0) > 0, controls: ['CTL-EU-CORRECTIVE'],
        why: 'A non-conforming system is corrected, withdrawn, disabled or recalled, and distributors, deployers and the authority are told (Art. 20).',
        doneWhen: 'no open action and everyone informed',
        check: (f) => { const n = euOf(f).nonconformity ?? {}; return done(false, `${count(n.open ?? 0, 'open action')}${n.informPending ? `, ${n.informPending} awaiting notification` : ''}`, { started: true }); },
        link: govLink('eu') },
    ],
  },
  {
    id: 'm-w3', workflow: 'W3', phase: '2 · Assess', title: 'Impact assessment', summary: 'The questionnaires your packs require, then a signed, immutable final.',
    steps: [
      { id: 'w3-1', step: 'W3.1', title: 'Pick questionnaires (ISO 42005, EU FRIA, DTA, US memo, materiality)', who: 'Model owner',
        where: 'Model page › Context, risk & impact › Impact assessments', flags: ['impactAssessment'],
        why: 'The packs in force decide which questionnaires are mandatory.', doneWhen: 'an assessment exists',
        check: (f) => done(!!f.ia, f.ia ? `Version ${f.ia.version} · ${f.ia.status}` : null), link: modelLink('risk') },
      { id: 'w3-2', step: 'W3.2', title: 'Answer (prefilled from the model record and context profile), save the draft', who: 'Model owner', where: 'Same tab',
        flags: ['impactAssessment'], deps: ['w3-1'], why: 'Prefilled answers save time. You review and complete them.', doneWhen: 'the draft is ready for sign-off or signed',
        check: (f) => done(!!f.ia && f.ia.status !== 'DRAFT', null, { started: !!f.ia }), link: modelLink('risk') },
      { id: 'w3-3', step: 'W3.3', title: 'Finalise: signed, hashed and immutable', who: 'Reviewer', where: 'Same tab', flags: ['impactAssessment'], deps: ['w3-2'],
        controls: ['CTL-IMPACT-01', 'CTL-PRIV-01'],
        why: 'Promotion checks for a FINAL impact assessment.', doneWhen: 'status FINAL and the impact controls pass',
        check: (f) => done(f.ia?.status === 'FINAL', f.ia?.signedAt ? `Signed ${iso(f.ia.signedAt)}` : null), link: modelLink('risk') },
      { id: 'w3-4', step: 'W3.4', title: 'View or report in a chosen layout', who: 'Anyone', where: 'Same tab › Record and reports', kind: 'shortcut', flags: ['impactAssessment'],
        why: 'Export the assessment in the layout a regulator expects.', link: modelLink('risk') },
      { id: 'w3-5', step: 'W3.5', title: 'New version when the model changes (REVALIDATION_REQUIRED)', who: 'Model owner', where: 'Same tab › New version',
        flags: ['impactAssessment'], applies: (f) => f.ia?.status === 'REVALIDATION_REQUIRED',
        why: 'The model changed after its last FINAL assessment, so the assessment must be redone.', doneWhen: 'a new FINAL version',
        check: () => done(false), blocker: (f) => `${f.m.name} changed after its impact assessment was finalised (REVALIDATION_REQUIRED).`,
        link: modelLink('risk') },
    ],
  },
  {
    id: 'm-w4', workflow: 'W4', phase: '2 · Assess', title: 'Risk register and treatment', summary: 'Suggest, score, treat and accept risk, then check the deploy gate.',
    steps: [
      { id: 'w4-1', step: 'W4.1', title: 'Suggest risks from the model’s signals, or add one', who: 'Model owner / reviewer', where: 'Model page › Context, risk & impact › Suggest risks',
        flags: ['riskRegister'], why: 'Signals from the scan and context become draft risks you confirm.', doneWhen: 'at least one risk on the register',
        check: (f) => done((f.gov.riskRegister?.total ?? 0) > 0, count(f.gov.riskRegister?.total ?? 0, 'risk')), link: modelLink('risk') },
      { id: 'w4-2', step: 'W4.2', title: 'Score inherent and residual risk on the heatmap', who: 'Reviewer', where: 'Governance › Risk & impact › Risk register',
        flags: ['riskRegister'], deps: ['w4-1'], controls: ['CTL-RISK-01'], why: 'The residual score decides who must accept the risk.',
        doneWhen: 'every open risk is assessed',
        check: (f) => { const r = f.gov.riskRegister ?? { total: 0, assessed: 0 }; return done(r.total > 0 && r.assessed === r.total, `${r.assessed} of ${r.total} assessed`, { started: r.assessed > 0 }); },
        link: govLink('risks') },
      { id: 'w4-3', step: 'W4.3', title: 'Add treatment actions with due dates', who: 'Model owner', where: 'Same tab (also read-only in Corrective actions)',
        flags: ['riskRegister'], deps: ['w4-2'], why: 'Treatments appear in the corrective-actions queue with their due dates.', doneWhen: 'at least one treatment action',
        check: (f) => done(f.riskActions > 0, count(f.riskActions, 'action')), link: govLink('risks') },
      { id: 'w4-4', step: 'W4.4', title: 'Accept residual risk (approver per band), waive or dismiss', who: 'Approver named in the appetite',
        where: 'Alignment › Inbox (Risk acceptance) → Risk register', flags: ['riskRegister'], deps: ['w4-2', 'org:w0-3'], controls: ['CTL-RISK-02', 'CTL-TRK-01'],
        why: 'Unaccepted residual risk warns or blocks at Promote, depending on the gate mode for the tier.', doneWhen: 'every risk is within appetite or validly accepted',
        check: (f) => { const r = f.gov.riskRegister ?? { assessed: 0, unaccepted: 0 }; return done(r.assessed > 0 && r.unaccepted === 0, r.unaccepted ? `${r.unaccepted} not accepted` : null); },
        link: route('alignment', { tab: 'inbox' }) },
      { id: 'w4-5', step: 'W4.5', title: 'Check the model’s deploy gate', who: 'Anyone', where: 'Model page › Context, risk & impact (gate badge)', flags: ['governanceSettings'],
        applies: (f) => !!f.gate && f.gate.mode !== 'OFF',
        why: 'Shows whether Promote would warn or block right now.', doneWhen: 'the deploy gate passes',
        check: (f) => { const issues = [...(f.gate?.block ?? []), ...(f.gate?.warn ?? [])]; return done(issues.length === 0, issues.length ? `${f.gate!.mode}: ${issues.map((i) => i.message).join('; ')}` : `Gate ${f.gate?.mode}: passes`); },
        blocker: (f) => (f.gate?.block.length ? `Deploy gate blocks ${f.m.name}: ${f.gate.block.map((b) => b.message).join('; ')}` : null),
        link: modelLink('risk') },
    ],
  },
  {
    id: 'm-w5', workflow: 'W5', phase: '3 · Evidence and test', title: 'Evidence and closing gaps', summary: 'Verdicts, remediation, evidence, evals, tools and Save & Re-check.',
    steps: [
      { id: 'w5-1', step: 'W5.1', title: 'See open gaps across the portfolio or for one model', who: 'Anyone', where: 'Model Inventory › Open gaps; Compliance Rollup › Most common gaps',
        kind: 'shortcut', why: 'Gaps are computed and clear only when the cause is fixed.', link: route('inventory') },
      { id: 'w5-3', step: 'W5.2–5.3', title: 'Open the model’s gaps and read per-framework verdicts', who: 'Model owner', where: 'Model page › Overview & gaps', kind: 'shortcut',
        why: 'Each verdict card names the control and what is missing.', link: modelLink('overview') },
      { id: 'w5-4', step: 'W5.4', title: 'Draft and attach a remediation plan as evidence', who: 'Model owner', where: 'Same tab › Remediation plan',
        why: 'Documents how open gaps will be closed and by when.', doneWhen: 'a remediation plan exists, or no gaps are open',
        check: (f) => done(f.openGaps === 0 || nonEmpty(f.m.gapRemediation), f.openGaps ? `${count(f.openGaps, 'open gap')}` : null), link: modelLink('overview') },
      { id: 'w5-5', step: 'W5.5', title: 'Attach a bias test, model card, DPIA or other evidence', who: 'Model owner', where: 'Same tab › Evidence on record › Attach',
        controls: ['CTL-FAIR-01', 'CTL-EXPL-01', 'CTL-DOC-01', 'CTL-DOC-02'],
        why: 'A bias test satisfies the Fairness & Equity Sutra and the bias_test_evidence CI rule.', doneWhen: 'evidence on record and the evidence controls pass',
        check: (f) => done(f.m.evidenceTypes.length > 0, f.m.evidenceTypes.length ? `On record: ${[...new Set(f.m.evidenceTypes)].join(', ')}` : 'No evidence attached'),
        link: modelLink('overview') },
      { id: 'w5-6', step: 'W5.6', title: 'Ingest behavioural eval results', who: 'Model owner', where: 'Same tab › Behavioral eval evidence',
        applies: (f) => LLM_KINDS.has(f.m.modelType), why: 'Reviewers see pass rates, not just a link.', doneWhen: 'a behavioral_eval artifact on record',
        check: (f) => done(f.m.evidenceTypes.includes('behavioral_eval')), link: modelLink('overview') },
      { id: 'w5-7', step: 'W5.7', title: 'Authorise detected tools', who: 'Model owner', where: 'Same tab › Tool authorization',
        applies: (f) => AGENT_KINDS.has(f.m.modelType) || f.m.detectedTools.length > 0,
        why: 'Any detected tool left unticked is a violation and blocks the CI gate.', doneWhen: 'every detected tool is permitted',
        check: (f) => { const missing = f.m.detectedTools.filter((t) => !f.m.permittedTools.includes(t)); return done(missing.length === 0, missing.length ? `Not authorised: ${missing.join(', ')}` : `${f.m.detectedTools.length} tool(s) authorised`); },
        blocker: (f) => { const n = f.m.detectedTools.filter((t) => !f.m.permittedTools.includes(t)).length; return n ? `${f.m.name} has ${count(n, 'detected tool')} that are not authorised. The CI gate will fail.` : null; },
        link: modelLink('overview') },
      { id: 'w5-8', step: 'W5.8', title: 'Fill governance fields and save (re-checks compliance)', who: 'Model owner', where: 'Same tab › Save & Re-check Compliance',
        deps: (f) => (f.flags('aims') ? ['org:w0-7'] : []), controls: ['CTL-POL-01', 'CTL-HUM-01', 'CTL-AUTO-01'],
        why: 'Human oversight, autonomous scope and board policy clear most of the remaining gaps.', doneWhen: 'board policy set and the policy and oversight controls pass',
        check: (f) => done(nonEmpty(f.m.boardPolicyRef) && f.m.humanOversight !== null, !nonEmpty(f.m.boardPolicyRef) ? 'No board policy' : null), link: modelLink('overview') },
      { id: 'w5-9', step: 'W5.9', title: 'Close gaps that need another record', who: 'Model owner', where: 'Follow the gap’s link to its tab (risk, impact, context, validation, threat model)',
        why: 'Some gaps close only when another record exists. This step completes when no in-scope gap is left.', doneWhen: 'no open gaps in the frameworks in scope',
        check: (f) => done(f.openGaps === 0, f.openGaps ? `${count(f.openGaps, 'open gap')} across the frameworks in scope` : 'No open gaps'), link: modelLink('overview') },
    ],
  },
  {
    id: 'm-w9', workflow: 'W9', phase: '3 · Evidence and test', title: 'Red team and audit', summary: 'Red team on the tier interval, threat model, formal audit and the event chain.',
    steps: [
      { id: 'w9-1', step: 'W9.1', title: 'See which models are due for red teaming or audit', who: 'Reviewer', where: 'Alignment › Inbox & due soon; Governance Calendar',
        kind: 'shortcut', why: 'One list of everything due in the next 30 days or overdue.', link: route('alignment', { tab: 'inbox' }) },
      { id: 'w9-2', step: 'W9.2', title: 'Record a red team (one record)', who: 'Reviewer', where: 'Model page › Overview & gaps › Record red team', recurring: true,
        controls: ['CTL-SEC-01', 'CTL-RT-02'],
        why: 'One record stores the artifact and sets the last-red-team date. The interval follows the risk tier and your packs.', doneWhen: 'a red team within the tier interval',
        check: (f) => f.m.lastRedTeamDate ? within(f.m.lastRedTeamDate, f.redTeamIntervalDays, f.now, 'red team') : done(false, 'Never red-teamed'),
        blocker: (f) => (HIGH.has(f.m.riskLevel) ? `${f.m.name} is ${f.m.riskLevel} risk with no red team in the last ${f.redTeamIntervalDays} days.` : null),
        link: modelLink('overview') },
      { id: 'w9-3', step: 'W9.3', title: 'Threat model and security evaluations', who: 'Reviewer, then a second officer approves', where: 'Model page › Testing & security; Governance › AI security',
        flags: ['aiSecurity'], controls: ['CTL-SEC-AI-01'], why: 'MITRE ATLAS, OWASP LLM Top 10 or NIST AI 100-2, approved by a second officer.',
        doneWhen: 'an approved threat model', check: (f) => done(f.threatModel?.status === 'APPROVED', f.threatModel ? `Threat model ${f.threatModel.status}` : null, { started: !!f.threatModel }),
        link: modelLink('testing') },
      { id: 'w9-4', step: 'W9.4', title: 'Initiate a formal audit, record findings', who: 'Auditor / reviewer', where: 'Audit Trail › Model audits (model page › History › Formal audits)',
        recurring: true, controls: ['CTL-AUD-01'], why: 'Stamps the verdict and the next-audit date (HIGH 6, MEDIUM 12, LOW 24 months).', doneWhen: 'an audit with its next-due date still ahead',
        check: (f) => !f.audit ? done(false, 'No audit yet')
          : { done: !f.m.nextAuditDue || f.m.nextAuditDue.getTime() >= f.now.getTime(), overdue: !!f.m.nextAuditDue && f.m.nextAuditDue.getTime() < f.now.getTime(), lastDoneAt: f.audit.at, nextDueAt: f.m.nextAuditDue,
              detail: `Last audit ${iso(f.audit.at)}${f.audit.verdict ? ` (${f.audit.verdict})` : ''}${f.m.nextAuditDue ? `, next due ${iso(f.m.nextAuditDue)}` : ''}` },
        blocker: (f) => (f.audit && f.m.nextAuditDue && f.m.nextAuditDue.getTime() < f.now.getTime() ? `${f.m.name}'s formal audit is overdue (due ${iso(f.m.nextAuditDue)}).` : null),
        link: withModel('audit') },
      { id: 'w9-5', step: 'W9.5', title: 'Verify the tamper-evident event chain', who: 'Auditor', where: 'Audit Trail › API action log › Verify chain', kind: 'shortcut',
        why: 'Recomputes the SHA-256 chain. Any edited or deleted record breaks it.', link: withModel('audit') },
    ],
  },
  {
    id: 'm-w6', workflow: 'W6', phase: '4 · Approve and ship', title: 'Approval and deploy gate', summary: 'Board approval, Promote (runs the deploy gate), CI, validation and attestation.',
    steps: [
      { id: 'w6-1', step: 'W6.1', title: 'Request review-board approval to a stage, with quorum', who: 'Model owner', where: 'Alignment › Deployment approvals › Request',
        applies: (f) => MED_OR_HIGH.has(f.m.riskLevel),
        why: 'MEDIUM and HIGH models can’t go live without a recorded board approval. LOW models have a self-service path.', doneWhen: 'a request is pending or approved',
        check: (f) => done(LIVE.has(f.m.lifecycleStage) || ['PENDING', 'APPROVED'].includes(f.approval?.status ?? ''), f.approval ? `Latest request ${f.approval.status} → ${f.approval.targetStage}` : null),
        link: route('alignment', { tab: 'approvals' }) },
      { id: 'w6-2', step: 'W6.2', title: 'See what is waiting for you', who: 'Approvers', where: 'Alignment › Inbox & due soon', kind: 'shortcut',
        why: 'Approvers start here.', link: route('alignment', { tab: 'inbox' }) },
      { id: 'w6-3', step: 'W6.3', title: 'Approve or reject', who: 'APPROVER / CISO / ADMIN', where: 'Alignment › Deployment approvals', deps: ['w6-1'],
        applies: (f) => MED_OR_HIGH.has(f.m.riskLevel), why: 'The requester can’t decide their own request, and nobody votes twice.', doneWhen: 'approved with quorum',
        check: (f) => done(LIVE.has(f.m.lifecycleStage) || f.approval?.status === 'APPROVED', null, { started: f.approval?.status === 'PENDING' }),
        link: route('alignment', { tab: 'approvals' }) },
      { id: 'w6-4', step: 'W6.4', title: 'Promote to the approved stage (runs the deploy gate)', who: 'Model owner', where: 'Alignment › Promote',
        deps: (f) => [...(MED_OR_HIGH.has(f.m.riskLevel) ? ['w6-3'] : []), ...(f.gate?.mode === 'BLOCK' ? ['w4-5'] : [])],
        why: 'Promotion runs the deploy gate: unaccepted residual risk or a missing FINAL impact assessment warns or blocks, per your settings.', doneWhen: 'lifecycle stage is DEPLOYED or MONITORING',
        check: (f) => done(LIVE.has(f.m.lifecycleStage), `Stage ${f.m.lifecycleStage}`), link: route('alignment', { tab: 'approvals' }) },
      { id: 'w6-5', step: 'W6.5', title: 'See approval state while fixing gaps', who: 'Model owner', where: 'Model page › Approvals & lifecycle', kind: 'shortcut',
        why: 'Approval status sits next to the gaps you are fixing.', link: modelLink('approvals') },
      { id: 'w6-6', step: 'W6.6', title: 'CI blocks unapproved or ungoverned code; auditor override', who: 'CI / officer', where: 'CI Gate Ledger',
        applies: (f) => !!f.ciLatest, why: 'The deploy stays blocked until the latest gate passes or an officer overrides with a reason.', doneWhen: 'the latest gate run passed or was overridden',
        check: (f) => done(f.ciLatest!.verdict === 'PASS' || f.ciLatest!.overridden, `Latest gate run: ${f.ciLatest!.verdict}${f.ciLatest!.overridden ? ' (overridden)' : ''}`),
        blocker: () => 'The latest CI gate run for this project failed.', link: route('ci-ledger') },
      { id: 'w6-7', step: 'W6.7', title: 'Independent validation before use (banks)', who: 'Validator, then an officer', where: 'Model page › Context, risk & impact › Model validation',
        flags: ['modelValidation'], applies: (f) => f.m.mrmInScope === true, deps: ['w2-3'], recurring: true, controls: ['CTL-VAL-01', 'CTL-VAL-02'],
        why: 'An independent validator reviews the model before use and again on revalidation.', doneWhen: 'a current, independent, completed validation',
        check: (f) => { const v = f.gov.validation ?? {}; const exp = v.expiresAt ? new Date(v.expiresAt) : null;
          const current = v.status === 'COMPLETED' && v.independent && v.result !== 'REJECTED' && (!exp || exp.getTime() > f.now.getTime());
          return { done: current, overdue: v.status === 'COMPLETED' && !!exp && exp.getTime() <= f.now.getTime(), started: !!v.status, nextDueAt: exp, detail: v.status ? `Validation ${v.status}${v.result ? ` · ${v.result}` : ''}` : null }; },
        link: modelLink('risk') },
      { id: 'w6-8', step: 'W6.8', title: 'Periodic attestation that controls still hold', who: 'Owners', where: 'Alignment › Attestations', deps: ['w6-4'],
        why: 'Owners attest or flag each in-scope model in the open campaign.', doneWhen: 'attested in the latest campaign',
        check: (f) => done(f.attestation?.status === 'ATTESTED', f.attestation ? `Latest item ${f.attestation.status}` : 'Not in a campaign yet', { started: !!f.attestation }),
        link: route('alignment', { tab: 'attestations' }) },
    ],
  },
  {
    id: 'm-w7', workflow: 'W7', phase: '5 · Operate', title: 'Monitoring, drift and runtime control', summary: 'Drift, BCP drills, runtime, kill switch and energy.',
    steps: [
      { id: 'w7-1', step: 'W7.1', title: 'Push reference and live scores; evaluate drift (PSI)', who: 'System / model owner', where: 'Drift Monitoring › Evaluate now',
        recurring: true, controls: ['CTL-MON-01'], why: 'Drift evidence expires after 30 days. The circuit breaker trips when PSI passes 0.20.', doneWhen: 'drift evaluated in the last 30 days',
        check: (f) => within(f.driftAt, 30, f.now, 'drift evaluation'), link: withModel('monitoring') },
      { id: 'w7-2', step: 'W7.2', title: 'Record BCP drills', who: 'Model owner', where: 'Drift Monitoring › BCP drills › Record drill', flags: ['bcpDrills'],
        applies: (f) => HIGH.has(f.m.riskLevel), recurring: true, controls: ['CTL-BCP-01', 'CTL-RES-01'],
        why: 'HIGH and CRITICAL models need a passed drill every 365 days. A failed drill is recorded but doesn’t count.', doneWhen: 'a PASSED drill in the last 365 days',
        check: (f) => within(f.drillPassedAt, 365, f.now, 'passed drill'), link: withModel('monitoring') },
      { id: 'w7-3', step: 'W7.3', title: 'See runtime events, scope deviations and the timeline', who: 'Reviewer / CISO', where: 'Runtime Visibility; model page › History', kind: 'shortcut',
        why: 'Tool calls outside the permitted set are flagged on arrival.', link: withModel('visibility') },
      { id: 'w7-4', step: 'W7.4', title: 'Kill switch: suspend or resume', who: 'ADMIN / CISO', where: 'Model page › Overview & gaps › Operational control', kind: 'shortcut',
        why: 'For emergencies. Deployed agents poll and halt.', link: modelLink('overview') },
      { id: 'w7-5', step: 'W7.5', title: 'Track energy use', who: 'Model owner', where: 'Model page › Operations › Record a reading', flags: ['energy'], recurring: true, controls: ['CTL-ENERGY-01'],
        why: 'kWh and kg CO₂e per model, from recorded readings.', doneWhen: 'a reading within the last year',
        check: (f) => within(f.gov.energy?.lastReadingAt ? new Date(f.gov.energy.lastReadingAt) : null, f.gov.energy?.maxAgeDays ?? 365, f.now, 'reading'), link: modelLink('operations') },
    ],
  },
  {
    id: 'm-w8', workflow: 'W8', phase: '5 · Operate', title: 'Incidents and grievances', summary: 'Steps appear when an incident or grievance is open on this model.',
    steps: [
      { id: 'w8-1', step: 'W8.1', title: 'Report an incident (category, severity)', who: 'Anyone', where: 'Incidents › Report', kind: 'action',
        why: 'Severity sets the reporting clock: P1 6 h, P2 24 h, P3 72 h, P4 7 days.', link: withModel('incidents') },
      { id: 'w8-2', step: 'W8.2', title: 'Move status (investigating, resolved, closed)', who: 'Model owner', where: 'Incidents › status', applies: (f) => incidentsOpen(f).length > 0,
        why: 'Keeps the reporting clock and the board pack accurate.', doneWhen: 'no incident left open',
        check: (f) => done(false, `${count(incidentsOpen(f).length, 'open incident')}`, { started: true }), link: withModel('incidents') },
      { id: 'w8-3', step: 'W8.3', title: 'Senior sign-off on P1 / P2 incidents', who: 'Officer or accountable official', where: 'Incidents › Sign-off, notices & tickets › Sign off',
        flags: ['incidentExtensions'], applies: (f) => incidentsOpen(f).some((i) => ['P1_CRITICAL', 'P2_HIGH'].includes(i.severity)),
        why: 'Serious incidents need a senior decision inside the reporting clock.', doneWhen: 'every open P1 / P2 incident signed off',
        check: (f) => { const n = incidentsOpen(f).filter((i) => ['P1_CRITICAL', 'P2_HIGH'].includes(i.severity) && !i.signedOff).length; return done(n === 0, n ? `${n} awaiting sign-off` : null); },
        blocker: (f) => `A P1 or P2 incident on ${f.m.name} has no senior sign-off.`, link: withModel('incidents') },
      { id: 'w8-4', step: 'W8.4', title: 'Notify affected people, or record why not', who: 'Model owner', where: 'Same panel', flags: ['incidentExtensions'], applies: (f) => incidentsOpen(f).length > 0,
        why: 'Either a notice is sent or the reason it isn’t is on record.', doneWhen: 'every open incident has a notice or a reason',
        check: (f) => { const n = incidentsOpen(f).filter((i) => !i.notified).length; return done(n === 0, n ? `${n} without a notice or reason` : null); }, link: withModel('incidents') },
      { id: 'w8-5', step: 'W8.5', title: 'DTA notification, CISA playbook, ticket, push to ITSM', who: 'Model owner', where: 'Same panel', flags: ['incidentExtensions'],
        applies: (f) => incidentsOpen(f).length > 0, controls: ['CTL-INC-02'],
        why: 'External notifications and tickets, per the packs in force and your integrations.', doneWhen: 'every open incident has a ticket and the incident controls pass',
        check: (f) => { const n = incidentsOpen(f).filter((i) => !i.ticket).length; return done(n === 0, n ? `${n} without a ticket` : null); }, link: withModel('incidents') },
      { id: 'w8-6', step: 'W8.6', title: 'Raise a corrective action', who: 'Model owner', where: 'Incidents › Raise action → Governance › Corrective actions', flags: ['correctiveActions'],
        applies: (f) => incidentsOpen(f).length > 0, why: 'Stops the same incident happening again.', doneWhen: 'every open incident has a corrective action',
        check: (f) => { const n = incidentsOpen(f).filter((i) => !i.correctiveAction).length; return done(n === 0, n ? `${n} without an action` : null); }, link: govLink('actions') },
      { id: 'w8-7', step: 'W8.7', title: 'File a grievance', who: 'Anyone (or the public via the transparency card)', where: 'Consumer Grievances › File', kind: 'action',
        why: 'SLA by severity: HIGH 7 days, MEDIUM 15, LOW 30.', link: withModel('grievances', { file: '1' }) },
      { id: 'w8-8', step: 'W8.8', title: 'Resolve grievances: link a decision, reconsider, appeal', who: 'Reviewer', where: 'Consumer Grievances › Decision… (kept in Decisions & appeals)',
        applies: (f) => f.grievances.open > 0, why: 'Lets a customer contest the decision the model made about them.', doneWhen: 'no grievance left open',
        check: (f) => done(false, `${count(f.grievances.open, 'open grievance')}${f.grievances.pastSla ? `, ${f.grievances.pastSla} past SLA` : ''}`, { started: true }),
        blocker: (f) => (f.grievances.pastSla ? `${count(f.grievances.pastSla, 'grievance')} on ${f.m.name} past the SLA.` : null), link: withModel('grievances') },
    ],
  },
  {
    id: 'm-w10', workflow: 'W10', phase: '6 · Review and disclose', title: 'Periodic review', lens: true,
    summary: 'Every recurring step for this model, by its next due date.',
    steps: [
      { id: 'w10-tevv', step: 'W10', title: 'Review the test sets (TEVV)', who: 'Model owner', where: 'Model page › Testing & security (TEVV)', flags: ['tevv'], recurring: true,
        controls: ['CTL-TEVV-01'], why: 'Test sets go stale as data changes.', doneWhen: 'test sets exist, have run and none is past its review date',
        check: (f) => { const t = f.gov.tevv ?? { testSets: 0, reviewOverdue: 0, neverRun: 0 }; return { done: t.testSets > 0 && t.reviewOverdue === 0 && t.neverRun === 0, overdue: t.reviewOverdue > 0, started: t.testSets > 0, detail: t.testSets ? `${count(t.testSets, 'test set')}${t.reviewOverdue ? `, ${t.reviewOverdue} review overdue` : ''}${t.neverRun ? `, ${t.neverRun} never run` : ''}` : 'No test sets' }; },
        link: modelLink('testing') },
    ],
  },
  {
    id: 'm-w11', workflow: 'W11', phase: '6 · Review and disclose', title: 'Transparency and disclosure', summary: 'Model card, public transparency card and US adverse-action notices.',
    steps: [
      { id: 'w11-card', step: 'W11', title: 'Publish a final model card', who: 'Model owner', where: 'Model page › Model card', flags: ['modelCards'],
        why: 'Feeds the transparency card, the readiness report and the board pack.', doneWhen: 'the latest model card is FINAL',
        check: (f) => done(f.card?.status === 'FINAL', f.card ? `Latest version ${f.card.status}` : 'No model card yet', { started: !!f.card }), link: modelLink('card') },
      { id: 'w11-1', step: 'W11.1', title: 'Public transparency card per model', who: 'System', where: 'Link on the model page header (/card/<id>)', kind: 'system',
        why: 'Every model has one, with a no-login File a grievance button.', link: modelLink('overview') },
      { id: 'w11-3', step: 'W11.3', title: 'Adverse-action notices and reason codes (US lending)', who: 'Reviewer', where: 'Governance › Risk & impact › Decisions & appeals',
        flags: ['usKit'], packs: [ORG_PACKS.us], controls: ['CTL-AA-01', 'CTL-AA-02', 'CTL-APPEAL-01'],
        why: 'US lending decisions driven by AI need notices with accurate reason codes, and a way to appeal.', doneWhen: 'the notice and appeal controls pass', link: govLink('decisions') },
    ],
  },
  {
    id: 'm-w12', workflow: 'W12', phase: '7 · Retire', title: 'Retirement', optional: true, startedBy: 'w12-1', summary: 'Optional. Counts toward progress only once retirement is requested.',
    steps: [
      { id: 'w12-1', step: 'W12.1', title: 'Request retirement with a reason', who: 'Model owner', where: 'Model page › Testing & security › Retirement', flags: ['tevv'],
        why: 'With governance on, decommissioning goes through retirement.', doneWhen: 'a request is recorded',
        check: (f) => done(!!f.retirement && f.retirement.status !== 'CANCELLED', f.retirement ? `Retirement ${f.retirement.status}` : null), link: modelLink('testing') },
      { id: 'w12-2', step: 'W12.2', title: 'Approve or reject', who: 'An officer other than the requester', where: 'Alignment › Inbox (Retirement) → same tab', flags: ['tevv'], deps: ['w12-1'],
        why: 'An independent officer decides.', doneWhen: 'approved', check: (f) => done(['APPROVED', 'COMPLETED'].includes(f.retirement?.status ?? '')), link: route('alignment', { tab: 'inbox' }) },
      { id: 'w12-3', step: 'W12.3', title: 'Work through the six-item checklist, then complete', who: 'Model owner', where: 'Same tab', flags: ['tevv'], deps: ['w12-2'],
        why: 'MODEL_RETIRED is written to the ledger and the model becomes DECOMMISSIONED.', doneWhen: 'retirement COMPLETED',
        check: (f) => done(f.retirement?.status === 'COMPLETED'), link: modelLink('testing') },
      { id: 'w12-4', step: 'W12.4', title: 'Issue data deletion orders for the model’s datasets', who: 'Model owner', where: 'Governance › Data register', flags: ['tevv', 'dataRegister'], deps: ['w12-3'],
        why: 'Datasets only this model used are deleted or justified.', doneWhen: 'no dataset of this model is past retention without an order',
        check: (f) => done((f.gov.datasets?.pendingDeletion ?? 0) === 0), link: govLink('datasets') },
    ],
  },
];

/* ------------------------------------------------------------ evaluation */

export interface StepView {
  id: string;
  step: string;
  title: string;
  who: string;
  where: string;
  why: string;
  done_when: string | null;
  status: StepStatus;
  counted: boolean;
  detail: string | null;
  gaps: string[];
  controls: string[];
  waiting_on: Array<{ id: string; step: string; title: string; scope: WorkflowScope }>;
  recurring: boolean;
  last_done_at: string | null;
  next_due_at: string | null;
  packs: string[];
  link: StepLink;
  /** Set on rows a periodic-review stage borrows from another stage. */
  from_stage?: string;
}

export interface StageView {
  id: string;
  workflow: string;
  title: string;
  summary: string;
  phase: string;
  optional: boolean;
  lens: boolean;
  done: number;
  total: number;
  status: 'complete' | 'in_progress' | 'blocked' | 'overdue' | 'not_started' | 'nothing_open' | 'optional';
  steps: StepView[];
}

export interface Blocker {
  message: string;
  step_id: string;
  scope: WorkflowScope;
}

export interface WorkflowView {
  scope: WorkflowScope;
  stages: StageView[];
  done: number;
  total: number;
  blockers: Blocker[];
  next: { step_id: string; scope: WorkflowScope; step: string; title: string; who: string; reason: string; unblocks: number; link: StepLink } | null;
}

/** Status of each step id in another scope (org steps that model steps depend on). */
export type ExternalStatus = Map<string, { status: StepStatus; step: string; title: string }>;

function applicable<F extends FactsBase>(s: StepDef<F>, f: F): boolean {
  if (s.flags && !s.flags.every((fl) => f.flags(fl))) return false;
  if (s.packs && !s.packs.some((p) => f.packs.includes(p))) return false;
  if (s.applies && !s.applies(f)) return false;
  // A step with only controls exists while one of them is evaluated for this scope.
  if (!s.check && !s.kind && s.controls && !s.controls.some((c) => f.controls.has(c))) return false;
  return true;
}

function controlResult(s: StepDef, f: FactsBase): { pass: boolean; gaps: string[] } {
  const outs = (s.controls ?? []).map((c) => f.controls.get(c)).filter((o): o is ControlOutcome => !!o && !o.notAssessed);
  return { pass: outs.every((o) => o.passed), gaps: [...new Set(outs.flatMap((o) => (o.passed ? [] : o.gaps)).filter(Boolean))] };
}

/** Evaluate every stage for one scope. */
export function evaluateWorkflow<F extends FactsBase>(scope: WorkflowScope, stages: StageDef<F>[], f: F, external: ExternalStatus = new Map()): WorkflowView {
  type Raw = { def: StepDef<F>; stage: StageDef<F>; check: StepCheck | null; gaps: string[] };
  const raw = new Map<string, Raw>();
  for (const st of stages) {
    for (const s of st.steps) {
      if (!applicable(s, f)) continue;
      let check: StepCheck | null = null;
      let gaps: string[] = [];
      if (!s.kind) {
        const c = controlResult(s, f);
        gaps = c.gaps;
        const rec = s.check ? s.check(f) : { done: true };
        check = { ...rec, done: rec.done && c.pass, started: rec.started || (rec.done && !c.pass) };
        if (rec.done && !c.pass && !rec.detail) check.detail = `${c.gaps.length} control gap(s) remain`;
      }
      raw.set(s.id, { def: s, stage: st, check, gaps });
    }
  }

  const statusCache = new Map<string, StepStatus>();
  const depList = (s: StepDef<F>) => (typeof s.deps === 'function' ? s.deps(f) : s.deps ?? []);
  const satisfied = (st: StepStatus | undefined) => st === undefined || st === 'done' || st === 'overdue' || st === 'system';
  const statusOf = (id: string, seen = new Set<string>()): StepStatus | undefined => {
    if (id.startsWith('org:')) return external.get(id.slice(4))?.status;
    if (statusCache.has(id)) return statusCache.get(id);
    const r = raw.get(id);
    if (!r) return undefined; // not applicable: never blocks
    let st: StepStatus;
    if (r.def.kind === 'shortcut') st = 'shortcut';
    else if (r.def.kind === 'action') st = 'action';
    else if (r.def.kind === 'system') st = 'system';
    else if (r.check!.overdue) st = 'overdue';
    else {
      // A step can't count as done ahead of the steps it builds on (nothing to review before a scan).
      seen.add(id);
      const missing = depList(r.def).filter((d) => !seen.has(d) && !satisfied(statusOf(d, seen)));
      st = missing.length ? 'blocked' : r.check!.done ? 'done' : r.check!.started ? 'in_progress' : 'todo';
    }
    statusCache.set(id, st);
    return st;
  };
  const missingDeps = (s: StepDef<F>) =>
    depList(s).filter((d) => !satisfied(statusOf(d))).map((d) => {
      if (d.startsWith('org:')) { const e = external.get(d.slice(4))!; return { id: d.slice(4), step: e.step, title: e.title, scope: 'org' as const }; }
      const r = raw.get(d)!; return { id: d, step: r.def.step, title: r.def.title, scope };
    });

  const counted = (r: Raw, optionalStarted: boolean) => !r.def.kind && !(r.stage.optional && !optionalStarted);
  const view = (r: Raw, optionalStarted: boolean, from?: string): StepView => ({
    id: r.def.id, step: r.def.step, title: r.def.title, who: r.def.who, where: r.def.where, why: r.def.why, done_when: r.def.doneWhen ?? null,
    status: statusOf(r.def.id)!, counted: from ? false : counted(r, optionalStarted), detail: r.check?.detail ?? null, gaps: r.gaps,
    controls: r.def.controls ?? [], waiting_on: statusOf(r.def.id) === 'blocked' ? missingDeps(r.def) : [],
    recurring: !!r.def.recurring, last_done_at: r.check?.lastDoneAt?.toISOString() ?? null, next_due_at: r.check?.nextDueAt?.toISOString() ?? null,
    packs: r.def.packs ?? [], link: r.def.link(f), ...(from ? { from_stage: from } : {}),
  });

  const stageViews: StageView[] = stages.map((st) => {
    const own = [...raw.values()].filter((r) => r.stage === st);
    const optionalStarted = !st.optional || own.some((r) => (!st.startedBy || r.def.id === st.startedBy) && r.check && (r.check.done || r.check.started));
    const steps = own.map((r) => view(r, optionalStarted));
    if (st.lens) {
      for (const r of raw.values()) if (r.stage !== st && r.def.recurring) steps.push(view(r, optionalStarted, r.stage.workflow));
    }
    const c = steps.filter((s) => s.counted);
    const doneN = c.filter((s) => s.status === 'done').length;
    const anyOverdue = steps.some((s) => s.status === 'overdue');
    const anyBlocked = c.some((s) => s.status === 'blocked');
    const status: StageView['status'] = st.optional && !optionalStarted ? 'optional'
      : !c.length ? 'nothing_open'
        : anyOverdue ? 'overdue'
          : doneN === c.length ? 'complete'
            : anyBlocked ? 'blocked'
              : c.some((s) => s.status !== 'todo') ? 'in_progress' : 'not_started';
    return { id: st.id, workflow: st.workflow, title: st.title, summary: st.summary, phase: st.phase, optional: !!st.optional, lens: !!st.lens, done: doneN, total: c.length, status, steps };
  });

  const allCounted = stageViews.flatMap((s) => s.steps.filter((x) => x.counted));
  const blockers: Blocker[] = [];
  for (const r of raw.values()) {
    const st = statusOf(r.def.id)!;
    if (st === 'done' || r.def.kind) continue;
    const msg = r.def.blocker?.(f);
    if (msg) blockers.push({ message: msg, step_id: r.def.id, scope });
    else if (st === 'overdue') blockers.push({ message: `${r.def.step} ${r.def.title}: ${r.check?.detail ?? 'overdue'}.`, step_id: r.def.id, scope });
  }

  // Next best action: clear a blocker first (or the first step it waits on), then the earliest unfinished stage.
  const actionable = (id: string, seen = new Set<string>()): string | null => {
    if (seen.has(id) || id.startsWith('org:')) return null;
    seen.add(id);
    const st = statusOf(id);
    const r = raw.get(id);
    if (!r) return null;
    if (st === 'blocked') {
      for (const d of depList(r.def)) { const a = actionable(d, seen); if (a) return a; }
      return null;
    }
    return st === 'todo' || st === 'in_progress' || st === 'overdue' ? id : null;
  };
  const unblocks = (id: string): number => {
    const hit = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of raw.values()) {
        if (hit.has(r.def.id) || statusOf(r.def.id) !== 'blocked') continue;
        if (depList(r.def).some((d) => hit.has(d))) { hit.add(r.def.id); grew = true; }
      }
    }
    return hit.size - 1;
  };
  let next: WorkflowView['next'] = null;
  const pick = (id: string, reason: string) => {
    const r = raw.get(id)!;
    next = { step_id: id, scope, step: r.def.step, title: r.def.title, who: r.def.who, reason, unblocks: unblocks(id), link: r.def.link(f) };
  };
  for (const b of blockers) {
    const a = actionable(b.step_id);
    if (a) { pick(a, a === b.step_id ? 'Clears a blocker.' : `Clears the way for ${raw.get(b.step_id)!.def.step}.`); break; }
  }
  if (!next) {
    for (const st of stageViews) {
      const c = st.steps.filter((s) => s.counted && !s.from_stage);
      const p = c.find((s) => s.status === 'in_progress') ?? c.find((s) => s.status === 'todo' || s.status === 'overdue');
      if (p) { pick(p.id, p.status === 'in_progress' ? 'Already started, in the earliest unfinished stage.' : 'Next step in the earliest unfinished stage.'); break; }
    }
  }

  return { scope, stages: stageViews, done: allCounted.filter((s) => s.status === 'done').length, total: allCounted.length, blockers, next };
}

/** Status of every org step, for model steps that depend on organisation steps. */
export function externalFrom(view: WorkflowView): ExternalStatus {
  const out: ExternalStatus = new Map();
  for (const st of view.stages) for (const s of st.steps) if (!s.from_stage) out.set(s.id, { status: s.status, step: s.step, title: s.title });
  return out;
}
