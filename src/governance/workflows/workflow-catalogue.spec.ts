import { evaluateWorkflow, externalFrom, MODEL_STAGES, ModelFacts, ORG_STAGES, OrgFacts, StageDef } from './workflow-catalogue';

const NOW = new Date('2026-06-01T00:00:00Z');
const allOn = () => true;

const orgFacts = (o: Partial<OrgFacts> = {}): OrgFacts => ({
  now: NOW, flags: allOn, packs: ['nist-ai-rmf', 'iso-42001'], controls: new Map(),
  org: { id: 'o1', accountableOfficial: false, board: false }, roles: { OWNER: 1 },
  settings: { isDefault: true, version: 0, primaryJurisdiction: 'INTL', changedFields: new Set(), peopleItemsOpen: 0 },
  integrations: 0, aiProviders: 0,
  aims: { policyApproved: false, policyOverdue: false, scopeApproved: false, objectives: 0, mgmtReviewAt: null },
  documents: 0, soaApprovedAt: null, trainingCourses: 0, frameworkReview: null,
  projects: { total: 1, withCode: 1, scanned: 1, pendingCandidates: 0, ciEvents: 0, boardNarrativeAt: null },
  models: { total: 1, missingOwnerOrPolicy: 0 }, attestation: { open: 0, lastOpenedAt: null, cadenceDays: null },
  datasetsPastRetention: 0, transparencyPublishedAt: null, transparencyOverdue: false,
  ...o,
});

const modelFacts = (o: Partial<ModelFacts> = {}, m: Partial<ModelFacts['m']> = {}): ModelFacts => ({
  now: NOW, flags: allOn, packs: ['nist-ai-rmf', 'iso-42001'], controls: new Map(),
  m: {
    id: 'm1', name: 'Fraud graph', riskLevel: 'HIGH', modelType: 'MACHINE_LEARNING', lifecycleStage: 'DEVELOPMENT', projectId: 'p1',
    ownerTeam: 'Risk', ownerUserId: 'u1', riskRationale: 'Credit decisions', sutras: [], humanOversight: true, boardPolicyRef: 'BP-1',
    lastRedTeamDate: null, nextAuditDue: null, gapRemediation: null, evidenceTypes: [], detectedTools: [], permittedTools: [],
    contextProfile: null, mrmInScope: null, ...m,
  },
  gov: {}, gate: null, openGaps: 0, ia: null, riskActions: 0, approval: null, threatModel: null, securityEvaluations: 0, audit: null,
  driftAt: null, drillPassedAt: null, incidents: [], grievances: { open: 0, pastSla: 0 }, retirement: null, card: null,
  attestation: null, ciLatest: null, redTeamIntervalDays: 90,
  ...o,
});

const find = (v: ReturnType<typeof evaluateWorkflow>, id: string) => v.stages.flatMap((s) => s.steps).find((s) => s.id === id && !s.from_stage);

describe('workflow catalogue', () => {
  it('has unique step ids and only depends on steps that exist', () => {
    const ids = [...ORG_STAGES, ...MODEL_STAGES].flatMap((s: StageDef) => s.steps.map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
    const f = modelFacts();
    for (const st of MODEL_STAGES) for (const s of st.steps) {
      const deps = typeof s.deps === 'function' ? s.deps(f) : s.deps ?? [];
      for (const d of deps) expect(ids).toContain(d.replace(/^org:/, ''));
    }
  });

  it('marks the jurisdiction step as a blocker until settings are saved', () => {
    let v = evaluateWorkflow('org', ORG_STAGES, orgFacts());
    expect(find(v, 'w0-2')!.status).toBe('todo');
    expect(v.blockers.map((b) => b.step_id)).toContain('w0-2');
    v = evaluateWorkflow('org', ORG_STAGES, orgFacts({ settings: { isDefault: false, version: 2, primaryJurisdiction: 'IN', changedFields: new Set(['enabledPacks']), peopleItemsOpen: 0 } }));
    expect(find(v, 'w0-2')!.status).toBe('done');
  });

  it('shows pack steps only when the pack is in force', () => {
    expect(find(evaluateWorkflow('model', MODEL_STAGES, modelFacts()), 'w2-5')).toBeUndefined();
    expect(find(evaluateWorkflow('model', MODEL_STAGES, modelFacts({ packs: ['rbi-free-ai'] })), 'w2-5')).toBeDefined();
  });

  it('needs both the record and the pack controls to pass', () => {
    const failing = new Map([['CTL-ACC-01', { passed: false, notAssessed: false, gaps: ['No named owner'], clauses: ['iso-42001:5.3'] }]]);
    const s = find(evaluateWorkflow('model', MODEL_STAGES, modelFacts({ controls: failing })), 'w1-7')!;
    expect(s.status).toBe('in_progress');
    expect(s.gaps).toEqual(['No named owner']);
    const passing = new Map([['CTL-ACC-01', { passed: true, notAssessed: false, gaps: [], clauses: [] }]]);
    expect(find(evaluateWorkflow('model', MODEL_STAGES, modelFacts({ controls: passing })), 'w1-7')!.status).toBe('done');
  });

  it('hides control-only steps whose controls are not evaluated for the packs in force', () => {
    expect(find(evaluateWorkflow('model', MODEL_STAGES, modelFacts()), 'w11-3')).toBeUndefined();
  });

  it('blocks a step on an unfinished organisation step and points the next action at it', () => {
    const org = evaluateWorkflow('org', ORG_STAGES, orgFacts());
    const v = evaluateWorkflow('model', MODEL_STAGES, modelFacts({}, { boardPolicyRef: null }), externalFrom(org));
    const s = find(v, 'w5-8')!;
    expect(s.status).toBe('blocked');
    expect(s.waiting_on[0]).toMatchObject({ id: 'w0-7', scope: 'org' });
  });

  it('turns lapsed recurring work overdue and lists it in periodic review', () => {
    const v = evaluateWorkflow('model', MODEL_STAGES, modelFacts({ driftAt: new Date('2026-03-01T00:00:00Z') }));
    expect(find(v, 'w7-1')!.status).toBe('overdue');
    const lens = v.stages.find((s) => s.id === 'm-w10')!;
    expect(lens.steps.some((s) => s.id === 'w7-1' && s.from_stage === 'W7' && !s.counted)).toBe(true);
  });

  it('counts retirement only once requested and incident steps only when one is open', () => {
    let v = evaluateWorkflow('model', MODEL_STAGES, modelFacts());
    expect(v.stages.find((s) => s.id === 'm-w12')!.status).toBe('optional');
    expect(find(v, 'w8-2')).toBeUndefined();
    v = evaluateWorkflow('model', MODEL_STAGES, modelFacts({
      retirement: { status: 'REQUESTED' },
      incidents: [{ severity: 'P1_CRITICAL', status: 'REPORTED', signedOff: false, notified: false, ticket: false, correctiveAction: false }],
    }));
    expect(v.stages.find((s) => s.id === 'm-w12')!.total).toBeGreaterThan(0);
    expect(find(v, 'w8-3')!.status).toBe('todo');
    expect(v.blockers.some((b) => b.step_id === 'w8-3')).toBe(true);
  });

  it('never counts shortcuts and reports progress over counted steps', () => {
    const v = evaluateWorkflow('model', MODEL_STAGES, modelFacts());
    const counted = v.stages.flatMap((s) => s.steps.filter((x) => x.counted));
    expect(counted.every((s) => !['shortcut', 'action', 'system'].includes(s.status))).toBe(true);
    expect(v.total).toBe(counted.length);
  });
});

describe('EU AI Act workflow steps', () => {
  const eu = (o: Record<string, any> = {}) => ({
    roles: ['PROVIDER'], scopeDecided: true, tier: 'High Risk', highRisk: true,
    art5: { signed: true, complete: true, prohibited: [], unanswered: [] },
    classification: { signed: true, annexIII: ['5(b)'] },
    annexIV: { score: 100, missing: [] }, instructions: { missing: [] },
    conformity: { status: 'NONE' }, declaration: { issued: false }, ce: { affixed: false },
    registration: { required: ['A'], missing: ['A'] }, art50: { missing: [] },
    pmm: { missing: [], reviewOverdue: false }, incidents: { serious: 0, overdue: 0, problems: [] },
    explanations: { open: 0, overdue: 0 }, valueChain: { open: 0 }, nonconformity: { open: 0, informPending: 0 },
    ...o,
  });
  const ids = (v: ReturnType<typeof evaluateWorkflow>) => v.stages.flatMap((s) => s.steps).map((s) => s.id);

  it('appears only with the EU pack in force and the workspace facts present', () => {
    expect(ids(evaluateWorkflow('model', MODEL_STAGES, modelFacts({ gov: { euAct: eu() } }))).filter((i) => i.startsWith('eu-'))).toEqual([]);
    expect(ids(evaluateWorkflow('model', MODEL_STAGES, modelFacts({ packs: ['eu-ai-act'] }))).filter((i) => i.startsWith('eu-'))).toEqual([]);
    const off = (fl: string) => fl !== 'euAiAct';
    expect(ids(evaluateWorkflow('model', MODEL_STAGES, modelFacts({ packs: ['eu-ai-act'], flags: off as any, gov: { euAct: eu() } }))).filter((i) => i.startsWith('eu-'))).toEqual([]);
    const v = evaluateWorkflow('model', MODEL_STAGES, modelFacts({ packs: ['eu-ai-act'], gov: { euAct: eu() } }));
    expect(ids(v)).toEqual(expect.arrayContaining(['eu-1', 'eu-2', 'eu-3', 'eu-4', 'eu-5', 'eu-6', 'eu-7', 'eu-11']));
    expect(ids(v)).not.toContain('eu-8'); // deployer duties: not a deployer
    expect(find(v, 'eu-5')!.status).toBe('todo');
    expect(find(v, 'eu-6')!.status).toBe('blocked');
    expect(find(v, 'eu-7')!.detail).toMatch(/section A/);
  });

  it('lists an Article 5 prohibited practice as a blocker', () => {
    const v = evaluateWorkflow('model', MODEL_STAGES, modelFacts({ packs: ['eu-ai-act'], gov: { euAct: eu({ art5: { signed: true, complete: true, prohibited: ['SOCIAL_SCORING'], unanswered: [] } }) } }));
    expect(find(v, 'eu-2')!.status).not.toBe('done');
    expect(v.blockers.map((b) => b.message).join(' ')).toMatch(/prohibited practice/);
  });

  it('shows the deployer, incident and explanation steps when they apply', () => {
    const controls = new Map([['CTL-EU-DEPLOYER', { passed: false, notAssessed: false, gaps: ['notice to affected persons'], clauses: [] }]]);
    const v = evaluateWorkflow('model', MODEL_STAGES, modelFacts({ packs: ['eu-ai-act'], controls, gov: { euAct: eu({
      roles: ['DEPLOYER'], incidents: { serious: 1, overdue: 1, problems: [] }, explanations: { open: 2, overdue: 1 } }) } }));
    expect(ids(v)).toEqual(expect.arrayContaining(['eu-8', 'eu-12', 'eu-13']));
    expect(ids(v)).not.toContain('eu-4');
    expect(v.blockers.map((b) => b.step_id)).toEqual(expect.arrayContaining(['eu-12', 'eu-13']));
  });

  it('adds the EU organisation step behind the pack', () => {
    const org = (packs: string[]) => evaluateWorkflow('org', ORG_STAGES, orgFacts({ packs, controls: new Map([['CTL-EU-ORG', { passed: false, notAssessed: false, gaps: ['No authorised representative'], clauses: [] }]]) }));
    expect(find(org(['iso-42001']), 'w0-eu')).toBeUndefined();
    expect(find(org(['eu-ai-act']), 'w0-eu')!.gaps).toEqual(['No authorised representative']);
  });
});
